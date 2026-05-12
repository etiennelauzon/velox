// js/live.js — live room WebRTC and marker management
import { S, status, log } from './state.js';
import { positionAt } from './route.js';
import { escapeHtml, setBusy } from './utils.js';

function liveIcon(peer) {
  const color = peer.color || LiveShare.colorFor(peer.id);
  const label = (peer.name || '?').trim().slice(0, 1).toUpperCase() || '?';

  return L.divIcon({
    className: '',
    html: '<div class="liveMarker" style="background:' + color + '">' + escapeHtml(label) + '</div>',
    iconSize: [24, 24],
    iconAnchor: [12, 12]
  });
}

export function removeLiveMarker(id) {
  const marker = S.live.markers.get(id);

  if (marker) {
    marker.remove();
    S.live.markers.delete(id);
  }
}

export function updateLivePeerMarkers() {
  if (!S.map || !S.routeLen || !window.L) return;

  const seen = new Set();

  S.live.peers.forEach((peer, id) => {
    if (!Number.isFinite(peer.lat) || !Number.isFinite(peer.lon)) return;

    seen.add(id);

    let marker = S.live.markers.get(id);

    if (!marker) {
      marker = L.marker(
        [peer.lat, peer.lon],
        {
          icon: liveIcon(peer),
          title: peer.name || id
        }
      ).addTo(S.map);

      S.live.markers.set(id, marker);
    } else {
      // IMPORTANT:
      // Only move the marker.
      // Recreating the icon each update causes blinking/flickering.
      marker.setLatLng([peer.lat, peer.lon]);
    }
  });

  Array.from(S.live.markers.keys()).forEach(id => {
    if (!seen.has(id)) removeLiveMarker(id);
  });
}

