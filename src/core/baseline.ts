export interface Stats {
  mean: number;
  stdDev: number;
  n: number;
}

export function rollingStats(values: number[]): Stats {
  const clean = values.filter((v) => Number.isFinite(v));
  const n = clean.length;
  if (n === 0) return { mean: 0, stdDev: 0, n: 0 };
  const mean = clean.reduce((a, b) => a + b, 0) / n;
  if (n < 2) return { mean, stdDev: 0, n };
  const variance = clean.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1);
  return { mean, stdDev: Math.sqrt(variance), n };
}

export function zScore(value: number, s: Stats): number {
  if (!Number.isFinite(value) || s.n < 3 || s.stdDev === 0) return 0;
  return (value - s.mean) / s.stdDev;
}

export function slopePctPertime(series: number[], perMs: number): number {
  const clean = series.filter((v) => Number.isFinite(v)) as number[];
  if (clean.length < 2) return 0;
  const first = clean[0];
  const last = clean[clean.length - 1];
  if (!first || first <= 0) return last > 0 ? 100 : 0;
  return ((last - first) / Math.abs(first)) * 100;
}
