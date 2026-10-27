// 에픽 색 도우미(WP-1017) — 에픽 색 우선·유형 색 대체, 부모 요약용 유형 색 바꿔치기, 색점 클래스.
import { describe, expect, it } from 'vitest';

import type { IssueTypeSummary } from '../types/issueType';
import { epicColorToken, epicDotClass, epicTypeSummary } from './epicColor';
import { LABEL_COLORS } from './labelColors';

const EPIC: IssueTypeSummary = { id: 9, name: 'EPIC', colorToken: 'PURPLE', icon: 'Zap' };

describe('epicColor (WP-1017)', () => {
  it('에픽 색이 있으면 그 색, 없으면 유형 색, 둘 다 없으면 undefined', () => {
    expect(epicColorToken({ epicColor: 'ORANGE', type: EPIC })).toBe('ORANGE');
    expect(epicColorToken({ epicColor: null, type: EPIC })).toBe('PURPLE');
    expect(epicColorToken({ type: null })).toBeUndefined();
  });

  it('부모 요약용 유형은 색만 에픽 색으로 바꾸고 나머지는 그대로', () => {
    expect(epicTypeSummary({ epicColor: 'TEAL', type: EPIC })).toEqual({ ...EPIC, colorToken: 'TEAL' });
    expect(epicTypeSummary({ epicColor: null, type: EPIC })).toBe(EPIC);
    expect(epicTypeSummary({ epicColor: 'TEAL', type: null })).toBeNull();
  });

  it('지금 에픽이 아닌 이슈는 남은 epicColor 를 쓰지 않는다 — 서버 부모 요약 규칙과 같게', () => {
    const task: IssueTypeSummary = { id: 1, name: 'TASK', colorToken: 'BLUE', icon: 'Circle' };
    expect(epicColorToken({ epicColor: 'ORANGE', type: task })).toBe('BLUE');
    expect(epicTypeSummary({ epicColor: 'ORANGE', type: task })).toBe(task);
  });

  it('색점 클래스 — 라벨 색점과 같고, 모르는 토큰은 회색', () => {
    expect(epicDotClass('BLUE')).toBe(LABEL_COLORS.BLUE.dot);
    expect(epicDotClass('MAGENTA')).toBe(LABEL_COLORS.GRAY.dot);
    expect(epicDotClass(undefined)).toBe(LABEL_COLORS.GRAY.dot);
  });
});
