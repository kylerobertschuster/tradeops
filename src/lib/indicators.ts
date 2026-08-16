export function sma(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

export function ema(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (values.length < period) return out;
  const k = 2 / (period + 1);
  let seed = 0;
  for (let i = 0; i < period; i++) seed += values[i];
  let prev = seed / period;
  out[period - 1] = prev;
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

export function rsi(values: number[], period = 14): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (values.length <= period) return out;
  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i++) {
    const d = values[i] - values[i - 1];
    if (d >= 0) gains += d;
    else losses -= d;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  out[period] = rsiValue(avgGain, avgLoss);
  for (let i = period + 1; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    const gain = d > 0 ? d : 0;
    const loss = d < 0 ? -d : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    out[i] = rsiValue(avgGain, avgLoss);
  }
  return out;
}

function rsiValue(avgGain: number, avgLoss: number): number {
  if (avgGain + avgLoss === 0) return 50;
  if (avgLoss === 0) return 100;
  return 100 - 100 / (1 + avgGain / avgLoss);
}

export type MacdResult = {
  macd: (number | null)[];
  signal: (number | null)[];
  histogram: (number | null)[];
};

export function macd(values: number[], fast = 12, slow = 26, signal = 9): MacdResult {
  const fastE = ema(values, fast);
  const slowE = ema(values, slow);
  const line: (number | null)[] = values.map((_, i) =>
    fastE[i] != null && slowE[i] != null ? (fastE[i] as number) - (slowE[i] as number) : null,
  );
  const start = line.findIndex((v) => v != null);
  if (start === -1) {
    return { macd: line, signal: line.slice(), histogram: line.slice() };
  }
  const valid = line.slice(start) as number[];
  const sigValid = ema(valid, signal);
  const signalLine: (number | null)[] = new Array(start).fill(null).concat(sigValid);
  const histogram: (number | null)[] = signalLine.map((s, i) =>
    s != null && line[i] != null ? (line[i] as number) - s : null,
  );
  return { macd: line, signal: signalLine, histogram };
}

export type BollingerPoint = { upper: number; middle: number; lower: number };

export function bollinger(
  values: number[],
  period = 20,
  mult = 2,
): (BollingerPoint | null)[] {
  const out: (BollingerPoint | null)[] = new Array(values.length).fill(null);
  for (let i = period - 1; i < values.length; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += values[j];
    const mean = sum / period;
    let vsum = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const d = values[j] - mean;
      vsum += d * d;
    }
    const sd = Math.sqrt(vsum / period);
    out[i] = { upper: mean + mult * sd, middle: mean, lower: mean - mult * sd };
  }
  return out;
}

type CandleLike = { high: number; low: number; close: number; volume: number };

/** Cumulative session VWAP over the loaded candles. */
export function vwap(candles: CandleLike[]): (number | null)[] {
  const out: (number | null)[] = new Array(candles.length).fill(null);
  let cumPV = 0;
  let cumV = 0;
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const typical = (c.high + c.low + c.close) / 3;
    cumPV += typical * c.volume;
    cumV += c.volume;
    out[i] = cumV > 0 ? cumPV / cumV : null;
  }
  return out;
}
