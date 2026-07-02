import type { TribeId } from '@cardgame/shared';
import { TRIBES } from '@cardgame/shared';

/**
 * Procedural, tribe-themed card portraits (design-spec §16.6 override — see requirements.md
 * decision #30). Every avatar is ORIGINAL geometry composed from a small per-tribe face kit,
 * so the clean-room rule (§0, which bans copying existing games' names/art) is satisfied by
 * construction. One unique recipe per slice card; faces read as their tribe at a glance and
 * stay individually distinct via per-card parts (ears/horns/fins, eyes, mouth, accessories).
 *
 * Output is a trusted, input-free SVG markup string injected via dangerouslySetInnerHTML.
 * viewBox is 0 0 200 200; the card frames it with CARD_VIEWBOX + a slice crop.
 */

// Frames the 0..200 face content (incl. crowns/antlers/fins) for a `meet` (contain) fit, so
// no top-of-head signature is cropped — the very feature that keeps same-archetype cards apart.
export const CARD_VIEWBOX = '12 14 176 176';

type Skin = { base: string; dark: string; light: string; pup?: string };
type Opts = Record<string, any>;

function shade(hex: string, p: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.substr(0, 2), 16), g = parseInt(h.substr(2, 2), 16), b = parseInt(h.substr(4, 2), 16);
  const f = (c: number) => Math.round(Math.max(0, Math.min(255, p < 0 ? c * (1 + p) : c + (255 - c) * p)));
  return '#' + [f(r), f(g), f(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

const WKS: Record<string, Skin> = {
  leaf: { base: '#6aab4d', dark: '#4d8a37', light: '#8cc46e' },
  moss: { base: '#5c9a52', dark: '#3f7639', light: '#83bd74' },
  fern: { base: '#74b85e', dark: '#538f42', light: '#9bd083' },
  bramble: { base: '#4f7e3e', dark: '#35592a', light: '#6fa257' },
};
const RKS: Record<string, Skin> = {
  tide: { base: '#2fa78f', dark: '#1d7c69', light: '#5fc8b3', pup: '#15564c' },
  deep: { base: '#2b93b0', dark: '#1b6c85', light: '#5cbed6', pup: '#114455' },
  poison: { base: '#5fa85a', dark: '#3f7a3c', light: '#8ec77f', pup: '#234d22' },
};
const WK_SHAPE: Record<string, [number, number, number]> = {
  sm: [54, 52, 116], round: [62, 58, 114], wide: [69, 54, 116], tall: [56, 63, 113], big: [70, 65, 116],
};

// ── generic parts ─────────────────────────────────────────────────────────────
function leafEar(cx: number, cy: number, rot: number, base: string, dk: string, s = 1): string {
  const a = 34 * s, b = 16 * s;
  return `<g transform="rotate(${rot} ${cx} ${cy})"><path d="M${cx} ${cy - a} C ${cx - b} ${cy - a * 0.7}, ${cx - b} ${cy + a * 0.55}, ${cx} ${cy + a * 0.78} C ${cx + b} ${cy + a * 0.55}, ${cx + b} ${cy - a * 0.7}, ${cx} ${cy - a} Z" fill="${base}"/><line x1="${cx}" y1="${cy - a * 0.78}" x2="${cx}" y2="${cy + a * 0.6}" stroke="${dk}" stroke-width="2" opacity=".5"/></g>`;
}
function antler(cx: number, cy: number, d: number, dk: string): string {
  return `<g stroke="${dk}" stroke-width="5" fill="none" stroke-linecap="round"><path d="M${cx} ${cy} q ${d * 4} -22 ${d * 10} -30"/><path d="M${cx + d * 6} ${cy - 18} q ${d * 10} -2 ${d * 16} -8"/><path d="M${cx + d * 8} ${cy - 26} q ${d * 8} 0 ${d * 14} -6"/></g>`;
}
function flower(cx: number, cy: number, lt: string, base: string): string {
  let s = '';
  for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2; s += `<circle cx="${(cx + Math.cos(a) * 11).toFixed(1)}" cy="${(cy + Math.sin(a) * 11).toFixed(1)}" r="7" fill="${lt}"/>`; }
  return s + `<circle cx="${cx}" cy="${cy}" r="6" fill="${base}"/>`;
}
function leafCrown(cx: number, cy: number, base: string, dk: string, lt: string): string {
  let s = '';
  [-28, -14, 0, 14, 28].forEach((dx, i) => { const h = i === 2 ? 30 : 22; s += `<path d="M${cx + dx} ${cy - h} q-7 ${h * 0.5} 0 ${h} q7 -${h * 0.5} 0 -${h} z" fill="${i % 2 ? base : lt}"/>`; });
  return s;
}
function helmet(_cx: number, _cy: number, base: string, dk: string): string {
  return `<path d="M58 96 Q100 60 142 96 Q120 86 100 86 Q80 86 58 96 Z" fill="${dk}"/><path d="M64 92 Q100 66 136 92" fill="none" stroke="${shade(base, 0.2)}" stroke-width="3"/>`;
}
function spikeCrown(cx: number, cy: number, glow: string, dk: string, tall: boolean): string {
  let s = '';
  [-26, -13, 0, 13, 26].forEach((dx, i) => { const h = (i === 2 ? 28 : 18) * (tall ? 1.4 : 1); s += `<path d="M${cx + dx} ${cy - h} L${cx + dx - 7} ${cy} L${cx + dx + 7} ${cy} Z" fill="${dk}"/>`; });
  return s + `<circle cx="${cx}" cy="${cy - (tall ? 40 : 30)}" r="5" fill="${glow}"/>`;
}
function batwing(cx: number, cy: number, d: number, dk: string): string {
  return `<path d="M${cx} ${cy - 30} q ${d * 42} 6 ${d * 46} 46 q ${d * -16} -12 ${d * -22} -6 q ${d * -4} -20 ${d * -24} -40 z" fill="${dk}"/>`;
}

// ── accessories (z-ordered by caller) ─────────────────────────────────────────
function scar(x: number, y: number): string { return `<g stroke="#e8d9c0" stroke-width="2.4" opacity=".85" stroke-linecap="round"><path d="M${x} ${y} l10 24"/><path d="M${x + 1} ${y + 6} l8 -3"/><path d="M${x + 4} ${y + 14} l8 -3"/></g>`; }
function warpaint(col: string): string { return `<path d="M62 122 q38 12 76 0" stroke="${col}" stroke-width="5" fill="none" opacity=".5" stroke-linecap="round"/>`; }
function droplet(x: number, y: number, col: string): string { return `<path d="M${x} ${y} q-7 9 0 15 q7 -6 0 -15z" fill="${col}"/><circle cx="${x - 2}" cy="${y + 9}" r="2" fill="#fff" opacity=".7"/>`; }
function glowMotes(col: string): string { let s = ''; ([[48, 78, 4], [152, 84, 5], [44, 140, 3], [156, 138, 4], [100, 36, 3]] as number[][]).forEach(([x, y, r]) => { s += `<circle cx="${x}" cy="${y}" r="${r + 3}" fill="${col}" opacity=".25"/><circle cx="${x}" cy="${y}" r="${r}" fill="${col}" opacity=".8"/>`; }); return s; }
function boneMark(x: number, y: number, col: string): string { return `<g transform="translate(${x} ${y})" fill="${col}" opacity=".85"><rect x="-9" y="-2" width="18" height="3" rx="1.5" transform="rotate(35)"/><rect x="-9" y="-2" width="18" height="3" rx="1.5" transform="rotate(-35)"/></g>`; }
function candleFlame(x: number, y: number): string { return `<rect x="${x - 2}" y="${y}" width="4" height="16" rx="1" fill="#e8e2cf"/><ellipse cx="${x}" cy="${y - 5}" rx="4" ry="8" fill="#ffd27a"/><ellipse cx="${x}" cy="${y - 4}" rx="2" ry="5" fill="#ff9a3c"/><circle cx="${x}" cy="${y}" r="9" fill="#ffd27a" opacity=".25"/>`; }
function miniWisps(col: string): string {
  const w = (x: number, y: number, s: number) => `<g transform="translate(${x} ${y}) scale(${s})"><path d="M-8 -2 Q-8 -12 0 -12 Q8 -12 8 -2 L8 8 q-4 5 -8 0 q-4 5 -8 0 Z" fill="${col}" opacity=".85"/><circle cx="-3" cy="-2" r="1.6" fill="#241d3a"/><circle cx="3" cy="-2" r="1.6" fill="#241d3a"/></g>`;
  return w(40, 90, 1) + w(160, 92, 1);
}
function soundArcs(x: number, d: number, col: string): string { let s = ''; for (let i = 1; i <= 3; i++) { const r = i * 9; s += `<path d="M${x} ${146 - r} A ${r} ${r} 0 0 ${d > 0 ? 1 : 0} ${x} ${146 + r}" fill="none" stroke="${col}" stroke-width="2.5" opacity="${0.7 - i * 0.15}"/>`; } return s; }
function horns(col: string): string { return `<path d="M70 78 Q52 64 56 44 Q66 60 78 70 Z" fill="${col}"/><path d="M130 78 Q148 64 144 44 Q134 60 122 70 Z" fill="${col}"/>`; }
function noteMotes(col: string): string { const n = (x: number, y: number) => `<circle cx="${x}" cy="${y}" r="4" fill="${col}"/><rect x="${x + 3}" y="${y - 14}" width="2.5" height="14" fill="${col}"/>`; return n(46, 96) + n(150, 100); }
function whiskers(col: string): string { return `<g stroke="${col}" stroke-width="2.5" fill="none" stroke-linecap="round" opacity=".8"><path d="M70 138 q-22 2 -34 -4"/><path d="M70 146 q-22 6 -32 4"/><path d="M130 138 q22 2 34 -4"/><path d="M130 146 q22 6 32 4"/></g>`; }
function bubble(x: number, y: number): string { return `<circle cx="${x}" cy="${y}" r="7" fill="#cdeefb" opacity=".5"/><circle cx="${x - 2}" cy="${y - 2}" r="2" fill="#fff" opacity=".8"/>`; }
function scales(col: string): string { let s = ''; for (let r = 0; r < 2; r++) for (let c = 0; c < 4; c++) { const x = 76 + c * 16 + (r % 2) * 8, y = 150 + r * 11; s += `<path d="M${x - 7} ${y} q7 -8 14 0" fill="none" stroke="${col}" stroke-width="2" opacity=".5"/>`; } return s; }
function rebornSwirl(x: number, y: number, col: string): string { return `<path d="M${x} ${y} a6 6 0 1 1 -5 -3" fill="none" stroke="${col}" stroke-width="2.5" stroke-linecap="round"/><path d="M${x - 5} ${y - 3} l-3 -2 l4 -1" fill="none" stroke="${col}" stroke-width="2.5" stroke-linecap="round"/>`; }
function echoOutline(skin: Skin): string { return `<ellipse cx="116" cy="114" rx="58" ry="55" fill="${skin.base}" opacity=".28"/><ellipse cx="84" cy="114" rx="58" ry="55" fill="${skin.base}" opacity=".28"/>`; }

// ── WILDKIN ───────────────────────────────────────────────────────────────────
function wkEyes(t: string, base: string, dk: string): string {
  let s = ''; const ey = 106;
  if (t === 'glow') [80, 120].forEach((x) => (s += `<circle cx="${x}" cy="${ey}" r="18" fill="#9be86a" opacity=".5"/>`));
  if (t === 'sleepy') { [80, 120].forEach((x) => (s += `<path d="M${x - 12} ${ey} a12 12 0 0 0 24 0" fill="#fbfdf6" stroke="${dk}" stroke-width="2"/><circle cx="${x}" cy="${ey + 3}" r="5" fill="#23301c"/>`)); return s; }
  [80, 120].forEach((x) => (s += `<circle cx="${x}" cy="${ey}" r="14" fill="#fbfdf6" stroke="${dk}" stroke-width="2"/>`));
  const pcol = t === 'glow' ? '#3a6a1e' : '#23301c';
  [80, 120].forEach((x) => (s += `<circle cx="${x}" cy="${ey + 2}" r="8" fill="${pcol}"/><circle cx="${x - 3}" cy="${ey - 1}" r="3" fill="#fff"/>`));
  if (t === 'soft') s += `<path d="M66 95 q14 -7 28 -1" stroke="${dk}" stroke-width="2" fill="none"/><path d="M106 94 q14 -6 28 1" stroke="${dk}" stroke-width="2" fill="none"/>`;
  if (t === 'fierce') s += `<path d="M66 92 L92 100" stroke="${dk}" stroke-width="4" stroke-linecap="round"/><path d="M134 92 L108 100" stroke="${dk}" stroke-width="4" stroke-linecap="round"/>`;
  return s;
}
function wkMouth(t: string, dk: string): string {
  if (t === 'fang') return `<path d="M86 140 Q100 151 114 140" stroke="${dk}" stroke-width="3" fill="none" stroke-linecap="round"/><path d="M92 142 l3 8 l3 -8z" fill="#fff"/><path d="M105 142 l3 8 l3 -8z" fill="#fff"/>`;
  if (t === 'grin') return `<path d="M84 139 Q100 158 116 139 Z" fill="${shade(dk, -0.3)}"/><path d="M90 144 l4 7 l4 -7z" fill="#fff"/><path d="M102 144 l4 7 l4 -7z" fill="#fff"/>`;
  if (t === 'open') return `<ellipse cx="100" cy="145" rx="9" ry="7" fill="${shade(dk, -0.3)}"/>`;
  return `<path d="M86 140 Q100 152 114 140" stroke="${dk}" stroke-width="3" fill="none" stroke-linecap="round"/>`;
}
function wk(o: Opts): string {
  const sk = WKS[o.skin], base = sk.base, dk = sk.dark, lt = sk.light;
  const [rx, ry, cy] = WK_SHAPE[o.shape || 'round'];
  let p = '';
  const e = o.ears;
  if (e === 'leaf' || e === 'leafTeal') p += leafEar(72, 58, -22, base, dk) + leafEar(128, 58, 22, base, dk);
  else if (e === 'leafShort') p += leafEar(76, 64, -20, base, dk, 0.72) + leafEar(124, 64, 20, base, dk, 0.72);
  else if (e === 'bunny') p += `<ellipse cx="78" cy="50" rx="12" ry="34" fill="${base}" transform="rotate(-12 78 50)"/><ellipse cx="78" cy="52" rx="6" ry="24" fill="${lt}" transform="rotate(-12 78 50)"/><ellipse cx="122" cy="50" rx="12" ry="34" fill="${base}" transform="rotate(12 122 50)"/><ellipse cx="122" cy="52" rx="6" ry="24" fill="${lt}" transform="rotate(12 122 50)"/>`;
  else if (e === 'antler') p += antler(70, 72, -1, dk) + antler(130, 72, 1, dk);
  p += `<ellipse cx="100" cy="${cy}" rx="${rx}" ry="${ry}" fill="${base}"/>`;
  p += `<ellipse cx="100" cy="${cy + 36}" rx="${rx * 0.64}" ry="22" fill="${dk}" opacity=".22"/>`;
  p += `<ellipse cx="100" cy="132" rx="30" ry="22" fill="${lt}" opacity=".42"/>`;
  if (o.tint) p += `<ellipse cx="100" cy="${cy}" rx="${rx}" ry="${ry}" fill="${o.tint}" opacity=".16"/>`;
  if (e === 'leafTeal') p += `<path d="M68 30 l4 12 l4 -12z" fill="#2fa78f"/><path d="M128 30 l-4 12 l-4 -12z" fill="#2fa78f"/>`;
  if (e === 'tusk') p += `<path d="M84 138 q-5 18 -11 22 q11 -2 15 -11 z" fill="#f3efdc"/><path d="M116 138 q5 18 11 22 q-11 -2 -15 -11 z" fill="#f3efdc"/>`;
  if (e === 'tuskBig') p += `<path d="M80 128 q-10 26 -20 30 q14 -2 24 -16 z" fill="#f3efdc"/><path d="M120 128 q10 26 20 30 q-14 -2 -24 -16 z" fill="#f3efdc"/>`;
  if (o.top === 'sprout') p += `<path d="M100 ${cy - ry} q-2 -22 -16 -26 q6 16 16 26z" fill="${lt}"/><path d="M100 ${cy - ry} q2 -16 14 -20 q-6 12 -14 20z" fill="${base}"/>`;
  if (o.top === 'flower') p += flower(100, cy - ry - 2, lt, base);
  if (o.top === 'crown') p += leafCrown(100, cy - ry + 4, base, dk, lt);
  if (o.top === 'helmet') p += helmet(100, cy, base, dk);
  p += wkEyes(o.eyes, base, dk);
  p += `<circle cx="68" cy="130" r="10" fill="${lt}" opacity=".5"/><circle cx="132" cy="130" r="10" fill="${lt}" opacity=".5"/>`;
  p += `<path d="M95 124 L105 124 L100 130 Z" fill="${dk}" opacity=".6"/>`;
  p += wkMouth(o.mouth, dk);
  return p;
}

// ── REVENANTS ─────────────────────────────────────────────────────────────────
function wisp(o: Opts): string {
  const g = o.skin || '#b8a9dc', gd = shade(g, -0.25), glow = o.glow || '#d8ccf2';
  const sc = o.size === 'sm' ? 0.86 : 1;
  let p = `<g transform="translate(100 110) scale(${sc}) translate(-100 -110)">`;
  p += `<path d="M58 78 Q58 44 100 44 Q142 44 142 78 L142 150 q-11 14 -21 0 q-10 -13 -20 0 q-10 13 -20 0 q-10 -13 -21 0 Z" fill="${g}" opacity=".95"/>`;
  p += `<path d="M58 78 Q58 44 100 44 Q142 44 142 78" fill="none" stroke="${gd}" stroke-width="2" opacity=".4"/>`;
  p += `<ellipse cx="84" cy="92" rx="9" ry="12" fill="#241d3a"/><ellipse cx="116" cy="92" rx="9" ry="12" fill="#241d3a"/>`;
  p += `<circle cx="84" cy="89" r="3" fill="${glow}"/><circle cx="116" cy="89" r="3" fill="${glow}"/>`;
  return p + `<ellipse cx="100" cy="118" rx="7" ry="9" fill="#241d3a" opacity=".8"/></g>`;
}
function rev(o: Opts): string {
  if (o.variant === 'wisp') return wisp(o);
  const bone = o.pale ? '#f4f1e6' : '#ece6d2', boneDk = o.pale ? '#dcd6c4' : '#cfc8ad', socket = '#241d3a';
  const hood = o.tint ? shade(o.tint, 0.05) : '#6a5a9c', hoodDk = o.tint ? shade(o.tint, -0.3) : '#473a70';
  const glow = o.glow || '#bda9ee', v = o.variant;
  let p = '';
  if (o.hood !== false && v !== 'wing') p += `<path d="M52 178 L52 96 Q52 40 100 40 Q148 40 148 96 L148 178 Z" fill="${hoodDk}"/><path d="M64 178 L64 98 Q64 54 100 54 Q136 54 136 98 L136 178 Z" fill="${hood}"/>`;
  if (o.finHood) p += `<path d="M52 120 q-22 -6 -26 14 q16 -2 26 4 z" fill="${hood}"/><path d="M148 120 q22 -6 26 14 q-16 -2 -26 4 z" fill="${hood}"/>`;
  if (v === 'wing') p += batwing(58, 110, -1, hoodDk) + batwing(142, 110, 1, hoodDk);
  const cy = v === 'colossus' ? 102 : 104, rx = v === 'colossus' ? 46 : 40, ry = v === 'colossus' ? 46 : 42;
  if (o.horns) p += horns(boneDk);
  if (o.crown === 'small') p += spikeCrown(100, cy - ry - 2, glow, hoodDk, false);
  if (o.crown === 'tall') p += spikeCrown(100, cy - ry, glow, hoodDk, true);
  p += `<ellipse cx="100" cy="${cy}" rx="${rx}" ry="${ry}" fill="${bone}"/>`;
  p += `<path d="M${100 - rx * 0.78} ${cy + 18} Q100 ${cy + 62} ${100 + rx * 0.78} ${cy + 18} Z" fill="${bone}"/>`;
  p += `<ellipse cx="100" cy="${cy + 6}" rx="${rx * 0.66}" ry="${ry * 0.55}" fill="${boneDk}" opacity=".22"/>`;
  if (o.tint) p += `<ellipse cx="100" cy="${cy}" rx="${rx}" ry="${ry}" fill="${o.tint}" opacity=".2"/>`;
  p += `<path d="M100 ${cy - rx} l-6 14 l5 8" stroke="${boneDk}" stroke-width="2" fill="none"/>`;
  if (o.crackHeavy) p += `<path d="M122 ${cy - 18} l-8 16 l6 10" stroke="${boneDk}" stroke-width="2.5" fill="none"/><path d="M78 ${cy + 4} l8 8" stroke="${boneDk}" stroke-width="2" fill="none"/>`;
  const oL = o.sly ? cy + 4 : cy;
  p += `<circle cx="85" cy="${oL + 2}" r="10" fill="${glow}" opacity=".28"/><ellipse cx="85" cy="${oL}" rx="11" ry="13" fill="${socket}"/><circle cx="85" cy="${oL + 2}" r="${o.crown === 'tall' ? 6 : 5}" fill="${glow}"/>`;
  p += `<circle cx="115" cy="${cy + 2}" r="10" fill="${glow}" opacity=".28"/><ellipse cx="115" cy="${cy}" rx="11" ry="13" fill="${socket}"/><circle cx="115" cy="${cy + 2}" r="${o.crown === 'tall' ? 6 : 5}" fill="${glow}"/>`;
  p += `<path d="M100 ${cy + 12} l-7 13 l14 0 z" fill="${socket}"/>`;
  if (o.jaw === 'gaping') p += `<ellipse cx="100" cy="${cy + 40}" rx="13" ry="16" fill="${socket}"/>`;
  else { const ty = cy + 34; for (let i = -2; i <= 2; i++) p += `<rect x="${100 + i * 9 - 3}" y="${ty}" width="6" height="13" rx="2" fill="${boneDk}"/>`; p += `<path d="M82 ${ty - 2} q18 8 36 0" stroke="${boneDk}" stroke-width="2" fill="none"/>`; }
  return p;
}

// ── REEFKIN ───────────────────────────────────────────────────────────────────
function fin(cx: number, cy: number, d: number, sk: Skin, scale: number, frilled: boolean): string {
  const inner = frilled
    ? `<path d="M0 -20 C 36 -28 44 0 30 26 L24 14 L30 8 L22 6 L28 -2 L20 -2 L24 -10 Z" fill="${sk.dark}"/>`
    : `<path d="M0 -20 C 34 -26 40 -2 30 24 C 18 14 6 16 0 22 Z" fill="${sk.dark}"/>`;
  return `<g transform="translate(${cx} ${cy}) scale(${d * scale} ${scale})">${inner}<g stroke="${shade(sk.dark, -0.2)}" stroke-width="2"><path d="M8 -8 L26 0"/><path d="M8 2 L28 10"/><path d="M8 12 L23 18"/></g></g>`;
}
function spikes(cx: number, cy: number, n: number, sk: Skin): string {
  if (n <= 0) return '';
  let s = ''; const w = 14, start = cx - ((n - 1) * w) / 2;
  for (let i = 0; i < n; i++) { const x = start + i * w, h = i === Math.floor(n / 2) ? 26 : 18; s += `<path d="M${x} ${cy - h} L${x - 7} ${cy} L${x + 7} ${cy} Z" fill="${sk.dark}"/>`; }
  return s;
}
function coralCrown(cx: number, cy: number, sk: Skin): string {
  let s = '';
  ([[-22, -2], [-10, -18], [2, -26], [14, -16], [24, -2]] as number[][]).forEach(([dx, dy]) => (s += `<circle cx="${cx + dx}" cy="${cy + dy}" r="8" fill="${shade(sk.base, 0.12)}"/>`));
  return s;
}
function rk(o: Opts): string {
  const sk = RKS[o.skin];
  const RS: [number, number, number] = o.shape === 'sm' ? [50, 48, 116] : o.shape === 'big' ? [64, 60, 114] : [58, 55, 114];
  const [rx, ry, cy] = RS;
  let p = '';
  const fs = (o.fins === 'big' ? 1.25 : 1) * (o.shape === 'big' ? 1.1 : 1);
  p += fin(54, cy - 2, -1, sk, fs, o.fins === 'frilled') + fin(146, cy - 2, 1, sk, fs, o.fins === 'frilled');
  if (o.crown === 'coral') p += coralCrown(100, cy - ry + 2, sk); else p += spikes(100, cy - ry + 4, o.crown == null ? 3 : o.crown, sk);
  if (o.spines) [68, 84, 100, 116, 132].forEach((x) => (p += `<path d="M${x} ${cy - ry + 8} l-5 -15 l10 0 z" fill="${shade(sk.base, -0.25)}"/>`));
  p += `<ellipse cx="100" cy="${cy}" rx="${rx}" ry="${ry}" fill="${sk.base}"/>`;
  p += `<ellipse cx="100" cy="${cy + 20}" rx="30" ry="20" fill="${sk.light}" opacity=".4"/>`;
  if (o.tint) p += `<ellipse cx="100" cy="${cy}" rx="${rx}" ry="${ry}" fill="${o.tint}" opacity=".16"/>`;
  p += `<g stroke="${sk.dark}" stroke-width="2.5" fill="none" stroke-linecap="round" opacity=".7"><path d="M60 116 q6 6 0 14"/><path d="M67 116 q6 6 0 14"/><path d="M140 116 q-6 6 0 14"/><path d="M133 116 q-6 6 0 14"/></g>`;
  const big = o.eyes !== 'narrow' && o.eyes !== 'wise';
  const pup = sk.pup as string;
  [80, 120].forEach((x) => (p += `<circle cx="${x}" cy="106" r="${big ? 16 : 11}" fill="#fff" stroke="${sk.dark}" stroke-width="2"/>`));
  [80, 120].forEach((x) => (p += `<circle cx="${x}" cy="108" r="${big ? 9 : 6}" fill="${pup}"/><circle cx="${x - 3}" cy="103" r="3" fill="#fff"/>`));
  if (o.eyes === 'narrow') p += `<path d="M66 99 q14 -6 26 0" stroke="${sk.dark}" stroke-width="4" fill="none" stroke-linecap="round"/><path d="M134 99 q-14 -6 -26 0" stroke="${sk.dark}" stroke-width="4" fill="none" stroke-linecap="round"/>`;
  if (o.eyes === 'wise') p += `<path d="M64 96 q16 -7 30 -1" stroke="${sk.dark}" stroke-width="2.5" fill="none"/><path d="M106 95 q16 -6 30 1" stroke="${sk.dark}" stroke-width="2.5" fill="none"/>`;
  if (o.mouth === 'open') p += `<ellipse cx="100" cy="146" rx="12" ry="9" fill="${sk.dark}"/>`;
  else if (o.mouth === 'fang') p += `<path d="M86 142 q14 10 28 0" stroke="${sk.dark}" stroke-width="3" fill="none" stroke-linecap="round"/><path d="M92 144 l3 7 l3 -7z" fill="#fff"/><path d="M105 144 l3 7 l3 -7z" fill="#fff"/>`;
  else p += `<path d="M84 142 q16 12 32 0" stroke="${sk.dark}" stroke-width="3" fill="none" stroke-linecap="round"/>`;
  if (o.pearl) p += `<circle cx="100" cy="86" r="9" fill="#f4f1ff"/><circle cx="97" cy="83" r="3" fill="#fff"/>`;
  if (o.shield) p += `<circle cx="100" cy="112" r="74" fill="#bfefff" opacity=".08"/><circle cx="100" cy="112" r="74" fill="none" stroke="#bfefff" stroke-width="3" opacity=".45"/>`;
  return p;
}

// ── INFERNALS ─────────────────────────────────────────────────────────────────
// Fire/blood demon faces (Prompt-2 tribe, clean-room §0: original geometry). Distinct
// per card via horns / eyes / mouth / brand·crack·wing accessories + a red skin ramp.
const IKS: Record<string, Skin> = {
  ember: { base: '#d0432e', dark: '#8f2417', light: '#f0764a' },
  blood: { base: '#a1232b', dark: '#66121a', light: '#cf474d' },
  ash: { base: '#6f5150', dark: '#3f2a29', light: '#9c7770' },
  coal: { base: '#4a3330', dark: '#271a19', light: '#7a544f' },
};
const IN_SHAPE: Record<string, [number, number, number]> = {
  sm: [52, 52, 114], round: [61, 58, 112], wide: [70, 56, 113], tall: [55, 64, 111], big: [72, 66, 113],
};
function ihorn(style: string, col: string, lt: string): string {
  if (style === 'nub') return `<path d="M76 84 Q68 70 74 60 Q84 72 84 84 Z" fill="${col}"/><path d="M124 84 Q132 70 126 60 Q116 72 116 84 Z" fill="${col}"/>`;
  if (style === 'tall') return `<path d="M74 88 Q60 54 68 30 Q82 56 84 84 Z" fill="${col}"/><path d="M126 88 Q140 54 132 30 Q118 56 116 84 Z" fill="${col}"/><path d="M74 62 q3 -10 7 -18" stroke="${lt}" stroke-width="2" fill="none" opacity=".5"/><path d="M126 62 q-3 -10 -7 -18" stroke="${lt}" stroke-width="2" fill="none" opacity=".5"/>`;
  if (style === 'ram') return `<path d="M76 82 Q48 76 44 52 Q42 36 58 38 Q48 54 64 68 Q72 76 82 80 Z" fill="${col}"/><path d="M124 82 Q152 76 156 52 Q158 36 142 38 Q152 54 136 68 Q128 76 118 80 Z" fill="${col}"/>`;
  return `<path d="M76 80 Q54 62 38 64 Q50 54 58 40 Q70 60 84 76 Z" fill="${col}"/><path d="M124 80 Q146 62 162 64 Q150 54 142 40 Q130 60 116 76 Z" fill="${col}"/>`; // swept
}
function magmaCrack(col: string): string {
  const d = 'M70 96 l8 14 l-4 12 l9 8 M132 100 l-7 12 l5 12 M100 150 l-6 10';
  return `<path d="${d}" stroke="${col}" stroke-width="5" fill="none" stroke-linecap="round" opacity=".2"/><path d="${d}" stroke="${col}" stroke-width="2.4" fill="none" stroke-linecap="round" opacity=".85"/>`;
}
function brandSigil(x: number, y: number, col: string): string {
  return `<circle cx="${x}" cy="${y}" r="13" fill="${col}" opacity=".18"/><g stroke="${col}" stroke-width="2.6" fill="none" stroke-linecap="round"><path d="M${x - 8} ${y - 8} L${x} ${y + 8} L${x + 8} ${y - 8}"/><path d="M${x - 6} ${y} L${x + 6} ${y}"/></g>`;
}
function infEyes(t: string, dk: string, glow: string): string {
  const ey = 104; let s = '';
  if (t === 'blaze') { [82, 118].forEach((x) => (s += `<circle cx="${x}" cy="${ey}" r="15" fill="${glow}" opacity=".35"/><circle cx="${x}" cy="${ey}" r="9" fill="${glow}"/><circle cx="${x}" cy="${ey - 2}" r="4" fill="#fff7e6"/>`)); return s; }
  if (t === 'hollow') { [82, 118].forEach((x) => (s += `<ellipse cx="${x}" cy="${ey}" rx="11" ry="13" fill="#1a0d0c"/><circle cx="${x}" cy="${ey + 3}" r="8" fill="${glow}" opacity=".25"/><circle cx="${x}" cy="${ey + 3}" r="4" fill="${glow}"/>`)); return s; }
  if (t === 'slit') { [82, 118].forEach((x) => (s += `<ellipse cx="${x}" cy="${ey}" rx="13" ry="9" fill="${glow}"/><ellipse cx="${x}" cy="${ey}" rx="3.5" ry="8" fill="#2a0f0c"/>`)); return s + `<path d="M64 90 L94 100" stroke="${dk}" stroke-width="5" stroke-linecap="round"/><path d="M136 90 L106 100" stroke="${dk}" stroke-width="5" stroke-linecap="round"/>`; }
  [82, 118].forEach((x) => (s += `<circle cx="${x}" cy="${ey}" r="13" fill="#fdf3e8"/><circle cx="${x}" cy="${ey + 1}" r="7" fill="#3a140f"/><circle cx="${x - 3}" cy="${ey - 2}" r="2.5" fill="#fff"/>`)); // round (imp)
  return s;
}
function infMouth(t: string, dk: string): string {
  if (t === 'maw') {
    let teeth = '';
    [78, 89, 100, 111, 122].forEach((x, i) => (teeth += `<path d="M${x - 5} 128 L${x} ${128 + (i % 2 ? 12 : 9)} L${x + 5} 128 Z" fill="#f2e8d8"/>`));
    [84, 100, 116].forEach((x) => (teeth += `<path d="M${x - 5} 164 L${x} 155 L${x + 5} 164 Z" fill="#e6dccb"/>`));
    return `<path d="M72 128 Q100 124 128 128 Q120 166 100 168 Q80 166 72 128 Z" fill="#180806"/>` + teeth;
  }
  if (t === 'grin') {
    let s = `<path d="M78 138 Q100 156 122 138 Z" fill="#180806"/>`;
    for (let i = 0; i < 5; i++) s += `<rect x="${84 + i * 8}" y="139" width="6" height="7" fill="#f2e8d8"/>`;
    return s + `<path d="M80 139 l-2 8 l5 -5z" fill="#f2e8d8"/><path d="M120 139 l2 8 l-5 -5z" fill="#f2e8d8"/>`;
  }
  if (t === 'fang') return `<path d="M84 138 Q100 148 116 138" stroke="${dk}" stroke-width="3" fill="none" stroke-linecap="round"/><path d="M90 139 l3 8 l3 -8z" fill="#f2e8d8"/><path d="M104 139 l3 8 l3 -8z" fill="#f2e8d8"/>`;
  return `<path d="M84 141 Q100 149 118 137" stroke="${dk}" stroke-width="3" fill="none" stroke-linecap="round"/><path d="M112 138 l2 6 l3 -5z" fill="#f2e8d8"/>`; // smirk
}
function inf(o: Opts): string {
  const sk = IKS[o.skin], base = sk.base, dk = sk.dark, lt = sk.light, glow = o.glow || '#ff9a3c';
  const [rx, ry, cy] = IN_SHAPE[o.shape || 'round'];
  let p = '';
  if (o.wing) p += batwing(58, 112, -1, dk) + batwing(142, 112, 1, dk);
  if (o.cowl) p += `<path d="M50 190 L50 100 Q50 44 100 44 Q150 44 150 100 L150 190 Z" fill="${dk}"/><path d="M62 190 L62 102 Q62 58 100 58 Q138 58 138 102 L138 190 Z" fill="${shade(base, -0.15)}"/>`;
  if (o.horns) p += ihorn(o.horns, dk, lt);
  p += `<ellipse cx="100" cy="${cy}" rx="${rx}" ry="${ry}" fill="${base}"/>`;
  p += `<path d="M${100 - rx * 0.62} ${cy + ry * 0.45} Q100 ${cy + ry + 20} ${100 + rx * 0.62} ${cy + ry * 0.45} Z" fill="${base}"/>`;
  p += `<ellipse cx="100" cy="${cy - 8}" rx="${rx * 0.88}" ry="${ry * 0.5}" fill="${lt}" opacity=".16"/>`;
  p += `<ellipse cx="100" cy="${cy + 28}" rx="${rx * 0.5}" ry="18" fill="${dk}" opacity=".2"/>`;
  if (o.tint) p += `<ellipse cx="100" cy="${cy}" rx="${rx}" ry="${ry}" fill="${o.tint}" opacity=".18"/>`;
  if (o.cracks) p += magmaCrack(glow);
  p += infEyes(o.eyes, dk, glow);
  p += `<path d="M96 122 q4 5 8 0" stroke="${dk}" stroke-width="2" fill="none" opacity=".55"/>`;
  p += infMouth(o.mouth, dk);
  if (o.brand) p += brandSigil(100, 84, glow);
  return p;
}

// ── CONSTRUCTS ────────────────────────────────────────────────────────────────
// Riveted machine faces (Prompt-2 tribe). Distinct per card via head silhouette,
// eye array (bolts / visor / cyclops / dual / wonky), antenna, cog, grille and shield.
const CKS: Record<string, Skin> = {
  steel: { base: '#8a97a0', dark: '#5a656c', light: '#b9c3ca' },
  iron: { base: '#7f8c8d', dark: '#55605f', light: '#a6b0b0' },
  bronze: { base: '#b0894f', dark: '#7c5f33', light: '#d6b57e' },
  rust: { base: '#9a6748', dark: '#6a4530', light: '#c28e69' },
};
const CON_SHAPE: Record<string, [number, number, number]> = {
  sm: [44, 42, 112], round: [52, 50, 112], wide: [60, 48, 112], big: [60, 58, 112],
};
function conRivets(rx: number, ry: number, cy: number, col: string): string {
  let s = '';
  ([[100 - rx + 8, cy - ry + 8], [100 + rx - 8, cy - ry + 8], [100 - rx + 8, cy + ry - 8], [100 + rx - 8, cy + ry - 8]] as number[][]).forEach(([x, y]) => (s += `<circle cx="${x}" cy="${y}" r="4.5" fill="${col}"/><circle cx="${x}" cy="${y}" r="1.8" fill="#2b3236"/>`));
  return s;
}
function conCog(cx: number, cy: number, r: number, col: string, dk: string): string {
  let s = '';
  for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2, x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r; s += `<rect x="${(x - 3).toFixed(1)}" y="${(y - 3).toFixed(1)}" width="6" height="6" fill="${col}" transform="rotate(${(a * 180 / Math.PI).toFixed(1)} ${x.toFixed(1)} ${y.toFixed(1)})"/>`; }
  return s + `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${col}"/><circle cx="${cx}" cy="${cy}" r="${r * 0.42}" fill="${dk}"/>`;
}
function conAntenna(style: string, col: string, glow: string): string {
  if (style === 'rod') return `<line x1="100" y1="58" x2="100" y2="30" stroke="${col}" stroke-width="4"/><circle cx="100" cy="27" r="10" fill="${glow}" opacity=".3"/><circle cx="100" cy="27" r="6" fill="${glow}"/>`;
  if (style === 'twin') return `<line x1="82" y1="58" x2="74" y2="34" stroke="${col}" stroke-width="3.5"/><circle cx="73" cy="31" r="4.5" fill="${glow}"/><line x1="118" y1="58" x2="126" y2="34" stroke="${col}" stroke-width="3.5"/><circle cx="127" cy="31" r="4.5" fill="${glow}"/>`;
  if (style === 'dish') return `<line x1="100" y1="58" x2="100" y2="40" stroke="${col}" stroke-width="4"/><g transform="rotate(-18 100 40)"><path d="M82 40 A18 11 0 0 1 118 40 Z" fill="${shade(col, 0.15)}"/><line x1="100" y1="40" x2="100" y2="28" stroke="${col}" stroke-width="2.5"/><circle cx="100" cy="27" r="3" fill="${glow}"/></g>`;
  return '';
}
function conEyes(t: string, dk: string, glow: string): string {
  const ey = 104; let s = '';
  if (t === 'visor') return `<rect x="66" y="96" width="68" height="18" rx="9" fill="#181d20"/><rect x="72" y="100" width="56" height="10" rx="5" fill="${glow}" opacity=".9"/><rect x="72" y="100" width="56" height="4" rx="2" fill="#fff" opacity=".4"/>`;
  if (t === 'cyclops') return `<circle cx="100" cy="${ey}" r="24" fill="${glow}" opacity=".18"/><circle cx="100" cy="${ey}" r="20" fill="#181d20"/><circle cx="100" cy="${ey}" r="14" fill="${glow}"/><circle cx="100" cy="${ey}" r="6" fill="#fff" opacity=".85"/>`;
  if (t === 'dual') { [80, 120].forEach((x) => (s += `<rect x="${x - 13}" y="${ey - 11}" width="26" height="22" rx="4" fill="#181d20"/><rect x="${x - 8}" y="${ey - 6}" width="16" height="12" rx="2" fill="${glow}"/>`)); return s; }
  if (t === 'wonky') return `<circle cx="84" cy="101" r="14" fill="${dk}"/><circle cx="84" cy="101" r="10" fill="#181d20"/><circle cx="84" cy="101" r="5" fill="${glow}"/><circle cx="119" cy="108" r="10" fill="${dk}"/><circle cx="119" cy="108" r="7" fill="#181d20"/><circle cx="119" cy="108" r="3.5" fill="${glow}"/>`;
  [80, 120].forEach((x) => (s += `<circle cx="${x}" cy="${ey}" r="15" fill="${dk}"/><circle cx="${x}" cy="${ey}" r="11" fill="#181d20"/><circle cx="${x}" cy="${ey}" r="6" fill="${glow}"/><circle cx="${x - 2}" cy="${ey - 2}" r="2" fill="#fff" opacity=".8"/>`)); // bolts
  return s;
}
function conMouth(t: string, dk: string, lt: string): string {
  if (t === 'grille') { let s = `<rect x="76" y="128" width="48" height="22" rx="3" fill="#20262a"/>`; for (let i = -2; i <= 2; i++) s += `<rect x="${100 + i * 10 - 3}" y="130" width="6" height="18" rx="1.5" fill="${lt}" opacity=".55"/>`; return s; }
  if (t === 'grid') { let s = `<rect x="80" y="130" width="40" height="16" rx="2" fill="#20262a"/>`; for (let i = 1; i < 4; i++) s += `<line x1="${80 + i * 10}" y1="130" x2="${80 + i * 10}" y2="146" stroke="${lt}" stroke-width="1.5" opacity=".7"/>`; return s + `<line x1="80" y1="138" x2="120" y2="138" stroke="${lt}" stroke-width="1.5" opacity=".7"/>`; }
  return `<rect x="84" y="135" width="32" height="8" rx="4" fill="#20262a"/><rect x="86" y="136" width="28" height="2" rx="1" fill="${lt}" opacity=".4"/>`; // slot
}
function con(o: Opts): string {
  const sk = CKS[o.skin], base = sk.base, dk = sk.dark, lt = sk.light, glow = o.glow || '#7fe0ff';
  const [rx, ry, cy] = CON_SHAPE[o.shape || 'round'];
  let p = '';
  if (o.antenna) p += conAntenna(o.antenna, dk, glow);
  if (o.cog) p += conCog(100, cy - ry - 1, 15, dk, shade(base, -0.3));
  if (o.head === 'box') p += `<rect x="${100 - rx}" y="${cy - ry}" width="${rx * 2}" height="${ry * 2}" rx="14" fill="${base}"/><rect x="${100 - rx}" y="${cy - ry}" width="${rx * 2}" height="${ry * 2}" rx="14" fill="none" stroke="${dk}" stroke-width="3"/>`;
  else p += `<path d="M${100 - rx} ${cy + ry - 6} L${100 - rx} ${cy - ry * 0.2} Q${100 - rx} ${cy - ry} 100 ${cy - ry} Q${100 + rx} ${cy - ry} ${100 + rx} ${cy - ry * 0.2} L${100 + rx} ${cy + ry - 6} Q${100 + rx} ${cy + ry} ${100 + rx - 8} ${cy + ry} L${100 - rx + 8} ${cy + ry} Q${100 - rx} ${cy + ry} ${100 - rx} ${cy + ry - 6} Z" fill="${base}"/>`;
  p += `<rect x="${100 - rx + 7}" y="${cy - ry + 6}" width="${rx * 2 - 14}" height="9" rx="4" fill="${lt}" opacity=".3"/>`;
  if (o.tint) p += `<rect x="${100 - rx}" y="${cy - ry}" width="${rx * 2}" height="${ry * 2}" rx="14" fill="${o.tint}" opacity=".16"/>`;
  if (o.rivets) p += conRivets(rx, ry, cy, dk);
  p += conEyes(o.eyes, dk, glow);
  p += conMouth(o.mouth, dk, lt);
  p += `<line x1="${100 - rx + 12}" y1="${cy + ry * 0.6}" x2="${100 + rx - 12}" y2="${cy + ry * 0.6}" stroke="${dk}" stroke-width="2" opacity=".35"/>`;
  if (o.shield) p += `<circle cx="100" cy="112" r="76" fill="#d8eefc" opacity=".08"/><circle cx="100" cy="112" r="76" fill="none" stroke="#d8eefc" stroke-width="3" opacity=".4"/>`;
  return p;
}

