import assert from 'node:assert/strict';
import test from 'node:test';
import { applyCommand, clientState, initialState, migrateState, verifyState } from '../server/state.js';
import { csvResults, readCsv } from '../public/csv.js';
import { MODULES, PRESETS, SAFE_AREA, activeEvent, defaultLayout,
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

test('timing commands are removed from the state API', () => {
  const app = session(true);
  assert.throws(() => app.send('clock:action', { operation: 'start' }), /无法识别的操作/);
  assert.throws(() => app.send('split:add', { index: 0 }), /无法识别的操作/);
  assert.throws(() => app.send('athlete:finish', { id: app.event.competitors[0].id }), /无法识别的操作/);
});

test('match scores and periods are recorded without a clock', () => {
  const app = session();
  app.send('event:save', { fields: PRESETS.football });
  assert.deepEqual(app.event.score, { home: 0, away: 0, period: 1 });
  app.send('match:score', { side: 'home', delta: 3 });
  app.send('match:score', { side: 'away', delta: -1 });
  app.send('match:period', { period: 2 });
  assert.deepEqual(app.event.score, { home: 3, away: 0, period: 2 });
  assert.equal(app.event.clock, undefined);
  assert.equal(app.event.periodMinutes, undefined);
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
  assert.equal(next.version, 8);
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
  assert.equal(app.event.graphics.modules.brand.visible, true);
  assert.equal(app.event.graphics.modules.results.visible, false);
  assert.equal(Object.hasOwn(app.event.graphics.modules, 'clock'), false);
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

test('upgrading saved events drops timing data and the clock layer', () => {
  const old = initialState(true);
  old.version = 6;
  const race = activeEvent(old);
  Object.assign(race.graphics.modules.brand, { x: 48, y: 34, opacity: 65, visible: false });
  Object.assign(race.graphics.modules.event, { x: 48, y: 931 });
  race.graphics.modules.clock = { visible: true, x: 1300, y: 100, scale: 100, opacity: 100, enter: 'fade', exit: 'fade', duration: 260 };
  Object.assign(old.standby.modules.brand, { x: 48, y: 34 });
  race.clock = { phase: 'finished', elapsed: 180400, startedAt: null };
  race.splits = [{ distance: 200, time: 40000 }];
  race.heatRuns = { 2: { clock: { phase: 'ready', elapsed: 0, startedAt: null }, splits: [] } };
  const next = verifyState(migrateState(verifyState(old)));
  const fixed = activeEvent(next);
  assert.deepEqual(fixed.graphics.modules.brand, { ...defaultLayout('brand'), opacity: 65, visible: false });
  assert.deepEqual(fixed.graphics.modules.event, defaultLayout('event'));
  assert.equal(fixed.graphics.modules.clock, undefined);
  assert.equal(fixed.clock, undefined);
  assert.equal(fixed.splits, undefined);
  assert.equal(fixed.heatRuns, undefined);
  assert.deepEqual(next.standby.modules.brand, defaultLayout('brand'));
  assert.equal(next.standby.modules.clock, undefined);
  assert.strictEqual(migrateState(next), next);
});

test('upgrading old overlay layouts moves the intro, winner and athlete cards to their new positions', () => {
  const old = initialState(true);
  old.version = 7;
  const race = activeEvent(old);
  Object.assign(race.graphics.modules.lineup, { x: 530, y: 150, scale: 100 });
  Object.assign(race.graphics.modules.results, { x: 560, y: 380, scale: 100 });
  Object.assign(race.graphics.modules.athlete, { x: 112, y: 906, scale: 100 });
  Object.assign(old.standby.modules.lineup, { x: 530, y: 150, scale: 100 });
  const next = verifyState(migrateState(verifyState(old)));
  const fixed = activeEvent(next);
  assert.deepEqual(fixed.graphics.modules.lineup, defaultLayout('lineup'));
  assert.deepEqual(fixed.graphics.modules.results, defaultLayout('results'));
  assert.deepEqual(fixed.graphics.modules.athlete, defaultLayout('athlete'));
  assert.deepEqual(next.standby.modules.lineup, defaultLayout('lineup'));
  assert.equal(next.version, 8);
});

test('formatting uses centiseconds and stable positive countdown rounding', () => {
  assert.equal(formatTime(201529), '03:21.52');
  assert.equal(formatTime(999, false, true), '00:01');
  assert.equal(formatTime(0, false, true), '00:00');
});
