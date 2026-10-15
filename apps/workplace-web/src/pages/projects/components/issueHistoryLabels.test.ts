// historyStatusLabel/historyPriorityLabel(WP-412) — 활동 타임라인 이력 값 매핑 단위 테스트.
// enum → 한국어·원문 폴백은 issueGrouping.test 의 statusLabel/priorityLabel 이 검증하고, 여기선 이력 고유 규칙('없음')과 위임만 본다.
import { describe, expect, it } from 'vitest';

import { historyPriorityLabel, historyStatusLabel } from './issueHistoryLabels';

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
