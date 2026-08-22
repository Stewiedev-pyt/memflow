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
