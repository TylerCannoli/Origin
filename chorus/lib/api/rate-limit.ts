import { ApiError } from "@/lib/api/errors";
import { redisConnection } from "@/lib/queue";

/**
 * Fixed-window rate limiter backed by Redis (INCR + EXPIRE). Falls back to an in-process
 * map when Redis is unreachable so a Redis outage degrades to per-instance limiting instead
 * of failing requests.
 */
const memory = new Map<string, { count: number; resetAt: number }>();

export async function rateLimit(key: string, limit: number, windowSeconds: number): Promise<void> {
  const bucket = `rl:${key}:${Math.floor(Date.now() / 1000 / windowSeconds)}`;
  let count: number;
  try {
    const redis = redisConnection();
    count = await redis.incr(bucket);
    if (count === 1) await redis.expire(bucket, windowSeconds + 1);
  } catch {
    const now = Date.now();
    const entry = memory.get(bucket);
    if (!entry || entry.resetAt < now) {
      memory.set(bucket, { count: 1, resetAt: now + windowSeconds * 1000 });
      count = 1;
    } else {
      entry.count += 1;
      count = entry.count;
    }
    if (memory.size > 5000) {
      for (const [k, v] of memory) if (v.resetAt < now) memory.delete(k);
    }
  }
  if (count > limit) {
    throw new ApiError(429, "Too many requests. Slow down and try again shortly.");
  }
}

export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}
