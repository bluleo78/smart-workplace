// historyStatusLabel/historyPriorityLabel(WP-412) — 활동 타임라인 이력 값 매핑 단위 테스트.
// enum → 한국어·원문 폴백은 issueGrouping.test 의 statusLabel/priorityLabel 이 검증하고, 여기선 이력 고유 규칙('없음')과 위임만 본다.
import { describe, expect, it } from 'vitest';

import { formatParentChanged, historyPriorityLabel, historyStatusLabel } from './issueHistoryLabels';

describe('historyStatusLabel / historyPriorityLabel', () => {
  it('값이 있으면 공용 표시명으로 바꾼다', () => {
    expect(historyStatusLabel('DONE')).toBe('완료');
    expect(historyPriorityLabel('MID')).toBe('보통');
  });

  it('값이 없으면 "없음"이다', () => {
    expect(historyStatusLabel(null)).toBe('없음');
    expect(historyStatusLabel('')).toBe('없음');
    expect(historyPriorityLabel(null)).toBe('없음');
    expect(historyPriorityLabel('')).toBe('없음');
  });
});

// WP-862: 「부모 r76 에픽 로 설정」처럼 조사가 고정되고 제목이 문장과 구분되지 않았다.
describe('formatParentChanged', () => {
  const json = (from: unknown, to: unknown) => JSON.stringify({ from, to });

  it('설정은 받침에 맞는 조사와 따옴표·키로 쓴다', () => {
    expect(formatParentChanged(json(null, { number: 68, title: 'r76 에픽' }), 'RX')).toBe('부모를 「r76 에픽」(RX-68)으로 설정');
    expect(formatParentChanged(json(null, { number: 3, title: '로그인 개선' }), 'RX')).toBe('부모를 「로그인 개선」(RX-3)으로 설정');
    expect(formatParentChanged(json(null, { number: 4, title: '결제 모듈' }), 'RX')).toBe('부모를 「결제 모듈」(RX-4)로 설정');
    expect(formatParentChanged(json(null, { number: 5, title: '검색 기능' }), 'RX')).toBe('부모를 「검색 기능」(RX-5)으로 설정');
    expect(formatParentChanged(json(null, { number: 6, title: '메일 필터' }), 'RX')).toBe('부모를 「메일 필터」(RX-6)로 설정');
  });

  it('받침을 알 수 없는 제목(영문·숫자 끝)은 「(으)로」, 제목이 없으면 키만', () => {
    expect(formatParentChanged(json(null, { number: 7, title: 'Release v2' }), 'RX')).toBe('부모를 「Release v2」(RX-7)(으)로 설정');
    expect(formatParentChanged(json(null, { number: 8, title: '' }), 'RX')).toBe('부모를 RX-8(으)로 설정');
  });

  it('해제·변경도 같은 표기다', () => {
    expect(formatParentChanged(json({ number: 68, title: 'r76 에픽' }, null), 'RX')).toBe('부모 「r76 에픽」(RX-68) 해제');
    expect(formatParentChanged(json({ number: 1, title: 'A 에픽' }, { number: 2, title: 'B 에픽' }), 'RX')).toBe(
      '「A 에픽」(RX-1) → 「B 에픽」(RX-2)',
    );
  });

  it('값이 없거나 깨졌으면 기본 문구·원문', () => {
    expect(formatParentChanged(null, 'RX')).toBe('부모 변경');
    expect(formatParentChanged(json(null, null), 'RX')).toBe('부모 변경');
    expect(formatParentChanged('{oops', 'RX')).toBe('{oops');
  });
});
