export function reflectionRemaining(changedAt: number, now: number, seconds: number) {
  if (!Number.isFinite(changedAt) || changedAt <= 0) return 0;
  return Math.max(0, Math.ceil((changedAt + seconds * 1000 - now) / 1000));
}
