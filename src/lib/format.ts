const n0 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const n2 = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const n3 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 });

/** SAR amount; whole riyals at or above 1,000, halalas below. */
export const fmtMoney = (n: number) => `SAR ${Math.abs(n) >= 1000 ? n0.format(n) : n2.format(n)}`;
export const fmtMoneyExact = (n: number) => `SAR ${n2.format(n)}`;
export const fmtCompact = (n: number) =>
  Math.abs(n) >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : Math.abs(n) >= 10_000 ? `${(n / 1000).toFixed(1)}K` : n0.format(n);
export const fmtInt = (n: number) => n0.format(n);
/** Quantities: up to 3 decimals, none when whole. */
export const fmtQty = (n: number) => n3.format(n);
/** Headline figures: millions shown as "SAR 137.2M" so they fit a tile; exact value goes in a tooltip. */
export const fmtMoneyShort = (n: number) => (Math.abs(n) >= 1_000_000 ? `SAR ${(n / 1_000_000).toFixed(1)}M` : fmtMoney(n));
export const fmtIntShort = (n: number) => (Math.abs(n) >= 10_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : Math.abs(n) >= 100_000 ? `${(n / 1000).toFixed(0)}K` : n0.format(n));
export const fmtPct = (x: number) => `${(x * 100).toFixed(x < 0.1 && x > 0 ? 1 : 0)}%`;
/** Unit price, SAR with 2–4 decimals as recorded. */
export const fmtPrice = (n: number) => `SAR ${new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(n)}`;

export const fmtDateTime = (d: Date, intl = "en-GB") =>
  d.toLocaleString(intl, { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
export const fmtDate = (d: Date, intl = "en-GB") => d.toLocaleDateString(intl, { day: "2-digit", month: "short", year: "numeric" });
export const fmtDay = (d: Date, intl = "en-GB") => d.toLocaleDateString(intl, { weekday: "short", day: "2-digit", month: "short", year: "numeric" });
