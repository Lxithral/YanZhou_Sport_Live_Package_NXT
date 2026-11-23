import assert from 'node:assert/strict';
import test from 'node:test';
import { applyCommand, clientState, initialState, migrateState, verifyState } from '../server/state.js';
import { SCHOOL_RACES, checkInTime, classStandings, scheduleSession } from '../public/meet-program.js';
import { activeEvent } from '../public/sport.js';

function operator(id) {
  let state = initialState();
  const app = {
    get state() { return state; },
    get event() { return activeEvent(state); },
    send(action, fields = {}, now = 0) { state = applyCommand(state, { action, eventId: state.activeEventId, ...fields }, now); },
    roster(rows, eventId) { for (const row of rows) this.send('athlete:save', { eventId: eventId ?? state.activeEventId, fields: row }); },
  };
  app.send('event:select', { eventId: id });
  return app;
}

test('school schedule keeps only the four 800 m finals while the other events stay commented out', () => {
  const timed = SCHOOL_RACES.filter(({ schedule }) => schedule.start);
  assert.equal(timed.length, 4);
  assert.equal(new Set(SCHOOL_RACES.map(({ id }) => id)).size, 4);
  assert.deepEqual(timed.reduce((counts, { schedule }) => {
    const period = scheduleSession(schedule);
    counts[period] = (counts[period] ?? 0) + 1;
    return counts;
  }, {}), { '11/27 下午': 4 });
  assert.equal(SCHOOL_RACES[0].id, 'school-g1-women-run-800-final');
  assert.ok(SCHOOL_RACES.every(({ schedule }) => schedule.project === 'run-800' && schedule.start));
  assert.equal(checkInTime(timed[0].schedule.start), '13:50');
  assert.equal(SCHOOL_RACES.filter((event) => event.schedule.round === 'heat').length, 0);
  assert.equal(verifyState(initialState()).version, 10);
});

test('upgrade removes empty generic presets and retains actual registrations and the current school race', () => {
  const app = operator('school-g2-men-run-800-final');
  app.roster([{ name: '正式选手', result: '12.34', heat: 2 }]);
  const { schedule, ...preset } = structuredClone(initialState().events.find(({ id }) => id === 'school-g1-women-run-800-final'));
  const blank = { ...preset, id: 'run-800' };
  const registered = { ...structuredClone(preset), id: 'run-800-women', division: 'women', competitors: app.event.competitors };
  const old = { ...app.state, version: 4, events: [blank, registered, ...app.state.events] };
  const updated = verifyState(migrateState(verifyState(old)));
  assert.equal(updated.version, 10);
  assert.equal(updated.activeEventId, old.activeEventId);
  assert.deepEqual(updated.events, [registered, ...app.state.events]);
  const previousActive = verifyState(migrateState({ ...old, activeEventId: blank.id }));
  assert.equal(previousActive.activeEventId, SCHOOL_RACES[0].id);
  assert.strictEqual(migrateState(updated), updated);
});

// 100 米预赛分组和晋级先不用，秩序册恢复后再打开。
// test('independent heat clocks merge placements and send the confirmed top eight to the correct final', () => {
//   const id = 'school-g1-women-run-100-heat';
//   ...
// });

// 跳高项目先不进本届播出单，学校横杆规则随秩序册恢复后再测。

test('confirmed class scores apply record multipliers and discard stale confirmations', () => {
  const first = 'school-g1-women-run-800-final';
  const second = 'school-g2-women-run-800-final';
  const app = operator(first);
  app.roster([{ name: '甲', team: '高一（1）班', result: '2:10.00' }, { name: '乙', team: '2班', result: '2:20.00' }]);
  app.send('points:confirm', { scored: true });
  assert.equal(classStandings(app.state.events).g1[0].total, 18);
  app.send('event:select', { eventId: second });
  app.roster([{ name: '丙', team: '1班', result: '2:05.00' }]);
  app.send('points:confirm', { scored: true });
  assert.equal(classStandings(app.state.events).g1[0].total, 9);
  assert.equal(classStandings(app.state.events).g2[0].total, 18);
  // 接力双倍计分先不用，迎面接力恢复后再测。
  app.send('event:select', { eventId: first });
  app.send('module:save', { key: 'results', patch: { visible: true } });
  app.send('module:save', { key: 'teams', patch: { visible: true } });
  const output = clientState(app.state, true);
  assert.equal(output.modules.results.visible, false);
  assert.deepEqual(output.classBoard.map(({ team, total }) => [team, total]), [['高一1班', 9], ['高一2班', 7]]);
  app.send('rank:remove', { id: app.event.competitors[0].id });
  assert.equal(app.event.schedule.scored, undefined);
  assert.equal(classStandings(app.state.events).g1.length, 0);
  assert.equal(classStandings(app.state.events).g2[0].total, 18);
});
