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

// Serve static files from React build (in production)
app.use(express.static(path.join(__dirname, '../frontend/build')));

// User storage (in-memory)
const users = new Map(); // username -> { password }
const userConnections = new Map(); // username -> Set of socket objects
const contacts = new Map(); // username -> Set of contacts
const pendingCalls = new Map(); // callId -> { from, to, timestamp }

// Store active rooms
const rooms = new Map();

// Helper: emit to all user's connections
function emitToUser(username, event, data) {
  const conns = userConnections.get(username);
  if (conns) {
    conns.forEach(socket => socket.emit(event, data));
  }
}

// Helper: get room ID from two users
function getRoomId(userA, userB) {
  return [userA, userB].sort().join('_');
}

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', rooms: rooms.size, users: users.size });
});

// Auth endpoints
app.post('/api/register', (req, res) => {
  const { username, password } = req.body;
  
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }
  
  if (users.has(username)) {
    return res.status(409).json({ error: 'Username already exists' });
  }
  
  users.set(username, { password });
  contacts.set(username, new Set());
  
  res.json({ success: true, username });
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }
  
  const user = users.get(username);
  if (!user || user.password !== password) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  
  res.json({ success: true, username });
});

// Contacts endpoints
app.get('/api/contacts/:username', (req, res) => {
  const { username } = req.params;
  const userContacts = contacts.get(username);
  
  if (!userContacts) {
    return res.json({ contacts: [] });
  }
  
  res.json({ contacts: Array.from(userContacts) });
});

app.post('/api/contacts', (req, res) => {
  const { username, contact } = req.body;
  
  if (!username || !contact) {
    return res.status(400).json({ error: 'Username and contact required' });
  }
  
  if (username === contact) {
    return res.status(400).json({ error: 'Cannot add yourself as contact' });
  }
  
  if (!users.has(contact)) {
    return res.status(404).json({ error: 'User not found' });
  }
  
  // Add contact (bidirectional)
  if (!contacts.has(username)) {
    contacts.set(username, new Set());
  }
  if (!contacts.has(contact)) {
    contacts.set(contact, new Set());
  }
  
  contacts.get(username).add(contact);
  contacts.get(contact).add(username);
  
  res.json({ success: true });
});

app.delete('/api/contacts', (req, res) => {
  const { username, contact } = req.body;
  
  if (!username || !contact) {
    return res.status(400).json({ error: 'Username and contact required' });
  }
  
  // Remove contact (bidirectional)
  if (contacts.has(username)) {
    contacts.get(username).delete(contact);
  }
  if (contacts.has(contact)) {
    contacts.get(contact).delete(username);
  }
  
  res.json({ success: true });
});

// Check if user exists
app.get('/api/users/:username', (req, res) => {
  const { username } = req.params;
  res.json({ exists: users.has(username) });
});

// Socket.io signaling
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  let currentRoom = null;
  let currentUserId = socket.id;
  let currentUsername = null;

  // Register socket with username
  socket.on('register-socket', ({ username }) => {
    currentUsername = username;
    
    if (!userConnections.has(username)) {
      userConnections.set(username, new Set());
    }
    userConnections.get(username).add(socket);
    
    console.log(`User ${username} registered with socket ${socket.id}`);
  });

  // Call request
  socket.on('call-request', ({ to, from }) => {
    console.log(`Call request from ${from} to ${to}`);
    
    const callId = `${from}_${to}_${Date.now()}`;
    pendingCalls.set(callId, { from, to, timestamp: Date.now() });
    
    // Emit to target user (all their connections)
    emitToUser(to, 'call-request-received', {
      callId,
      from,
      to
    });
  });

  // Call accepted
  socket.on('call-accepted', ({ to, from }) => {
    console.log(`Call accepted: ${from} accepted from ${to}`);
    
    const roomId = getRoomId(from, to);
    
    // Notify both users - both get each other's username
    emitToUser(to, 'call-accepted', { peer: from, roomId });
    emitToUser(from, 'call-accepted', { peer: to, roomId });
  });

  // Call rejected
  socket.on('call-rejected', ({ to, from }) => {
    console.log(`Call rejected: ${from} rejected from ${to}`);
    
    emitToUser(to, 'call-rejected', { from });
  });

  // Video request
  socket.on('video-request', ({ to, from, type }) => {
    console.log(`Video request: from=${from}, to=${to}, type=${type}`);
    console.log(`userConnections map:`, Array.from(userConnections.keys()));
    emitToUser(to, 'video-request-received', { from, type });
  });

  // Video accepted
  socket.on('video-accepted', ({ to, from }) => {
    console.log(`Video accepted: ${from} accepted from ${to}`);
    emitToUser(to, 'video-accepted', { from });
  });

  // Video rejected
  socket.on('video-rejected', ({ to, from }) => {
    console.log(`Video rejected: ${from} rejected from ${to}`);
    emitToUser(to, 'video-rejected', { from });
  });

  // Join a room
  socket.on('join-room', ({ roomId, peerId }) => {
    const room = rooms.get(roomId);
    
    if (room && room.peers.size >= 2) {
      socket.emit('room-full', { roomId });
      return;
    }

    socket.join(roomId);
    currentRoom = roomId;

    if (!rooms.has(roomId)) {
      rooms.set(roomId, {
        peers: new Map(),
        createdAt: Date.now()
      });
    }

    const roomData = rooms.get(roomId);
    roomData.peers.set(peerId, socket.id);

    console.log(`Peer ${peerId} joined room ${roomId}. Total peers: ${roomData.peers.size}`);

    socket.to(roomId).emit('peer-joined', { peerId });

    if (roomData.peers.size === 2) {
      io.to(roomId).emit('room-ready', { roomId });
    }

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
    
    // Remove from userConnections
    if (currentUsername) {
      const conns = userConnections.get(currentUsername);
      if (conns) {
        conns.delete(socket);
        if (conns.size === 0) {
          userConnections.delete(currentUsername);
        }
      }
    }
    
    if (currentRoom) {
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

// Handle React Router routes
app.get('*', (req, res) => {
  if (!req.path.startsWith('/api')) {
    res.sendFile(path.join(__dirname, '../frontend/build/index.html'));
  }
});

server.listen(PORT, () => {
  console.log(`Signaling server running on port ${PORT}`);
  console.log(`Open http://localhost:${PORT} in your browser`);
});