// ── TUSKERS ─────────────────────────────────────────────────────────────────
// Boar raiders hoarding gems (Round-6 tribe, clean-room §0: original geometry). Distinct
// per card via tusks / eyes / snout + gem·helm·hoard accessories and a tan/gold skin ramp.
const TKS: Record<string, Skin> = {
  hide: { base: '#b9770e', dark: '#8a5606', light: '#d9a03e' },
  boar: { base: '#a86a2e', dark: '#774819', light: '#cf9450' },
  bristle: { base: '#8a6540', dark: '#5c422a', light: '#b58a5f' },
  gilt: { base: '#c69a3c', dark: '#8f6b1f', light: '#e6c65e' },
};
const TK_SHAPE: Record<string, [number, number, number]> = {
  sm: [56, 52, 116], round: [65, 58, 114], wide: [73, 55, 116], tall: [58, 64, 112], big: [76, 66, 114],
};
function gemShape(x: number, y: number, r: number, col: string, lt: string): string {
  return `<g><path d="M${x} ${y - r} L${x + r} ${y} L${x} ${y + r} L${x - r} ${y} Z" fill="${col}"/><path d="M${x} ${y - r} L${x + r} ${y} L${x} ${y} Z" fill="${lt}"/><path d="M${x} ${y - r} L${x - r} ${y} L${x} ${y} Z" fill="${shade(col, 0.2)}"/><circle cx="${x - r * 0.3}" cy="${y - r * 0.3}" r="1.5" fill="#fff"/></g>`;
}
function tuskPair(style: string, col: string): string {
  if (style === 'big') return `<path d="M78 140 q-14 26 -26 24 q10 6 20 2 q10 -6 12 -20 z" fill="${col}"/><path d="M122 140 q14 26 26 24 q-10 6 -20 2 q-10 -6 -12 -20 z" fill="${col}"/>`;
  if (style === 'curved') return `<path d="M80 142 q-16 18 -10 34 q8 -4 12 -14 q4 -12 4 -20 z" fill="${col}"/><path d="M120 142 q16 18 10 34 q-8 -4 -12 -14 q-4 -12 -4 -20 z" fill="${col}"/>`;
  return `<path d="M82 142 q-8 20 -16 22 q8 2 14 -4 q5 -7 6 -18 z" fill="${col}"/><path d="M118 142 q8 20 16 22 q-8 2 -14 -4 q-5 -7 -6 -18 z" fill="${col}"/>`;
}
function tskEyes(t: string, dk: string): string {
  const ey = 108; let s = '';
  if (t === 'greedy') { [82, 118].forEach((x) => (s += `<circle cx="${x}" cy="${ey}" r="11" fill="#fff" stroke="${dk}" stroke-width="2"/><path d="M${x} ${ey - 5} L${x + 3} ${ey} L${x} ${ey + 5} L${x - 3} ${ey} Z" fill="#e8c45a"/>`)); return s; }
  if (t === 'fierce') { [82, 118].forEach((x) => (s += `<circle cx="${x}" cy="${ey}" r="10" fill="#fff" stroke="${dk}" stroke-width="2"/><circle cx="${x}" cy="${ey + 1}" r="5" fill="#2a1c0c"/>`)); return s + `<path d="M68 96 L94 104" stroke="${dk}" stroke-width="4" stroke-linecap="round"/><path d="M132 96 L106 104" stroke="${dk}" stroke-width="4" stroke-linecap="round"/>`; }
  [82, 118].forEach((x) => (s += `<circle cx="${x}" cy="${ey}" r="9" fill="#fff" stroke="${dk}" stroke-width="2"/><circle cx="${x}" cy="${ey + 1}" r="5" fill="#2a1c0c"/><circle cx="${x - 2}" cy="${ey - 2}" r="2" fill="#fff"/>`));
  return s;
}
function tsk(o: Opts): string {
  const sk = TKS[o.skin], base = sk.base, dk = sk.dark, lt = sk.light;
  const [rx, ry, cy] = TK_SHAPE[o.shape || 'round'];
  let p = '';
  p += `<path d="M${100 - rx * 0.7} ${cy - ry * 0.5} q-22 -10 -30 6 q16 0 26 12 z" fill="${dk}"/><path d="M${100 + rx * 0.7} ${cy - ry * 0.5} q22 -10 30 6 q-16 0 -26 12 z" fill="${dk}"/>`;
  if (o.helm) p += `<path d="M${100 - rx * 0.82} ${cy - ry + 8} Q100 ${cy - ry - 26} ${100 + rx * 0.82} ${cy - ry + 8} Q100 ${cy - ry - 6} ${100 - rx * 0.82} ${cy - ry + 8} Z" fill="${shade(base, -0.34)}"/>`;
  p += `<ellipse cx="100" cy="${cy}" rx="${rx}" ry="${ry}" fill="${base}"/>`;
  p += `<ellipse cx="100" cy="${cy + 30}" rx="${rx * 0.6}" ry="20" fill="${dk}" opacity=".2"/>`;
  if (o.tint) p += `<ellipse cx="100" cy="${cy}" rx="${rx}" ry="${ry}" fill="${o.tint}" opacity=".16"/>`;
  p += `<ellipse cx="100" cy="${cy + 26}" rx="24" ry="17" fill="${lt}"/><ellipse cx="92" cy="${cy + 26}" rx="4" ry="6" fill="${dk}"/><ellipse cx="108" cy="${cy + 26}" rx="4" ry="6" fill="${dk}"/>`;
  p += tuskPair(o.tusk || 'small', '#f3efdc');
  p += tskEyes(o.eyes, dk);
  if (o.gem) p += gemShape(100, cy - ry + (o.helm ? 0 : -6), 9, o.gemCol || '#3fa9c9', '#bfe9f5');
  if (o.hoard) p += gemShape(52, 150, 6, '#c94f6a', '#f0b6c4') + gemShape(148, 150, 6, '#4fb36a', '#b6f0c9');
  return p;
}

