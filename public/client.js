export function pageUrl(page, params = {}) {
  const url = new URL(`/${page}.html`, location.origin);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url.href;
}

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

export class SportsClient {
  #socket;
  #offset = null;
  #best = null;
  #pending = new Map();
  #attempt = 0;
  #ready = false;
  #nextId = 0;

  constructor({ role, onState, onConnection = () => {} }) {
    this.role = role;
    this.onState = onState;
    this.onConnection = onConnection;
    this.connect();
    setInterval(() => this.ping(), 10000);
    window.addEventListener('focus', () => this.ping());
  }

  now() {
    return this.#offset === null ? Date.now() : this.#offset + performance.now();
  }

  connect() {
    const url = new URL('/ws', location.href);
    url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    url.searchParams.set('role', this.role);
    const socket = new WebSocket(url.href);
    this.#socket = socket;
    socket.addEventListener('open', () => {
      this.#best = null;
      this.ping();
    });
    socket.addEventListener('message', ({ data }) => {
      const message = JSON.parse(data);
      const received = performance.now();
      if (message.type === 'state') {
        if (!this.#ready) {
          this.#offset = message.at - received;
          this.#ready = true;
          this.#attempt = 0;
          this.onConnection(true);
        }
        this.onState(message.state);
      } else if (message.type === 'pong') {
        const rtt = received - message.sent;
        if (rtt >= 0 && (!this.#best || rtt <= this.#best.rtt + 1 || received - this.#best.at > 45000)) {
          this.#best = { rtt, at: received };
          this.#offset = message.at - (received + message.sent) / 2;
        }
      } else if (message.type === 'result') {
        const pending = this.#pending.get(message.id);
        if (!pending) return;
        this.#pending.delete(message.id);
        clearTimeout(pending.timeout);
        if (message.ok) pending.resolve();
        else pending.reject(new Error(message.error));
      }
    });
    socket.addEventListener('close', () => {
      this.#ready = false;
      this.onConnection(false);
      for (const pending of this.#pending.values()) {
        clearTimeout(pending.timeout);
        pending.reject(new Error('连接已断开。重连后请核对画面和操作结果。'));
      }
      this.#pending.clear();
      this.#attempt++;
      setTimeout(() => this.connect(), Math.min(3000, 250 * (2 ** Math.min(this.#attempt, 4))));
    });
  }

  ping() {
    if (this.#socket?.readyState === WebSocket.OPEN) this.#socket.send(JSON.stringify({ type: 'ping', sent: performance.now() }));
  }

  command(action, args = {}) {
    if (!this.#ready || this.#socket.readyState !== WebSocket.OPEN) return Promise.reject(new Error('正在重连，请稍后再试。'));
    const id = String(++this.#nextId);
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error('操作回执超时，请先核对当前状态。'));
      }, 6000);
      this.#pending.set(id, { resolve, reject, timeout });
      this.#socket.send(JSON.stringify({ type: 'command', id, command: { ...args, action } }));
    });
  }
}
