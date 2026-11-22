import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { WebSocket } from 'ws';
import { createApp } from '../server/server.js';
import { activeEvent } from '../public/sport.js';

function connect(base, role = 'control', origin = base) {
  const ws = new WebSocket(`${base.replace('http:', 'ws:')}/ws?role=${role}`, { origin });
  const events = new EventEmitter();
  const inbox = [];
  let serial = 0;
  ws.on('message', (data) => { inbox.push(JSON.parse(data)); events.emit('data'); });
  ws.on('error', () => {});
  function take(match) {
    return new Promise((resolve, reject) => {
      const search = () => {
        const index = inbox.findIndex(match);
        if (index === -1) return;
        clearTimeout(timeout);
        events.off('data', search);
        resolve(inbox.splice(index, 1)[0]);
      };
      const timeout = setTimeout(() => {
        events.off('data', search);
        reject(new Error(`No matching WebSocket message (${role})`));
      }, 2000);
      events.on('data', search);
      search();
    });
  }
  return {
    ws,
    state: (revision = 0) => take((msg) => msg.type === 'state' && msg.state.revision >= revision).then((msg) => msg.state),
    command(action, fields = {}) {
      const id = String(++serial);
      ws.send(JSON.stringify({ type: 'command', id, command: { ...fields, action } }));
      return take((msg) => msg.type === 'result' && msg.id === id);
    },
  };
}

test('control and output stay in sync and a restart restores the race', async (t) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'yanzhou-test-'));
  let app = createApp({ dataDir });
  t.after(async () => { await app.close(); await rm(dataDir, { recursive: true, force: true }); });
  let base = `http://127.0.0.1:${await app.listen(0)}`;
  assert.equal((await fetch(`${base}/health`)).status, 200);
  assert.match(await (await fetch(`${base}/control.html`)).text(), /<title>烟洲体育导播台<\/title>/);
  assert.equal((await fetch(`${base}/overlay.html`, { method: 'HEAD' })).status, 200);
  const brandingPreview = await fetch(`${base}/branding-preview.html`);
  assert.equal(brandingPreview.status, 200);
  assert.match(await brandingPreview.text(), /data-branding-preview/);
  const channelWordmark = await fetch(`${base}/assets/branding/yanzhou-channel-wordmark.png`, { method: 'HEAD' });
  assert.equal(channelWordmark.status, 200);
  assert.equal(channelWordmark.headers.get('content-type'), 'image/png');
  const goldMark = await fetch(`${base}/assets/branding/yanzhou-zhou-gold-mark.png`, { method: 'HEAD' });
  assert.equal(goldMark.status, 200);
  assert.equal(goldMark.headers.get('content-type'), 'image/png');
  assert.equal((await fetch(`${base}/data/settings.json`)).status, 404);
  const operator = connect(base);
  const output = connect(base, 'view');
  const [live, view] = await Promise.all([operator.state(), output.state()]);
  assert.equal(live.events.length, 4);
  assert.ok(live.events.every(({ schedule }) => schedule));
  assert.equal(view.events.length, 1);
  assert.equal(activeEvent(live).competitors.length, 0);
  assert.equal((await output.command('module:clear')).ok, false);
  assert.equal((await operator.command('module:clear')).ok, true);
  assert.equal((await output.state(1)).modules.brand.visible, false);
  assert.equal((await operator.command('athlete:save', { eventId: live.activeEventId, fields: { name: '测试选手', bib: '1', result: '2:05.00' } })).ok, true);
  const raced = await output.state(2);
  assert.equal(raced.modules.brand.visible, false);
  assert.equal(activeEvent(raced).competitors[0].time, 125000);
  assert.equal(JSON.parse(await readFile(path.join(dataDir, 'settings.json'), 'utf8')).revision, 2);
  const denied = connect(base, 'control', 'https://other.example');
  const code = await new Promise((resolve) => denied.ws.once('unexpected-response', (_, res) => { res.resume(); resolve(res.statusCode); }));
  denied.ws.terminate();
  assert.equal(code, 403);
  await app.close();
  app = createApp({ dataDir });
  base = `http://127.0.0.1:${await app.listen(0)}`;
  const resumed = await connect(base, 'view').state(2);
  assert.equal(activeEvent(resumed).competitors[0].name, '测试选手');
  assert.equal(activeEvent(resumed).competitors[0].time, 125000);
  assert.equal(resumed.modules.brand.visible, false);
});

