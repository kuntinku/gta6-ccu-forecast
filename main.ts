// gta6-twitch-ccu-forecast-01 entry: launch-day Twitch viewer forecast for the Grand Theft Auto VI
// category, hour by hour, as five quantiles per hour. Node 22, standard library only, no network.
//
// The model: past big launches' release-day curves are in the case's `comparables` — for each one
// take its hourly counts, divide each hour by its own hour-1 mean, and take the log. That gives,
// per hour of the UTC day, a distribution of log ratios across comparable launches. The forecast
// for hour h is hour 1's print times exp(median_h + z_tau * s_h), where median_h is that
// distribution's median (the typical shape of a launch day: quiet early hours, an evening peak)
// and s_h its spread, slightly widened with the baseline's random-walk term so the far hours keep
// an honest band. Nothing is tuned on the practice answers: the parameters were picked by
// leave-one-out across the comparables themselves.
//
// Read every <id>.in in the input directory (the grader runs one case per container), write
// <id>.out with exactly 23 rows, hours 2..24 once each, five non-decreasing quantiles in
// [1, 1e9]. Deterministic: no randomness, no clock reads, so the two grading runs match bytes.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
const LEVELS = [0.05, 0.25, 0.5, 0.75, 0.95];
const Z = [-1.645, -0.674, 0, 0.674, 1.645];
/** The comparable spread is scaled a little below one: the raw dispersion across launches
 *  overstates how far one launch day wanders around its own curve. */
const SPREAD = 0.7;
/** A small widening with the square root of hours since hour 1, like the baseline's walk. */
const BASE = 0.03;

function median(values) {
  const s = [...values].sort((a, b) => a - b);
  const n = s.length;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

function pstdev(values) {
  const m = values.reduce((a, b) => a + b, 0) / values.length;
  return Math.sqrt(values.reduce((a, b) => a + (b - m) * (b - m), 0) / values.length);
}

function hourOf(fromIso, dayStartIso) {
  return Math.round((Date.parse(fromIso) - Date.parse(dayStartIso)) / 3600_000) + 1;
}

/** hour -> viewers over the comparable's release day, hours above 1 ignored when tiny. */
function dayHours(comp) {
  const out = new Map();
  for (const row of comp.hourly) {
    const h = hourOf(row.from, comp.day_start);
    if (h >= 1 && h <= 24 && row.viewers != null) {
      const v = Math.max(1, row.viewers);
      out.set(h, Math.max(out.get(h) ?? 0, v));
    }
  }
  return out;
}

/** Each comparable contributes a log-ratio curve: ln(viewers_h / viewers_1) for h = 2..24. */
function ratioCurve(comp) {
  const hh = dayHours(comp);
  const p1 = hh.get(1) ?? 0;
  if (p1 < 30) return null;
  const r = {};
  for (let h = 2; h <= 24; h++) if (hh.has(h)) r[h] = Math.log(hh.get(h) / p1);
  return Object.keys(r).length >= 15 ? r : null;
}

/** Per hour: the median and spread of the log ratios across the comparable launches. */
function fitCurves(curves) {
  const med = {}, sd = {};
  for (let h = 2; h <= 24; h++) {
    const vals = curves.map((c) => c[h]).filter((v) => v != null);
    if (vals.length >= 5) {
      med[h] = median(vals);
      sd[h] = vals.length > 2 ? pstdev(vals) : 0.35;
    } else {
      med[h] = (med[h - 1] ?? 0);
      sd[h] = (sd[h - 1] ?? 0.35);
    }
  }
  return { med, sd };
}

function forecast(caseObj) {
  const curves = (caseObj.comparables ?? []).map(ratioCurve).filter(Boolean);
  const { med, sd } = fitCurves(curves);
  const p1 = Math.max(1, caseObj.known?.[0]?.viewers ?? caseObj.known?.viewers ?? 1);
  const rows = [];
  for (const row of caseObj.forecast) {
    const h = row.hour;
    const m = med[h] ?? 0;
    const s = SPREAD * (sd[h] ?? 0.35) + BASE * Math.sqrt(h - 1);
    const q = Z.map((z) => Math.max(1, Math.min(1e9, p1 * Math.exp(m + z * s))));
    rows.push({ hour: h, q });
  }
  return { hours: rows };
}

for (const name of readdirSync(INPUT_DIR).filter((f) => f.endsWith('.in')).sort()) {
  const caseObj = JSON.parse(readFileSync(join(INPUT_DIR, name), 'utf8'));
  const out = JSON.stringify(forecast(caseObj));
  if (out.length > 65536) throw new Error('forecast too large for ' + name);
  mkdirSync(OUTPUT_DIR, { recursive: true });
  writeFileSync(join(OUTPUT_DIR, name.replace(/\.in$/, '.out')), out);
}
