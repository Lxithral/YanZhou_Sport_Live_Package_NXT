import assert from 'node:assert/strict';
import test from 'node:test';
import { applyCommand, clientState, initialState, migrateState, verifyState } from '../server/state.js';
import { csvResults, readCsv } from '../public/csv.js';
import { MODULES, PRESETS, SAFE_AREA, activeEvent, checkpoints, clockPhase, clockValue, defaultLayout,
  eventStage, formatTime, moduleBounds, paginatedCount, resultRows, safeAnchor, standings } from '../public/sport.js';

function session(demo = false) {
  let state = initialState(demo);
  return {
    get state() { return state; },
    get event() { return activeEvent(state); },
    send(action, fields = {}, at = 0) {
      state = applyCommand(state, { eventId: state.activeEventId, ...fields, action }, at);
    },
  };
}

test('1000 m and relay checkpoints follow the course configuration', () => {
  assert.deepEqual(checkpoints(PRESETS['run-1000']), [200, 600, 1000]);
  assert.deepEqual(checkpoints({ ...PRESETS['run-1000'], trackLength: 300 }), [100, 400, 700, 1000]);
  assert.deepEqual(checkpoints(PRESETS['run-800']), [400, 800]);
  assert.deepEqual(checkpoints(PRESETS['run-100']), [100]);
  assert.deepEqual(checkpoints(PRESETS['run-1500']), [300, 700, 1100, 1500]);
  assert.deepEqual(checkpoints(PRESETS['relay-100']), [100, 200, 300, 400]);
  assert.deepEqual(checkpoints(PRESETS['relay-400']), [400, 800, 1200, 1600]);
});

test('leader splits, clock pause, finish order, and timer reset are independent', () => {
  const app = session(true);
  const clock = (operation, at, value) => app.send('clock:action', { operation, value }, at);
  clock('start', 1000);
  app.send('split:add', { index: 0 }, 40000);
  assert.throws(() => app.send('split:add', { index: 0 }, 42000), /通过点已更新/);
  clock('pause', 60000);
  assert.equal(clockValue(app.event, 99000), 59000);
  clock('resume', 66000);
  app.send('split:add', { index: 1 }, 120010);
  app.send('split:add', { index: 2 }, 189100);
  const [a, b, c] = app.event.competitors;
  app.send('athlete:finish', { id: b.id }, 189500);
  app.send('athlete:finish', { id: a.id }, 193222);
  app.send('athlete:finish', { id: c.id }, 193227);
  assert.throws(() => app.send('athlete:finish', { id: b.id }, 194000), /已录入/);
  assert.equal(clockPhase(app.event, 194000), 'running');
  clock('finish', 204000);
  assert.equal(clockValue(app.event, 300000), 197000);
  assert.deepEqual(app.event.splits.map(({ distance, time }) => [distance, time]), [[200, 39000], [600, 113010], [1000, 182100]]);
  assert.deepEqual(standings(app.event).slice(0, 3).map(({ athlete, rank, value }) => [athlete.id, rank, value]),
    [[b.id, 1, 182500], [a.id, 2, 186220], [c.id, 2, 186220]]);
  clock('reset', 300001);
  assert.equal(app.event.clock.elapsed, 0);
  assert.deepEqual(app.event.splits, []);
  assert.equal(app.event.competitors[0].time, 186220);
});

test('custom match countdown reaches zero and the next period preserves scores', () => {
  const app = session();
  app.send('event:save', { fields: { ...PRESETS.football, clockMode: 'down', periodMinutes: 10 } });
  assert.equal(clockValue(app.event, 0), 600000);
  app.send('clock:action', { operation: 'set', value: '00:03' });
  app.send('clock:action', { operation: 'resume' }, 1000);
  assert.throws(() => app.send('match:period', { period: 2 }, 3000), /暂停/);
  app.send('match:score', { side: 'home', delta: 3 }, 3000);
  app.send('match:score', { side: 'away', delta: -1 }, 3001);
  assert.equal(clockValue(app.event, 4100), 0);
  assert.equal(clockPhase(app.event, 4100), 'finished');
  app.send('match:period', { period: 2 }, 4101);
  assert.equal(clockValue(app.event, 4102), 600000);
  assert.deepEqual(app.event.score, { home: 3, away: 0, period: 2 });
});

