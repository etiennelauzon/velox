# VELOX Rider Live

A real-time cycling simulator with live location sharing, GPX route simulation, and Bluetooth trainer/HRM integration.

## Features

- **Cycling Simulator**: Realistic bike physics with power, speed, and grade calculations.
- **GPX/FIT Route Loading**: Upload or select preset routes (CGV, Huez) for simulation.
- **Live Location Sharing**: Share cycling position in real-time with other riders via WebRTC.
- **Peer-to-Peer Communication**: Direct data channels for location data between peers.
- **Room-Based Sharing**: Join rooms by ID to share with specific groups.
- **Map Integration**: Interactive Leaflet map displaying rider positions.
- **Bluetooth Support**: Connect to cycling trainers and heart rate monitors.
- **Strava Segments**: Match and time Strava starred segments on routes.
- **Mapillary Streetview**: Integrated street-level imagery viewer.
- **Preset Routes**: Built-in routes like CGV and Huez for immediate riding.

## Architecture

### Frontend (ES Modules + HTML/CSS)
- **Modular ES6**: Code split into `js/` modules (state.js, physics.js, route.js, etc.).
- **State Management**: Centralized app state with reactive updates.
- **Physics Engine**: Bike physics calculations for realistic simulation.
- **Route Parsing**: GPX/FIT file parsing and route visualization.
- **WebRTC Live Sharing**: Peer-to-peer location sharing via SimplePeer.
- **Bluetooth Integration**: Web Bluetooth API for trainer and HRM data.
- **Mapillary Integration**: Streetview imagery for route exploration.

### Backend (Node.js/Express + Socket.IO)
- **Signaling Server**: WebRTC signaling for peer connections.
- **Room Management**: Isolated peer groups for sharing.
- **Fallback Relaying**: Server-relayed updates if WebRTC fails.

## Technology Stack

- **Frontend**: HTML5, CSS3, ES6 Modules, Leaflet.js, MapillaryJS, SimplePeer
- **Backend**: Node.js, Express, Socket.IO
- **Real-time**: WebRTC (peer-to-peer), Socket.IO (signaling)
- **Bluetooth**: Web Bluetooth API
- **Deployment**: GitHub Pages (static hosting)

## Setup

### Local Development

1. Install dependencies:
   ```bash
   npm install
   ```

2. Start the signaling server:
   ```bash
   npm start
   ```

3. Open `velox.html` in a browser (requires HTTPS for Bluetooth/WebRTC).

### GitHub Pages Deployment

The app is deployed on GitHub Pages with native ES modules. No build step required.

- Static files served over HTTPS
- ES modules loaded directly by browser
- CDN libraries (Leaflet, Mapillary, SimplePeer) loaded via `<script defer>`

## Usage

- **Upload Route**: Click "Upload Course" to load GPX/FIT files.
- **Preset Routes**: Select from dropdown (CGV, Huez).
- **Connect Devices**: Use "Connect Trainer" and "Connect HRM" for Bluetooth.
- **Live Sharing**: Join a room to share location with others.
- **Simulation**: Start demo or recording to simulate riding.

## File Structure

```
velox/
├── velox.html          # Main HTML
├── velox.css           # Stylesheet
├── js/                 # ES modules
│   ├── app.js          # Main entry point
│   ├── state.js        # App state management
│   ├── physics.js      # Bike physics
│   ├── route.js        # GPX/FIT parsing and routes
│   ├── bluetooth.js    # Trainer/HRM integration
│   ├── live.js         # WebRTC sharing
│   ├── mapillary.js    # Streetview
│   ├── segments.js     # Strava segments
│   ├── export.js       # GPX/FIT export
│   ├── chart.js        # Charts
│   ├── features.js     # UI features
│   └── utils.js        # Helpers
├── routes/             # Preset GPX files
│   ├── CGV.gpx
│   └── Huez.gpx
├── server.js           # Signaling server
├── package.json        # Dependencies
└── README.md
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