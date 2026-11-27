import { CANVAS, SAFE_AREA } from './sport.js';
import { escapeHtml } from './client.js';

const insetX = SAFE_AREA.x + SAFE_AREA.padding;
const insetY = SAFE_AREA.y + SAFE_AREA.padding;

const emblemSize = 56;
export const BRANDING_CORNERS = {
  bl: { x: insetX, y: CANVAS.height - insetY - emblemSize, width: emblemSize, height: emblemSize },
};

export function placeBrandCorner(box, caption, occupied) {
  const gap = SAFE_AREA.padding;
  const width = caption ? emblemSize + 24 + Math.max(125, [...caption].length * 28) : box.width;
  const blockers = occupied
    .filter((layer) => box.x < layer.x + layer.width + gap && box.x + width + gap > layer.x)
    .sort((a, b) => b.y - a.y);
  let y = box.y;
  for (const layer of blockers) {
    if (y < layer.y + layer.height + gap && y + box.height + gap > layer.y) {
      y = layer.y - gap - box.height;
    }
  }
  return y >= insetY ? { ...box, y, width } : null;
}

export function brandingMode(query) {
  const value = query.get('branding');
  return value === 'legacy' || value === 'off' ? value : 'modern';
}

export function showBrandLayer(mode, visible) {
  return mode !== 'off' && visible;
}

export function brandGraphic(mode, subtitle) {
  if (mode === 'off') return '';
  if (mode === 'legacy') {
    const seal = '<img class="school-seal" src="/assets/yanzhou-seal.png" alt="中山市烟洲中学校徽">';
    return `<div class="brand-ribbon">${seal}<div class="brand-copy">
      <img class="brand-wordmark" src="/assets/yanzhou-sport-wordmark.png" alt="YZBTVS SPORT" width="513" height="92">
      ${subtitle ? `<small>${escapeHtml(subtitle)}</small>` : ''}</div></div>`;
  }
  return `<div class="branding-channel">
    <img src="/assets/branding/yanzhou-channel-wordmark.png" alt="YZBTVS SPORT" width="1536" height="244">
  </div>`;
}

export function mountBrandCorners(stage) {
  return Object.entries(BRANDING_CORNERS).map(([key, box]) => {
    const node = stage.ownerDocument.createElement('aside');
    node.className = `branding-corner branding-corner--${key}`;
    node.hidden = true;
    for (const [property, pixels] of Object.entries({ left: box.x, top: box.y, width: box.width, height: box.height })) {
      node.style[property] = `${pixels}px`;
    }
    node.innerHTML = `<img src="/assets/branding/yanzhou-zhou-gold-mark.png" alt="" width="${emblemSize}" height="${emblemSize}">`;
    const copy = stage.ownerDocument.createElement('div');
    copy.className = 'branding-corner-copy';
    copy.hidden = true;
    const caption = stage.ownerDocument.createElement('span');
    caption.className = 'branding-corner-text';
    const subtitle = stage.ownerDocument.createElement('span');
    subtitle.className = 'branding-corner-subtitle';
    subtitle.textContent = 'YZBTVS SPORT';
    copy.append(caption, subtitle);
    node.append(copy);
    stage.append(node);
    return { node, box, copy, caption };
  });
}
