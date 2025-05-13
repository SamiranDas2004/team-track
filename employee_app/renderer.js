const io = require('socket.io-client');
const { ipcRenderer } = require('electron');

// Get DOM elements
const toggleBtn = document.getElementById('toggleBtn');
const timerStatus = document.getElementById('timerStatus');
const video = document.getElementById('video');
const canvas = document.getElementById('canvas');
const snapshotContainer = document.getElementById('snapshotContainer');
const teamIdInput = document.getElementById('teamId');
const employeeIdInput = document.getElementById('employeeId');
const context = canvas.getContext('2d');

let stream = null;
let isTracking = false;
let snapshotInterval = null;
let peerConnection = null;
let reconnectInterval = null;

// Connect to signaling server

const socket = io('http://localhost:3000', { 
  autoConnect: true,
  reconnection: true,
  reconnectionAttempts: 10,
  reconnectionDelay: 2000
});

const configuration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ]
};

let teamId = 'team1';
let peerConnections = {};

socket.on('connect', () => {
  console.log('Manager connected to signaling server');
  socket.emit('join-team', { teamId, role: 'manager' });
});

socket.on('offer', async (data) => {
  const { sdp, teamId: offerTeamId, employeeId } = data;
  if (offerTeamId !== teamId) return;

  let peerConnection = peerConnections[employeeId];
  if (!peerConnection) {
    peerConnection = new RTCPeerConnection(configuration);
    peerConnections[employeeId] = peerConnection;

    peerConnection.ontrack = (event) => {
      const video = document.createElement('video');
      video.srcObject = event.streams[0];
      video.autoplay = true;
      video.style.width = '320px';
      document.body.appendChild(video);
    };

    peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit('ice-candidate', {
          target: employeeId,
          candidate: event.candidate,
          teamId,
          employeeId
        });
      }
    };

    peerConnection.oniceconnectionstatechange = () => {
      console.log(`Manager ICE state for ${employeeId}: ${peerConnection.iceConnectionState}`);
      if (peerConnection.iceConnectionState === 'disconnected' || 
          peerConnection.iceConnectionState === 'failed') {
        console.log(`Connection lost with ${employeeId}, waiting for reconnection...`);
        peerConnection.close();
        delete peerConnections[employeeId];
      }
    };
  }

  try {
    await peerConnection.setRemoteDescription(new RTCSessionDescription(sdp));
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    socket.emit('answer', { sdp: answer, teamId, employeeId });
  } catch (err) {
    console.error(`Error handling offer from ${employeeId}:`, err);
  }
});

