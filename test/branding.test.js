import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { BRANDING_CORNERS, brandGraphic, placeBrandCorner } from '../public/branding.js';
import { CANVAS, MODULES, SAFE_AREA, defaultLayout } from '../public/sport.js';
import { clientState, initialState } from '../server/state.js';

test('default branding is inside the 1080p safe area, with spacing for adjacent graphics', () => {
  const { x, y } = defaultLayout('brand');
  const boxes = [{ x, y, width: MODULES.brand.w, height: MODULES.brand.h }, ...Object.values(BRANDING_CORNERS)];
  for (const box of boxes) {
    assert.ok(box.x >= SAFE_AREA.x + SAFE_AREA.padding);
    assert.ok(box.y >= SAFE_AREA.y + SAFE_AREA.padding);
    assert.ok(box.x + box.width <= CANVAS.width - SAFE_AREA.x - SAFE_AREA.padding);
    assert.ok(box.y + box.height <= CANVAS.height - SAFE_AREA.y - SAFE_AREA.padding);
  }

  const corner = BRANDING_CORNERS.bl;
  const banner = { ...defaultLayout('event'), width: MODULES.event.w, height: MODULES.event.h };
  const raised = placeBrandCorner(corner, '中山市烟洲中学', [banner]);
  assert.equal(raised.x, corner.x);
  assert.equal(raised.y + raised.height + SAFE_AREA.padding, banner.y);
  assert.equal(placeBrandCorner(corner, '', []).y, corner.y);
  assert.equal(placeBrandCorner(corner, '', [{ ...banner, y: 20, height: CANVAS.height }]), null);
});

test('modern channel shows only the wordmark and legacy keeps its seal and escaped subtitle', () => {
  const modern = brandGraphic('modern', '<现场>');
  assert.match(modern, /^<div class="branding-channel">\s*<img src="\/assets\/branding\/yanzhou-channel-wordmark\.png" alt="YZBTVS SPORT"[^>]*>\s*<\/div>$/);
  assert.doesNotMatch(modern, /yanzhou-seal|<small>|现场/);
  assert.doesNotMatch(brandGraphic('modern', ''), /<small>|烟洲体育/);

  const legacy = brandGraphic('legacy', '<现场>');
  assert.match(legacy, /yanzhou-seal\.png/);
  assert.match(legacy, /yanzhou-sport-wordmark\.png/);
  assert.match(legacy, /<small>&lt;现场&gt;<\/small>/);
});

async function renderOverlay(t, query, staticPreview = false) {
  const makeNode = () => ({
    style: { setProperty() {} },
    dataset: {},
    children: [],
    querySelector() { return null; },
    append(...children) { this.children.push(...children); },
    animate(frames, timing) {
      this.animation = { frames, timing, cancel() {} };
      return this.animation;
    },
  });
  const stage = makeNode();
  stage.hasAttribute = (name) => name === 'data-branding-preview' && staticPreview;
  const document = { createElement: makeNode, querySelector: () => stage, documentElement: {} };
  stage.ownerDocument = document;
  let receive;
  for (const [key, value] of Object.entries({
    document,
    window: { addEventListener() {} },
    location: new URL(`http://127.0.0.1/overlay.html${query}`),
    innerWidth: 1920,
    innerHeight: 1080,
    ResizeObserver: class { observe() {} },
    matchMedia: () => ({ matches: false }),
    getComputedStyle: () => ({ opacity: '0.4' }),
    setInterval: () => {},
    WebSocket: class {
      addEventListener(type, listener) {
        if (type === 'message') receive = listener;
      }
    },
  })) {
    const original = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    t.after(() => original ? Object.defineProperty(globalThis, key, original) : delete globalThis[key]);
  }

  await import(`../public/overlay.js?test=${encodeURIComponent(query)}&preview=${staticPreview}`);
  return {
    node: (name) => stage.children.find((child) => child.className.split(' ').includes(name)),
    receive(snapshot) {
      receive({ data: JSON.stringify({ type: 'state', state: snapshot, at: 0 }) });
    },
    connected: Boolean(receive),
  };
}

