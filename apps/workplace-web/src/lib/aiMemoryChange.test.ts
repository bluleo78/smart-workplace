import { describe, expect, it } from 'vitest';

import type { AiMemoryChange, AiMemorySnapshot } from '@/types/aiMemory';

import { toChangeLogEntry } from './aiMemoryChange';

const snap = (id: number, content: string): AiMemorySnapshot => ({
  id, content, kind: 'PREFERENCE', scope: null, expiresOn: null, source: 'AI', pinned: false, lastUsedAt: '2026-10-15T00:00:00Z',
});
const change = (over: Partial<AiMemoryChange>): AiMemoryChange => ({
  id: 1, action: 'ADDED', createdAt: '2026-10-15T02:40:00Z', memory: null, before: [], undoneAt: null, ...over,
});

describe('toChangeLogEntry', () => {
  it('ADDED — 새로 기억함, 결과 내용, 출처 대화', () => {
    const e = toChangeLogEntry(change({ memory: snap(5, 'WP 배포를 맡고 있다'), source: { id: 's-1', title: '배포 순서 정리' }, reason: '맡은 일' }));
    expect(e).toMatchObject({ id: 1, icon: 'ADDED', label: '새로 기억함', content: 'WP 배포를 맡고 있다', removed: false, before: [], source: { id: 's-1', title: '배포 순서 정리' } });
    // 사유는 지움(FORGOTTEN)에만 보인다 — 나머지는 동작 이름이 곧 설명이다.
    expect(e.note).toBeUndefined();
  });
  it('MERGED — n개를 합침, 합치기 전 원본들', () => {
    const e = toChangeLogEntry(change({ action: 'MERGED', memory: snap(5, '보고서·요약은 표로'), before: [snap(5, '주간 보고서는 표로'), snap(6, '요약은 표 형식')] }));
    expect(e).toMatchObject({ icon: 'MERGED', label: '2개를 합침', before: ['주간 보고서는 표로', '요약은 표 형식'], beforeLabel: '합치기 전' });
  });
  it('UPDATED — 고침, 이전 내용', () => {
    const e = toChangeLogEntry(change({ action: 'UPDATED', memory: snap(5, '아침 회의는 10시'), before: [snap(5, '아침 회의는 9시')] }));
    expect(e).toMatchObject({ icon: 'UPDATED', label: '고침', content: '아침 회의는 10시', before: ['아침 회의는 9시'], beforeLabel: '이전' });
  });
  it('FORGOTTEN — 지운 내용에 취소선, 사유를 보조 문구로', () => {
    const e = toChangeLogEntry(change({ action: 'FORGOTTEN', before: [snap(5, '회의록은 영어로')], reason: '회의록은 한국어로 써 달라고 함' }));
    expect(e).toMatchObject({ icon: 'FORGOTTEN', label: '대화와 맞지 않아 지움', content: '회의록은 영어로', removed: true, before: [], note: '회의록은 한국어로 써 달라고 함' });
  });
  it('DECAYED — 90일 동안 쓰지 않아 지움, 출처 없음', () => {
    const e = toChangeLogEntry(change({ action: 'DECAYED', before: [snap(5, '출장 중엔 메일 요약만')], undoneAt: '2026-10-15T03:00:00Z' }));
    expect(e).toMatchObject({ icon: 'DECAYED', label: '90일 동안 쓰지 않아 지움', removed: true, undoneAt: '2026-10-15T03:00:00Z' });
    expect(e.source).toBeUndefined();
  });
});
