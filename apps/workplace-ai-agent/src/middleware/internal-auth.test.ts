// 사내 서비스 인증 미들웨어 — Authorization: Internal {token} 검증.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { internalAuth } from './internal-auth.js';

function mockReq(authHeader?: string): Partial<Request> {
  return { headers: authHeader ? { authorization: authHeader } : {} };
}

function mockRes(): Partial<Response> & { statusCode?: number; body?: unknown } {
  const res: Partial<Response> & { statusCode?: number; body?: unknown } = {};
  res.status = vi.fn((code: number) => {
    res.statusCode = code;
    return res as Response;
  });
  res.json = vi.fn((data: unknown) => {
    res.body = data;
    return res as Response;
  });
  return res;
}

describe('internalAuth', () => {
  const VALID = 'test-token-12345';

  beforeEach(() => {
    process.env.INTERNAL_SERVICE_TOKEN = VALID;
  });
  afterEach(() => {
    delete process.env.INTERNAL_SERVICE_TOKEN;
  });

  it('올바른 토큰 → next() 호출', () => {
    const req = mockReq(`Internal ${VALID}`);
    const res = mockRes();
    const next = vi.fn() as NextFunction;
    internalAuth(req as Request, res as Response, next);
    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('Authorization 헤더 없음 → 401', () => {
    const req = mockReq();
    const res = mockRes();
    const next = vi.fn() as NextFunction;
    internalAuth(req as Request, res as Response, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('Bearer 스킴 → 401', () => {
    const req = mockReq(`Bearer ${VALID}`);
    const res = mockRes();
    const next = vi.fn() as NextFunction;
    internalAuth(req as Request, res as Response, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('잘못된 토큰 → 401', () => {
    const req = mockReq('Internal wrong-token');
    const res = mockRes();
    const next = vi.fn() as NextFunction;
    internalAuth(req as Request, res as Response, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('서버에 INTERNAL_SERVICE_TOKEN 미설정 → 500', () => {
    delete process.env.INTERNAL_SERVICE_TOKEN;
    const req = mockReq(`Internal ${VALID}`);
    const res = mockRes();
    const next = vi.fn() as NextFunction;
    internalAuth(req as Request, res as Response, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(500);
  });
});
