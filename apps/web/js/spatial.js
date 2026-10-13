// D-pad / remote navigation for TVs (Android TV, Fire TV, Tizen, webOS) and keyboards.
// Arrow keys move focus to the nearest focusable element in that direction.
const FOCUSABLE = 'a[href]:not([tabindex="-1"]), button:not([disabled]):not([tabindex="-1"]), input:not([disabled]), select:not([disabled]), textarea, [tabindex="0"]';
const DIRS = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };

function visible(el) {
  if (el.closest('[hidden], [inert]')) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
}

function score(from, to, dir) {
  const fx = from.left + from.width / 2;
  const fy = from.top + from.height / 2;
  const tx = to.left + to.width / 2;
  const ty = to.top + to.height / 2;
  const dx = tx - fx;
  const dy = ty - fy;
  const ok = { left: dx < -4, right: dx > 4, up: dy < -4, down: dy > 4 }[dir];
  if (!ok) return Infinity;
  const horizontal = dir === 'left' || dir === 'right';
  // Stay in the same row/column when possible.
  const overlap = horizontal ? (to.bottom > from.top && to.top < from.bottom) : (to.right > from.left && to.left < from.right);
  return (horizontal ? Math.abs(dx) : Math.abs(dy)) + (horizontal ? Math.abs(dy) : Math.abs(dx)) * (overlap ? 0.5 : 3);
}

export function moveFocus(dir, scope = document.querySelector('.modal') || document) {
  const current = document.activeElement;
  const all = [...scope.querySelectorAll(FOCUSABLE)].filter((el) => el !== current && visible(el));
  if (!current || current === document.body || !scope.contains(current)) {
    all[0]?.focus();
    return !!all[0];
  }
  const from = current.getBoundingClientRect();
  let best = null;
  let bestScore = Infinity;
  for (const el of all) {
    const s = score(from, el.getBoundingClientRect(), dir);
    if (s < bestScore) { bestScore = s; best = el; }
  }
  if (!best) return false;
  best.focus({ preventScroll: true });
  best.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  return true;
}

export function installSpatialNav() {
  document.addEventListener('keydown', (e) => {
    const dir = DIRS[e.key];
    if (!dir || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
    const t = e.target;
    if (t?.closest?.('[data-own-keys]')) return; // the player handles its own keys
    if (t?.tagName === 'INPUT' && !['checkbox', 'radio', 'button', 'range'].includes(t.type) && (dir === 'left' || dir === 'right')) return;
    if (t?.tagName === 'TEXTAREA') return;
    if (t?.tagName === 'SELECT' && (dir === 'up' || dir === 'down')) return;
    if (moveFocus(dir)) e.preventDefault();
  });
}

/** TVs: larger focus rings / no hover-dependent UI. */
export function detectTv() {
  const ua = navigator.userAgent;
  const tv = /SMART-TV|SmartTV|Tizen|Web0S|webOS|AFT[A-Z]|BRAVIA|Android TV|GoogleTV|CrKey|HbbTV/i.test(ua) || new URLSearchParams(location.search).has('tv');
  document.documentElement.classList.toggle('tv', tv);
  return tv;
}
