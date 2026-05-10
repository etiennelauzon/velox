import express from 'express';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const port = Number(process.env.PORT || 8787);
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: true,
    methods: ['GET', 'POST']
  }
});

const rooms = new Map();
const stalePeerMs = 30_000; // Design decision: Clean up inactive peers after 30s to prevent stale entries
const maxRoomLength = 32;
const maxNameLength = 32;

app.use(express.static(__dirname, {
  extensions: ['html']
}));

app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'velox-mapillary-live.html'));
});

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    rooms: rooms.size,
    peers: Array.from(rooms.values()).reduce((sum, peers) => sum + peers.size, 0)
  });
});

function normalizeRoom(value) {
  const room = String(value || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '-')
    .slice(0, maxRoomLength);
  return room || 'team-ride';
}

function cleanText(value, fallback) {
  const text = String(value || '').trim().slice(0, maxNameLength);
  return text || fallback;
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function sanitizeState(state = {}) {
  // Design decision: Sanitize all data to prevent abuse, ensure numbers are finite, strings are clean
  return {
    lat: numberOrNull(state.lat),
    lon: numberOrNull(state.lon),
    ele: numberOrNull(state.ele),
    routeDistance: numberOrNull(state.routeDistance),
    routeLen: numberOrNull(state.routeLen),
    speed: numberOrNull(state.speed),
    power: numberOrNull(state.power),
    cadence: numberOrNull(state.cadence),
    hr: numberOrNull(state.hr),
    elapsed: numberOrNull(state.elapsed),
    routeName: cleanText(state.routeName, 'No course'),
    recording: Boolean(state.recording)
  };
}

function getRoom(roomId) {
  if (!rooms.has(roomId)) rooms.set(roomId, new Map());
  return rooms.get(roomId);
}

function peerList(roomId) {
  const now = Date.now();
  const peers = getRoom(roomId);
  for (const [id, peer] of peers) {
    if (now - peer.updatedAt > stalePeerMs) {
      peers.delete(id);
      io.to(roomId).emit('peer:left', { id });
    }
  }
  return Array.from(peers.values());
}

function leaveCurrentRoom(socket) {
  const roomId = socket.data.room;
  if (!roomId) return;

  socket.leave(roomId);
  const peers = getRoom(roomId);
  peers.delete(socket.id);
  if (peers.size === 0) rooms.delete(roomId);
  socket.to(roomId).emit('peer:left', { id: socket.id });
  socket.data.room = '';
}

io.on('connection', socket => {
  socket.on('room:join', payload => {
    leaveCurrentRoom(socket);

    const roomId = normalizeRoom(payload?.room);
    const name = cleanText(payload?.name, `Rider ${socket.id.slice(0, 5)}`);
    const color = cleanText(payload?.color, '#19d3ef');
    const peer = {
      id: socket.id,
      room: roomId,
      name,
      color,
      ...sanitizeState(payload?.state),
      updatedAt: Date.now()
    };

    socket.data.room = roomId;
    socket.data.name = name;
    socket.join(roomId);
    getRoom(roomId).set(socket.id, peer);

    socket.emit('room:peers', peerList(roomId).filter(item => item.id !== socket.id));
    socket.to(roomId).emit('peer:update', peer);
    // Design decision: Signal new peer for WebRTC connection establishment
    socket.to(roomId).emit('peer:joined', { id: socket.id, name, color });
  });

  // Design decision: WebRTC signaling - relay offers/answers/ICE to enable peer-to-peer connections
  socket.on('webrtc:offer', ({ to, offer }) => {
    socket.to(to).emit('webrtc:offer', { from: socket.id, offer });
  });

  socket.on('webrtc:answer', ({ to, answer }) => {
    socket.to(to).emit('webrtc:answer', { from: socket.id, answer });
  });

  socket.on('webrtc:ice', ({ to, candidate }) => {
    socket.to(to).emit('webrtc:ice', { from: socket.id, candidate });
  });

  socket.on('location:update', state => {
    const roomId = socket.data.room;
    if (!roomId) return;

    const peers = getRoom(roomId);
    const previous = peers.get(socket.id);
    if (!previous) return;

    const peer = {
      ...previous,
      ...sanitizeState(state),
      updatedAt: Date.now()
    };
    peers.set(socket.id, peer);
    // Design decision: Broadcast update for fallback if WebRTC fails
    socket.to(roomId).emit('peer:update', peer);
  });

  socket.on('room:leave', () => {
    leaveCurrentRoom(socket);
  });

  socket.on('disconnect', () => {
    leaveCurrentRoom(socket);
  });
});

setInterval(() => {
  // Design decision: Periodic cleanup of stale peers to maintain accurate room state
  for (const roomId of rooms.keys()) peerList(roomId);
}, 10_000).unref();

server.listen(port, () => {
  console.log(`VELOX live service listening on http://localhost:${port}`);
  console.log(`Open http://localhost:${port}/velox-mapillary-live.html`);
});