// ── PRIMORDIALS ───────────────────────────────────────────────────────────────
// Elemental storm-spirits (Round-6 tribe). Distinct via crown (bolt/cloud) / orbit ring /
// cracks / eyes / mouth and a teal·storm·cinder skin ramp; eyes glow like charged cores.
const PKS: Record<string, Skin> = {
  spark: { base: '#16a085', dark: '#0e6b59', light: '#4fd0b6' },
  storm: { base: '#2c7fb8', dark: '#1b5580', light: '#5fb0e0' },
  cinder: { base: '#d98c2b', dark: '#9c5f16', light: '#f0b45a' },
  gale: { base: '#3fae9a', dark: '#25786a', light: '#79d8c6' },
};
const PR_SHAPE: Record<string, [number, number, number]> = {
  sm: [54, 52, 114], round: [62, 58, 113], wide: [70, 55, 114], tall: [56, 64, 111], big: [72, 66, 113],
};
function bolt(x: number, y: number, col: string): string {
  return `<path d="M${x} ${y} l-8 16 l6 0 l-6 16 l16 -22 l-7 0 l7 -10 z" fill="${col}"/>`;
}
function prm(o: Opts): string {
  const sk = PKS[o.skin], base = sk.base, dk = sk.dark, lt = sk.light, glow = o.glow || '#aef5e4';
  const [rx, ry, cy] = PR_SHAPE[o.shape || 'round'];
  let p = '';
  if (o.ring) p += `<ellipse cx="100" cy="${cy}" rx="${rx + 16}" ry="${ry * 0.5}" fill="none" stroke="${lt}" stroke-width="3" opacity=".5" transform="rotate(-18 100 ${cy})"/>`;
  if (o.crown === 'bolt') p += bolt(92, cy - ry - 16, glow) + bolt(112, cy - ry - 12, lt);
  else if (o.crown === 'cloud') p += `<g fill="${lt}" opacity=".9"><circle cx="82" cy="${cy - ry}" r="14"/><circle cx="104" cy="${cy - ry - 6}" r="17"/><circle cx="124" cy="${cy - ry}" r="13"/></g>`;
  p += `<ellipse cx="100" cy="${cy}" rx="${rx}" ry="${ry}" fill="${base}"/>`;
  p += `<ellipse cx="100" cy="${cy - 6}" rx="${rx * 0.8}" ry="${ry * 0.6}" fill="${lt}" opacity=".28"/>`;
  if (o.tint) p += `<ellipse cx="100" cy="${cy}" rx="${rx}" ry="${ry}" fill="${o.tint}" opacity=".18"/>`;
  if (o.cracks) p += `<path d="M84 96 l-10 18 l6 6 M120 100 l8 14" stroke="${glow}" stroke-width="2.5" fill="none" opacity=".8"/>`;
  const ey = 106;
  [80, 120].forEach((x) => (p += `<circle cx="${x}" cy="${ey}" r="15" fill="${glow}" opacity=".3"/><circle cx="${x}" cy="${ey}" r="8" fill="${glow}"/><circle cx="${x}" cy="${ey - 2}" r="3" fill="#fff"/>`));
  if (o.eyes === 'fierce') p += `<path d="M64 92 L92 100" stroke="${dk}" stroke-width="4" stroke-linecap="round"/><path d="M136 92 L108 100" stroke="${dk}" stroke-width="4" stroke-linecap="round"/>`;
  if (o.mouth === 'open') p += `<ellipse cx="100" cy="140" rx="10" ry="8" fill="${dk}"/>`;
  else p += `<path d="M86 138 q14 10 28 0" stroke="${dk}" stroke-width="3" fill="none" stroke-linecap="round"/>`;
  return p;
}

