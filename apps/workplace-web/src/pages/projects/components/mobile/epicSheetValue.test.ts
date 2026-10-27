// 에픽 시트 값 변환(WP-1039) — 지금 부모를 시트 체크 값으로, 고른 값을 에픽 번호로. 상세·생성 칩 시트와 행 메뉴 시트가 같은 함수를 쓴다.
import { describe, expect, it } from 'vitest';

import { epicFromSheetValue, epicSheetValue, NO_EPIC_SHEET_OPTION } from './epicSheetValue';

describe('epicSheetValue', () => {
  it('같은 프로젝트 에픽만 그 번호 줄, 없으면 「에픽 없음」, 다른 프로젝트·가려진 부모는 체크 없음', () => {
    expect(epicSheetValue(null, 'WP')).toBe(NO_EPIC_SHEET_OPTION.value);
    expect(epicSheetValue({ number: 5 }, 'WP')).toBe('5');
    expect(epicSheetValue({ number: 5, projectKey: 'WP' }, 'WP')).toBe('5');
    expect(epicSheetValue({ number: 5, projectKey: 'CLA' }, 'WP')).toBeNull();
    expect(epicSheetValue({ number: 0, hidden: true }, 'WP')).toBeNull();
  });

  it('고른 값은 「에픽 없음」이면 null, 그 밖엔 에픽 번호', () => {
    expect(epicFromSheetValue(NO_EPIC_SHEET_OPTION.value)).toBeNull();
    expect(epicFromSheetValue('12')).toBe(12);
  });
});
