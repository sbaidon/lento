export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function round(value: number, decimals = 6): number {
  const p = 10 ** decimals;
  return Math.round(value * p) / p;
}