// ── SIRENS ────────────────────────────────────────────────────────────────────
// Deep-sea enchantresses (Round-6 tribe). Distinct via crown (coral/fin) / anglerfish lure /
// almond eyes / poison droplet / song arcs and a blue·venom·pearl·coral skin ramp.
const SKS: Record<string, Skin> = {
  abyss: { base: '#2980b9', dark: '#1a5580', light: '#5fb0e0', pup: '#0f3a55' },
  venom: { base: '#3fa46a', dark: '#256a44', light: '#79d0a0', pup: '#123a24' },
  pearl: { base: '#6a7fc0', dark: '#455a95', light: '#9fb0e6', pup: '#28345e' },
  coral: { base: '#c96a8a', dark: '#8f4460', light: '#e6a0b6', pup: '#5a2438' },
};
const SR_SHAPE: Record<string, [number, number, number]> = {
  sm: [52, 52, 114], round: [58, 56, 113], wide: [66, 52, 114], tall: [54, 62, 111], big: [66, 62, 113],
};
function sirenTendril(cx: number, cy: number, d: number, col: string): string {
  return `<path d="M${cx} ${cy} q${d * 30} 10 ${d * 20} 44 q${d * -4} -20 ${d * -14} -28 q${d * 10} 8 ${d * 8} 30" fill="none" stroke="${col}" stroke-width="5" stroke-linecap="round" opacity=".8"/>`;
}
function lureLight(y: number, stalkCol: string, glow: string): string {
  return `<path d="M100 ${y + 22} Q100 ${y} 100 ${y}" fill="none" stroke="${stalkCol}" stroke-width="3"/><circle cx="100" cy="${y}" r="9" fill="${glow}" opacity=".4"/><circle cx="100" cy="${y}" r="5" fill="${glow}"/>`;
}
function srn(o: Opts): string {
  const sk = SKS[o.skin], base = sk.base, dk = sk.dark, lt = sk.light, pup = sk.pup as string, glow = o.glow || '#bff0e0';
  const [rx, ry, cy] = SR_SHAPE[o.shape || 'round'];
  let p = '';
  p += sirenTendril(66, cy, -1, o.hairCol || dk) + sirenTendril(134, cy, 1, o.hairCol || dk);
  if (o.crown === 'coral') p += coralCrown(100, cy - ry + 2, { base, dark: dk, light: lt });
  else if (o.crown === 'fin') p += `<path d="M74 ${cy - ry + 6} l-6 -18 l14 6 l2 -18 l12 14 l8 -16 l6 18 z" fill="${dk}"/>`;
  if (o.lure) p += lureLight(cy - ry - 16, dk, glow);
  p += `<ellipse cx="100" cy="${cy}" rx="${rx}" ry="${ry}" fill="${base}"/>`;
  p += `<ellipse cx="100" cy="${cy + 18}" rx="26" ry="18" fill="${lt}" opacity=".35"/>`;
  if (o.tint) p += `<ellipse cx="100" cy="${cy}" rx="${rx}" ry="${ry}" fill="${o.tint}" opacity=".16"/>`;
  p += `<path d="M${100 - rx} ${cy} q-16 -4 -20 10 q12 0 20 6 z" fill="${dk}"/><path d="M${100 + rx} ${cy} q16 -4 20 10 q-12 0 -20 6 z" fill="${dk}"/>`;
  const ey = 106;
  [82, 118].forEach((x) => (p += `<path d="M${x - 13} ${ey} q13 -12 26 0 q-13 12 -26 0 z" fill="#fff" stroke="${dk}" stroke-width="1.5"/><circle cx="${x}" cy="${ey}" r="6" fill="${pup}"/><circle cx="${x - 2}" cy="${ey - 2}" r="2" fill="#fff"/>`));
  if (o.lashes) p += `<path d="M70 100 q12 -8 26 -3" stroke="${dk}" stroke-width="2" fill="none"/><path d="M104 97 q12 -5 26 3" stroke="${dk}" stroke-width="2" fill="none"/>`;
  if (o.mouth === 'sing') p += `<ellipse cx="100" cy="142" rx="8" ry="11" fill="${dk}"/>`;
  else if (o.mouth === 'fang') p += `<path d="M88 140 q12 8 24 0" stroke="${dk}" stroke-width="3" fill="none" stroke-linecap="round"/><path d="M94 141 l3 7 l3 -7z" fill="#fff"/><path d="M106 141 l3 7 l3 -7z" fill="#fff"/>`;
  else p += `<path d="M88 140 q12 9 24 0" stroke="${dk}" stroke-width="3" fill="none" stroke-linecap="round"/>`;
  if (o.poison) p += droplet(100, 152, '#9bd06a');
  if (o.sing) p += soundArcs(150, 1, lt);
  return p;
}

