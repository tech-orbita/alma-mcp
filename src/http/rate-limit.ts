import type { NextFunction, Request, Response } from 'express';

interface Bucket {
  count: number;
  resetAt: number;
}

export function fixedWindowRateLimit(options: { windowMs: number; max: number; now?: () => number }) {
  const buckets = new Map<string, Bucket>();
  const now = options.now ?? Date.now;

  return (request: Request, response: Response, next: NextFunction): void => {
    const current = now();
    const key = request.ip ?? request.socket.remoteAddress ?? 'unknown';
    let bucket = buckets.get(key);
    if (bucket === undefined || bucket.resetAt <= current) {
      bucket = { count: 0, resetAt: current + options.windowMs };
      buckets.set(key, bucket);
    }
    bucket.count += 1;

    response.set('RateLimit-Limit', String(options.max));
    response.set('RateLimit-Remaining', String(Math.max(0, options.max - bucket.count)));
    response.set('RateLimit-Reset', String(Math.ceil(bucket.resetAt / 1_000)));

    if (bucket.count > options.max) {
      response
        .status(429)
        .set('Retry-After', String(Math.max(1, Math.ceil((bucket.resetAt - current) / 1_000))))
        .json({ error: 'rate_limit_exceeded', message: 'Demasiadas solicitudes.' });
      return;
    }

    if (buckets.size > 10_000) {
      for (const [bucketKey, candidate] of buckets) {
        if (candidate.resetAt <= current) buckets.delete(bucketKey);
      }
    }
    next();
  };
}
