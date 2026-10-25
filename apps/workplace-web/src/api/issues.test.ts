// WP-873 issueFilterParams — 완료일 기간 토큰이 서버 closedFrom/closedTo(KST 날짜) 로 풀려 실린다.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { parseFilters } from '@/lib/issueFilters';

import { issueFilterParams } from './issues';

const EMPTY = parseFilters(new URLSearchParams());

describe('issueFilterParams — closedIn', () => {
  beforeEach(() => {
    // 2026-10-23(금) 정오 KST 로 시계 고정 — 프리셋은 호출 시점 기준으로 풀린다.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-23T12:00:00+09:00'));
  });
  afterEach(() => vi.useRealTimers());

  it('프리셋은 호출 시점의 날짜 범위로 풀어 보낸다', () => {
    const p = issueFilterParams({ ...EMPTY, closedIn: 'last-week' });
    expect(p.get('closedFrom')).toBe('2026-10-12');
    expect(p.get('closedTo')).toBe('2026-10-18');
    expect(p.has('closedIn')).toBe(false);
  });

  it('직접 지정은 그대로 보낸다', () => {
    const p = issueFilterParams({ ...EMPTY, closedIn: '2026-09-01~2026-09-05' });
    expect(p.get('closedFrom')).toBe('2026-09-01');
    expect(p.get('closedTo')).toBe('2026-09-05');
  });

  it('closedIn 이 없으면 보내지 않는다', () => {
    const p = issueFilterParams(EMPTY);
    expect(p.has('closedFrom')).toBe(false);
    expect(p.has('closedTo')).toBe(false);
  });
});

// WP-933: 구성요소 필터는 서버에 component=id,…,none 으로 실린다(URL 과 같은 표현).
describe('issueFilterParams — component', () => {
  it('id 와 「구성요소 없음」을 component 한 키로 보낸다', () => {
    expect(issueFilterParams({ ...EMPTY, componentIds: [3, 5], componentNone: true }).get('component')).toBe('3,5,none');
    expect(issueFilterParams(EMPTY).has('component')).toBe(false);
  });
});