// ── CORSAIRS ──────────────────────────────────────────────────────────────────
// Pirate raiders (Round-6 tribe). Distinct via hat (tricorne/bandana) / eyepatch / beard /
// scar / shield / reborn-swirl and a slate·navy·tan skin ramp.
const COS: Record<string, Skin> = {
  brine: { base: '#5a6b7a', dark: '#3a4650', light: '#8494a2' },
  navy: { base: '#3e5068', dark: '#283445', light: '#697d97' },
  tan: { base: '#b08a5a', dark: '#7c5f38', light: '#d4b483' },
  ash: { base: '#6d6a72', dark: '#47454d', light: '#9a97a2' },
};
const CO_SHAPE: Record<string, [number, number, number]> = {
  sm: [54, 52, 116], round: [62, 58, 114], wide: [70, 54, 115], tall: [56, 64, 112], big: [72, 66, 114],
};
function tricorne(cx: number, cy: number, col: string, lt: string): string {
  return `<path d="M${cx - 46} ${cy} Q${cx} ${cy - 44} ${cx + 46} ${cy} Q${cx + 30} ${cy - 12} ${cx} ${cy - 14} Q${cx - 30} ${cy - 12} ${cx - 46} ${cy} Z" fill="${col}"/><path d="M${cx - 46} ${cy} Q${cx} ${cy - 8} ${cx + 46} ${cy}" fill="none" stroke="${lt}" stroke-width="3"/><path d="M${cx} ${cy - 32} l-6 13 l12 0 z" fill="${lt}"/>`;
}
function cor(o: Opts): string {
  const sk = COS[o.skin], base = sk.base, dk = sk.dark, lt = sk.light;
  const [rx, ry, cy] = CO_SHAPE[o.shape || 'round'];
  let p = '';
  p += `<ellipse cx="100" cy="${cy}" rx="${rx}" ry="${ry}" fill="${base}"/>`;
  p += `<ellipse cx="100" cy="${cy + 30}" rx="${rx * 0.6}" ry="20" fill="${dk}" opacity=".2"/>`;
  if (o.tint) p += `<ellipse cx="100" cy="${cy}" rx="${rx}" ry="${ry}" fill="${o.tint}" opacity=".16"/>`;
  if (o.beard) p += `<path d="M${100 - rx * 0.72} ${cy + 4} Q100 ${cy + ry + 20} ${100 + rx * 0.72} ${cy + 4} Q100 ${cy + ry - 6} ${100 - rx * 0.72} ${cy + 4} Z" fill="${dk}"/>`;
  const ey = 108;
  if (o.eyepatch) {
    p += `<circle cx="118" cy="${ey}" r="9" fill="#fff" stroke="${dk}" stroke-width="2"/><circle cx="118" cy="${ey}" r="5" fill="#2a2230"/>`;
    p += `<rect x="74" y="${ey - 9}" width="18" height="18" rx="4" fill="#141018"/><line x1="66" y1="${ey - 12}" x2="130" y2="${ey - 16}" stroke="#141018" stroke-width="3"/>`;
  } else {
    [82, 118].forEach((x) => (p += `<circle cx="${x}" cy="${ey}" r="9" fill="#fff" stroke="${dk}" stroke-width="2"/><circle cx="${x}" cy="${ey + 1}" r="5" fill="#2a2230"/><circle cx="${x - 2}" cy="${ey - 2}" r="2" fill="#fff"/>`));
    if (o.eyes === 'fierce') p += `<path d="M68 98 L94 105" stroke="${dk}" stroke-width="4" stroke-linecap="round"/><path d="M132 98 L106 105" stroke="${dk}" stroke-width="4" stroke-linecap="round"/>`;
  }
  if (o.mouth === 'grin') p += `<path d="M84 138 Q100 152 116 138 Z" fill="#2a2230"/><rect x="94" y="139" width="6" height="6" fill="#fff"/>`;
  else p += `<path d="M86 140 q14 8 28 0" stroke="${dk}" stroke-width="3" fill="none" stroke-linecap="round"/>`;
  if (o.hat === 'tricorne') p += tricorne(100, cy - ry + 16, dk, lt);
  else if (o.hat === 'bandana') p += `<path d="M${100 - rx} ${cy - ry + 20} Q100 ${cy - ry - 6} ${100 + rx} ${cy - ry + 20} L${100 + rx} ${cy - ry + 26} Q100 ${cy - ry + 8} ${100 - rx} ${cy - ry + 26} Z" fill="${o.bandanaCol || '#a1232b'}"/><path d="M${100 - rx} ${cy - ry + 24} q-14 2 -18 16 q10 -2 16 2 z" fill="${o.bandanaCol || '#a1232b'}"/>`;
  if (o.scar) p += scar(62, 82);
  if (o.shield) p += `<circle cx="100" cy="112" r="76" fill="#d8eefc" opacity=".07"/><circle cx="100" cy="112" r="76" fill="none" stroke="#d8eefc" stroke-width="3" opacity=".4"/>`;
  if (o.reborn) p += rebornSwirl(150, 150, lt);
  return p;
}