socket.on('ice-candidate', async (data) => {
  const { candidate, teamId: candidateTeamId, employeeId } = data;
  if (candidateTeamId !== teamId) return;

  const peerConnection = peerConnections[employeeId];
  if (peerConnection) {
    try {
      await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (err) {
      console.warn(`Error adding ICE candidate from ${employeeId}:`, err);
    }
  }
});

socket.on('employee-disconnect', (data) => {
  const { teamId: disconnectTeamId, employeeId } = data;
  if (disconnectTeamId !== teamId) return;

  console.log(`Employee ${employeeId} disconnected`);
  const peerConnection = peerConnections[employeeId];
  if (peerConnection) {
    peerConnection.close();
    delete peerConnections[employeeId];
  }
});

socket.on('disconnect', (reason) => {
  console.warn('Disconnected from signaling server:', reason);
  timerStatus.textContent = 'Disconnected: ' + reason;
});

// Update teamId and employeeId on input change
teamIdInput.addEventListener('change', () => {
  teamId = teamIdInput.value;
  if (socket.connected) {
    socket.emit('join-team', { teamId, role: 'employee', userId: employeeId });
  }
});

employeeIdInput.addEventListener('change', () => {
  employeeId = employeeIdInput.value;
  if (socket.connected) {
    socket.emit('join-team', { teamId, role: 'employee', userId: employeeId });
  }
});

// // WebRTC configuration with more STUN servers for better NAT traversal
// const configuration = {
//   iceServers: [
//     { urls: 'stun:stun.l.google.com:19302' },
//     { urls: 'stun:stun1.l.google.com:19302' },
//     { urls: 'stun:stun2.l.google.com:19302' },
//     { urls: 'stun:stun3.l.google.com:19302' },
//     { urls: 'stun:stun4.l.google.com:19302' },
//     // Add TURN server for reliable NAT traversal in production
//     // { urls: 'turn:your-turn-server.com', username: 'user', credential: 'pass' },
//   ],
//   iceCandidatePoolSize: 10,
//   iceTransportPolicy: 'all'
// };

// Clean up resources when the application is closing
window.addEventListener('beforeunload', () => {
  cleanupResources();
});

function cleanupResources() {
  stopWebcam();
  if (socket) {
    socket.disconnect();
  }
  if (reconnectInterval) {
    clearInterval(reconnectInterval);
  }
}

// Handle WebRTC connection errors and implement reconnection
function setupPeerConnectionListeners(peerConnection) {
  peerConnection.onicecandidate = (event) => {
    if (event.candidate) {
      console.log(`Sending ICE candidate for ${employeeId}`);
      socket.emit('ice-candidate', {
        target: 'manager',
        candidate: event.candidate,
        teamId,
        employeeId
      });
    }
  };

  peerConnection.onicegatheringstatechange = () => {
    console.log(`ICE gathering state: ${peerConnection.iceGatheringState}`);
  };

  peerConnection.oniceconnectionstatechange = () => {
    console.log(`ICE connection state: ${peerConnection.iceConnectionState}`);
    if (peerConnection.iceConnectionState === 'failed' || 
        peerConnection.iceConnectionState === 'disconnected') {
      console.warn('ICE connection failed or disconnected, attempting to restart');
      timerStatus.textContent = 'Connection lost, attempting to reconnect...';
      
      // Restart ICE immediately
      peerConnection.restartIce();

      // If still failing after 5 seconds, recreate the entire connection
      setTimeout(() => {
        if (peerConnection.iceConnectionState === 'failed' || 
            peerConnection.iceConnectionState === 'disconnected') {
          if (isTracking) {
            console.log('ICE restart failed, recreating WebRTC connection...');
            stopWebcam();
            startWebcam().catch(err => {
              console.error('Failed to restart webcam:', err);
              timerStatus.textContent = 'Reconnection failed. Retrying...';
            });
          }
        }
      }, 5000);
    } else if (peerConnection.iceConnectionState === 'connected') {
      timerStatus.textContent = 'ICE connection established';
    }
  };

  peerConnection.onconnectionstatechange = () => {
    console.log(`Connection state for ${employeeId}: ${peerConnection.connectionState}`);
    if (peerConnection.connectionState === 'failed' || 
        peerConnection.connectionState === 'disconnected' || 
        peerConnection.connectionState === 'closed') {
      console.error(`WebRTC connection ${peerConnection.connectionState}`);
      timerStatus.textContent = `Connection ${peerConnection.connectionState}. Reconnecting...`;
      
      // Attempt to reconnect immediately
      if (isTracking) {
        stopWebcam();
        startWebcam().catch(err => {
          console.error('Failed to reconnect:', err);
          timerStatus.textContent = 'Reconnection failed. Retrying...';
        });
      }
    } else if (peerConnection.connectionState === 'connected') {
      timerStatus.textContent = 'Connected to manager';
    }
  };

  peerConnection.onsignalingstatechange = () => {
    console.log(`Signaling state: ${peerConnection.signalingState}`);
    if (peerConnection.signalingState === 'closed') {
      console.log('Signaling state is closed');
      timerStatus.textContent = 'Signaling closed. Reconnecting...';
      if (isTracking) {
        stopWebcam();
        startWebcam().catch(console.error);
      }
    }
  };

  // Handle track events (useful for debugging stream issues)
  peerConnection.ontrack = (event) => {
    console.log('Received track from manager:', event);
  };
}
// Request webcam access and start streaming
async function startWebcam() {
  if (peerConnection) {
    peerConnection.close();
    peerConnection = null;
  }

  try {
    // Request webcam with constraints that might work better across devices
    stream = await navigator.mediaDevices.getUserMedia({ 
      video: { 
        width: { ideal: 640 },
        height: { ideal: 480 },
        frameRate: { max: 30 }
      } 
    });
    
    video.srcObject = stream;
    timerStatus.textContent = 'Timer: Webcam Started';

    // Initialize WebRTC peer connection
    peerConnection = new RTCPeerConnection(configuration);
    setupPeerConnectionListeners(peerConnection);

    // Add video stream to peer connection
    stream.getTracks().forEach(track => {
      peerConnection.addTrack(track, stream);
    });

    // Create and send offer with timeout and retry logic
    await createAndSendOffer();

    // Set up socket listeners for this connection
    setupSocketListeners();

    return true;
  } catch (err) {
    console.error('Error accessing webcam:', err);
    timerStatus.textContent = 'Timer: Webcam Access Denied - ' + err.message;
    throw err;
  }
}

async function createAndSendOffer() {
  try {
    const offer = await peerConnection.createOffer({
      offerToReceiveVideo: true,
      iceRestart: true
    });
    
    await peerConnection.setLocalDescription(offer);
    console.log(`Sending offer for ${employeeId}`);
    
    socket.emit('offer', {
      sdp: offer,
      teamId,
      employeeId
    });
    
    // Set a timeout to resend the offer if no answer is received
    setTimeout(async () => {
      if (peerConnection && peerConnection.connectionState !== 'connected') {
        console.log('No answer received, resending offer');
        createAndSendOffer();
      }
    }, 10000);
  } catch (err) {
    console.error('Error creating offer:', err);
    timerStatus.textContent = 'Error creating offer: ' + err.message;
  }
}

function setupSocketListeners() {
  // Clean up any existing listeners first to prevent duplicates
  socket.off('answer');
  socket.off('ice-candidate');

  // Handle incoming answer
  socket.on('answer', async (data) => {
    if (data.teamId === teamId && peerConnection && peerConnection.signalingState !== 'closed') {
      try {
        // Check if the remote description is already set with the same SDP
        if (peerConnection.currentRemoteDescription &&
            peerConnection.currentRemoteDescription.sdp === data.sdp.sdp) {
          console.log('Remote description already set with the same SDP');
          return;
        }
        
        await peerConnection.setRemoteDescription(new RTCSessionDescription(data.sdp));
        console.log(`Answer received for ${employeeId}`);
      } catch (err) {
        console.error(`Error setting remote description for ${employeeId}:`, err);
        // Try to recover by restarting the connection
        if (isTracking) {
          stopWebcam();
          setTimeout(() => startWebcam().catch(console.error), 2000);
        }
      }
    }
  });

  // Handle incoming ICE candidates
  socket.on('ice-candidate', async (data) => {
    if (data.teamId === teamId && peerConnection && peerConnection.signalingState !== 'closed') {
      try {
        await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
        console.log(`ICE candidate received for ${employeeId}`);
      } catch (err) {
        // This error is often non-critical, so we'll just log it
        console.warn(`Error adding ICE candidate for ${employeeId}:`, err);
      }
    }
  });
}

// Stop webcam and WebRTC
function stopWebcam() {
  clearInterval(snapshotInterval);
  
  if (stream) {
    stream.getTracks().forEach(track => {
      track.stop();
    });
    video.srcObject = null;
    timerStatus.textContent = 'Timer: Stopped';
  }
  
  if (peerConnection) {
    try {
      // Notify the manager of disconnection
      socket.emit('employee-disconnect', { teamId, employeeId });
      
      peerConnection.close();
    } catch (err) {
      console.warn('Error while closing peer connection:', err);
    } finally {
      peerConnection = null;
      console.log(`Peer connection closed for ${employeeId}`);
    }
  }
}

// Capture snapshot and upload to backend with retry logic
async function takeSnapshot() {
  if (!video.srcObject) {
    console.warn('Video stream not available for snapshot');
    return;
  }
  
  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  const dataURL = canvas.toDataURL('image/png');
  
  // Display the snapshot in UI
  const img = document.createElement('img');
  img.src = dataURL;
  img.width = 160;
  
  // Limit the number of snapshots shown to prevent memory issues
  if (snapshotContainer.childElementCount >= 10) {
    snapshotContainer.removeChild(snapshotContainer.firstChild);
  }
  snapshotContainer.appendChild(img);

  // Upload to backend
  const blob = dataURLtoBlob(dataURL);
  const formData = new FormData();
  formData.append('snapshot', blob, `snapshot-${Date.now()}.png`);
  formData.append('teamId', teamId);
  formData.append('employeeId', employeeId);
  
  // Retry upload up to 3 times
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch('http://localhost:3001/upload-snapshot', {
        method: 'POST',
        body: formData,
        timeout: 10000 // 10 second timeout
      });
      
      if (!res.ok) {
        throw new Error(`Server responded with ${res.status}: ${res.statusText}`);
      }
      
      const data = await res.json();
      console.log('Snapshot uploaded:', data.url);
      return; // Success, exit the retry loop
    } catch (err) {
      console.error(`Upload failed (attempt ${attempt + 1}/3):`, err);
      if (attempt < 2) {
        // Wait before retrying (exponential backoff)
        await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, attempt)));
      }
    }
  }
}