test('switching divisions restores each event graphics, results, and on-air page after restart', async (t) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'yanzhou-test-'));
  let app = createApp({ dataDir });
  t.after(async () => { await app.close(); await rm(dataDir, { recursive: true, force: true }); });
  let base = `http://127.0.0.1:${await app.listen(0)}`;
  let operator = connect(base);
  const output = connect(base, 'view');
  await operator.state();
  const men = 'school-g1-men-run-800-final';
  const women = 'school-g1-women-run-800-final';
  let revision = 0;
  async function send(action, fields) {
    const result = await operator.command(action, fields);
    assert.equal(result.ok, true, result.error);
    revision++;
  }
  await send('event:select', { eventId: men });
  const roster = Array.from({ length: 8 }, (_, i) => ({ name: `男子选手${i + 1}`, bib: String(i + 1), result: String(260 + i) }));
  for (const [index, row] of roster.entries()) await send('athlete:save', { eventId: men, fields: { ...row, lane: index + 1 } });
  await send('meet:save', { eventId: men, title: '男子组', accent: '#c58546' });
  await send('module:save', { key: 'results', eventId: men, patch: { visible: true, x: 230, scale: 80 } });
  await send('page:set', { key: 'results', eventId: men, page: 1 });
  await send('event:select', { eventId: women });
  const femaleSnap = await output.state(revision);
  assert.equal(activeEvent(femaleSnap).stage, '女子决赛');
  assert.deepEqual(activeEvent(femaleSnap).competitors, []);
  assert.equal(femaleSnap.modules.results.visible, false);
  assert.equal(femaleSnap.meet.title, '烟洲体育');
  assert.match((await operator.command('module:clear', { eventId: men })).error, /赛事已切换/);
  await send('athlete:save', { eventId: women, fields: { name: '女子选手', bib: '1', result: '285.22' } });
  await send('module:clear', { eventId: women });
  await send('event:select', { eventId: men });
  const maleSnap = await output.state(revision);
  assert.equal(activeEvent(maleSnap).stage, '男子决赛');
  assert.equal(activeEvent(maleSnap).competitors.length, 8);
  assert.equal(maleSnap.modules.results.x, 230);
  assert.equal(maleSnap.modules.results.scale, 80);
  assert.equal(maleSnap.modules.results.visible, true);
  assert.equal(maleSnap.pages.results, 1);
  assert.equal(maleSnap.meet.accent, '#c58546');
  await app.close();
  app = createApp({ dataDir });
  base = `http://127.0.0.1:${await app.listen(0)}`;
  operator = connect(base);
  assert.equal((await operator.state(revision)).pages.results, 1);
  await send('event:select', { eventId: women });
  const restored = await connect(base, 'view').state(revision);
  assert.equal(activeEvent(restored).competitors[0].time, 285220);
  assert.equal(restored.modules.brand.visible, false);
  assert.equal(restored.pages.results, 0);
});

test('a failed atomic write keeps the previous snapshot and can be retried', async (t) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'yanzhou-test-'));
  const app = createApp({ dataDir });
  t.after(async () => { await app.close(); await rm(dataDir, { recursive: true, force: true }); });
  const port = await app.listen(0);
  const operator = connect(`http://127.0.0.1:${port}`);
  await operator.state();
  const blocker = path.join(dataDir, 'settings.json');
  await mkdir(blocker);
  assert.match((await operator.command('module:clear')).error, /保存失败/);
  await rm(blocker, { recursive: true });
  const fresh = await connect(`http://127.0.0.1:${port}`, 'view').state();
  assert.equal(fresh.revision, 0);
  assert.equal(fresh.modules.brand.visible, true);
  assert.equal((await operator.command('module:clear')).ok, true);
  assert.equal((await operator.state(1)).modules.brand.visible, false);
});