// ── per-card recipes (real slice card ids) ────────────────────────────────────
const RECIPES: Record<string, () => string> = {
  // WILDKIN — swarm
  wildkin_brambleling: () => wk({ shape: 'sm', skin: 'leaf', ears: 'leaf', top: 'sprout', eyes: 'round', mouth: 'fang' }),
  wildkin_thornpup: () => wk({ shape: 'sm', skin: 'fern', ears: 'leafShort', eyes: 'sleepy', mouth: 'smile' }),
  wildkin_gorehide: () => wk({ shape: 'wide', skin: 'bramble', ears: 'tusk', eyes: 'fierce', mouth: 'grin' }) + scar(70, 86),
  wildkin_thornwarden: () => wk({ shape: 'wide', skin: 'moss', ears: 'none', top: 'helmet', eyes: 'fierce', mouth: 'smile' }),
  wildkin_motherthorn: () => wk({ shape: 'round', skin: 'fern', ears: 'leaf', top: 'flower', eyes: 'soft', mouth: 'smile' }),
  wildkin_packmother: () => wk({ shape: 'round', skin: 'moss', ears: 'bunny', eyes: 'fierce', mouth: 'fang' }) + warpaint('#caa37a') + boneMark(132, 128, '#e8d9c0'),
  wildkin_brackentide: () => wk({ shape: 'round', skin: 'leaf', ears: 'leafTeal', top: 'sprout', eyes: 'round', mouth: 'smile', tint: '#2fa78f' }) + droplet(100, 150, '#7fe0d0'),
  wildkin_grovecaller: () => glowMotes('#bdf59a') + wk({ shape: 'tall', skin: 'fern', ears: 'antler', eyes: 'glow', mouth: 'smile' }),
  wildkin_bonepiper: () => wk({ shape: 'tall', skin: 'bramble', ears: 'antler', eyes: 'fierce', mouth: 'open' }) + boneMark(70, 128, '#e8d9c0'),
  wildkin_thornbeast: () => wk({ shape: 'big', skin: 'bramble', ears: 'tuskBig', eyes: 'fierce', mouth: 'grin' }) + scar(66, 84) + scar(120, 90),
  wildkin_grovelord: () => glowMotes('#cdf7a4') + wk({ shape: 'big', skin: 'bramble', ears: 'antler', top: 'crown', eyes: 'glow', mouth: 'grin' }),
  // REVENANTS — deaths
  revenants_cryptling: () => rev({ variant: 'skull', hood: false }) + rebornSwirl(106, 78, '#bda9ee'),
  revenants_wisp: () => wisp({ size: 'sm' }),
  revenants_pallbearer: () => rev({ variant: 'skull' }) + candleFlame(150, 118),
  revenants_gravewing: () => rev({ variant: 'wing' }),
  revenants_tombspawn: () => miniWisps('#b8a9dc') + rev({ variant: 'skull', hood: false, crackHeavy: true }),
  revenants_graverobber: () => rev({ variant: 'skull', sly: true }) + `<circle cx="150" cy="120" r="6" fill="#e8c45a"/><circle cx="148" cy="118" r="2" fill="#fff8e0"/>`,
  revenants_mortarch: () => rev({ variant: 'skull', crown: 'small' }),
  revenants_dirgecaller: () => rev({ variant: 'skull', jaw: 'gaping' }) + soundArcs(150, 1, '#bda9ee') + soundArcs(50, -1, '#bda9ee'),
  revenants_lastrites: () => rev({ variant: 'skull', hood: true }) + soundArcs(150, 1, '#cfc0f0') + rebornSwirl(50, 132, '#bda9ee'),
  revenants_tideclaimer: () => rev({ variant: 'skull', tint: '#2f9a86', glow: '#7fe8d4', finHood: true }),
  revenants_palelich: () => rev({ variant: 'lich', crown: 'tall', pale: true, glow: '#dfeaff' }),
  revenants_boncolossus: () => rev({ variant: 'colossus', horns: true, crackHeavy: true }),
  revenants_ossuarytitan: () => rev({ variant: 'colossus', crackHeavy: true, tint: '#6a5a86' }) + boneMark(150, 128, '#e7def4'),
  revenants_gravemonarch: () => rev({ variant: 'lich', crown: 'tall', horns: true, glow: '#c9b8ee' }),
  revenants_rebornwisp: () => wisp({ skin: '#a7b8e0', glow: '#cfe0ff', size: 'sm' }),
  revenants_rebornwraith: () => rev({ variant: 'wing', glow: '#cfe0ff', tint: '#5b7fd0' }),
  // REEFKIN — battlecries
  reefkin_tidecaller: () => rk({ skin: 'tide', crown: 3, eyes: 'big', mouth: 'smile' }),
  reefkin_spinefish: () => rk({ skin: 'poison', spines: 1, crown: 0, eyes: 'narrow', mouth: 'fang' }) + droplet(100, 150, '#9bd06a'),
  reefkin_pearlguard: () => rk({ skin: 'tide', crown: 3, eyes: 'soft', mouth: 'smile', pearl: 1, shield: 1 }),
  reefkin_brineling: () => rk({ skin: 'poison', shape: 'sm', crown: 2, eyes: 'big', mouth: 'smile' }) + bubble(128, 140),
  reefkin_coralwarden: () => rk({ skin: 'deep', crown: 'coral', eyes: 'big', mouth: 'smile', shield: 1 }),
  reefkin_deepsinger: () => rk({ skin: 'deep', crown: 3, eyes: 'big', mouth: 'open' }) + soundArcs(152, 1, '#5cbed6'),
  reefkin_chorustide: () => rk({ skin: 'deep', fins: 'big', crown: 5, eyes: 'big', mouth: 'open' }) + noteMotes('#9fe0ee'),
  reefkin_echochoir: () => echoOutline(RKS.deep) + rk({ skin: 'deep', fins: 'frilled', crown: 4, eyes: 'big', mouth: 'open' }),
  reefkin_reefmourner: () => rk({ skin: 'tide', crown: 3, eyes: 'soft', mouth: 'smile', tint: '#8a5cb0' }) + boneMark(126, 130, '#e7def4'),
  reefkin_tideprophet: () => rk({ skin: 'deep', crown: 'coral', eyes: 'wise', mouth: 'smile' }) + whiskers('#1b6c85'),
  reefkin_leviathan: () => rk({ skin: 'deep', shape: 'big', fins: 'big', crown: 5, eyes: 'narrow', mouth: 'fang', shield: 1 }) + scales('#1b6c85'),
  reefkin_tidebinder: () => rk({ skin: 'tide', crown: 4, eyes: 'wise', mouth: 'open' }) + noteMotes('#9fe0ee') + droplet(100, 152, '#7fe0d0'),
  // INFERNALS — sacrifice / risk
  infernals_cinderling: () => glowMotes('#ff9a3c') + inf({ shape: 'sm', skin: 'ember', horns: 'nub', eyes: 'round', mouth: 'fang' }),
  infernals_gravebrand: () => inf({ shape: 'round', skin: 'ash', horns: 'swept', eyes: 'slit', mouth: 'grin', brand: 1 }),
  infernals_hollowpriest: () => inf({ shape: 'tall', skin: 'coal', cowl: 1, eyes: 'hollow', mouth: 'smirk' }),
  infernals_pyrewalker: () => glowMotes('#ffb14a') + inf({ shape: 'tall', skin: 'ember', horns: 'tall', eyes: 'blaze', mouth: 'grin', cracks: 1 }),
  infernals_bloodcaller: () => inf({ shape: 'round', skin: 'blood', horns: 'ram', eyes: 'slit', mouth: 'fang' }) + droplet(78, 150, '#e0454a') + droplet(122, 150, '#e0454a'),
  infernals_dreadmaw: () => inf({ shape: 'big', skin: 'coal', horns: 'swept', eyes: 'hollow', mouth: 'maw', cracks: 1 }),
  infernals_abysslord: () => glowMotes('#ff8a3c') + inf({ shape: 'big', skin: 'blood', horns: 'tall', eyes: 'blaze', mouth: 'maw', wing: 1, cracks: 1 }),
  infernals_carrionsovereign: () => glowMotes('#c0392b') + inf({ shape: 'big', skin: 'ash', horns: 'ram', eyes: 'hollow', mouth: 'maw', wing: 1, cracks: 1, brand: 1 }) + droplet(72, 150, '#8a2a2e') + droplet(128, 150, '#8a2a2e'),
  infernals_gorgemaw: () => inf({ shape: 'round', skin: 'coal', horns: 'nub', eyes: 'round', mouth: 'maw', cracks: 1, brand: 1 }) + droplet(150, 150, '#ff8a3c'),
  infernals_cindermarshal: () => glowMotes('#ffb14a') + inf({ shape: 'tall', skin: 'ember', horns: 'tall', eyes: 'blaze', mouth: 'grin', wing: 1, brand: 1 }),
  // CONSTRUCTS — assembly / redeploy
  constructs_scrapling: () => con({ shape: 'sm', skin: 'rust', head: 'box', eyes: 'wonky', mouth: 'slot', antenna: 'twin' }),
  constructs_sentinel: () => con({ shape: 'big', skin: 'steel', head: 'box', eyes: 'visor', mouth: 'grille', rivets: 1 }),
  constructs_cogling: () => con({ shape: 'sm', skin: 'bronze', head: 'dome', eyes: 'bolts', mouth: 'slot', cog: 1 }),
  constructs_bulwark: () => con({ shape: 'wide', skin: 'iron', head: 'box', eyes: 'dual', mouth: 'grille', rivets: 1, shield: 1 }),
  constructs_reclaimer: () => con({ shape: 'round', skin: 'bronze', head: 'dome', eyes: 'bolts', mouth: 'grid', antenna: 'dish' }),
  constructs_shielddrone: () => con({ shape: 'sm', skin: 'steel', head: 'dome', eyes: 'cyclops', mouth: 'slot', antenna: 'rod', shield: 1 }),
  constructs_foundry: () => con({ shape: 'big', skin: 'rust', head: 'box', eyes: 'visor', mouth: 'grille', cog: 1, rivets: 1 }),
  constructs_titanforge: () => con({ shape: 'big', skin: 'steel', head: 'box', eyes: 'dual', mouth: 'grille', cog: 1, rivets: 1, antenna: 'twin' }),
  constructs_nullforge: () => glowMotes('#9fb4c9') + con({ shape: 'wide', skin: 'iron', head: 'dome', eyes: 'cyclops', mouth: 'grid', antenna: 'dish', cog: 1 }),
  constructs_aegisprime: () => glowMotes('#d8eefc') + con({ shape: 'big', skin: 'steel', head: 'box', eyes: 'visor', mouth: 'grille', rivets: 1, shield: 1, antenna: 'dish', cog: 1 }),
  // TUSKERS — spoils / exponential doubler
  tuskers_gemsnout: () => tsk({ shape: 'sm', skin: 'boar', tusk: 'small', eyes: 'greedy', gem: 1, gemCol: '#4fb36a' }),
  tuskers_tuskhoarder: () => tsk({ shape: 'round', skin: 'hide', tusk: 'small', eyes: 'greedy', gem: 1, hoard: 1 }),
  tuskers_grubtusk: () => tsk({ shape: 'wide', skin: 'bristle', tusk: 'curved', eyes: 'plain', helm: 1 }),
  tuskers_ivorytusk: () => tsk({ shape: 'round', skin: 'gilt', tusk: 'big', eyes: 'greedy', gem: 1, gemCol: '#c94f6a' }),
  tuskers_goldgrin: () => tsk({ shape: 'round', skin: 'gilt', tusk: 'small', eyes: 'plain', gem: 1, hoard: 1, gemCol: '#e8c45a' }),
  tuskers_warhoard: () => tsk({ shape: 'big', skin: 'boar', tusk: 'big', eyes: 'fierce', helm: 1, gem: 1 }),
  tuskers_ivorylord: () => tsk({ shape: 'tall', skin: 'hide', tusk: 'curved', eyes: 'fierce', helm: 1, gem: 1, gemCol: '#8f5cd0' }),
  tuskers_gemtitan: () => tsk({ shape: 'big', skin: 'gilt', tusk: 'big', eyes: 'fierce', helm: 1, gem: 1, hoard: 1, gemCol: '#3fa9c9' }),
  tuskers_tuskmonger: () => tsk({ shape: 'wide', skin: 'boar', tusk: 'curved', eyes: 'greedy', gem: 1, hoard: 1, gemCol: '#4fb36a' }) + boneMark(150, 150, '#e8d9c0'),
  // decision #39 gem sinks — distinct recipes (clean-room §0: original geometry)
  tuskers_gemwright: () => tsk({ shape: 'wide', skin: 'gilt', tusk: 'small', eyes: 'plain', gem: 1, gemCol: '#e8a13c' }),
  tuskers_facetguard: () => tsk({ shape: 'tall', skin: 'bristle', tusk: 'small', eyes: 'plain', helm: 1, gem: 1, gemCol: '#3fa9c9' }),
  tuskers_oreseeker: () => tsk({ shape: 'sm', skin: 'hide', tusk: 'curved', eyes: 'greedy', gem: 1, hoard: 1, gemCol: '#8f5cd0' }),
  // PRIMORDIALS — elements / cleave
  primordials_sparkling: () => prm({ shape: 'sm', skin: 'spark', crown: 'bolt', mouth: 'smile' }),
  primordials_gustling: () => prm({ shape: 'wide', skin: 'gale', crown: 'cloud', mouth: 'open' }),
  primordials_tideling: () => prm({ shape: 'round', skin: 'storm', ring: 1, mouth: 'smile' }),
  primordials_stormcaller: () => prm({ shape: 'round', skin: 'storm', crown: 'bolt', ring: 1, cracks: 1, mouth: 'open' }),
  primordials_cinderwing: () => prm({ shape: 'wide', skin: 'cinder', crown: 'bolt', cracks: 1, eyes: 'fierce', mouth: 'open', glow: '#ffcf7a' }),
  primordials_tempest: () => prm({ shape: 'tall', skin: 'storm', crown: 'cloud', ring: 1, cracks: 1, eyes: 'fierce', mouth: 'open' }),
  primordials_thunderhead: () => prm({ shape: 'big', skin: 'gale', crown: 'cloud', ring: 1, eyes: 'fierce', mouth: 'open' }),
  primordials_worldspark: () => prm({ shape: 'big', skin: 'spark', crown: 'bolt', ring: 1, cracks: 1, eyes: 'fierce', mouth: 'open', glow: '#d0ffee' }),
  // SIRENS — spellcraft / poison + burst
  sirens_lurefish: () => srn({ shape: 'sm', skin: 'venom', lure: 1, mouth: 'fang', poison: 1 }),
  sirens_reefwitch: () => srn({ shape: 'round', skin: 'abyss', crown: 'coral', mouth: 'smile', lashes: 1 }),
  sirens_sirenling: () => srn({ shape: 'sm', skin: 'pearl', crown: 'fin', mouth: 'sing', sing: 1 }),
  sirens_venomsong: () => srn({ shape: 'round', skin: 'venom', crown: 'fin', mouth: 'fang', poison: 1 }),
  sirens_deepchanter: () => srn({ shape: 'tall', skin: 'abyss', crown: 'coral', mouth: 'sing', sing: 1, lashes: 1 }),
  sirens_tempestsinger: () => srn({ shape: 'wide', skin: 'venom', crown: 'fin', lure: 1, mouth: 'fang', poison: 1 }),
  sirens_abysscantor: () => srn({ shape: 'tall', skin: 'pearl', crown: 'coral', lure: 1, mouth: 'sing', sing: 1, poison: 1 }),
  sirens_leviathansong: () => srn({ shape: 'big', skin: 'abyss', crown: 'coral', lure: 1, mouth: 'fang', poison: 1, sing: 1, tint: '#7a3fae' }),
  sirens_maelstromcantor: () => srn({ shape: 'wide', skin: 'abyss', crown: 'coral', lure: 1, mouth: 'fang', poison: 1, sing: 1 }) + droplet(100, 152, '#9bd06a'),
  // CORSAIRS — tempo / reborn + shields
  corsairs_swab: () => cor({ shape: 'sm', skin: 'tan', hat: 'bandana', mouth: 'smile', reborn: 1 }),
  corsairs_deckhand: () => cor({ shape: 'round', skin: 'brine', hat: 'bandana', bandanaCol: '#c0392b', mouth: 'grin' }),
  corsairs_ironclad: () => cor({ shape: 'wide', skin: 'navy', beard: 1, eyes: 'fierce', mouth: 'smile', shield: 1 }),
  corsairs_pennant: () => cor({ shape: 'tall', skin: 'tan', hat: 'bandana', mouth: 'smile' }),
  corsairs_cutthroat: () => cor({ shape: 'round', skin: 'ash', hat: 'bandana', eyepatch: 1, mouth: 'grin', reborn: 1 }),
  corsairs_stormrider: () => cor({ shape: 'round', skin: 'navy', hat: 'tricorne', mouth: 'smile', shield: 1 }),
  corsairs_reaver: () => cor({ shape: 'tall', skin: 'brine', hat: 'bandana', scar: 1, eyes: 'fierce', mouth: 'grin', reborn: 1 }),
  corsairs_marauder: () => cor({ shape: 'big', skin: 'ash', hat: 'tricorne', beard: 1, eyes: 'fierce', mouth: 'grin', reborn: 1 }),
  corsairs_seaqueen: () => cor({ shape: 'tall', skin: 'navy', hat: 'tricorne', mouth: 'smile', shield: 1, reborn: 1 }),
  corsairs_dreadnought: () => cor({ shape: 'big', skin: 'brine', hat: 'tricorne', beard: 1, eyepatch: 1, mouth: 'grin', scar: 1, reborn: 1 }),
  corsairs_quartermaster: () => cor({ shape: 'round', skin: 'brine', hat: 'tricorne', beard: 1, eyepatch: 1, mouth: 'smile', reborn: 1 }) + droplet(150, 150, '#e8c45a'),
};

