import { describe, expect, it } from 'vitest';
import { parseAiRunHeader } from './header.js';

const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64url');
const encodeAiRunHeader = (ctx: object) => b64(JSON.stringify(ctx));

// X-AI-Run 헤더 해석 검증 (WP-1828)
describe('X-AI-Run 헤더', () => {
  it('encode → parse 왕복이 같다', () => {
    const ctx = {
      runId: '3f2b8c1e-5a4d-4e8f-9b7a-1c2d3e4f5a6b', kind: 'AI_CHAT', targetType: 'ISSUE', targetId: '5', targetLabel: 'WP-5',
      actorType: 'USER' as const, actorId: 9, sourceAt: '2026-01-01T00:00:00Z', tenantId: 3, attempt: 2,
    };
    expect(parseAiRunHeader(encodeAiRunHeader(ctx))).toEqual(ctx);
  });

  it('패딩이 붙은 base64url 도 읽는다', () => {
    const padded = Buffer.from('{"kind":"a"}').toString('base64');
    expect(parseAiRunHeader(padded)).toEqual({ kind: 'a' });
  });

  it.each([undefined, '', '%%%', b64('not json'), b64('[1]')])('형식 오류는 null: %s', (raw) => {
    expect(parseAiRunHeader(raw as string | undefined)).toBeNull();
  });

  it('타입이 틀린 필드만 빠진다', () => {
    const raw = b64(JSON.stringify({ tenantId: '1', actorType: 'ROBOT', runId: '3f2b8c1e-5a4d-4e8f-9b7a-1c2d3e4f5a6b', attempt: 2 }));
    expect(parseAiRunHeader(raw)).toEqual({ runId: '3f2b8c1e-5a4d-4e8f-9b7a-1c2d3e4f5a6b', attempt: 2 });
  });

  it('UUID 가 아닌 runId·ISO 가 아닌 sourceAt 는 그 필드만 버린다', () => {
    const raw = b64(JSON.stringify({ runId: 'r-1', sourceAt: 'yesterday', kind: 'K', attempt: 2 }));
    expect(parseAiRunHeader(raw)).toEqual({ kind: 'K', attempt: 2 });
  });

  it('actorId 는 숫자 또는 숫자 문자열(숫자로 바꿈)만 받고 나머지는 버린다', () => {
    expect(parseAiRunHeader(b64(JSON.stringify({ actorId: 7 })))).toEqual({ actorId: 7 });
    expect(parseAiRunHeader(b64(JSON.stringify({ actorId: '7' })))).toEqual({ actorId: 7 });
    expect(parseAiRunHeader(b64(JSON.stringify({ actorId: 'abc', kind: 'K' })))).toEqual({ kind: 'K' });
  });
});