test('preview loads the left channel and the lower-left school lockup without WebSocket', async (t) => {
  const html = await readFile(new URL('../public/branding-preview.html', import.meta.url), 'utf8');
  assert.match(html, /class="guides" data-branding-preview/);
  assert.match(html, /src="\/overlay.js"/);
  const css = await readFile(new URL('../public/branding.css', import.meta.url), 'utf8');
  assert.doesNotMatch(css, /track-preview\.png/, '角标预览不应再依赖已删除的跑道底图');
  assert.match(css, /\.branding-preview #stage\s*\{[^}]*background:[^;]*#0d1a1e/);
  assert.doesNotMatch(css, /branding-silver|background-clip/);
  const overlay = await renderOverlay(t, '', true);
  assert.equal(overlay.connected, false);
  const channel = overlay.node('layer--brand').children[0].innerHTML;
  assert.match(channel, /yanzhou-channel-wordmark\.png/);
  assert.doesNotMatch(channel, /yanzhou-seal\.png/);
  const mark = overlay.node('branding-corner--bl');
  assert.match(mark.innerHTML, /^<img src="\/assets\/branding\/yanzhou-zhou-gold-mark\.png"[^>]*>$/);
  assert.deepEqual(mark.children[0].children.map(node => node.textContent), ['中山市烟洲中学', 'YZBTVS SPORT']);
  assert.equal(mark.hidden, false);
});

test('the school lockup clears the winner until its exit animation ends', async (t) => {
  const overlay = await renderOverlay(t, '', false);
  const snapshot = clientState(initialState(), true);
  snapshot.events[0].competitors.push({ id: 'champion', name: '第一名', status: 'ok', time: 120000, attempts: [] });
  snapshot.modules.event.visible = false;
  const bottom = overlay.node('branding-corner--bl');
  overlay.receive(snapshot);
  assert.equal(bottom.hidden, false);
  const defaultTop = bottom.style.top;
  snapshot.modules.results.visible = true;
  overlay.receive(snapshot);
  const winner = overlay.node('layer--results').children[0];
  assert.match(winner.innerHTML, /winner-card/);
  snapshot.modules.results.x = 112;
  snapshot.modules.results.y = 630;
  overlay.receive(snapshot);
  const raisedTop = bottom.style.top;
  assert.ok(parseFloat(raisedTop) < parseFloat(defaultTop));
  snapshot.modules.results.visible = false;
  overlay.receive(snapshot);
  assert.equal(bottom.style.top, raisedTop);
  winner.animation.onfinish();
  assert.equal(bottom.style.top, defaultTop);
  snapshot.modules.brand.opacity = 25;
  overlay.receive(snapshot);
  assert.equal(bottom.style.opacity, 0.25);
  snapshot.modules.brand.opacity = 0;
  overlay.receive(snapshot);
  assert.equal(bottom.hidden, true);
});

test('visibility reverses smoothly and both brand corners fade together', async (t) => {
  const overlay = await renderOverlay(t, '?motion', false);
  const snapshot = clientState(initialState(), true);
  const event = snapshot.events[0];
  event.competitors.push({ id: 'runner', name: '甲', status: 'pending', time: null, attempts: [] });
  snapshot.modules.event.visible = false;
  overlay.receive(snapshot);
  const intro = overlay.node('layer--lineup');
  const graphic = intro.children[0];
  snapshot.modules.lineup.visible = true;
  overlay.receive(snapshot);
  assert.deepEqual(graphic.animation.frames, [{ opacity: 0 }, { opacity: 1 }]);
  snapshot.modules.lineup.visible = false;
  overlay.receive(snapshot);
  assert.equal(intro.hidden, false);
  assert.deepEqual(graphic.animation.frames, [{ opacity: 0.4 }, { opacity: 0 }]);
  graphic.animation.onfinish();
  assert.equal(intro.hidden, true);

  snapshot.modules.brand.visible = false;
  overlay.receive(snapshot);
  const mark = overlay.node('branding-corner--bl');
  const logo = overlay.node('layer--brand').children[0];
  assert.deepEqual(mark.animation.frames, [{ filter: 'opacity(1)' }, { filter: 'opacity(0)' }]);
  assert.deepEqual(mark.animation.timing, logo.animation.timing);
  assert.equal(mark.hidden, false);
  logo.animation.onfinish();
  assert.equal(mark.hidden, true);
});

test('event banner and lineup alternate with an exit followed by an entrance', async (t) => {
  const overlay = await renderOverlay(t, '?alternation', false);
  const snapshot = clientState(initialState(), true);
  snapshot.events[0].competitors.push({ id: 'runner', name: '甲', status: 'pending', time: null, attempts: [] });
  overlay.receive(snapshot);
  const banner = overlay.node('layer--event');
  const intro = overlay.node('layer--lineup');

  for (const [fromKey, from, toKey, to] of [
    ['event', banner, 'lineup', intro],
    ['lineup', intro, 'event', banner],
  ]) {
    snapshot.modules[fromKey].visible = false;
    snapshot.modules[toKey].visible = true;
    overlay.receive(snapshot);
    assert.equal(from.hidden, false);
    assert.equal(to.hidden, true);
    assert.deepEqual(from.children[0].animation.frames, [{ opacity: 1 }, { opacity: 0 }]);
    from.children[0].animation.onfinish();
    assert.equal(from.hidden, true);
    assert.equal(to.hidden, false);
    assert.deepEqual(to.children[0].animation.frames, [{ opacity: 0 }, { opacity: 1 }]);
    to.children[0].animation.onfinish();
  }
});

test('legacy keeps the original wordmark and omits the school lockup', async (t) => {
  const overlay = await renderOverlay(t, '?branding=legacy');
  overlay.receive(clientState(initialState(), true));
  assert.match(overlay.node('layer--brand').children[0].innerHTML, /yanzhou-sport-wordmark\.png/);
  assert.equal(overlay.node('branding-corner--bl'), undefined);
});

test('off hides the brand but leaves the event graphic on air', async (t) => {
  const overlay = await renderOverlay(t, '?branding=off');
  overlay.receive(clientState(initialState(), true));
  assert.equal(overlay.node('layer--brand').hidden, true);
  assert.equal(overlay.node('branding-corner--bl'), undefined);
  assert.match(overlay.node('layer--event').children[0].innerHTML, /event-banner/);
});