test('early roster import leaves the current event live, and manual results work without times', () => {
  const app = session();
  const current = app.event.id;
  app.send('event:save', { activate: false, fields: { ...PRESETS['run-1000'], stage: '第 2 组' } });
  const staged = app.state.events.at(-1).id;
  assert.equal(app.event.id, current);
  const rows = Array.from({ length: 8 }, (_, i) => ({ name: `选手${i + 1}`, bib: String(i + 1) }));
  app.send('athlete:import', { eventId: staged, rows });
  assert.equal(app.event.competitors.length, 0);
  app.send('event:select', { eventId: staged });
  const athletes = app.event.competitors;
  for (const { id } of athletes.slice(0, 7)) app.send('rank:move', { id });
  app.send('rank:move', { id: athletes[6].id, beforeId: athletes[0].id });
  assert.deepEqual(resultRows(app.event).map(({ athlete, rank }) => [athlete.name, rank]),
    [['选手7', 1], ['选手1', 2], ['选手2', 3], ['选手3', 4], ['选手4', 5], ['选手5', 6], ['选手6', 7]]);
  assert.equal(paginatedCount(app.event, 'results'), 2);
  assert.match(csvResults(app.event), /"7","选手7","","","pending","","1"/);
  assert.ok(resultRows(app.event).every(({ value }) => value === null));
  app.send('rank:remove', { id: athletes[0].id });
  assert.equal(paginatedCount(app.event, 'results'), 1);
  app.send('athlete:save', { id: athletes[6].id, fields: { name: athletes[6].name, status: 'DQ' } });
  assert.equal(resultRows(app.event).at(-1).athlete.status, 'DQ');
  assert.equal(resultRows(app.event).at(-1).rank, null);
  assert.throws(() => app.send('rank:move', { id: athletes[6].id }), /不能排入名次/);
  app.send('rank:reset');
  assert.equal(resultRows(app.event).length, 1);
  assert.equal(app.event.rankOrder, undefined);
});

test('legacy basketball is removed without deleting other events or modifying stored results', () => {
  const app = session();
  app.send('event:save', { fields: PRESETS.football });
  app.send('match:score', { side: 'home', delta: 1 });
  const football = app.event;
  app.send('event:save', { fields: { ...PRESETS.football, name: '篮球' } });
  const { events, ...previous } = clientState(app.state, false);
  const oldEvents = events.slice(-2).map(({ division, ...event }) => ({ ...event, stage: eventStage({ ...event, division }) }));
  const next = verifyState(migrateState(verifyState({ ...previous, events: oldEvents, version: 1 })));
  assert.equal(next.version, 6);
  assert.equal(activeEvent(next).id, football.id);
  assert.deepEqual(activeEvent(next).score, football.score);
  assert.ok(next.events.every(({ name }) => name !== '篮球'));
  assert.equal(PRESETS.basketball, undefined);
  assert.strictEqual(migrateState(next), next);
});

test('legacy shared graphics migrate to the live event and female events retain their roster and classification', () => {
  const app = session();
  app.send('event:save', { activate: false, fields: { ...PRESETS['run-1000'], stage: '男子决赛' } });
  app.send('event:save', { fields: { ...PRESETS['shot-put'], stage: '女子决赛' } });
  const femaleId = app.event.id;
  app.send('athlete:import', { rows: [{ name: '铅球选手', attempts: '8.25|X|8.62' }] });
  app.send('module:save', { key: 'results', patch: { visible: true, x: 200 } });
  app.send('text:save', { key: 'notice', fields: { title: '颁奖', body: '请到东侧集合' }, visible: true });
  const { events, ...shared } = clientState(app.state, false);
  const oldEvents = events.slice(-2).map(({ division, ...event }) => ({ ...event, stage: eventStage({ ...event, division }) }));
  const migrated = verifyState(migrateState(verifyState({ ...shared, events: oldEvents, version: 2 })));
  const live = activeEvent(migrated);
  assert.equal(live.id, femaleId);
  assert.equal(live.division, 'women');
  assert.equal(standings(live)[0].value, 862);
  assert.equal(live.graphics.modules.results.visible, true);
  assert.equal(live.graphics.notice.body, '请到东侧集合');
  assert.equal(migrated.events[0].graphics.modules.results.x, 200);
  assert.equal(migrated.events[0].graphics.modules.results.visible, false);
  assert.equal(migrated.events[0].graphics.notice.body, '');
  assert.equal(migrated.events.filter((event) => !event.schedule && event.division === 'women' && event.name === '铅球').length, 1);
  assert.equal(migrated.events.filter((event) => event.schedule && event.name === '铅球').length, 0);
  assert.equal(migrated.events.filter((event) => event.schedule && event.distance === 800).length, 4);
  assert.equal(migrated.events.filter((event) => event.schedule && event.distance === 1000).length, 2);
});

