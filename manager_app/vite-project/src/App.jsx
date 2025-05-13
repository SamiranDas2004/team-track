import React, { useEffect, useRef, useState } from 'react';
import io from 'socket.io-client';
import './App.css';

const socket = io('http://localhost:3000', { autoConnect: false });

function App() {
  const [teamId, setTeamId] = useState('team1');
  const [managerId, setManagerId] = useState('manager1');
  const [streams, setStreams] = useState({}); // { employeeId: { stream, peerConnection } }
  const [snapshots, setSnapshots] = useState({}); // { employeeId: [urls] }
  const [status, setStatus] = useState('Connecting...');
  const [activeEmployees, setActiveEmployees] = useState(0);
  const videoRefs = useRef({});
  const hasJoined = useRef(false);

  useEffect(() => {
    if (!socket.connected) {
      socket.connect();
    }

    socket.on('connect', () => {
      setStatus('Connected to server');
      if (!hasJoined.current) {
        socket.emit('join-team', { teamId, role: 'manager', userId: managerId });
        hasJoined.current = true;
      }
    });

    socket.on('connect_error', (err) => {
      setStatus(`Connection error: ${err.message}`);
    });

    socket.on('disconnect', (reason) => {
      setStatus(`Disconnected: ${reason}`);
    });

    const configuration = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun3.l.google.com:19302' },
        { urls: 'stun:stun4.l.google.com:19302' },
      ],
    };

    socket.on('offer', async (data) => {
      if (data.teamId !== teamId) return;

      console.log(`Received offer from ${data.employeeId}`);

      const peerConnection = new RTCPeerConnection(configuration);

      peerConnection.ontrack = (event) => {
        console.log(`Stream received for ${data.employeeId}`);
        setStreams((prev) => {
          const newStreams = {
            ...prev,
            [data.employeeId]: { stream: event.streams[0], peerConnection },
          };
          setActiveEmployees(Object.keys(newStreams).length);
          return newStreams;
        });
      };

      peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
          console.log(`Sending ICE candidate to ${data.employeeId}`);
          socket.emit('ice-candidate', {
            target: data.sender,
            candidate: event.candidate,
            teamId,
          });
        }
      };

      peerConnection.onconnectionstatechange = () => {
        console.log(`Connection state for ${data.employeeId}: ${peerConnection.connectionState}`);
        if (peerConnection.connectionState === 'failed') {
          console.error(`WebRTC connection failed for ${data.employeeId}`);
          setStreams((prev) => {
            const newStreams = { ...prev };
            delete newStreams[data.employeeId];
            setActiveEmployees(Object.keys(newStreams).length);
            return newStreams;
          });
          peerConnection.close();
        }
      };

      try {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(data.sdp));
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        socket.emit('answer', {
          sdp: answer,
          target: data.sender,
          teamId,
        });
        console.log(`Sent answer to ${data.employeeId}`);
      } catch (err) {
        console.error(`Error handling offer from ${data.employeeId}:`, err);
      }

      socket.on('ice-candidate', async (candidateData) => {
        if (candidateData.teamId === teamId && peerConnection.signalingState !== 'closed') {
          try {
            await peerConnection.addIceCandidate(new RTCIceCandidate(candidateData.candidate));
            console.log(`ICE candidate received for ${data.employeeId}`);
          } catch (err) {
            console.warn(`Error adding ICE candidate for ${data.employeeId}:`, err);
          }
        }
      });

      socket.on('employee-disconnect', (disconnectData) => {
        if (disconnectData.teamId === teamId && disconnectData.employeeId === data.employeeId) {
          console.log(`${data.employeeId} disconnected`);
          setStreams((prev) => {
            const newStreams = { ...prev };
            delete newStreams[data.employeeId];
            setActiveEmployees(Object.keys(newStreams).length);
            return newStreams;
          });
          peerConnection.close();
        }
      });
    });

    const snapshotInterval = setInterval(async () => {
      try {
        const res = await fetch(`http://localhost:3001/snapshots?teamId=${teamId}`);
        if (!res.ok) throw new Error(`HTTP error ${res.status}`);
        const data = await res.json();
        setSnapshots(data);
      } catch (err) {
        console.error('Error fetching snapshots:', err);
      }
    }, 60000);

    return () => {
      socket.off('connect');
      socket.off('connect_error');
      socket.off('disconnect');
      socket.off('offer');
      socket.off('ice-candidate');
      socket.off('employee-disconnect');
      Object.values(streams).forEach(({ peerConnection }) => peerConnection.close());
      socket.disconnect();
      clearInterval(snapshotInterval);
    };
  }, [teamId, managerId]);

  useEffect(() => {
    Object.entries(streams).forEach(([employeeId, { stream }]) => {
      if (videoRefs.current[employeeId]) {
        console.log(`Setting stream for ${employeeId}`);
        videoRefs.current[employeeId].srcObject = stream;
        videoRefs.current[employeeId].play().catch(err => {
          console.error(`Error playing video for ${employeeId}:`, err);
        });
      }
    });
  }, [streams]);

  const handleReconnect = () => {
    socket.disconnect();
    setStreams({});
    setActiveEmployees(0);
    setStatus('Connecting...');
    hasJoined.current = false;
    socket.connect();
  };

  return (
    <div className="App">
      <h1>Manager's Dashboard</h1>
      <div>
        <label>Team ID: </label>
        <input
          type="text"
          value={teamId}
          onChange={(e) => setTeamId(e.target.value)}
          disabled={Object.keys(streams).length > 0}
        />
      </div>
      <div>
        <label>Manager ID: </label>
        <input
          type="text"
          value={managerId}
          onChange={(e) => setManagerId(e.target.value)}
          disabled={Object.keys(streams).length > 0}
        />
      </div>
      <div>
        <p>Status: {status}</p>
        <p>Active Employees: {activeEmployees}</p>
      </div>
      <button onClick={handleReconnect}>Reconnect</button>
      <h2>Live Video Feeds</h2>
      <div className="video-grid">
        {Object.entries(streams).map(([employeeId, { stream }]) => (
          <div key={employeeId} className="video-container">
            <h3>{employeeId}</h3>
            <video
              ref={(el) => (videoRefs.current[employeeId] = el)}
              autoPlay
              playsInline
              muted
              style={{ width: '300px', height: '225px', background: 'black' }}
            />
          </div>
        ))}
      </div>
      <div className="snapshot-grid">
        {Object.entries(snapshots).map(([employeeId, urls]) => (
          <div key={employeeId} className="snapshot-container">
            <h3>{employeeId} Snapshots</h3>
            <div className="snapshot-images">
              {urls.map((url, idx) => (
                <img key={idx} src={url} alt={`Snapshot ${idx}`} style={{ width: '100px', margin: '5px' }} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default App;