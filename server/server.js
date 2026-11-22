import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { WebSocket, WebSocketServer } from 'ws';
import { applyCommand, clientState, initialState, migrateState, verifyState } from './state.js';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const PUBLIC = path.join(ROOT, 'public');
const BIND = '127.0.0.1';
const DEFAULT_PORT = 3120;
const MAX_STATE_BYTES = 5 * 1024 * 1024;
const CSP = "default-src 'self'; connect-src 'self' ws://127.0.0.1:* ws://localhost:*; img-src 'self' data:; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'none'; frame-ancestors 'self'; form-action 'self'";
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png' };

function readSettings(file) {
  try {
    const stored = verifyState(JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, '')));
    const state = migrateState(stored);
    if (state !== stored) saveSettings(file, state);
    return state;
  }
  catch (error) {
    if (error.code === 'ENOENT') return initialState();
    throw new Error(`无法读取 ${file}：${error.message}`);
  }
}

function saveSettings(file, state) {
  const content = JSON.stringify(state);
  if (Buffer.byteLength(content) > MAX_STATE_BYTES) throw new Error('赛事资料已达到容量上限，请导出并移除已结束的项目。');
  const temp = `${file}.${randomUUID()}.tmp`;
  try {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(temp, content + '\n', { flag: 'wx', flush: true });
    renameSync(temp, file);
  } catch (error) {
    try { unlinkSync(temp); } catch { /* The temporary file may not exist. */ }
    console.error(`保存失败 ${file}: ${error.message}`);
    throw new Error('保存失败。请检查磁盘空间和包装目录的写入权限后重试。');
  }
}

function hostAllowed(server, req) {
  const port = server.address()?.port;
  return [BIND, 'localhost'].some((hostname) => req.headers.host?.toLowerCase() === `${hostname}:${port}`);
}

function reply(req, res, status, type, data) {
  res.writeHead(status, {
    'Content-Type': type,
    'Content-Length': Buffer.byteLength(data),
    'Cache-Control': 'no-store',
    'Content-Security-Policy': CSP,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  });
  res.end(req.method === 'HEAD' ? undefined : data);
}

