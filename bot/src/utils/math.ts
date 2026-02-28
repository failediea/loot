export function sqrt(x: number): number {
  if (x === 0) return 0;
  return Math.floor(Math.sqrt(x));
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function calculateLevel(xp: number): number {
  if (xp === 0) return 1;
  return Math.floor(Math.sqrt(xp));
}

export function maxHealth(vitality: number): number {
  return Math.min(1023, 100 + vitality * 15);
}
