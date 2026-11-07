import { ApiError } from './http.js';

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

/** Small in-process sliding-window limiter for auth and provider endpoints. */
export function rateLimit(key: string, limit: number, windowMs: number): void {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }
  bucket.count += 1;
  if (bucket.count > limit) {
    throw new ApiError(429, 'rate_limited', 'Too many requests. Try again shortly.');
  }
}

setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets) if (bucket.resetAt < now) buckets.delete(key);
}, 60_000).unref?.();
