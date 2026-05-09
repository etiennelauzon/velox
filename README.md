# VELOX Live Location Sharing

A real-time cycling application with peer-to-peer live location sharing using WebRTC.

## Features

- **Live Location Sharing**: Share your cycling position in real-time with other riders in the same room.
- **Peer-to-Peer Communication**: Uses WebRTC for direct data channels between peers, minimizing server load.
- **Room-Based**: Join rooms by ID to share with specific groups.
- **Map Integration**: Displays rider positions on an interactive map.
- **Bluetooth Support**: Connect to cycling trainers and heart rate monitors.
- **Course Upload**: Load GPX/FIT files for route simulation.

## Architecture

### Backend (Node.js/Express + Socket.IO)
- **Signaling Server**: Handles WebRTC signaling (offers, answers, ICE candidates).
- **Room Management**: Manages peer connections and state.
- **Real-time Communication**: Uses Socket.IO for signaling and fallback.

### Frontend (HTML/JS + WebRTC)
- **WebRTC Peer Connections**: Direct data channels for location data.
- **Socket.IO Client**: For signaling and initial connection.
- **Leaflet Map**: Displays live positions of all peers.

## Technology Choices

- **Real-time Communication**: WebRTC for peer-to-peer data channels, best for direct, low-latency sharing of location data without server relaying.
- **Signaling**: Socket.IO over WebSockets for reliable signaling.
- **Backend**: Node.js/Express for simplicity and performance.

## Design Decisions

### Peer-to-Peer vs Server-Mediated Communication
**Hypothesis**: For live location sharing among multiple users in a room, peer-to-peer communication via WebRTC reduces server load and latency compared to server-relaying all messages.

**Decision**: Implemented WebRTC data channels for direct peer connections. Socket.IO is used only for signaling (establishing connections). This scales better as the number of peers increases, since data doesn't bottleneck at the server.

**Rationale**: Location data (lat/lon, speed, etc.) is lightweight and frequent. WebRTC allows direct sharing without constant server round-trips, improving performance for real-time applications.

### Signaling Server Choice
**Hypothesis**: WebRTC requires a signaling server for initial connection establishment, but the server shouldn't handle ongoing data traffic.

**Decision**: Used Socket.IO (WebSockets) for signaling. The server relays offers, answers, and ICE candidates but not location updates.

**Rationale**: Socket.IO provides reliable, bidirectional communication for signaling. It's simpler than implementing custom WebRTC signaling and handles connection fallbacks.

### Fallback Mechanism
**Hypothesis**: WebRTC connections might fail due to network issues, firewalls, or browser limitations.

**Decision**: Implemented fallback to server-relayed updates via Socket.IO if WebRTC peers don't connect.

**Rationale**: Ensures reliability. If direct peer connection fails, the app still works by broadcasting through the server, maintaining functionality at the cost of higher server load.

### Room-Based Isolation
**Hypothesis**: Users should only share with intended groups, not globally.

**Decision**: Used room IDs for grouping peers. Each room is isolated, with separate peer lists and connections.

**Rationale**: Prevents accidental sharing across unrelated groups. Rooms are lightweight to manage and allow multiple simultaneous sessions.

### Stale Peer Cleanup
**Hypothesis**: Peers may disconnect abruptly, leaving stale entries.

**Decision**: Automatic cleanup of peers inactive for 30 seconds. Periodic checks every 10 seconds.

**Rationale**: Keeps peer lists accurate and prevents accumulation of disconnected users. Balances responsiveness with resource usage.

### Data Sanitization and Security
**Hypothesis**: User input and data must be validated to prevent abuse.

**Decision**: Sanitize all incoming data (numbers, strings, lengths). Limit room/name lengths.

**Rationale**: Prevents injection attacks, DoS via oversized data, and ensures consistent state across clients.

### WebRTC Library Choice
**Hypothesis**: WebRTC APIs are complex; a wrapper simplifies implementation.

**Decision**: Used `simple-peer` library for WebRTC connections.

**Rationale**: Abstracts WebRTC complexity, handles signaling internally, and provides a simple API for data channels. Widely used and maintained.

### Update Frequency and Throttling
**Hypothesis**: Location updates should be frequent enough for real-time feel but not overwhelm connections.

**Decision**: Configurable share interval (0.75s to 5s), throttled to prevent spam.

**Rationale**: Balances responsiveness with bandwidth. Users can adjust based on network conditions.

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Start the server:
   ```bash
   npm start
   ```

3. Open `http://localhost:8787/velox-mapillary-live.html` in your browser.

## Usage

1. Enter a Room ID and Rider Name.
2. Click "Join Room" to connect.
3. Upload a GPX/FIT course if desired.
4. Start demo or connect trainer to begin sharing location.
5. Other riders in the same room will see your position in real-time.

## API

### Server Events
- `room:join` - Join a room
- `webrtc:offer` - Send WebRTC offer
- `webrtc:answer` - Send WebRTC answer
- `webrtc:ice` - Send ICE candidate
- `location:update` - Update location (fallback)

### Client Events
- `room:peers` - List of peers in room
- `peer:joined` - New peer joined
- `peer:update` - Peer location update
- `peer:left` - Peer left
- `webrtc:offer` - WebRTC offer received
- `webrtc:answer` - WebRTC answer received
- `webrtc:ice` - ICE candidate received

## Best Practices

- **WebRTC for P2P**: Chosen for direct peer connections, reducing server bandwidth for location data.
- **Fallback to Server**: If WebRTC fails, falls back to server-relayed updates.
- **Room Isolation**: Rooms keep peer groups separate.
- **Stale Peer Cleanup**: Automatically removes inactive peers.

## Dependencies

- `express` - Web server
- `socket.io` - Real-time communication
- `simple-peer` - WebRTC wrapper
- `leaflet` - Map library
- `mapillary-js` - Street-level imagery