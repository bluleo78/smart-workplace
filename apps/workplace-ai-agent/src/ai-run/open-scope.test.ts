import { afterEach, describe, expect, it, vi } from 'vitest';
import { openAiRunScope, readAiRunHeader, safeClose } from './open-scope.js';
import { AiRunScope, swallowRecording } from './scope.js';
import type { AiRunRecord } from './types.js';

const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');

// 범위 열기·닫기 공용 보조 함수 검증 (WP-1828)
describe('open-scope', () => {
  afterEach(() => vi.restoreAllMocks());

  it('배열 헤더는 첫 원소만 해석한다', () => {
    expect(readAiRunHeader([enc({ kind: 'X' }), enc({ kind: 'Y' })])).toEqual({ kind: 'X' });
  });

  it('헤더가 없으면 경고 없이 빈 맥락', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(readAiRunHeader(undefined)).toEqual({});
    expect(warn).not.toHaveBeenCalled();
  });

  it('읽을 수 없으면 빈 맥락과 100자까지의 경고 한 줄', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(readAiRunHeader('!'.repeat(300))).toEqual({});
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][1]).toHaveLength(100);
  });

  it('safeClose 는 close 오류를 삼킨다', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const scope = { close: () => { throw new Error('x'); } } as unknown as AiRunScope;
    expect(() => safeClose(scope, { ok: true })).not.toThrow();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('openAiRunScope: 헤더 필드가 derived 를, 헤더 kind 가 표 kind 를 이긴다', () => {
    const records: AiRunRecord[] = [];
    const sink = { enqueue: (r: AiRunRecord) => records.push(r) };
    const scope = openAiRunScope('AI_CHAT', enc({ kind: 'PROJECT_REPORT', tenantId: 9 }), { tenantId: 1, targetId: '5' }, sink);
    scope!.runnerStarted('m', 'c');
    expect(records[0]).toMatchObject({ kind: 'PROJECT_REPORT', tenantId: 9, targetId: '5' });
  });

  it('openAiRunScope: 헤더가 없으면 표 kind·derived 를 쓴다', () => {
    const records: AiRunRecord[] = [];
    const scope = openAiRunScope('AI_CHAT', undefined, { tenantId: 1 }, { enqueue: (r) => records.push(r) });
    scope!.runnerStarted('m', 'c');
    expect(records[0]).toMatchObject({ kind: 'AI_CHAT', tenantId: 1 });
  });

  it('swallowRecording 은 오류를 삼키고 라벨과 메시지를 경고한다', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(() => swallowRecording('테스트', () => { throw new Error('boom'); })).not.toThrow();
    expect(warn).toHaveBeenCalledWith('[ai-run] 테스트 실패(무시):', 'boom');
  });
});
