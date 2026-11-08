import type { Bar } from "../market/types";

export interface Indicators {
  last: number;
  prevClose: number;
  ema50: number;
  rsi: number;
  atr: number;
  volRatio: number;
}

export function indicators(bars: Bar[]): Indicators | null {
  if (bars.length < 60) return null;
  const close = bars.map((b) => b.close);
  const k = 2 / 51;
  let ema = close[0];
  for (const c of close) ema = c * k + ema * (1 - k);

  let gain = 0, loss = 0;
  const a = 1 / 14;
  for (let i = 1; i < close.length; i++) {
    const d = close[i] - close[i - 1];
    gain = Math.max(d, 0) * a + gain * (1 - a);
    loss = Math.max(-d, 0) * a + loss * (1 - a);
  }
  const rsi = 100 - 100 / (1 + gain / (loss || 1e-9));

  let atr = bars[0].high - bars[0].low;
  for (let i = 1; i < bars.length; i++) {
    const p = close[i - 1], b = bars[i];
    const tr = Math.max(b.high - b.low, Math.abs(b.high - p), Math.abs(b.low - p));
    atr = tr * a + atr * (1 - a);
  }

  // Today's bar is partial during the session, so take the better of the last two days.
  const volRatioAt = (i: number) => {
    const win = bars.slice(Math.max(0, i - 20), i);
    const avg = win.reduce((s, b) => s + b.volume, 0) / (win.length || 1);
    return avg > 0 ? bars[i].volume / avg : 0;
  };
  const n = bars.length - 1;
  return {
    last: close[n], prevClose: close[n - 1], ema50: ema, rsi, atr,
    volRatio: Math.max(volRatioAt(n), volRatioAt(n - 1)),
  };
}
