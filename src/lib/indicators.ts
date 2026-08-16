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