export function createApp({ dataDir = path.join(ROOT, 'data'), now = () => Math.floor(performance.timeOrigin + performance.now()) } = {}) {
  const dataFile = path.join(dataDir, 'settings.json');
  const session = { file: dataFile, state: readSettings(dataFile) };
  const wss = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024, perMessageDeflate: false });
  const server = http.createServer(async (req, res) => {
    const plain = MIME['.html'].replace('text/html', 'text/plain');
    if (!hostAllowed(server, req)) return reply(req, res, 403, plain, '请用本机 127.0.0.1 地址访问。');
    if (!['GET', 'HEAD'].includes(req.method)) return reply(req, res, 405, plain, 'Method Not Allowed');
    try {
      const url = new URL(req.url, `http://${req.headers.host}`);
      if (url.pathname === '/health') {
        return reply(req, res, 200, 'application/json; charset=utf-8', JSON.stringify({ ok: true, app: 'yanzhou-sport' }));
      }
      const name = url.pathname === '/' ? 'control.html' : decodeURIComponent(url.pathname.slice(1));
      const type = MIME[path.extname(name)];
      if (!type || !/^(?:assets\/)?[a-z0-9][a-z0-9.-]*$/i.test(name)) {
        return reply(req, res, 404, plain, '页面不存在。');
      }
      const content = await readFile(path.join(PUBLIC, name));
      return reply(req, res, 200, type, content);
    } catch (error) {
      const status = error.code === 'ENOENT' ? 404 : (error instanceof URIError || error.code === 'ERR_INVALID_URL') ? 400 : 500;
      return reply(req, res, status, plain, status === 404 ? '页面不存在。' : '无法读取请求的页面。');
    }
  });

  function send(client, message) {
    if (client.readyState !== WebSocket.OPEN) return;
    if (client.bufferedAmount > MAX_STATE_BYTES * 2) client.terminate();
    else client.send(JSON.stringify(message));
  }

  function snapshot(client) {
    const state = clientState(client.session.state, client.role === 'view');
    send(client, { type: 'state', state, at: now() });
  }

  server.on('upgrade', (req, socket, head) => {
    let url;
    try { url = new URL(req.url, 'http://127.0.0.1'); }
    catch { socket.destroy(); return; }
    const role = url.searchParams.get('role');
    if (!hostAllowed(server, req) || url.pathname !== '/ws' ||
        !['view', 'control'].includes(role) || req.headers.origin !== `http://${req.headers.host}`) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      return;
    }
    wss.handleUpgrade(req, socket, head, (client) => {
      client.role = role;
      client.session = session;
      wss.emit('connection', client);
    });
  });

  wss.on('connection', (client) => {
    client.alive = true;
    client.on('pong', () => { client.alive = true; });
    client.on('error', () => client.terminate());
    snapshot(client);
    client.on('message', (payload, binary) => {
      const at = now();
      let message;
      try { message = binary ? null : JSON.parse(payload.toString('utf8')); }
      catch { send(client, { type: 'result', ok: false, error: '消息格式不正确。' }); return; }
      if (message?.type === 'ping' && Number.isFinite(message.sent)) {
        send(client, { type: 'pong', sent: message.sent, at });
        return;
      }
      const id = message?.id;
      if (message?.type !== 'command' || typeof id !== 'string' || id.length > 50) return;
      try {
        if (client.role !== 'control') throw new Error('此连接为输出页。');
        const next = applyCommand(client.session.state, message.command, at);
        saveSettings(client.session.file, next);
        client.session.state = next;
        for (const peer of wss.clients) if (peer.session === client.session) snapshot(peer);
        send(client, { type: 'result', id, ok: true });
      } catch (error) {
        send(client, { type: 'result', id, ok: false, error: error.message });
      }
    });
  });

  const heartbeat = setInterval(() => {
    for (const client of wss.clients) {
      if (!client.alive) client.terminate();
      else { client.alive = false; client.ping(); }
    }
  }, 15000);
  heartbeat.unref();

  return {
    listen(port = DEFAULT_PORT) {
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, BIND, () => {
          server.off('error', reject);
          resolve(server.address().port);
        });
      });
    },
    async close() {
      clearInterval(heartbeat);
      for (const client of wss.clients) client.terminate();
      wss.close();
      await new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); });
    },
  };
}

function openBrowser(url) {
  const command = process.platform === 'win32' ? 'explorer.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  const child = spawn(command, [url], { detached: true, stdio: 'ignore', windowsHide: true });
  child.on('error', () => console.log(`请在浏览器中打开 ${url}`));
  child.unref();
}

async function start() {
  const port = process.env.YANZHOU_PORT === undefined ? DEFAULT_PORT : Number(process.env.YANZHOU_PORT);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('YANZHOU_PORT 应为 1024 至 65535 的整数。');
  const dataDir = path.resolve(process.env.YANZHOU_DATA_DIR || path.join(ROOT, 'data'));
  const app = createApp({ dataDir });
  try { await app.listen(port); }
  catch (error) {
    await app.close();
    if (error.code === 'EADDRINUSE') throw new Error(`端口 ${port} 已被占用。请使用已打开的包装，或设置 YANZHOU_PORT 后重新启动。`);
    throw error;
  }
  const base = `http://${BIND}:${port}`;
  console.log(`\n烟洲体育直播包装已启动\n导播台　${base}/control.html\nOBS　　${base}/overlay.html   1920 × 1080\n数据　　${dataDir}\n\n请保留本窗口，按 Ctrl+C 结束服务。\n`);
  if (process.argv.includes('--open')) openBrowser(`${base}/control.html`);
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void app.close(); });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  start().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
