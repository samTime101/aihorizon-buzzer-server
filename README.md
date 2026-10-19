# AI Horizon Buzzer Server

Real-time backend server for the **AI Horizon Buzzer** application. It coordinates players, an admin/host, and a TV display using Socket.IO so buzzer rounds stay synchronized across connected clients.

## Features

- Real-time communication with Socket.IO
- Player registration and live user-list updates
- Admin/host authentication using environment variables
- Host controls for starting, resetting, and managing rounds
- Configurable answer options for each round
- Fastest-buzz tracking with reaction times in milliseconds
- Correct-answer selection and winner reveal
- TV client synchronization for live game-state updates
- CORS support for local-network and deployed clients
- Automatic state recovery for newly connected users and TV clients

## Tech Stack

- Node.js
- Express
- Socket.IO
- CORS
- dotenv
- CommonJS modules

## Requirements

- Node.js 18 or newer
- npm

## Getting Started

### 1. Clone the repository

```bash
git clone https://github.com/samTime101/AI_HORIZON_BUZZER_SERVER.git
cd AI_HORIZON_BUZZER_SERVER
```

### 2. Install dependencies

```bash
npm install
```

### 3. Configure environment variables

Create a `.env` file in the project root:

```env
PORT=3001
ADMIN_USERNAME=admin
ADMIN_PASSWORD=change-this-password
```

`PORT` is optional and defaults to `3001`.

> Do not commit `.env` or real credentials to the repository. The server currently falls back to `admin` / `admin` when admin credentials are not configured, so set both environment variables before deploying.

### 4. Start the server

For normal use:

```bash
npm start
```

The server listens on:

```text
http://localhost:3001
```

For development, the project currently uses the same command:

```bash
npm run dev
```

## Socket.IO Events

### Client-to-server events

| Event | Purpose |
| --- | --- |
| `register_user` | Registers a player with an `id` and `name`. |
| `tv_register` | Registers a TV/display client and sends the current state. |
| `admin_login` | Authenticates the host using a username, password, and stable user ID. |
| `admin_reconnect` | Restores an existing host session using the host user ID. |
| `start_round` | Starts a round and optionally supplies answer options. Host only. |
| `set_correct_option` | Sets the correct answer option. Host only. |
| `reveal_winner` | Selects and broadcasts the winner. Host only. |
| `buzz` | Records a player's buzz and reaction time while a round is open. |
| `reset_round` | Clears the current round and returns the game to `WAITING`. Host only. |

### Server-to-client events

| Event | Purpose |
| --- | --- |
| `users_update` | Broadcasts the currently connected users. |
| `game_state` | Sends the current game state, buzzes, options, and correct option. |
| `round_started` | Indicates that a new round has started. |
| `admin_success` | Confirms successful admin authentication. |
| `admin_error` | Reports invalid admin credentials. |
| `correct_option_set` | Confirms the selected correct option. |
| `winner_reveal` | Broadcasts the winner and correct option. |

## Game Flow

1. Players connect and emit `register_user`.
2. The host connects using `admin_login`.
3. The host emits `start_round` with optional answer choices.
4. Registered players emit `buzz` while the game state is `OPEN`.
5. The server records each player's reaction time and prevents duplicate buzzes from the same user ID.
6. The host optionally selects a correct answer with `set_correct_option`.
7. The host emits `reveal_winner`.
8. The fastest player on the correct option wins. If no correct option is selected, the fastest buzz overall wins.
9. The host emits `reset_round` to prepare for the next round.

## Client Connection Example

```js
import { io } from "socket.io-client";

const socket = io("http://localhost:3001", {
  path: "/socket.io",
});

socket.emit("register_user", {
  id: crypto.randomUUID(),
  name: "Player 1",
});

socket.on("game_state", (state) => {
  console.log("Game state:", state);
});

socket.emit("buzz", { option: "1" });
```

## Deployment Notes

- Set `PORT` using the hosting provider's environment-variable configuration.
- Set strong, unique values for `ADMIN_USERNAME` and `ADMIN_PASSWORD`.
- Update the client application's Socket.IO URL to the deployed server URL.
- Restrict CORS origins before production if the server should accept connections only from trusted frontend applications.
- This server keeps game state in memory, so restarting the process clears connected users and the current round.

## Project Structure

```text
.
├── index.js          # Express and Socket.IO server
├── package.json      # Scripts and dependencies
├── package-lock.json # Locked dependency versions
└── README.md         # Project documentation
```

## Available Scripts

| Command | Description |
| --- | --- |
| `npm start` | Starts the server with Node.js. |
| `npm run dev` | Starts the server in development mode. |
| `npm test` | Placeholder test command; tests are not configured yet. |

## License

This project currently uses the ISC license as specified in `package.json`.