// Generic per-tribe fallback for any unit with no specific recipe (e.g. a non-catalog
// combat summon). Slice tribes get a clean baseline face; others a tinted blob.
const GENERIC: Partial<Record<TribeId, () => string>> = {
  wildkin: () => wk({ shape: 'round', skin: 'leaf', ears: 'leaf', eyes: 'round', mouth: 'smile' }),
  revenants: () => rev({ variant: 'skull' }),
  reefkin: () => rk({ skin: 'tide', crown: 3, eyes: 'big', mouth: 'smile' }),
  infernals: () => inf({ shape: 'round', skin: 'ember', horns: 'swept', eyes: 'blaze', mouth: 'fang' }),
  constructs: () => con({ shape: 'round', skin: 'steel', head: 'box', eyes: 'bolts', mouth: 'grille' }),
  tuskers: () => tsk({ shape: 'round', skin: 'hide', tusk: 'small', eyes: 'plain', gem: 1 }),
  primordials: () => prm({ shape: 'round', skin: 'spark', crown: 'bolt', mouth: 'smile' }),
  sirens: () => srn({ shape: 'round', skin: 'abyss', crown: 'coral', mouth: 'smile' }),
  corsairs: () => cor({ shape: 'round', skin: 'brine', hat: 'bandana', mouth: 'smile' }),
};

