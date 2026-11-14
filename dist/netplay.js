// Direct P2P WebRTC Netplay for Super Smash Bros. Melee (Browser Recompilation)
// Features: Option 1 Hybrid Cloud Relay (ntfy.sh) + Local Server Fallback.
// No 3rd-party accounts, no tunnels required when friends run locally on their own PCs!
// Direct UDP DataChannels, 2-frame anti-stutter buffer, live RTT ping, 1v1, Teams, and FFA.

import { getKeyMap } from './pads.js';

const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  { urls: 'stun:stun3.l.google.com:19302' },
  { urls: 'stun:stun4.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
];

export class Netplay {
  constructor(app, pads) {
    this.app = app;
    this.pads = pads;
    this.role = 'none'; // 'host' | 'guest' | 'none'
    this.roomCode = '';
    this.pc = null;
    this.dc = null;
    this.mode = '1v1'; // '1v1' | 'teams' | 'ffa'
    this.status = 'disconnected'; // 'disconnected' | 'hosting' | 'joining' | 'connected' | 'in_match'
    this.rtt = 0;
    this.inputDelay = 2; // 2 frames buffer for smooth 60fps stutter-free play
    this.localPlayer = 0; // 0 for host (P1), 1 for guest (P2)
    this.targetPlayer = 1;

    // Fixed tick frame queues
    this.currentTick = 0;
    this.localQueue = new Map();
    this.remoteQueue = new Map();
    this.lastRemoteInput = null;

    // Track active keyboard presses for players without physical gamepads
    this.heldKeys = new Set();
    window.addEventListener('keydown', (e) => {
      if (!e.repeat) this.heldKeys.add(e.code);
    });
    window.addEventListener('keyup', (e) => {
      this.heldKeys.delete(e.code);
    });

    // Listeners for UI updates
    this.onStatusChange = null;
    this.onPingUpdate = null;
    this.onLobbySync = null;

    this.sse = null;
    this.pollInterval = null;
    this.pingInterval = null;
    this.offerHandled = false;
    this.answerHandled = false;
  }

  get isConnected() {
    return this.dc && this.dc.readyState === 'open';
  }

  get isOnlineMatch() {
    return this.status === 'in_match' && this.isConnected;
  }

  generateCode() {
    const prefixes = ['FOX', 'MARTH', 'FALCO', 'SHEIK', 'ROY', 'LINK', 'PEACH', 'PUFF', 'MELEE'];
    const p = prefixes[Math.floor(Math.random() * prefixes.length)];
    const n = Math.floor(10 + Math.random() * 89);
    return `${p}${n}`;
  }

  // --- Host Room ---
  async hostRoom(mode = '1v1', customCode = '') {
    this.cleanup();
    this.role = 'host';
    this.localPlayer = 0;
    this.targetPlayer = 1;
    this.mode = mode;
    this.roomCode = customCode ? customCode.toUpperCase() : this.generateCode();
    this.status = 'hosting';
    this.updateStatus(`Creating room ${this.roomCode}…`);

    // 1. Post to local server if running
    fetch('/api/room/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: this.roomCode, mode: this.mode }),
    }).catch(() => {});

    // 2. Initialize native WebRTC PeerConnection
    this.pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

    // Host creates the unbuffered low-latency DataChannel
    this.dc = this.pc.createDataChannel('melee', { ordered: false, maxRetransmits: 0 });
    this.bindDataChannel(this.dc);

    this.pc.onicecandidate = (e) => {
      if (e.candidate) {
        this.broadcastSignal({ type: 'candidate', candidate: e.candidate });
      }
    };

    // 3. Create and post SDP Offer
    try {
      const offer = await this.pc.createOffer();
      await this.pc.setLocalDescription(offer);
      await this.broadcastSignal({ type: 'offer', sdp: this.pc.localDescription.sdp, mode: this.mode });
      this.updateStatus(`Room Ready: ${this.roomCode}. Waiting for friend to join…`);
    } catch (e) {
      console.error('[Netplay] Error creating offer:', e);
      this.updateStatus('Could not create room offer. Check WebRTC support.');
      return;
    }

