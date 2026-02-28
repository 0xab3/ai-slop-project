const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { Low } = require('lowdb');
const { JSONFile } = require('lowdb/node');

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

// Initialize lowdb
const adapter = new JSONFile(path.join(__dirname, 'db.json'));
const db = new Low(adapter, {
  users: [],
  contacts: []
});

// Initialize database file if it doesn't exist
db.read().then(() => {
  if (!db.data) {
    db.data = { users: [], contacts: [] };
    db.write();
  }
}).catch(err => {
  console.log('Initializing new database...');
  db.data = { users: [], contacts: [] };
  db.write();
});

// Helper functions for database
async function getUser(username) {
  await db.read();
  return db.data.users.find(u => u.username === username);
}

async function addUser(username, password) {
  await db.read();
  db.data.users.push({ username, password });
  await db.write();
}

async function getContacts(username) {
  await db.read();
  return db.data.contacts
    .filter(c => c.username === username)
    .map(c => c.contact);
}

async function addContact(username, contact) {
  await db.read();
  // Add bidirectional
  if (!db.data.contacts.find(c => c.username === username && c.contact === contact)) {
    db.data.contacts.push({ username, contact });
  }
  if (!db.data.contacts.find(c => c.username === contact && c.contact === username)) {
    db.data.contacts.push({ username: contact, contact: username });
  }
  await db.write();
}

async function removeContact(username, contact) {
  await db.read();
  db.data.contacts = db.data.contacts.filter(
    c => !(c.username === username && c.contact === contact) &&
         !(c.username === contact && c.contact === username)
  );
  await db.write();
}

async function userExists(username) {
  await db.read();
  return db.data.users.some(u => u.username === username);
}

// In-memory storage for active connections
const userConnections = new Map(); // username -> Set of socket objects

// Store active rooms
const rooms = new Map();
const userToRoom = new Map(); // username -> roomId

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
  res.json({ status: 'ok', rooms: rooms.size });
});

// Auth endpoints
app.post('/api/register', async (req, res) => {
  const { username, password } = req.body;
  
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }
  
  const exists = await userExists(username);
  if (exists) {
    return res.status(409).json({ error: 'Username already exists' });
  }
  
  await addUser(username, password);
  
  res.json({ success: true, username });
});

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }
  
  const user = await getUser(username);
  if (!user || user.password !== password) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  
  res.json({ success: true, username });
});

// Contacts endpoints
app.get('/api/contacts/:username', async (req, res) => {
  const { username } = req.params;
  const userContacts = await getContacts(username);
  
  res.json({ contacts: userContacts });
});

app.post('/api/contacts', async (req, res) => {
  const { username, contact } = req.body;
  
  if (!username || !contact) {
    return res.status(400).json({ error: 'Username and contact required' });
  }
  
  if (username === contact) {
    return res.status(400).json({ error: 'Cannot add yourself as contact' });
  }
  
  const exists = await userExists(contact);
  if (!exists) {
    return res.status(404).json({ error: 'User not found' });
  }
  
  await addContact(username, contact);
  
  res.json({ success: true });
});

app.delete('/api/contacts', async (req, res) => {
  const { username, contact } = req.body;
  
  if (!username || !contact) {
    return res.status(400).json({ error: 'Username and contact required' });
  }
  
  await removeContact(username, contact);
  
  res.json({ success: true });
});

// Check if user exists
app.get('/api/users/:username', async (req, res) => {
  const { username } = req.params;
  const exists = await userExists(username);
  res.json({ exists });
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
    console.log(`[call-request] from=${from}, to=${to}`);
    
    // Check if either user is already in a room together
    const roomId = getRoomId(from, to);
    const fromUserRoom = userToRoom.get(from);
    const toUserRoom = userToRoom.get(to);
    
    console.log(`[call-request] roomId=${roomId}, fromUserRoom=${fromUserRoom}, toUserRoom=${toUserRoom}`);
    
    // If either user is already in this room, just join without notification
    if (fromUserRoom === roomId || toUserRoom === roomId) {
      console.log(`[room-already-active] User already in room ${roomId}, notifying both users`);
      emitToUser(to, 'room-already-active', { roomId, peer: from });
      emitToUser(from, 'room-already-active', { roomId, peer: to });
      return;
    }
    
    // Emit to target user (all their connections)
    emitToUser(to, 'call-request-received', {
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
  socket.on('join-room', ({ roomId, peerId, username }) => {
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
    
    // Track which user is in which room
    if (username) {
      userToRoom.set(username, roomId);
      console.log(`[join-room] User ${username} (peerId=${peerId}) joined room ${roomId}. Total peers: ${roomData.peers.size}`);
    } else {
      console.log(`[join-room] Peer ${peerId} joined room ${roomId}. Total peers: ${roomData.peers.size} (no username)`);
    }

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
  socket.on('leave-room', ({ roomId, peerId, username }) => {
    handlePeerLeave(roomId, peerId);
    // Explicitly clear userToRoom when user intentionally leaves
    if (username) {
      console.log(`[leave-room] User ${username} explicitly left room ${roomId}`);
      userToRoom.delete(username);
    }
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
      
      // Don't delete room - other peer may still be connected and waiting
      console.log(`[peer-left] Peer ${peerId} left room ${roomId}. Remaining peers: ${room.peers.size}`);
    }
    if (currentRoom === roomId) {
      socket.leave(roomId);
      currentRoom = null;
    }
    
    // Note: don't remove from userToRoom on disconnect - the other peer may still be in the room
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
