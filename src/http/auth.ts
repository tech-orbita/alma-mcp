import { timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

function safeEqual(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length) {
    timingSafeEqual(expectedBuffer, expectedBuffer);
    return false;
  }
  return timingSafeEqual(actualBuffer, expectedBuffer);
}

export function isAuthorizedBearer(authorization: string | undefined, expectedToken: string): boolean {
  if (authorization === undefined) return false;
  const match = /^Bearer ([^\s]+)$/.exec(authorization);
  return match?.[1] !== undefined && safeEqual(match[1], expectedToken);
}

export function bearerAuth(expectedToken: string) {
  return (request: Request, response: Response, next: NextFunction): void => {
    if (!isAuthorizedBearer(request.header('authorization'), expectedToken)) {
      response
        .status(401)
        .set('WWW-Authenticate', 'Bearer realm="alma-mcp"')
        .json({ error: 'unauthorized', message: 'Se requiere un token Bearer válido.' });
      return;
    }
    next();
  };
}
