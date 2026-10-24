// WP-869: 비서 프롬프트의 이슈 상태 표기 — 상태 이름이 있으면 범주와 함께, 없으면 범주 라벨.
import { describe, it, expect } from 'vitest';
import { statusDisplay } from './status-display.js';

describe('statusDisplay', () => {
  it('statusDisplay: 이름과 범주를 함께 보인다', () => expect(statusDisplay('IN_PROGRESS', '검토 중')).toBe('검토 중(진행 중 범주)'));
  it('기본 상태처럼 이름이 범주 라벨과 같으면 이름만 보인다(중복 표기 없음)', () => {
    expect(statusDisplay('IN_PROGRESS', '진행 중')).toBe('진행 중');
    expect(statusDisplay('DONE', ' 완료 ')).toBe('완료');
  });
  it('범주 라벨과 같은 이름이라도 다른 범주의 라벨이면 범주를 붙인다', () => {
    expect(statusDisplay('IN_PROGRESS', '할 일')).toBe('할 일(진행 중 범주)');
  });
  it('이름이 없으면(구 API) 범주 라벨', () => {
    expect(statusDisplay('DONE')).toBe('완료');
    expect(statusDisplay('TODO', null)).toBe('할 일');
    expect(statusDisplay('CANCELED', '  ')).toBe('취소');
  });
  it('모르는 범주 값은 그대로', () => {
    expect(statusDisplay('BLOCKED')).toBe('BLOCKED');
    expect(statusDisplay('BLOCKED', '막힘')).toBe('막힘(BLOCKED 범주)');
  });
});
