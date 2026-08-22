export interface Candle {
  ts: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

export function ema(values: number[], period: number): number[] {
  if (values.length < period) return [];
  const k = 2 / (period + 1);
  const out: number[] = [values.slice(0, period).reduce((a, b) => a + b, 0) / period];
  for (let i = period; i < values.length; i++) {
    out.push(values[i] * k + out[out.length - 1] * (1 - k));
  }
  return out;
}

export function rsi(closes: number[], period = 14): number | null {
  if (closes.length < period + 1) return null;
  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(diff, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-diff, 0)) / period;
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

export interface TechnicalRead {
  trend: string;
  rsiValue: number | null;
  rsiNote: string;
  support?: number;
  resistance?: number;
  volumeNote: string;
}

export function analyzeCandles(candles: Candle[]): TechnicalRead | null {
  if (candles.length < 25) return null;
  const closes = candles.map((c) => c.c);
  const e9 = ema(closes, 9);
  const e21 = ema(closes, 21);
  const lastEma9 = e9[e9.length - 1];
  const lastEma21 = e21[e21.length - 1];
  const prevEma9 = e9[e9.length - 2];
  const prevEma21 = e21[e21.length - 2];

  let trend: string;
  if (lastEma9 > lastEma21 && prevEma9 <= prevEma21) trend = "🔄 bullish crossover JUST happened";
  else if (lastEma9 < lastEma21 && prevEma9 >= prevEma21) trend = "🔄 bearish crossover JUST happened";
  else if (lastEma9 > lastEma21) trend = "📈 bullish — short EMA above long";
  else trend = "📉 bearish — short EMA below long";

  const rsiValue = rsi(closes);
  let rsiNote = "";
  if (rsiValue !== null) {
    if (rsiValue >= 70) rsiNote = "overbought — chase risk high";
    else if (rsiValue >= 55) rsiNote = "strong momentum";
    else if (rsiValue >= 45) rsiNote = "neutral zone";
    else if (rsiValue >= 30) rsiNote = "weak hands being shaken";
    else rsiNote = "oversold — bounce watch";
  }

  const recent = candles.slice(-48);
  const support = Math.min(...recent.map((c) => c.l));
  const resistance = Math.max(...recent.map((c) => c.h));

  const recentVol = candles.slice(-5).reduce((a, c) => a + c.v, 0) / 5;
  const priorVol = candles.slice(-25, -5).reduce((a, c) => a + c.v, 0) / 20;
  const ratio = priorVol > 0 ? recentVol / priorVol : 0;
  let volumeNote: string;
  if (ratio >= 2) volumeNote = `volume exploding (${ratio.toFixed(1)}× normal)`;
  else if (ratio >= 1.3) volumeNote = `volume rising (${ratio.toFixed(1)}× normal)`;
  else if (ratio >= 0.7) volumeNote = "volume normal";
  else volumeNote = `volume fading (${ratio.toFixed(1)}× normal)`;

  return { trend, rsiValue, rsiNote, support, resistance, volumeNote };
}
