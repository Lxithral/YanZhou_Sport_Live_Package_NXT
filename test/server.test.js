import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { WebSocket } from 'ws';
import { createApp } from '../server/server.js';
import { activeEvent, clockValue } from '../public/sport.js';

function connect(base, role = 'control', mode = 'live', origin = base) {
  const ws = new WebSocket(`${base.replace('http:', 'ws:')}/ws?role=${role}&mode=${mode}`, { origin });
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
        reject(new Error(`No matching WebSocket message (${role}, ${mode})`));
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

test('control and output stay in sync, rehearsals stay isolated, and a restart restores the race', async (t) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'yanzhou-test-'));
  let now = 1000000;
  let app = createApp({ dataDir, now: () => now });
  t.after(async () => { await app.close(); await rm(dataDir, { recursive: true, force: true }); });
  let base = `http://127.0.0.1:${await app.listen(0)}`;
  assert.equal((await fetch(`${base}/health`)).status, 200);
  assert.match(await (await fetch(`${base}/control.html`)).text(), /<title>烟洲体育导播台<\/title>/);
  assert.equal((await fetch(`${base}/overlay.html`, { method: 'HEAD' })).status, 200);
  assert.equal((await fetch(`${base}/data/settings.json`)).status, 404);
  const operator = connect(base);
  const output = connect(base, 'view');
  const rehearsal = connect(base, 'control', 'demo');
  const [live, view, practice] = await Promise.all([operator.state(), output.state(), rehearsal.state()]);
  assert.equal(live.events.length, 6);
  assert.ok(live.events.every(({ schedule }) => schedule));
  assert.ok(practice.events.every(({ schedule }) => schedule));
  assert.equal(view.events.length, 1);
  assert.equal(activeEvent(live).competitors.length, 0);
  assert.equal(activeEvent(practice).competitors.length, 8);
  assert.equal((await output.command('module:clear')).ok, false);
  assert.equal((await rehearsal.command('module:clear')).ok, true);
  assert.equal((await rehearsal.state(1)).modules.brand.visible, false);
  assert.equal((await operator.command('clock:action', { eventId: live.activeEventId, operation: 'start' })).ok, true);
  assert.equal((await output.state(1)).modules.brand.visible, true);
  now += 45000;
  assert.equal((await operator.command('split:add', { eventId: live.activeEventId, index: 0 })).ok, true);
  assert.deepEqual(activeEvent(await output.state(2)).splits, [{ distance: 400, time: 45000 }]);
  assert.equal(JSON.parse(await readFile(path.join(dataDir, 'settings.json'), 'utf8')).revision, 2);
  const denied = connect(base, 'control', 'live', 'https://other.example');
  const code = await new Promise((resolve) => denied.ws.once('unexpected-response', (_, res) => { res.resume(); resolve(res.statusCode); }));
  denied.ws.terminate();
  assert.equal(code, 403);
  await app.close();
  now += 5000;
  app = createApp({ dataDir, now: () => now });
  base = `http://127.0.0.1:${await app.listen(0)}`;
  const resumed = await connect(base, 'view').state(2);
  assert.equal(clockValue(activeEvent(resumed), now), 50000);
  assert.equal(activeEvent(resumed).splits[0].distance, 400);
  assert.equal((await connect(base, 'view', 'demo').state(1)).modules.brand.visible, false);
});

test('switching divisions restores each event graphics, results, clock, and on-air page after restart', async (t) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'yanzhou-test-'));
  let now = 1000000;
  let app = createApp({ dataDir, now: () => now });
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
  await send('athlete:import', { eventId: men, rows: roster });
  await send('clock:action', { eventId: men, operation: 'start' });
  await send('meet:save', { eventId: men, title: '男子计时组', accent: '#c58546' });
  await send('text:save', { eventId: men, key: 'notice', fields: { title: '赛后', body: '男子组颁奖' }, visible: true });
  await send('module:save', { key: 'results', eventId: men, patch: { visible: true, x: 230, scale: 80 } });
  await send('page:set', { key: 'results', eventId: men, page: 1 });
  await send('event:select', { eventId: women });
  const femaleSnap = await output.state(revision);
  assert.equal(activeEvent(femaleSnap).stage, '女子决赛');
  assert.deepEqual(activeEvent(femaleSnap).competitors, []);
  assert.equal(clockValue(activeEvent(femaleSnap), now), 0);
  assert.equal(femaleSnap.modules.results.visible, false);
  assert.equal(femaleSnap.notice.body, '');
  assert.equal(femaleSnap.meet.title, '烟洲体育');
  assert.match((await operator.command('module:clear', { eventId: men })).error, /赛事已切换/);
  await send('athlete:import', { eventId: women, rows: [{ name: '女子选手', bib: '1', result: '285.22' }] });
  await send('module:clear', { eventId: women });
  await send('event:select', { eventId: men });
  now += 18345;
  const maleSnap = await output.state(revision);
  assert.equal(activeEvent(maleSnap).stage, '男子决赛');
  assert.equal(activeEvent(maleSnap).competitors.length, 8);
  assert.equal(clockValue(activeEvent(maleSnap), now), 18345);
  assert.equal(maleSnap.modules.results.x, 230);
  assert.equal(maleSnap.modules.results.scale, 80);
  assert.equal(maleSnap.modules.results.visible, true);
  assert.equal(maleSnap.pages.results, 1);
  assert.equal(maleSnap.notice.body, '男子组颁奖');
  assert.equal(maleSnap.meet.accent, '#c58546');
  await app.close();
  app = createApp({ dataDir, now: () => now });
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
  assert.equal(fresh.modules.clock.visible, true);
  assert.equal((await operator.command('module:clear')).ok, true);
  assert.equal((await operator.state(1)).modules.clock.visible, false);
});
