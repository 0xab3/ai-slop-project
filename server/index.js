const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3001;

app.use(express.json());

// Store active rooms
const rooms = new Map();

// Serve static files from React build (in production)
app.use(express.static(path.join(__dirname, '../frontend/build')));

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', rooms: rooms.size });
});

// Socket.io signaling
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  let currentRoom = null;
  let currentUserId = socket.id;

  // Join a room
  socket.on('join-room', ({ roomId, peerId }) => {
    const room = rooms.get(roomId);
    
    if (room && room.peers.size >= 2) {
      // Room is full
      socket.emit('room-full', { roomId });
      return;
    }

    socket.join(roomId);
    currentRoom = roomId;

    // Initialize room if it doesn't exist
    if (!rooms.has(roomId)) {
      rooms.set(roomId, {
        peers: new Map(),
        createdAt: Date.now()
      });
    }

    const roomData = rooms.get(roomId);
    roomData.peers.set(peerId, socket.id);

    console.log(`Peer ${peerId} joined room ${roomId}. Total peers: ${roomData.peers.size}`);

    // Notify other peer in the room
    socket.to(roomId).emit('peer-joined', { peerId });

    // If this is the second peer, notify both that ready for connection
    if (roomData.peers.size === 2) {
      io.to(roomId).emit('room-ready', { roomId });
    }

    // Send current peers in room to the joining peer
    socket.emit('peers-list', { 
      peers: Array.from(roomData.peers.keys()).filter(id => id !== peerId)
    });
  });

  // Handle offer (WebRTC)
  socket.on('offer', ({ roomId, offer, fromPeerId, toPeerId }) => {
    console.log(`Offering from ${fromPeerId} to ${toPeerId} in room ${roomId}`);
    socket.to(roomId).emit('offer', { offer, fromPeerId, toPeerId });
  });

  // Handle answer (WebRTC)
  socket.on('answer', ({ roomId, answer, fromPeerId, toPeerId }) => {
    console.log(`Answer from ${fromPeerId} to ${toPeerId} in room ${roomId}`);
    socket.to(roomId).emit('answer', { answer, fromPeerId, toPeerId });
  });

  // Handle ICE candidates
  socket.on('ice-candidate', ({ roomId, candidate, fromPeerId, toPeerId }) => {
    socket.to(roomId).emit('ice-candidate', { candidate, fromPeerId, toPeerId });
  });

  // Handle leaving room
  socket.on('leave-room', ({ roomId, peerId }) => {
    handlePeerLeave(roomId, peerId);
  });

  // Handle disconnect
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
    if (currentRoom) {
      // Find and remove peer from room
      const room = rooms.get(currentRoom);
      if (room) {
        for (const [peerId, socketId] of room.peers.entries()) {
          if (socketId === socket.id) {
            handlePeerLeave(currentRoom, peerId);
            break;
          }
        }
      }
    }
  });

  function handlePeerLeave(roomId, peerId) {
    const room = rooms.get(roomId);
    if (room) {
      room.peers.delete(peerId);
      socket.to(roomId).emit('peer-left', { peerId });
      
      // Clean up empty rooms
      if (room.peers.size === 0) {
        rooms.delete(roomId);
        console.log(`Room ${roomId} deleted (empty)`);
      }
    }
    if (currentRoom === roomId) {
      socket.leave(roomId);
      currentRoom = null;
    }
  }
});

// Handle React Router routes - serve index.html for all non-API routes
app.get('*', (req, res) => {
  if (!req.path.startsWith('/api')) {
    res.sendFile(path.join(__dirname, '../frontend/build/index.html'));
  }
});

server.listen(PORT, () => {
  console.log(`Signaling server running on port ${PORT}`);
  console.log(`Open http://localhost:${PORT} in your browser`);
});
