require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*", // Allows any origin, fine for local development
    methods: ["GET", "POST"]
  }
});

// App State
let users = {}; // socket.id -> { id, name, isHost }
let gameState = 'WAITING'; // 'WAITING', 'OPEN', 'FINISHED'
let roundStartTime = 0;
let buzzes = []; // { socketId, reactionTimeMs, user, option }
let options = []; // string[] eg ['1','2','3','4']
let hostSocketId = null;

io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);

  // Register user
  socket.on('register_user', (data) => {
    const { id, name } = data;
    
    users[socket.id] = { id, name, isHost: false };

    // Broadcast updated user list
    io.emit('users_update', Object.values(users));
    
    // Send current game state to new user
    socket.emit('game_state', { gameState, buzzes, options });
  });

  // Admin login
  socket.on('admin_login', (data) => {
    const { username, password, id } = data;
    const envUser = process.env.ADMIN_USERNAME || 'admin';
    const envPass = process.env.ADMIN_PASSWORD || 'admin';

    if (username === envUser && password === envPass) {
      hostSocketId = socket.id;
      users[socket.id] = { id, name: 'Admin', isHost: true };
      
      io.emit('users_update', Object.values(users));
      socket.emit('game_state', { gameState, buzzes, options });
      socket.emit('admin_success');
    } else {
      socket.emit('admin_error', 'Invalid credentials');
    }
  });

  // Admin reconnect (session recovery)
  socket.on('admin_reconnect', (data) => {
    const { id } = data;
    hostSocketId = socket.id;
    users[socket.id] = { id, name: 'Admin', isHost: true };
    
    io.emit('users_update', Object.values(users));
    socket.emit('game_state', { gameState, buzzes, options });
    socket.emit('admin_success');
  });

  // Host: Start Round / Open Buzzer
  socket.on('start_round', (data) => {
    if (socket.id !== hostSocketId) return; // Only host can start round
    
    gameState = 'OPEN';
    roundStartTime = Date.now();
    buzzes = [];
    options = data?.options || [];

    io.emit('game_state', { gameState, buzzes, options });
    io.emit('round_started');
  });

  // Player: Buzz In
  socket.on('buzz', (data) => {
    if (gameState !== 'OPEN') return;
    const user = users[socket.id];
    if (!user) return; // Unregistered user shouldn't buzz

    // Prevent duplicate buzzes from same user (persists across disconnects if using same ID)
    if (buzzes.some(b => b.user.id === user.id)) return;

    const reactionTimeMs = Date.now() - roundStartTime;
    const option = data?.option || null;
    
    if (!user) return; // Unregistered user shouldn't buzz

    // Add to buzzes
    buzzes.push({
      socketId: socket.id,
      user,
      reactionTimeMs,
      option
    });

    // Broadcast the new buzz immediately
    io.emit('game_state', { gameState, buzzes, options });
  });

  // Host: Reset Round
  socket.on('reset_round', () => {
    if (socket.id !== hostSocketId) return; // Only host can reset
    
    gameState = 'WAITING';
    buzzes = [];
    roundStartTime = 0;
    options = [];

    io.emit('game_state', { gameState, buzzes, options });
  });

  socket.on('disconnect', () => {
    console.log(`User disconnected: ${socket.id}`);
    
    const wasHost = socket.id === hostSocketId;
    delete users[socket.id];
    
    if (wasHost) {
      hostSocketId = null;
    }

    // Broadcast updated user list
    io.emit('users_update', Object.values(users));
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
