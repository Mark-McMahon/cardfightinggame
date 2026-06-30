import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

export const OUT_DIR = join(process.cwd(), 'sim-out');

export function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

export function std(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
}

export function pct(n: number, total: number): string {
  if (total === 0) return '0.0%';
  return `${((100 * n) / total).toFixed(1)}%`;
}

export function bar(fraction: number, width = 20): string {
  const filled = Math.round(Math.max(0, Math.min(1, fraction)) * width);
  return '█'.repeat(filled) + '·'.repeat(width - filled);
}

export function writeJSON(name: string, data: unknown): string {
  mkdirSync(OUT_DIR, { recursive: true });
  const path = join(OUT_DIR, name);
  writeFileSync(path, JSON.stringify(data, null, 2));
  return path;
}

export function writeCSV(name: string, rows: Array<Record<string, string | number>>): string {
  mkdirSync(OUT_DIR, { recursive: true });
  const path = join(OUT_DIR, name);
  if (rows.length === 0) {
    writeFileSync(path, '');
    return path;
  }
  const headers = Object.keys(rows[0]);
  const body = rows.map((r) => headers.map((h) => String(r[h])).join(','));
  writeFileSync(path, [headers.join(','), ...body].join('\n'));
  return path;
}

const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
};
export const color = C;

export function heading(s: string): void {
  console.log(`\n${C.bold}${C.cyan}${s}${C.reset}`);
  console.log(C.dim + '─'.repeat(s.length) + C.reset);
}

/** PASS/FAIL line for a sim metric gate (spec §16.7). */
export function verdict(label: string, pass: boolean, detail: string): void {
  const tag = pass ? `${C.green}PASS${C.reset}` : `${C.red}FAIL${C.reset}`;
  console.log(`  [${tag}] ${C.bold}${label}${C.reset} ${C.dim}—${C.reset} ${detail}`);
}
