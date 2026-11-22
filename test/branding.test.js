import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { BRANDING_CORNERS, brandGraphic, showBrandCorner } from '../public/branding.js';
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

  const corner = BRANDING_CORNERS.br;
  const nearby = { x: corner.x - 100, y: corner.y, width: 98, height: 100 };
  assert.equal(showBrandCorner('modern', true, null, corner, [nearby]), false);
  assert.equal(showBrandCorner('modern', true, 'results', corner, []), false);
  assert.equal(showBrandCorner('modern', true, null, corner, []), true);
});

test('modern channel omits subtitles and legacy keeps its escaped subtitle', () => {
  const modern = brandGraphic('modern', '<现场>');
  assert.match(modern, /src="\/assets\/yanzhou-seal\.png"/);
  assert.match(modern, /YZBTVS <span>SPORT<\/span>/);
  assert.doesNotMatch(modern, /<small>|现场/);
  assert.doesNotMatch(brandGraphic('modern', ''), /<small>|烟洲体育/);

  const legacy = brandGraphic('legacy', '<现场>');
  assert.match(legacy, /yanzhou-sport-wordmark\.png/);
  assert.match(legacy, /<small>&lt;现场&gt;<\/small>/);
});

async function renderOverlay(t, query, staticPreview = false) {
  const makeNode = () => ({
    style: { setProperty() {} },
    dataset: {},
    children: [],
    append(child) { this.children.push(child); },
    animate() {
      this.animation = { cancel() {} };
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

test('preview loads the production renderer without WebSocket with only the left channel and lower-right mark', async (t) => {
  const html = await readFile(new URL('../public/branding-preview.html', import.meta.url), 'utf8');
  assert.match(html, /class="guides" data-branding-preview/);
  assert.match(html, /src="\/overlay.js"/);
  const css = await readFile(new URL('../public/branding.css', import.meta.url), 'utf8');
  assert.match(css, /\/assets\/track-preview\.png/);
  assert.match(css, /\.branding-channel\s*\{[^}]*color:\s*#ffffff\b/);
  assert.doesNotMatch(css, /branding-silver|background-clip/);
  const overlay = await renderOverlay(t, '', true);
  assert.equal(overlay.connected, false);
  assert.match(overlay.node('layer--brand').children[0].innerHTML, /branding-channel/);
  assert.match(overlay.node('branding-corner--br').innerHTML, /^<img src="\/assets\/branding\/yanzhou-zhou-gold-mark\.png"[^>]*>$/);
  assert.equal(overlay.node('branding-corner--tr'), undefined);
  assert.equal(overlay.node('branding-corner--br').hidden, false);
});

test('live output gives the champion card priority through its exit animation', async (t) => {
  const overlay = await renderOverlay(t, '', false);
  const snapshot = clientState(initialState(), true);
  const bottom = overlay.node('branding-corner--br');
  overlay.receive(snapshot);
  assert.equal(bottom.hidden, false);
  snapshot.modules.results.visible = true;
  overlay.receive(snapshot);
  const winner = overlay.node('layer--results').children[0];
  assert.match(winner.innerHTML, /winner-card/);
  assert.equal(bottom.hidden, true);
  snapshot.modules.results.x = 112;
  overlay.receive(snapshot);
  assert.equal(bottom.hidden, false);
  snapshot.modules.results.x = defaultLayout('results').x;
  snapshot.modules.results.visible = false;
  overlay.receive(snapshot);
  assert.equal(bottom.hidden, true);
  winner.animation.onfinish();
  assert.equal(bottom.hidden, false);
  snapshot.modules.brand.opacity = 0;
  overlay.receive(snapshot);
  assert.equal(bottom.hidden, true);
});

test('legacy keeps the original wordmark and omits both new right corners', async (t) => {
  const overlay = await renderOverlay(t, '?branding=legacy');
  overlay.receive(clientState(initialState(), true));
  assert.match(overlay.node('layer--brand').children[0].innerHTML, /yanzhou-sport-wordmark\.png/);
  assert.equal(overlay.node('branding-corner--tr'), undefined);
  assert.equal(overlay.node('branding-corner--br'), undefined);
});

test('off hides the brand but leaves the event graphic on air', async (t) => {
  const overlay = await renderOverlay(t, '?branding=off');
  overlay.receive(clientState(initialState(), true));
  assert.equal(overlay.node('layer--brand').hidden, true);
  assert.equal(overlay.node('branding-corner--tr'), undefined);
  assert.match(overlay.node('layer--event').children[0].innerHTML, /event-banner/);
});
