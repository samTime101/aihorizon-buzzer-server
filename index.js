require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
// Allow all origins in dev so mobile devices on the same network can connect
app.use(cors({ origin: true, credentials: true }));

const server = http.createServer(app);

const io = new Server(server, {
  path: "/socket.io",
  cors: {
    origin: true,   // allow any origin (local network IPs, etc.)
    methods: ["GET", "POST"],
    credentials: true
  }
});
// App State
let users = {}; // socket.id -> { id, name, isHost }
let gameState = 'WAITING'; // 'WAITING', 'OPEN', 'FINISHED'
let roundStartTime = 0;
let buzzes = []; // { socketId, reactionTimeMs, user, option }
let options = []; // string[] eg ['1','2','3','4']
let correctOption = null; // The option admin marks as correct
let hostSocketId = null;  // current socket.id of the host
let hostUserId = null;    // stable user UUID of the host (survives reconnects)

io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);

  // Register user
  socket.on('register_user', (data) => {
    const { id, name } = data;
    
    users[socket.id] = { id, name, isHost: false };
    
    const userCount = Object.keys(users).length;
    console.log(`[USER_JOINED] Name: ${name}, ID: ${id}, Total Users: ${userCount}`);

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
      hostUserId = id;
      users[socket.id] = { id, name: 'Admin', isHost: true };
      
      console.log(`[ADMIN_LOGIN] Host connected. ID: ${id}`);
      
      io.emit('users_update', Object.values(users));
      socket.emit('game_state', { gameState, buzzes, options, correctOption });
      socket.emit('admin_success');
    } else {
      console.log(`[ADMIN_FAILED] Failed login attempt for username: ${username}`);
      socket.emit('admin_error', 'Invalid credentials');
    }
  });

  // Admin reconnect (session recovery)
  socket.on('admin_reconnect', (data) => {
    const { id } = data;
    hostSocketId = socket.id;
    hostUserId = id;
    users[socket.id] = { id, name: 'Admin', isHost: true };
    console.log(`[ADMIN_RECONNECT] Host reconnected. ID: ${id}`);
    
    io.emit('users_update', Object.values(users));
    socket.emit('game_state', { gameState, buzzes, options, correctOption });
    socket.emit('admin_success');
  });

  // Host: Start Round / Open Buzzer
  socket.on('start_round', (data) => {
    if (socket.id !== hostSocketId) return; // Only host can start round
    
    gameState = 'OPEN';
    roundStartTime = Date.now();
    buzzes = [];
    options = data?.options || [];
    correctOption = null;

    console.log(`[ROUND_STARTED] Options: [${options.join(', ')}], Start Time: ${new Date(roundStartTime).toISOString()}`);

    io.emit('game_state', { gameState, buzzes, options, correctOption });
    io.emit('round_started');
  });

  // Helper: is this socket the host?
  const isHost = () => socket.id === hostSocketId || users[socket.id]?.isHost === true;

  // Host: Mark Correct Option
  socket.on('set_correct_option', (data) => {
    if (!isHost()) return;
    correctOption = data?.option ?? null;
    console.log(`[set_correct_option] correctOption = ${correctOption}`);
    socket.emit('correct_option_set', { correctOption });
  });

  // Host: Reveal Winner
  socket.on('reveal_winner', () => {
    console.log(`[reveal_winner] called by socket=${socket.id}, hostSocketId=${hostSocketId}, isHost=${isHost()}`);
    if (!isHost()) {
      console.warn('[reveal_winner] REJECTED — not host');
      return;
    }
    
    let winner = null;
    if (correctOption !== null) {
      // Find fastest buzz on the correct option
      const correctBuzzes = buzzes.filter(b => b.option === correctOption);
      console.log(`[reveal_winner] correctOption=${correctOption}, correctBuzzes=${correctBuzzes.length}, allBuzzes=${buzzes.length}`);
      if (correctBuzzes.length > 0) {
        winner = correctBuzzes.reduce((prev, curr) =>
          prev.reactionTimeMs < curr.reactionTimeMs ? prev : curr
        );
      }
    } else {
      // No correct option defined — fastest overall
      console.log(`[reveal_winner] no correctOption set, using fastest overall from ${buzzes.length} buzzes`);
      if (buzzes.length > 0) {
        winner = buzzes.reduce((prev, curr) =>
          prev.reactionTimeMs < curr.reactionTimeMs ? prev : curr
        );
      }
    }

    const payload = {
      winner: winner ? { name: winner.user.name, id: winner.user.id, reactionTimeMs: winner.reactionTimeMs, option: winner.option } : null,
      correctOption
    };
    
    console.log(`[REVEAL_WINNER] Result:`, JSON.stringify(payload, null, 2));
    if (buzzes.length > 0) {
      console.log(`[REVEAL_RANKINGS] Full list of buzzes:`);
      const sorted = [...buzzes].sort((a,b) => a.reactionTimeMs - b.reactionTimeMs);
      sorted.forEach((b, idx) => {
        console.log(`  #${idx+1}: ${b.user.name} (${b.user.id}) - Time: ${b.reactionTimeMs}ms, Option: ${b.option || 'N/A'}`);
      });
    }

    io.emit('winner_reveal', payload);
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

    console.log(`[BUZZ_EVENT] User: ${user.name} (${user.id}), Time: ${reactionTimeMs}ms, Option: ${option || 'N/A'}`);

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
    correctOption = null;

    console.log(`[ROUND_RESET] Game cleared by host.`);

    io.emit('game_state', { gameState, buzzes, options, correctOption });
    io.emit('winner_reveal', null); // Clear winner modal on all clients
  });

  socket.on('disconnect', () => {
    const user = users[socket.id];
    const wasHost = socket.id === hostSocketId;
    
    if (user) {
      console.log(`[USER_DISCONNECTED] Name: ${user.name}, ID: ${user.id}`);
    } else {
      console.log(`[SOCKET_DISCONNECTED] ID: ${socket.id}`);
    }

    delete users[socket.id];
    
    if (wasHost) {
      hostSocketId = null;
      console.log(`[ADMIN_DISCONNECTED] Host has left.`);
    }

    // Broadcast updated user list
    io.emit('users_update', Object.values(users));
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, "0.0.0.0", () => {
  console.log(`Server listening on port ${PORT}`);
});