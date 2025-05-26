import React, { useEffect, useRef, useState } from 'react';
import { Users, Monitor, Activity, Wifi, WifiOff, RotateCcw, Eye, Clock, User, Building, Calendar, Search, Filter } from 'lucide-react';
import io from 'socket.io-client';

const socket = io('http://localhost:3000', { autoConnect: false });

function App() {
  const [teamId, setTeamId] = useState('team1');
  const [managerId, setManagerId] = useState('manager1');
  const [streams, setStreams] = useState({});
  const [snapshots, setSnapshots] = useState({});
  const [status, setStatus] = useState('Connecting...');
  const [appUsageData, setAppUsageData] = useState([]);

  const [activeEmployees, setActiveEmployees] = useState(0);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedEmployee, setSelectedEmployee] = useState('all');
  const [selectedApp, setSelectedApp] = useState('all');
  const videoRefs = useRef({});
  const hasJoined = useRef(false);

  // Get unique employees and apps for filters
  const uniqueEmployees = [...new Set(appUsageData.map(entry => entry.employeeId))];
  const uniqueApps = [...new Set(appUsageData.map(entry => entry.appName))];

  // Filter app usage data
  const filteredAppData = appUsageData.filter(entry => {
    const matchesSearch = entry.appName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         entry.windowTitle?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         entry.employeeId?.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesEmployee = selectedEmployee === 'all' || entry.employeeId === selectedEmployee;
    const matchesApp = selectedApp === 'all' || entry.appName === selectedApp;
    
    return matchesSearch && matchesEmployee && matchesApp;
  });







  useEffect(() => {
    const fetchAppUsageData = async () => {
      try {
        const res = await fetch('http://localhost:3001/app-usage');
        if (!res.ok) throw new Error(`HTTP error ${res.status}`);
        const data = await res.json();
        setAppUsageData(data.data || []);
      } catch (err) {
        console.error('Error fetching app usage data:', err);
      }
    };
  
    // Fetch immediately
    fetchAppUsageData();
  
    // Set interval to fetch every 2 seconds
    const intervalId = setInterval(fetchAppUsageData, 2000);
  
    // Cleanup on component unmount
    return () => clearInterval(intervalId);
  }, []);
  







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

  const getAppIcon = (appName) => {
    const icons = {
      'Visual Studio Code': '💻',
      'Microsoft Edge': '🌐',
      'Electron': '⚡',
      'Slack': '💬',
      'Chrome': '🔍',
      'Firefox': '🦊'
    };
    return icons[appName] || '📱';
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'Connected': return 'text-green-600 bg-green-100';
      case 'Connecting...': return 'text-yellow-600 bg-yellow-100';
      case 'Disconnected': return 'text-red-600 bg-red-100';
      default: return 'text-gray-600 bg-gray-100';
    }
  };

  const formatTimeAgo = (timestamp) => {
    const now = new Date();
    const past = new Date(timestamp);
    const diffInMinutes = Math.floor((now - past) / (1000 * 60));
    
    if (diffInMinutes < 1) return 'Just now';
    if (diffInMinutes < 60) return `${diffInMinutes}m ago`;
    if (diffInMinutes < 1440) return `${Math.floor(diffInMinutes / 60)}h ago`;
    return `${Math.floor(diffInMinutes / 1440)}d ago`;
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50">
      {/* Header */}
      <div className="bg-white shadow-lg border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <div className="bg-gradient-to-r from-blue-600 to-purple-600 p-3 rounded-xl">
                <Monitor className="w-8 h-8 text-white" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-gray-900">Team Monitor</h1>
                <p className="text-gray-600">Real-time employee activity dashboard</p>
              </div>
            </div>
            
            <div className="flex items-center space-x-4">
              <div className={`px-3 py-2 rounded-full flex items-center space-x-2 ${getStatusColor(status)}`}>
                {status === 'Connected' ? <Wifi className="w-4 h-4" /> : <WifiOff className="w-4 h-4" />}
                <span className="text-sm font-medium">{status}</span>
              </div>
              <button
                onClick={handleReconnect}
                className="bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white px-4 py-2 rounded-lg flex items-center space-x-2 transition-all duration-200 shadow-lg hover:shadow-xl transform hover:scale-105"
              >
                <RotateCcw className="w-4 h-4" />
                <span>Reconnect</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-6">
        {/* Configuration Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div className="bg-white rounded-2xl shadow-lg p-6 border border-gray-100">
            <div className="flex items-center space-x-3 mb-4">
              <Building className="w-6 h-6 text-blue-600" />
              <label className="text-lg font-semibold text-gray-900">Team Configuration</label>
            </div>
            <input
              type="text"
              value={teamId}
              onChange={(e) => setTeamId(e.target.value)}
              disabled={Object.keys(streams).length > 0}
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-200"
              placeholder="Enter team ID"
            />
          </div>

          <div className="bg-white rounded-2xl shadow-lg p-6 border border-gray-100">
            <div className="flex items-center space-x-3 mb-4">
              <User className="w-6 h-6 text-purple-600" />
              <label className="text-lg font-semibold text-gray-900">Manager ID</label>
            </div>
            <input
              type="text"
              value={managerId}
              onChange={(e) => setManagerId(e.target.value)}
              disabled={Object.keys(streams).length > 0}
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all duration-200"
              placeholder="Enter manager ID"
            />
          </div>

          <div className="bg-gradient-to-r from-green-500 to-teal-600 rounded-2xl shadow-lg p-6 text-white">
            <div className="flex items-center space-x-3 mb-2">
              <Users className="w-6 h-6" />
              <span className="text-lg font-semibold">Active Employees</span>
            </div>
            <div className="text-3xl font-bold">{activeEmployees}</div>
            <div className="text-green-100 text-sm">Currently online</div>
          </div>
        </div>

        {/* Live Video Feeds */}
        <div className="bg-white rounded-2xl shadow-lg p-6 mb-8 border border-gray-100">
          <div className="flex items-center space-x-3 mb-6">
            <Eye className="w-6 h-6 text-red-600" />
            <h2 className="text-2xl font-bold text-gray-900">Live Video Feeds</h2>
          </div>
          
          {Object.keys(streams).length === 0 ? (
            <div className="text-center py-12">
              <Monitor className="w-16 h-16 text-gray-400 mx-auto mb-4" />
              <p className="text-gray-500 text-lg">No active video streams</p>
              <p className="text-gray-400">Employees will appear here when they connect</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {Object.entries(streams).map(([employeeId, { stream }]) => (
                <div key={employeeId} className="bg-gradient-to-br from-gray-100 to-gray-200 rounded-xl p-4 hover:shadow-lg transition-all duration-200 transform hover:scale-105">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="font-semibold text-gray-900 flex items-center space-x-2">
                      <div className="w-3 h-3 bg-green-500 rounded-full animate-pulse"></div>
                      <span>{employeeId}</span>
                    </h3>
                    <div className="text-xs text-gray-500 bg-gray-200 px-2 py-1 rounded-full">LIVE</div>
                  </div>
                  <div className="bg-black rounded-lg overflow-hidden">
                    <video
                      ref={(el) => (videoRefs.current[employeeId] = el)}
                      autoPlay
                      playsInline
                      muted
                      className="w-full h-48 object-cover"
                      style={{ background: 'linear-gradient(45deg, #1a1a1a, #2d2d2d)' }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Screenshots Section */}
        <div className="bg-white rounded-2xl shadow-lg p-6 mb-8 border border-gray-100">
          <div className="flex items-center space-x-3 mb-6">
            <Activity className="w-6 h-6 text-orange-600" />
            <h2 className="text-2xl font-bold text-gray-900">Recent Screenshots</h2>
          </div>
          
          {Object.keys(snapshots).length === 0 ? (
            <div className="text-center py-12">
              <Calendar className="w-16 h-16 text-gray-400 mx-auto mb-4" />
              <p className="text-gray-500 text-lg">No screenshots available</p>
            </div>
          ) : (
            <div className="space-y-6">
              {Object.entries(snapshots).map(([employeeId, urls]) => (
                <div key={employeeId} className="border border-gray-200 rounded-xl p-6 bg-gray-50">
                  <h3 className="font-semibold text-gray-900 mb-4 flex items-center space-x-2">
                    <User className="w-5 h-5 text-blue-600" />
                    <span>{employeeId} Screenshots</span>
                    <span className="text-sm text-gray-500 bg-blue-100 px-2 py-1 rounded-full">{urls.length} images</span>
                  </h3>
                  <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
                    {urls.map((url, idx) => (
                      <div key={idx} className="group relative bg-white rounded-lg overflow-hidden shadow-md hover:shadow-lg transition-all duration-200 transform hover:scale-105">
                        <img 
                          src={url} 
                          alt={`Screenshot ${idx + 1}`} 
                          className="w-full h-24 object-cover"
                        />
                        <div className="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-20 transition-all duration-200 flex items-center justify-center">
                          <Eye className="w-6 h-6 text-white opacity-0 group-hover:opacity-100 transition-all duration-200" />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* App Usage Logs */}
        <div className="bg-white rounded-2xl shadow-lg p-6 border border-gray-100">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center space-x-3">
              <Clock className="w-6 h-6 text-indigo-600" />
              <h2 className="text-2xl font-bold text-gray-900">Application Usage Logs</h2>
            </div>
            <div className="text-sm text-gray-500 bg-indigo-100 px-3 py-1 rounded-full">
              {filteredAppData.length} entries
            </div>
          </div>

          {/* Filters */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
              <input
                type="text"
                placeholder="Search apps, windows, employees..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              />
            </div>
            
            <select
              value={selectedEmployee}
              onChange={(e) => setSelectedEmployee(e.target.value)}
              className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            >
              <option value="all">All Employees</option>
              {uniqueEmployees.map(emp => (
                <option key={emp} value={emp}>{emp}</option>
              ))}
            </select>

            <select
              value={selectedApp}
              onChange={(e) => setSelectedApp(e.target.value)}
              className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            >
              <option value="all">All Applications</option>
              {uniqueApps.map(app => (
                <option key={app} value={app}>{app}</option>
              ))}
            </select>

            <div className="flex items-center justify-center text-sm text-gray-500 bg-gray-100 rounded-lg px-3 py-2">
              <Filter className="w-4 h-4 mr-1" />
              Active Filters
            </div>
          </div>

          {/* Usage Logs Table */}
          <div className="overflow-hidden rounded-xl border border-gray-200">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gradient-to-r from-indigo-600 to-purple-600 text-white">
                  <tr>
                    <th className="px-6 py-4 text-left text-sm font-semibold">Employee</th>
                    <th className="px-6 py-4 text-left text-sm font-semibold">Application</th>
                    <th className="px-6 py-4 text-left text-sm font-semibold">Window Title</th>
                    <th className="px-6 py-4 text-left text-sm font-semibold">Time</th>
                    <th className="px-6 py-4 text-left text-sm font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {filteredAppData.map((entry, index) => (
                    <tr key={entry._id} className={`hover:bg-gray-50 transition-colors duration-150 ${index % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}`}>
                      <td className="px-6 py-4">
                        <div className="flex items-center space-x-3">
                          <div className="w-8 h-8 bg-gradient-to-r from-blue-500 to-purple-500 rounded-full flex items-center justify-center text-white text-sm font-bold">
                            {entry.employeeId.charAt(entry.employeeId.length - 1)}
                          </div>
                          <span className="font-medium text-gray-900">{entry.employeeId}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center space-x-2">
                          <span className="text-xl">{getAppIcon(entry.appName)}</span>
                          <span className="font-medium text-gray-900">{entry.appName}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="max-w-xs">
                          <p className="text-gray-900 truncate" title={entry.windowTitle}>
                            {entry.windowTitle}
                          </p>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="text-sm">
                          <p className="text-gray-900 font-medium">
                            {new Date(entry.timestamp).toLocaleTimeString()}
                          </p>
                          <p className="text-gray-500">
                            {formatTimeAgo(entry.timestamp)}
                          </p>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                          Active
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {filteredAppData.length === 0 && (
            <div className="text-center py-12">
              <Search className="w-16 h-16 text-gray-400 mx-auto mb-4" />
              <p className="text-gray-500 text-lg">No matching results found</p>
              <p className="text-gray-400">Try adjusting your search filters</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default App;