function genericBlob(tribe: TribeId): string {
  const col = TRIBES[tribe]?.colorHex ?? '#888';
  return `<ellipse cx="100" cy="112" rx="60" ry="56" fill="${col}"/><circle cx="82" cy="104" r="11" fill="#fff"/><circle cx="118" cy="104" r="11" fill="#fff"/><circle cx="82" cy="106" r="6" fill="#1c1c1c"/><circle cx="118" cy="106" r="6" fill="#1c1c1c"/><path d="M84 138 q16 10 32 0" stroke="${shade(col, -0.35)}" stroke-width="3" fill="none" stroke-linecap="round"/>`;
}

/** Inner SVG markup for a card's portrait. Falls back tribe → blob for unknown cards. */
export function cardFace(cardId: string | undefined, tribe: TribeId): string {
  if (cardId && RECIPES[cardId]) return RECIPES[cardId]();
  const g = GENERIC[tribe];
  return g ? g() : genericBlob(tribe);
}

/** True when a card has its own bespoke portrait recipe (not a tribe fallback). Every
 *  catalog unit must — the uniqueness guarantee is enforced by cardArt.test.ts. */
export function hasCardRecipe(cardId: string): boolean {
  return Object.prototype.hasOwnProperty.call(RECIPES, cardId);
}

/** Radial-gradient background for the portrait box, themed to the tribe colour. */
export function portraitBg(tribe: TribeId): string {
  const col = TRIBES[tribe]?.colorHex ?? '#555';
  return `radial-gradient(circle at 50% 34%, ${shade(col, -0.5)}, ${shade(col, -0.74)})`;
}
