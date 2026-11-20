import assert from 'node:assert/strict';
import test from 'node:test';
import { applyCommand, clientState, initialState, migrateState, verifyState } from '../server/state.js';
import { csvResults, readCsv } from '../public/csv.js';
import { SCHOOL_RACES, checkInTime, classStandings, finalFor, scheduleSession } from '../public/meet-program.js';
import { activeEvent, checkpoints, jumpHeight, lineupRoster, nextJumpHeight, standings } from '../public/sport.js';

function operator(id) {
  let state = initialState();
  const app = {
    get state() { return state; },
    get event() { return activeEvent(state); },
    send(action, fields = {}, now = 0) { state = applyCommand(state, { action, eventId: state.activeEventId, ...fields }, now); },
  };
  app.send('event:select', { eventId: id });
  return app;
}

test('school schedule contains the timetable and pending extensions, with matching finals and check-in times', () => {
  const timed = SCHOOL_RACES.filter(({ schedule }) => schedule.start);
  assert.equal(timed.length, 42);
  assert.equal(new Set(SCHOOL_RACES.map(({ id }) => id)).size, 49);
  assert.deepEqual(timed.reduce((counts, { schedule }) => {
    const period = scheduleSession(schedule);
    counts[period] = (counts[period] ?? 0) + 1;
    return counts;
  }, {}), { '11/27 上午': 22, '11/27 下午': 14, '11/28 上午': 6 });
  assert.equal(SCHOOL_RACES[0].id, 'school-g1-women-run-100-heat');
  assert.ok(SCHOOL_RACES.slice(-6).every(({ schedule }) => !schedule.start && !schedule.session));
  assert.equal(checkInTime(timed[0].schedule.start), '07:05');
  const heats = SCHOOL_RACES.filter((event) => event.schedule.round === 'heat');
  assert.equal(heats.length, 8);
  assert.ok(heats.every((race) => finalFor(SCHOOL_RACES, race)?.schedule.start > race.schedule.start));
  assert.equal(SCHOOL_RACES.filter(({ schedule }) => !schedule.start && schedule.project === 'run-1500').length, 4);
  assert.equal(SCHOOL_RACES.filter(({ schedule }) => !schedule.start && schedule.project === 'run-1000').length, 2);
  assert.equal(scheduleSession(SCHOOL_RACES.find(({ id }) => id === 'school-staff-teams').schedule), '11/27 下午');
  assert.deepEqual(checkpoints(SCHOOL_RACES.find(({ id }) => id === 'school-g1-open-shuttle-50-final')), [50, 100, 150, 200, 250, 300, 350, 400, 450, 500]);
  assert.equal(verifyState(initialState()).version, 5);
});

test('upgrade removes empty generic presets and retains actual registrations and the current school race', () => {
  const app = operator('school-g2-men-run-100-heat');
  app.send('athlete:import', { rows: [{ name: '正式选手', result: '12.34', heat: 2 }] });
  const { schedule, ...preset } = structuredClone(initialState().events.find(({ id }) => id === 'school-g1-men-run-1000-final'));
  const blank = { ...preset, id: 'run-1000' };
  const registered = { ...structuredClone(preset), id: 'run-1000-women', division: 'women', competitors: app.event.competitors };
  const old = { ...app.state, version: 4, events: [blank, registered, ...app.state.events] };
  const updated = verifyState(migrateState(verifyState(old)));
  assert.equal(updated.version, 5);
  assert.equal(updated.activeEventId, old.activeEventId);
  assert.deepEqual(updated.events, [registered, ...app.state.events]);
  const previousActive = verifyState(migrateState({ ...old, activeEventId: blank.id }));
  assert.equal(previousActive.activeEventId, SCHOOL_RACES[0].id);
  assert.strictEqual(migrateState(updated), updated);
});

test('old rehearsal examples and timing records move into school program events', () => {
  const rehearsal = initialState(true);
  const targets = { 'run-1000': 'school-g1-men-run-1000-final', 'long-jump': 'school-g1-men-long-jump-final' };
  const legacy = Object.entries(targets).map(([id, targetId]) => {
    const { schedule, ...sample } = rehearsal.events.find((event) => event.id === targetId);
    return { ...sample, id };
  });
  legacy[0].clock = { phase: 'finished', startedAt: null, elapsed: 182350 };
  legacy[0].splits = [{ distance: 200, time: 40120 }];
  const blank = initialState();
  const migrated = verifyState(migrateState(verifyState({ ...blank, version: 4, activeEventId: 'run-1000', events: [...legacy, ...blank.events] })));
  assert.equal(migrated.events.length, 49);
  assert.equal(migrated.activeEventId, targets['run-1000']);
  for (const [id, targetId] of Object.entries(targets)) {
    const selected = migrated.events.find((event) => event.id === targetId);
    const source = legacy.find((event) => event.id === id);
    for (const key of ['competitors', 'clock', 'splits']) assert.deepEqual(selected[key], source[key]);
  }
});

