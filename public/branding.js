import { CANVAS, SAFE_AREA } from './sport.js';
import { escapeHtml } from './client.js';

const insetX = SAFE_AREA.x + SAFE_AREA.padding;
const insetY = SAFE_AREA.y + SAFE_AREA.padding;

function bottomRightCorner(width, height) {
  return {
    x: CANVAS.width - insetX - width,
    y: CANVAS.height - insetY - height,
    width,
    height,
  };
}

export const BRANDING_CORNERS = {
  br: bottomRightCorner(110, 142),
};

export function brandingMode(query) {
  const value = query.get('branding');
  return value === 'legacy' || value === 'off' ? value : 'modern';
}

export function showBrandLayer(mode, visible) {
  return mode !== 'off' && visible;
}

export function showBrandCorner(mode, brandVisible, focusKey, corner, occupied) {
  if (mode !== 'modern' || !brandVisible || focusKey) return false;
  const gap = SAFE_AREA.padding;
  return !occupied.some((box) => (
    corner.x < box.x + box.width + gap &&
    corner.x + corner.width + gap > box.x &&
    corner.y < box.y + box.height + gap &&
    corner.y + corner.height + gap > box.y
  ));
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

const cornerMarkup = {
  br: '<img src="/assets/branding/yanzhou-zhou-gold-mark.png" alt="" width="110" height="110">',
};

export function mountBrandCorners(stage) {
  return Object.entries(BRANDING_CORNERS).map(([key, box]) => {
    const node = stage.ownerDocument.createElement('aside');
    node.className = `branding-corner branding-corner--${key}`;
    node.hidden = true;
    for (const [property, pixels] of Object.entries({ left: box.x, top: box.y, width: box.width, height: box.height })) {
      node.style[property] = `${pixels}px`;
    }
    node.innerHTML = cornerMarkup[key];
    const caption = stage.ownerDocument.createElement('span');
    caption.className = 'branding-corner-text';
    caption.hidden = true;
    node.append(caption);
    stage.append(node);
    return { node, box, caption };
  });
}
