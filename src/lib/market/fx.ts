import "server-only";

/** USD to PHP from a free, keyless endpoint. Returns null on failure so the saved rate is kept. */
export async function fetchUsdPhp(): Promise<number | null> {
  try {
    const r = await fetch("https://open.er-api.com/v6/latest/USD", { cache: "no-store" });
    const j = (await r.json()) as { rates?: Record<string, number> };
    const v = j.rates?.PHP;
    return v && v > 20 && v < 200 ? v : null;
  } catch {
    return null;
  }
}
