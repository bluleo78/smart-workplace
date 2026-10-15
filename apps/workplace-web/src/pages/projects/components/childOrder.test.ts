// sortChildrenByCreatedAt(WP-412) — 하위 태스크 정렬 단위 테스트(subtasks E2E 에서 이관, #166).
import { describe, expect, it } from 'vitest';

import type { IssueResponse } from '@/types/issue';

import { sortChildrenByCreatedAt } from './childOrder';

const child = (title: string, createdAt: string, updatedAt = createdAt) =>
  ({ title, createdAt, updatedAt }) as IssueResponse;

describe('sortChildrenByCreatedAt', () => {
  it('백엔드 updatedAt 역순 응답을 생성 시간 오름차순으로 — 신규 추가가 맨 아래', () => {
    const backend = [
      child('신규 서브태스크', '2026-06-08T00:00:00Z'),
      child('최근 서브태스크', '2024-06-01T00:00:00Z', '2024-06-08T00:00:00Z'),
      child('오래된 서브태스크', '2024-01-01T00:00:00Z'),
    ];
    expect(sortChildrenByCreatedAt(backend).map((c) => c.title)).toEqual([
      '오래된 서브태스크',
      '최근 서브태스크',
      '신규 서브태스크',
    ]);
    // 원본(쿼리 캐시 데이터)은 건드리지 않는다.
    expect(backend[0].title).toBe('신규 서브태스크');
  });
});