test('independent heat clocks merge placements and send the confirmed top eight to the correct final', () => {
  const id = 'school-g1-women-run-100-heat';
  const app = operator(id);
  const rows = Array.from({ length: 9 }, (_, i) => ({ name: `选手${i}`, bib: String(i), team: '1班', heat: i < 4 ? 1 : 2 }));
  app.send('athlete:import', { rows });
  app.send('clock:action', { operation: 'start', heat: 1 }, 1000);
  assert.throws(() => app.send('heat:select', { heat: 2 }, 1200), /暂停或结束/);
  assert.throws(() => app.send('athlete:finish', { id: app.event.competitors[4].id }, 1450), /不在当前/);
  app.event.competitors.slice(0, 4).forEach((athlete, i) => app.send('athlete:finish', { id: athlete.id, heat: 1 }, 14500 + i * 200));
  app.send('clock:action', { operation: 'finish', heat: 1 }, 16000);
  app.send('heat:select', { heat: 2 }, 18000);
  assert.equal(app.event.clock.phase, 'ready');
  assert.equal(lineupRoster(app.event).length, 5);
  assert.throws(() => app.send('clock:action', { operation: 'start', heat: 1 }, 19000), /分组已切换/);
  app.send('clock:action', { operation: 'start', heat: 2 }, 20000);
  app.event.competitors.slice(4).forEach((athlete, i) => app.send('athlete:finish', { id: athlete.id, heat: 2 }, 33000 + i * 200));
  app.send('clock:action', { operation: 'finish', heat: 2 }, 35000);
  app.send('heat:select', { heat: 1 }, 36000);
  assert.equal(app.event.clock.elapsed, 15000);
  assert.equal(standings(app.event)[0].athlete.name, '选手4');
  app.send('round:qualify');
  const final = finalFor(app.state.events, app.event);
  assert.equal(app.state.activeEventId, id);
  assert.equal(final.competitors.length, 8);
  assert.ok(final.competitors.every(({ time, lane, heat }) => time === null && lane === null && heat === 1));
  assert.throws(() => app.send('round:qualify'), /已有名单/);
  assert.equal(verifyState(app.state), app.state);
});

test('high jump advances by the school rule, counts misses, and round-trips the log', () => {
  const app = operator('school-g1-women-high-jump-final');
  app.send('athlete:import', { rows: [{ name: '甲', team: '1班' }, { name: '乙', team: '2班' }] });
  const [first, second] = app.event.competitors;
  const mark = (id, outcome) => app.send('jump:mark', { id, outcome, height: jumpHeight(app.event), index: app.event.competitors.find((row) => row.id === id).jumps?.length ?? 0 });
  const raise = () => app.send('jump:raise', { height: jumpHeight(app.event) });
  assert.equal(jumpHeight(app.event), 95);
  mark(first.id, 'O');
  mark(second.id, 'X');
  mark(second.id, 'O');
  raise();
  mark(second.id, 'O');
  mark(first.id, 'X');
  mark(first.id, 'O');
  assert.deepEqual(standings(app.event).map(({ athlete, rank }) => [athlete.name, rank]), [['乙', 1], ['甲', 2]]);
  raise();
  mark(first.id, 'X');
  mark(first.id, '-');
  raise();
  mark(first.id, 'X');
  mark(first.id, 'X');
  assert.throws(() => mark(first.id, 'O'), /试跳/);
  raise();
  assert.equal(jumpHeight(app.event), 115);
  assert.equal(nextJumpHeight(app.event), 118);
  const copied = readCsv(csvResults(app.event));
  app.send('athlete:import', { rows: copied, replace: true });
  assert.deepEqual(standings(app.event).map(({ athlete, value, rank }) => [athlete.name, value, rank]), [['乙', 100, 1], ['甲', 100, 2]]);
});

test('confirmed class scores apply relay and record multipliers and discard stale confirmations', () => {
  const first = 'school-g1-women-run-100-final';
  const second = 'school-g2-women-run-100-final';
  const relay = 'school-g1-open-shuttle-50-final';
  const app = operator(first);
  app.send('athlete:import', { rows: [{ name: '甲', team: '高一（1）班', result: '13.70' }, { name: '乙', team: '2班', result: '14.50' }] });
  app.send('points:confirm', { scored: true });
  assert.equal(classStandings(app.state.events).g1[0].total, 18);
  app.send('event:select', { eventId: second });
  app.send('athlete:import', { rows: [{ name: '丙', team: '1班', result: '13.63' }] });
  app.send('points:confirm', { scored: true });
  assert.equal(classStandings(app.state.events).g1[0].total, 9);
  assert.equal(classStandings(app.state.events).g2[0].total, 18);
  app.send('event:select', { eventId: relay });
  app.send('athlete:import', { rows: [{ name: '1班', result: '84', boys: 5, girls: 4 }] });
  assert.throws(() => app.send('points:confirm', { scored: true }), /人数不符/);
  app.send('athlete:save', { id: app.event.competitors[0].id, fields: { name: '1班', result: '84', boys: 5, girls: 5 } });
  app.send('points:confirm', { scored: true });
  app.send('module:save', { key: 'results', patch: { visible: true } });
  app.send('module:save', { key: 'teams', patch: { visible: true } });
  const output = clientState(app.state, true);
  assert.equal(output.modules.results.visible, false);
  assert.deepEqual(output.classBoard.map(({ team, total }) => [team, total]), [['高一1班', 27], ['高一2班', 7]]);
  app.send('rank:remove', { id: app.event.competitors[0].id });
  assert.equal(app.event.schedule.scored, undefined);
  assert.equal(classStandings(app.state.events).g1[0].total, 9);
});
