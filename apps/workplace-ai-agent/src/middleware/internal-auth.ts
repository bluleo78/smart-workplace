// 사내 서비스 간 인증 — Authorization: Internal {token} 헤더의 토큰을
// INTERNAL_SERVICE_TOKEN 환경변수와 timingSafeEqual 로 비교한다.
// 타이밍 공격 방지를 위해 단순 === 비교가 아닌 crypto 의 안전 비교 사용.
import type { Request, Response, NextFunction } from 'express';
import { timingSafeEqual } from 'node:crypto';

import { INTERNAL_AUTH_SCHEME } from '../constants.js';

export function internalAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header || !header.startsWith(INTERNAL_AUTH_SCHEME)) {
    res.status(401).json({ error: 'unauthorized', reason: 'missing_or_invalid_scheme' });
    return;
  }

  const expected = process.env.INTERNAL_SERVICE_TOKEN;
  if (!expected) {
    // 운영 실수 — 서버 설정 누락. 클라이언트에는 일반 500.
    console.error('[internalAuth] INTERNAL_SERVICE_TOKEN 환경변수 미설정');
    res.status(500).json({ error: 'internal_error' });
    return;
  }

  const token = header.substring(INTERNAL_AUTH_SCHEME.length);
  const tokenBuf = Buffer.from(token);
  const expectedBuf = Buffer.from(expected);

  if (tokenBuf.length !== expectedBuf.length || !timingSafeEqual(tokenBuf, expectedBuf)) {
    res.status(401).json({ error: 'unauthorized', reason: 'invalid_token' });
    return;
  }

  next();
}