test('CSV field import keeps valid, skipped, and invalid attempts together', () => {
  const app = session();
  app.send('event:save', { fields: PRESETS['long-jump'] });
  const source = '\uFEFF道次,号码,姓名,单位,试次\r\n1,001,甲,"蓝,班",5.0|X|5.32\r\n2,002,乙,二班,-|X\r\n';
  app.send('athlete:import', { rows: readCsv(source) });
  const [first, second] = app.event.competitors;
  assert.deepEqual(first.attempts, [500, 'X', 532]);
  assert.equal(first.team, '蓝,班');
  assert.equal(second.status, 'NM');
  app.send('athlete:attempt', { id: second.id, index: 2, value: '5.52' });
  assert.deepEqual(standings(app.event).map(({ athlete, value, rank }) => [athlete.name, value, rank]), [['乙', 552, 1], ['甲', 532, 2]]);
  const rows = readCsv(csvResults(app.event));
  app.send('athlete:import', { rows, replace: true });
  assert.deepEqual(standings(app.event).map(({ value }) => value), [552, 532]);
  const before = app.state;
  assert.throws(() => app.send('athlete:import', { rows }), /号码.*重复/);
  assert.strictEqual(app.state, before);
});

test('layout bounds, single result board and clear are enforced on the server model', () => {
  const app = session(true);
  app.send('module:save', { key: 'lineup', patch: { visible: true } });
  app.send('page:set', { key: 'lineup', page: 1 });
  assert.equal(app.event.graphics.pages.lineup, 1);
  app.send('module:save', { key: 'results', patch: { visible: true, x: 1920, y: 1080, scale: 120 } });
  assert.equal(app.event.graphics.modules.lineup.visible, false);
  assert.deepEqual({ x: app.event.graphics.modules.results.x, y: app.event.graphics.modules.results.y }, moduleBounds('results', 120));
  app.send('module:clear');
  assert.ok(Object.values(app.event.graphics.modules).every(({ visible }) => !visible));
  app.send('module:base');
  assert.equal(app.event.graphics.modules.clock.visible, true);
  assert.equal(app.event.graphics.modules.results.visible, false);
});

test('default positions and the four corners fit the same guide rectangle', () => {
  for (const key of Object.keys(MODULES)) {
    const layouts = [defaultLayout(key), ...['tl', 'tr', 'bl', 'br'].map((corner) => safeAnchor(key, 180, corner))];
    for (const { x, y, scale } of layouts) {
      const bounds = moduleBounds(key, scale);
      assert.ok(x >= SAFE_AREA.x && x <= bounds.x - SAFE_AREA.x, `${key} fits horizontally`);
      assert.ok(y >= SAFE_AREA.y && y <= bounds.y - SAFE_AREA.y, `${key} fits vertically`);
    }
  }
  const event = defaultLayout('event');
  const athlete = defaultLayout('athlete');
  assert.ok(event.x + MODULES.event.w < defaultLayout('notice').x);
  assert.ok(athlete.y + MODULES.athlete.h < event.y);
});

test('upgrading saved events moves old default corners and preserves custom layout and timing', () => {
  const old = initialState(true);
  old.version = 5;
  const race = activeEvent(old);
  Object.assign(race.graphics.modules.brand, { x: 48, y: 34, opacity: 65, visible: false });
  Object.assign(race.graphics.modules.event, { x: 48, y: 931 });
  Object.assign(race.graphics.modules.clock, { x: 1300, y: 100 });
  Object.assign(old.standby.modules.brand, { x: 48, y: 34 });
  race.clock = { phase: 'finished', elapsed: 180400, startedAt: null };
  const next = verifyState(migrateState(verifyState(old)));
  const fixed = activeEvent(next);
  assert.deepEqual(fixed.graphics.modules.brand, { ...defaultLayout('brand'), opacity: 65, visible: false });
  assert.deepEqual(fixed.graphics.modules.event, defaultLayout('event'));
  assert.deepEqual(fixed.graphics.modules.clock, race.graphics.modules.clock);
  assert.deepEqual(fixed.clock, race.clock);
  assert.deepEqual(next.standby.modules.brand, defaultLayout('brand'));
  const reset = applyCommand(next, { action: 'module:reset', eventId: fixed.id, key: 'clock' }, 0);
  assert.deepEqual(activeEvent(reset).graphics.modules.clock, defaultLayout('clock'));
  assert.strictEqual(migrateState(next), next);
});

test('formatting uses centiseconds and stable positive countdown rounding', () => {
  assert.equal(formatTime(201529), '03:21.52');
  assert.equal(formatTime(999, false, true), '00:01');
  assert.equal(formatTime(0, false, true), '00:00');
});
