// secretFetches — 언제 원문 엔드포인트를 다시 부를지. agent-key 를 부르면 곧 교체(generation+1)라 필요할 때만.
import { describe, expect, it } from 'vitest';
import { secretFetches } from './secrets.js';
import type { RunnerSecretRef } from './works/client.js';

const NOW = new Date('2026-11-10T00:00:00Z');

function refs(
  agentKeyVersion: number | null,
  claudeVersion?: number | null,
  rotateAfter: string | null = '2026-11-24T10:00:00+09:00',
): RunnerSecretRef[] {
  const out: RunnerSecretRef[] = [{ name: 'agent-key', source: 'WORKS', version: agentKeyVersion, rotateAfter }];
  if (claudeVersion !== undefined) out.push({ name: 'claude', source: 'WORKS', version: claudeVersion, rotateAfter: null });
  out.push({ name: 'github', source: 'LOCATION', version: null, rotateAfter: null });
  return out;
}

const ANNOTATED = {
  'genia.works/agent-key-id': '812',
  'genia.works/agent-key-rotate-after': '2026-11-24T01:00:00.000Z',
  'genia.works/claude-version': '57',
};

describe('secretFetches', () => {
  it('noFetchWhenAnnotationMatchesVersion', () => {
    expect(secretFetches(refs(812, 57), ANNOTATED, NOW)).toEqual({ agentKey: false, claude: 'keep' });
  });

  it('fetchesWhenVersionNull', () => {
    // Works 에 쓸 수 있는 키가 없다(첫 발급·회수됨) → 받기 전엔 Pod 를 못 띄운다
    expect(secretFetches(refs(null, 57), ANNOTATED, NOW).agentKey).toBe(true);
    // 어노테이션이 아예 없음(새 AI)
    expect(secretFetches(refs(812, 57), {}, NOW).agentKey).toBe(true);
    // Works 의 현재 키가 우리가 받은 것과 다름(관리자가 회수 → 다음 키)
    expect(secretFetches(refs(813, 57), ANNOTATED, NOW).agentKey).toBe(true);
  });

  it('fetchesAfterRotateAfter', () => {
    const later = new Date('2026-11-24T01:00:01Z');
    expect(secretFetches(refs(812, 57), ANNOTATED, later).agentKey).toBe(true);
    const before = new Date('2026-11-24T00:59:59Z');
    expect(secretFetches(refs(812, 57), ANNOTATED, before).agentKey).toBe(false);
  });

  it('ignoresDesiredRotateAfterUnlessVersionNull', () => {
    // 「수명을 줄였다」는 Works 가 정한다 — 정리 유예 키는 desired 에서 version=null 로 나오므로 desired rotateAfter 는 보지 않는다
    expect(secretFetches(refs(812, 57, '2026-11-03T00:05:00Z'), ANNOTATED, NOW).agentKey).toBe(false);
    expect(secretFetches(refs(812, 57, '2026-11-20T00:00:00Z'), ANNOTATED, NOW).agentKey).toBe(false);
    expect(secretFetches(refs(812, 57, null), ANNOTATED, NOW).agentKey).toBe(false);
    // 끄고 곧 다시 켬 — 유예 키만 남아 version 이 null 이면 새로 받는다
    expect(secretFetches(refs(null, 57, null), ANNOTATED, NOW).agentKey).toBe(true);
  });

  it('claudeFetchesOnVersionChangeAndClearsWithoutConnection', () => {
    expect(secretFetches(refs(812, 58), ANNOTATED, NOW).claude).toBe('fetch');
    expect(secretFetches(refs(812, 57), ANNOTATED, NOW).claude).toBe('keep');
    // 연결 없음(null) — 받을 것이 없다(토큰은 지운다)
    expect(secretFetches(refs(812, null), ANNOTATED, NOW).claude).toBe('clear');
    // 템플릿이 요구하지 않음(참조 없음)
    expect(secretFetches(refs(812), ANNOTATED, NOW).claude).toBe('clear');
    // 아직 받은 적 없음
    expect(secretFetches(refs(812, 57), { 'genia.works/agent-key-id': '812' }, NOW).claude).toBe('fetch');
  });
});