export const LiveShare = {
  colors: ['#19d3ef', '#44d07b', '#e9c54a', '#ff8738', '#c65cff', '#5d8cff', '#ef4d4d'],

  defaultServer() {
    return 'https://velox-u31w.onrender.com';
  },

  makeId() {
    return Math.random().toString(36).slice(2, 8).toUpperCase();
  },

  normalizeRoom(value) {
    return (value || '')
      .trim()
      .replace(/[^a-zA-Z0-9_-]/g, '-')
      .slice(0, 32);
  },

  colorFor(id) {
    let n = 0;

    for (const ch of String(id || '')) {
      n = (n + ch.charCodeAt(0)) % 997;
    }

    return this.colors[n % this.colors.length];
  },

  async ensureSocketIo(serverUrl) {
    if (window.io) return;

    await new Promise((resolve, reject) => {
      const script = document.createElement('script');

      script.src = 'https://cdn.socket.io/4.7.5/socket.io.min.js';
      script.onload = resolve;
      script.onerror = () => reject(new Error('Socket.IO client failed to load from CDN'));

      document.head.appendChild(script);
    });
  },

  snapshot() {
    const p = positionAt(S.routeDistance);

    return {
      lat: p.lat,
      lon: p.lon,
      ele: p.ele,
      routeDistance: S.routeDistance,
      routeLen: S.routeLen,
      speed: S.speed,
      power: S.power,
      cadence: S.cadence,
      hr: S.hr,
      elapsed: S.elapsed,
      routeName: S.routeName,
      recording: S.recording,
      updatedAt: Date.now()
    };
  },

  render() {
    const dot = document.getElementById('liveDot');
    const state = document.getElementById('liveStatus');
    const list = document.getElementById('livePeers');

    if (dot) dot.classList.toggle('on', S.live.connected);

    if (state) {
      state.textContent = S.live.connected
        ? 'Room ' + S.live.room + ' · ' + S.live.peers.size + ' peer' + (S.live.peers.size === 1 ? '' : 's')
        : 'Live sharing disconnected';
    }

    if (!list) return;

    const peers = Array.from(S.live.peers.values())
      .sort((a, b) => (a.name || '').localeCompare(b.name || ''));

    list.innerHTML = peers.map(peer => {
      const km = Number.isFinite(peer.routeDistance)
        ? (peer.routeDistance / 1000).toFixed(2) + ' km'
        : '--';

      const spd = Number.isFinite(peer.speed)
        ? peer.speed.toFixed(1) + ' km/h'
        : '--';

      const color = peer.color || this.colorFor(peer.id);

      const age = Math.max(
        0,
        Math.round((Date.now() - (peer.updatedAt || Date.now())) / 1000)
      );

      return '<div class="livePeer">' +
        '<i class="liveSwatch" style="background:' + color + '"></i>' +
        '<b>' + escapeHtml(peer.name || peer.id) + '</b>' +
        '<span>' + km + ' · ' + spd + ' · ' + age + 's</span>' +
        '</div>';
    }).join('');

    updateLivePeerMarkers();
  },

  async join() {
    const serverUrl = (
      document.getElementById('liveServer').value ||
      this.defaultServer()
    ).trim().replace(/\/$/, '');

    const room = this.normalizeRoom(
      document.getElementById('liveRoom').value || 'team-ride'
    ) || 'team-ride';

    const name = (
      document.getElementById('liveName').value ||
      'Rider ' + this.makeId()
    ).trim().slice(0, 32);

    document.getElementById('liveServer').value = serverUrl;
    document.getElementById('liveRoom').value = room;
    document.getElementById('liveName').value = name;

    setBusy('liveJoinBtn', true, 'Joining...');

    try {
      await this.ensureSocketIo(serverUrl);

      if (S.live.socket) S.live.socket.disconnect();

      S.live.room = room;
      S.live.name = name;
      S.live.color = this.colorFor(name);

      const socket = window.io(serverUrl, {
        transports: ['websocket', 'polling'],
        timeout: 30000
      });

      S.live.socket = socket;

      socket.on('connect', () => {
        S.live.connected = true;
        S.live.clientId = socket.id;
        S.live.peers.clear();

        socket.emit('room:join', {
          room,
          name,
          color: S.live.color,
          state: this.snapshot()
        });

        document.getElementById('liveJoinBtn').textContent = 'Joined';
        document.getElementById('liveJoinBtn').disabled = true;
        document.getElementById('liveLeaveBtn').disabled = false;

        status('Live room joined: ' + room);

        this.render();
        this.share(true);
      });

      socket.on('connect_error', err => {
        status('Live connection failed: ' + err.message);
      });

      socket.on('room:peers', peers => {
        S.live.peers.clear();

        (peers || []).forEach(peer => {
          if (peer.id !== S.live.clientId) this.addPeer(peer);
        });

        this.render();
        updateLivePeerMarkers();
      });

      socket.on('peer:joined', peer => {
        this.addPeer(peer);
        this.render();
        updateLivePeerMarkers();
      });

      socket.on('peer:update', peer => {
        if (peer && peer.id !== S.live.clientId) {
          S.live.peers.set(peer.id, peer);
          this.render();
          updateLivePeerMarkers();
        }
      });

      socket.on('peer:left', ({ id }) => {
        this.removePeer(id);
        this.render();
        updateLivePeerMarkers();
      });

      socket.on('webrtc:offer', ({ from, offer }) => {
        this.handleOffer(from, offer);
      });

      socket.on('webrtc:answer', ({ from, answer }) => {
        this.handleAnswer(from, answer);
      });

      socket.on('webrtc:ice', ({ from, candidate }) => {
        this.handleIce(from, candidate);
      });

      socket.on('disconnect', () => {
        S.live.connected = false;

        document.getElementById('liveJoinBtn').textContent = 'Join Room';
        document.getElementById('liveJoinBtn').disabled = false;
        document.getElementById('liveLeaveBtn').disabled = true;

        this.render();
      });

    } catch (e) {
      status(e.message);

    } finally {
      if (!S.live.connected) {
        setBusy('liveJoinBtn', false, 'Join Room');
      }
    }
  },

  addPeer(peer) {
    const alreadyHasPeer = S.live.peers.has(peer.id);

    S.live.peers.set(peer.id, peer);

    if (S.live.webRTCpeers?.has(peer.id)) return;

    const p = new SimplePeer({
      initiator: peer.id < S.live.clientId,
      trickle: false
    });

    p.peerId = peer.id;

    S.live.webRTCpeers = S.live.webRTCpeers || new Map();
    S.live.webRTCpeers.set(peer.id, p);

    p.on('signal', data => {
      if (data.type === 'offer') {
        S.live.socket.emit('webrtc:offer', {
          to: peer.id,
          offer: data
        });
      } else if (data.type === 'answer') {
        S.live.socket.emit('webrtc:answer', {
          to: peer.id,
          answer: data
        });
      } else if (data.candidate) {
        S.live.socket.emit('webrtc:ice', {
          to: peer.id,
          candidate: data
        });
      }
    });

    p.on('connect', () => {
      log('WebRTC connected to ' + peer.id);
      this.share(true);
    });

    p.on('data', data => {
      try {
        const update = JSON.parse(data.toString());

        if (update.id !== S.live.clientId) {
          S.live.peers.set(update.id, update);
          this.render();
        }

      } catch (e) {
        log('Invalid peer data: ' + e.message);
      }
    });

    p.on('error', err => {
      log('WebRTC error with ' + peer.id + ': ' + err.message);
    });

    p.on('close', () => {
      this.removePeer(peer.id);
    });
  },

  removePeer(id) {
    removeLiveMarker(id);

    S.live.peers.delete(id);

    if (S.live.webRTCpeers) {
      const p = S.live.webRTCpeers.get(id);

      if (p) p.destroy();

      S.live.webRTCpeers.delete(id);
    }
  },

  handleOffer(from, offer) {
    const p = S.live.webRTCpeers.get(from);

    if (p) p.signal(offer);
  },

  handleAnswer(from, answer) {
    const p = S.live.webRTCpeers.get(from);

    if (p) p.signal(answer);
  },

  handleIce(from, candidate) {
    const p = S.live.webRTCpeers.get(from);

    if (p) p.signal(candidate);
  },

  leave() {
    if (S.live.socket) S.live.socket.disconnect();

    S.live.connected = false;

    S.live.peers.forEach((_, id) => this.removePeer(id));
    S.live.peers.clear();

    if (S.live.webRTCpeers) {
      S.live.webRTCpeers.forEach(p => p.destroy());
      S.live.webRTCpeers.clear();
    }

    document.getElementById('liveJoinBtn').textContent = 'Join Room';
    document.getElementById('liveJoinBtn').disabled = false;
    document.getElementById('liveLeaveBtn').disabled = true;

    this.render();

    status('Live room left');
  },

  share(force) {
    if (!S.live.connected) return;

    const now = Date.now();

    if (!force && now - S.live.lastSent < S.live.rateMs) return;

    S.live.lastSent = now;

    const data = {
      ...this.snapshot(),
      id: S.live.clientId,
      name: S.live.name,
      color: S.live.color
    };

    if (S.live.webRTCpeers) {
      S.live.webRTCpeers.forEach(p => {
        if (p.connected) {
          p.send(JSON.stringify(data));
        }
      });
    }

    if (S.live.socket && S.live.socket.connected) {
      S.live.socket.emit('location:update', data);
    }
  }
};