function dataURLtoBlob(dataURL) {
  const [header, data] = dataURL.split(',');
  const mime = header.match(/:(.*?);/)[1];
  const binary = atob(data);
  const array = [];
  for (let i = 0; i < binary.length; i++) {
    array.push(binary.charCodeAt(i));
  }
  return new Blob([new Uint8Array(array)], { type: mime });
}






const activeWin = require('active-win');

// Inside the toggleBtn event listener, after starting the webcam
const trackApplications = async () => {
  try {
    const activeWindow = await activeWin();
    if (activeWindow) {
      const appInfo = {
        appName: activeWindow.owner.name, // e.g., "Google Chrome"
        windowTitle: activeWindow.title, // e.g., "Google - Search"
        teamId,
        employeeId,
        timestamp: Date.now()
      };
      console.log(`Active app for ${employeeId}: ${appInfo.appName} - ${appInfo.windowTitle}`);

      // Send app info to backend
      await fetch('http://localhost:3001/upload-app-usage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(appInfo)
      });
    }
  } catch (err) {
    console.error('Error tracking application usage:', err);
  }
};


setInterval(()=>{
  trackApplications()
},12000)







// Toggle tracking with improved error handling
toggleBtn.addEventListener('click', async () => {
  if (!isTracking) {
    try {
      await startWebcam();
      toggleBtn.textContent = 'Stop Tracking';
      isTracking = true;
      
      takeSnapshot();
      snapshotInterval = setInterval(takeSnapshot, 30000);
      
      // Set up automatic reconnection
      reconnectInterval = setInterval(() => {
        if (isTracking && (!peerConnection || 
            peerConnection.connectionState === 'failed' || 
            peerConnection.connectionState === 'disconnected' || 
            peerConnection.connectionState === 'closed')) {
          console.log('Attempting automatic reconnection...');
          stopWebcam();
          startWebcam().catch(console.error);
        }
      }, 60000);
    } catch (err) {
      console.error('Failed to start tracking:', err);
      timerStatus.textContent = 'Failed to start: ' + err.message;
    }
  } else {
    stopWebcam();
    toggleBtn.textContent = 'Start Tracking';
    isTracking = false;
    
    if (reconnectInterval) {
      clearInterval(reconnectInterval);
      reconnectInterval = null;
    }
  }
});