    // 4. Listen for guest answer on both Cloud Relay (ntfy.sh) and Local Server
    this.listenSignals('host');
  }

  // --- Join Room ---
  async joinRoom(code) {
    if (!code) return;
    this.cleanup();
    this.role = 'guest';
    this.localPlayer = 1;
    this.targetPlayer = 0;
    this.roomCode = code.trim().toUpperCase();
    this.status = 'joining';
    this.updateStatus(`Connecting to Room ${this.roomCode}…`);

    // 1. Initialize native WebRTC PeerConnection
    this.pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

    // Guest listens for Host's DataChannel
    this.pc.ondatachannel = (e) => {
      this.dc = e.channel;
      this.bindDataChannel(this.dc);
    };

    this.pc.onicecandidate = (e) => {
      if (e.candidate) {
        this.broadcastSignal({ type: 'candidate', candidate: e.candidate });
      }
    };

    // 2. Check local server if running on same host
    fetch('/api/room/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: this.roomCode }),
    }).then((res) => res.json()).then((data) => {
      if (data && data.mode) this.mode = data.mode;
      if (data && data.offer) this.handleRemoteOffer(data.offer);
    }).catch(() => {});

    // 3. Listen for host offer on both Cloud Relay (ntfy.sh) and Local Server
    this.listenSignals('guest');
  }

  // Broadcast signal to both Cloud Relay (ntfy.sh) and Local server
  async broadcastSignal(sig) {
    const topic = this.role === 'host'
      ? `melee-p2p-${this.roomCode}-host-sig`
      : `melee-p2p-${this.roomCode}-guest-sig`;

    const payload = JSON.stringify(sig);

    // Cloud Relay (Option 1)
    fetch(`https://ntfy.sh/${topic}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
    }).catch(() => {});

    // Local server fallback
    fetch('/api/room/signal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: this.roomCode, from: this.role, signal: sig }),
    }).catch(() => {});
  }

  async handleRemoteOffer(offerSdp) {
    if (this.offerHandled || !this.pc) return;
    this.offerHandled = true;
    try {
      await this.pc.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp: offerSdp }));
      const answer = await this.pc.createAnswer();
      await this.pc.setLocalDescription(answer);
      await this.broadcastSignal({ type: 'answer', sdp: this.pc.localDescription.sdp });
    } catch (e) {
      console.error('[Netplay] Error handling remote offer:', e);
    }
  }

  async handleRemoteAnswer(answerSdp) {
    if (this.answerHandled || !this.pc) return;
    this.answerHandled = true;
    try {
      await this.pc.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp: answerSdp }));
    } catch (e) {
      console.error('[Netplay] Error handling remote answer:', e);
    }
  }

  listenSignals(myRole) {
    const listenTopic = myRole === 'host'
      ? `melee-p2p-${this.roomCode}-guest-sig`
      : `melee-p2p-${this.roomCode}-host-sig`;

    // 1. Realtime Cloud SSE Stream via ntfy.sh
    try {
      this.sse = new EventSource(`https://ntfy.sh/${listenTopic}/sse`);
      this.sse.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data);
          if (data && data.event === 'message') {
            const sig = JSON.parse(data.message);
            this.processIncomingSignal(sig);
          }
        } catch {}
      };
    } catch {}

    // 2. Fast Cloud Polling + Local Polling Fallback
    if (this.pollInterval) clearInterval(this.pollInterval);
    this.pollInterval = setInterval(async () => {
      if (this.isConnected) {
        clearInterval(this.pollInterval);
        this.pollInterval = null;
        return;
      }

      // Check Cloud Relay
      try {
        const resp = await fetch(`https://ntfy.sh/${listenTopic}/json?poll=1&since=10m`);
        const text = await resp.text();
        const lines = text.trim().split('\n');
        for (const line of lines) {
          if (!line) continue;
          try {
            const data = JSON.parse(line);
            if (data.event === 'message') {
              const sig = JSON.parse(data.message);
              this.processIncomingSignal(sig);
            }
          } catch {}
        }
      } catch {}

      // Check Local Server fallback
      try {
        const resp = await fetch(`/api/room/poll?code=${this.roomCode}&peer=${myRole}`);
        const data = await resp.json();
        if (data.ok) {
          if (data.offer && !this.offerHandled) this.handleRemoteOffer(data.offer);
          if (data.answer && !this.answerHandled) this.handleRemoteAnswer(data.answer);
          if (Array.isArray(data.candidates)) {
            for (const cand of data.candidates) {
              try { await this.pc.addIceCandidate(new RTCIceCandidate(cand)); } catch {}
            }
          }
        }
      } catch {}
    }, 350);
  }

  processIncomingSignal(sig) {
    if (!sig) return;
    if (sig.type === 'offer') {
      this.handleRemoteOffer(sig.sdp);
    } else if (sig.type === 'answer') {
      this.handleRemoteAnswer(sig.sdp);
    } else if (sig.type === 'candidate' && sig.candidate && this.pc) {
      try {
        this.pc.addIceCandidate(new RTCIceCandidate(sig.candidate));
      } catch {}
    }
  }

  bindDataChannel(dc) {
    dc.binaryType = 'arraybuffer';

    dc.onopen = () => {
      this.cleanupSignaling();
      this.status = 'connected';
      this.updateStatus(`🟢 Connected! Peer in Room ${this.roomCode}`);

      // Register virtual pad handle 99 for remote opponent
      this.app.pad_connect(99, 'Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 028e)');
      this.app.pad_assign(99, this.targetPlayer);

      // Start live RTT ping loop
      this.startPingLoop();

      // Handshake
      this.send({ type: 'hello', role: this.role, mode: this.mode });
    };

    dc.onmessage = (e) => {
      this.handleIncoming(e.data);
    };

    dc.onclose = () => {
      this.status = 'disconnected';
      this.updateStatus('🔴 Opponent disconnected.');
      this.app.pad_disconnect(99);
      if (this.pingInterval) clearInterval(this.pingInterval);
    };

    dc.onerror = (e) => {
      console.warn('[Netplay] DataChannel error:', e);
    };
  }

  send(msg) {
    if (!this.isConnected) return;
    try {
      if (msg instanceof ArrayBuffer || msg instanceof Uint8Array) {
        this.dc.send(msg);
      } else {
        this.dc.send(JSON.stringify(msg));
      }
    } catch (e) {
      console.warn('[Netplay] Send error:', e);
    }
  }

  startPingLoop() {
    if (this.pingInterval) clearInterval(this.pingInterval);
    this.pingInterval = setInterval(() => {
      if (this.isConnected) {
        this.send({ type: 'ping', t: performance.now() });
      }
    }, 1000);
  }

  handleIncoming(data) {
    // 1. Binary Packet (In-Match 60Hz Input)
    if (data instanceof ArrayBuffer || (data.buffer && data.buffer instanceof ArrayBuffer)) {
      const buf = data instanceof ArrayBuffer ? data : data.buffer;
      const view = new DataView(buf);
      if (view.byteLength >= 10) {
        const frame = view.getUint16(0);
        const buttons = view.getUint16(2);
        const sx = view.getInt8(4) / 127.0;
        const sy = view.getInt8(5) / 127.0;
        const cx = view.getInt8(6) / 127.0;
        const cy = view.getInt8(7) / 127.0;
        const tl = view.getUint8(8) / 255.0;
        const tr = view.getUint8(9) / 255.0;

        const padInput = {
          frame,
          buttons,
          axes: [sx, sy, cx, cy, tl, tr],
        };
        this.remoteQueue.set(frame, padInput);
        this.lastRemoteInput = padInput;
      }
      return;
    }

    // 2. JSON Message
    try {
      const msg = typeof data === 'string' ? JSON.parse(data) : data;
      switch (msg.type) {
        case 'ping':
          this.send({ type: 'pong', t: msg.t });
          break;
        case 'pong':
          this.rtt = Math.round(performance.now() - msg.t);
          if (this.onPingUpdate) this.onPingUpdate(this.rtt);
          break;
        case 'hello':
          this.updateStatus(`🟢 Paired with opponent in ${this.mode.toUpperCase()}`);
          if (this.role === 'host') {
            this.send({ type: 'sync_mode', mode: this.mode });
          }
          break;
        case 'sync_mode':
          this.mode = msg.mode;
          if (this.onLobbySync) this.onLobbySync('mode', this.mode);
          break;
        case 'pick':
          if (this.onLobbySync) this.onLobbySync('pick', msg);
          break;
        case 'start_match':
          if (this.onLobbySync) this.onLobbySync('start_match', msg);
          break;
        case 'rematch':
          if (this.onLobbySync) this.onLobbySync('rematch', msg);
          break;
        default:
          break;
      }
    } catch {}
  }

  getLocalInputs() {
    let hasPad = false;
    for (let i = 0; i < 16; i++) {
      if (this.pads.buttons[i] > 0.1) { hasPad = true; break; }
    }
    if (!hasPad) {
      for (let i = 0; i < 4; i++) {
        if (Math.abs(this.pads.axes[i]) > 0.2) { hasPad = true; break; }
      }
    }
    if (hasPad) {
      return { buttons: this.pads.buttons, axes: this.pads.axes };
    }
    return this.getKeyboardInputs();
  }

  getKeyboardInputs() {
    const btns = new Float32Array(16);
    const axes = new Float32Array(6);
    const km = getKeyMap();
    for (const code of this.heldKeys) {
      const b = km[code];
      if (b && (b[0] === this.localPlayer || b[0] === 0)) {
        const action = b[1];
        if (action === 'left') axes[0] = -1.0;
        if (action === 'right') axes[0] = 1.0;
        if (action === 'up') axes[1] = -1.0;
        if (action === 'down') axes[1] = 1.0;
        if (action === 'attack') btns[0] = 1.0;
        if (action === 'special') btns[1] = 1.0;
        if (action === 'jump') btns[2] = 1.0;
        if (action === 'shield') { btns[6] = 1.0; axes[4] = 1.0; }
        if (action === 'grab') btns[4] = 1.0;
      }
    }
    return { buttons: btns, axes };
  }

  sendTickInput(tick) {
    if (!this.isConnected) return;
    const targetFrame = (tick + this.inputDelay) & 0xFFFF;
    const { buttons: rawButtons, axes: rawAxes } = this.getLocalInputs();

    const buf = new ArrayBuffer(10);
    const view = new DataView(buf);
    view.setUint16(0, targetFrame);

    let bitmask = 0;
    for (let i = 0; i < 16; i++) {
      if (rawButtons[i] > 0.45) bitmask |= (1 << i);
    }
    view.setUint16(2, bitmask);

    const clampByte = (v) => Math.max(-128, Math.min(127, Math.round(v * 127)));
    view.setInt8(4, clampByte(rawAxes[0] || 0));
    view.setInt8(5, clampByte(rawAxes[1] || 0));
    view.setInt8(6, clampByte(rawAxes[2] || 0));
    view.setInt8(7, clampByte(rawAxes[3] || 0));
    view.setUint8(8, Math.min(255, Math.round((rawAxes[4] || 0) * 255)));
    view.setUint8(9, Math.min(255, Math.round((rawAxes[5] || 0) * 255)));

    this.send(buf);

    this.localQueue.set(targetFrame, {
      frame: targetFrame,
      buttons: bitmask,
      axes: [rawAxes[0] || 0, rawAxes[1] || 0, rawAxes[2] || 0, rawAxes[3] || 0, rawAxes[4] || 0, rawAxes[5] || 0],
    });
  }

  sampleTick(tick) {
    const target = tick & 0xFFFF;
    const remote = this.remoteQueue.get(target) || this.lastRemoteInput;
    if (this.remoteQueue.has(target)) {
      this.remoteQueue.delete(target);
    }

    if (remote) {
      const btnArr = new Float32Array(17);
      for (let i = 0; i < 16; i++) {
        if (remote.buttons & (1 << i)) btnArr[i] = 1.0;
      }
      this.app.pad_update(99, btnArr, remote.axes, performance.now());
    }

    if (this.localQueue.size > 60) {
      for (const k of this.localQueue.keys()) {
        if (k < target - 30) this.localQueue.delete(k);
      }
    }
  }

  updateStatus(text) {
    if (this.onStatusChange) this.onStatusChange(text, this.status);
  }

  cleanupSignaling() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    if (this.sse) {
      try { this.sse.close(); } catch {}
      this.sse = null;
    }
  }

  cleanup() {
    this.cleanupSignaling();
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
    if (this.dc) {
      try { this.dc.close(); } catch {}
      this.dc = null;
    }
    if (this.pc) {
      try { this.pc.close(); } catch {}
      this.pc = null;
    }
    this.offerHandled = false;
    this.answerHandled = false;
  }

  leave() {
    this.cleanup();
    this.status = 'disconnected';
    this.role = 'none';
    this.roomCode = '';
    this.updateStatus('Disconnected from Online');
  }
}
