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

/** Fraction of total volume the value area must cover. */
const VALUE_AREA_FRACTION = 0.7;

export type VolumeProfileBin = {
  /** Bin centre — the level a POC/VAH/VAL readout should quote. */
  price: number;
  /** Inclusive lower edge of the bin. */
  low: number;
  /** Inclusive upper edge of the bin. */
  high: number;
  volume: number;
};

export type VolumeProfileResult = {
  bins: VolumeProfileBin[];
  /** Point of Control: centre of the highest-volume bin. */
  poc: number;
  /** Value Area High: upper edge of the highest bin inside the value area. */
  vah: number;
  /** Value Area Low: lower edge of the lowest bin inside the value area. */
  val: number;
  totalVolume: number;
  /** Height of one price bin. `0` when the window was perfectly flat. */
  step: number;
};

/**
 * Volume profile over a window of candles: how much traded at each *price*
 * rather than when. Answers where the market accepted value (the POC), the
 * range containing 70% of it (VAH/VAL), and which levels are thin.
 *
 * **The uniform-distribution caveat.** Volume profile wants tick data, which
 * keyless candle endpoints do not give us. Given only OHLCV, this spreads each
 * bar's volume evenly across the price bins it touched. That is the standard
 * approximation, and it is an approximation: a bar that spent all its time at
 * its high and merely wicked to its low is treated as uniform. So the output is
 * a faithful summary of *where price traded*, not an exchange-grade accepted-
 * value measurement, and it should be labelled as derived wherever it is shown.
 *
 * Bars with no volume are excluded before the price range is measured — a bar
 * that gapped through prices without trading says nothing about accepted value
 * and should not stretch the profile.
 *
 * Returns `null` when there is nothing to profile.
 */
export function volumeProfile(
  candles: CandleLike[],
  binCount = 60,
): VolumeProfileResult | null {
  if (!Number.isInteger(binCount) || binCount < 1) return null;

  const usable = candles.filter(
    (c) =>
      Number.isFinite(c.high) &&
      Number.isFinite(c.low) &&
      Number.isFinite(c.volume) &&
      c.volume > 0 &&
      c.high >= c.low,
  );
  if (usable.length === 0) return null;

  let lo = Infinity;
  let hi = -Infinity;
  for (const c of usable) {
    if (c.low < lo) lo = c.low;
    if (c.high > hi) hi = c.high;
  }

  // A perfectly flat window collapses to a single bin rather than dividing by
  // zero; `step === 0` is reported so callers can tell the two cases apart.
  const step = hi > lo ? (hi - lo) / binCount : 0;
  const n = step > 0 ? binCount : 1;
  const volumes = new Array<number>(n).fill(0);

  const idxOf = (p: number) => {
    if (step <= 0) return 0;
    const i = Math.floor((p - lo) / step);
    return i < 0 ? 0 : i >= n ? n - 1 : i;
  };

  for (const c of usable) {
    const a = idxOf(c.low);
    const b = idxOf(c.high);
    const span = b - a + 1;
    const perBin = c.volume / span;
    for (let i = a; i <= b; i++) volumes[i] += perBin;
  }

  const bins: VolumeProfileBin[] = volumes.map((volume, i) => ({
    low: step > 0 ? lo + i * step : lo,
    high: step > 0 ? lo + (i + 1) * step : hi,
    price: step > 0 ? lo + (i + 0.5) * step : lo,
    volume,
  }));

  let totalVolume = 0;
  let pocIdx = 0;
  for (let i = 0; i < n; i++) {
    totalVolume += volumes[i];
    // Strict `>` so ties resolve to the lower price, deterministically.
    if (volumes[i] > volumes[pocIdx]) pocIdx = i;
  }

  // Grow the value area outwards from the POC, always taking the richer side.
  // This is the one-bin-at-a-time form of the standard TPO expansion; the
  // classic Market Profile version compares bins in pairs. The two differ only
  // marginally, and this form is simpler to verify, so we take it deliberately.
  const target = totalVolume * VALUE_AREA_FRACTION;
  let current = volumes[pocIdx];
  let up = pocIdx + 1;
  let down = pocIdx - 1;
  while (current < target) {
    const upVol = up < n ? volumes[up] : null;
    const downVol = down >= 0 ? volumes[down] : null;
    if (upVol == null && downVol == null) break;
    const takeUp = upVol == null ? false : downVol == null ? true : upVol >= downVol;
    if (takeUp) {
      current += upVol as number;
      up++;
    } else {
      current += downVol as number;
      down--;
    }
  }

  return {
    bins,
    poc: bins[pocIdx].price,
    vah: bins[up - 1].high,
    val: bins[down + 1].low,
    totalVolume,
    step,
  };
}

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
