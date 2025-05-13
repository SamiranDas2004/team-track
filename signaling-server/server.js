const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: ['http://localhost:5173', 'http://localhost:3000'], // Allow manager app and electron app
  },
});

const teams = new Map();

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('join-team', ({ teamId, role, userId }) => {
    socket.join(teamId);
    if (!teams.has(teamId)) {
      teams.set(teamId, { managerId: null, employeeIds: new Set() });
    }
    const team = teams.get(teamId);
    if (role === 'manager') {
      team.managerId = socket.id;
    } else {
      team.employeeIds.add(socket.id);
    }
    console.log(`User ${userId} joined team ${teamId} as ${role}`);
  });

  socket.on('offer', (data) => {
    const team = teams.get(data.teamId);
    if (team && team.managerId) {
      io.to(team.managerId).emit('offer', {
        sdp: data.sdp,
        sender: socket.id,
        teamId: data.teamId,
        employeeId: data.employeeId,
      });
    }
  });

  socket.on('answer', (data) => {
    io.to(data.target).emit('answer', { sdp: data.sdp, teamId: data.teamId });
  });

  socket.on('ice-candidate', (data) => {
    io.to(data.target).emit('ice-candidate', {
      candidate: data.candidate,
      teamId: data.teamId,
    });
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    for (const [teamId, team] of teams) {
      if (team.managerId === socket.id) {
        team.managerId = null;
      }
      team.employeeIds.delete(socket.id);
      if (!team.managerId && team.employeeIds.size === 0) {
        teams.delete(teamId);
      }
    }
  });
});

server.listen(3000, () => {
  console.log('Signaling server running on port 3000');
});