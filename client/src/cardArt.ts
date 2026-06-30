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
  revenants_tideclaimer: () => rev({ variant: 'skull', tint: '#2f9a86', glow: '#7fe8d4', finHood: true }),
  revenants_palelich: () => rev({ variant: 'lich', crown: 'tall', pale: true, glow: '#dfeaff' }),
  revenants_boncolossus: () => rev({ variant: 'colossus', horns: true, crackHeavy: true }),
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
};

// Generic per-tribe fallback for any unit with no specific recipe (e.g. a non-catalog
// combat summon). Slice tribes get a clean baseline face; others a tinted blob.
const GENERIC: Partial<Record<TribeId, () => string>> = {
  wildkin: () => wk({ shape: 'round', skin: 'leaf', ears: 'leaf', eyes: 'round', mouth: 'smile' }),
  revenants: () => rev({ variant: 'skull' }),
  reefkin: () => rk({ skin: 'tide', crown: 3, eyes: 'big', mouth: 'smile' }),
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

/** Radial-gradient background for the portrait box, themed to the tribe colour. */
export function portraitBg(tribe: TribeId): string {
  const col = TRIBES[tribe]?.colorHex ?? '#555';
  return `radial-gradient(circle at 50% 34%, ${shade(col, -0.5)}, ${shade(col, -0.74)})`;
}
