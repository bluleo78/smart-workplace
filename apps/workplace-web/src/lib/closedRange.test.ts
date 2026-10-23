// WP-873 완료일 기간 — 프리셋 계산(KST·월요일 시작)·토큰 검증·라벨.
import { describe, expect, it } from 'vitest';

import {
  CLOSED_PRESETS,
  closedRangeLabel,
  formatClosedSpan,
  parseClosedIn,
  resolveClosedRange,
} from './closedRange';

// 2026-10-23 은 금요일, 2027-01-03 은 일요일(주 경계·연 경계 확인용).
const FRI = new Date('2026-10-23T12:00:00+09:00');
const SUN_NEW_YEAR = new Date('2027-01-03T12:00:00+09:00');

describe('CLOSED_PRESETS', () => {
  it('문구·순서가 고정이다', () => {
    expect(CLOSED_PRESETS.map((p) => p.label)).toEqual([
      '오늘',
      '이번 주',
      '지난 주',
      '이번 달',
      '지난 달',
      '최근 30일',
    ]);
    expect(CLOSED_PRESETS.map((p) => p.value)).toEqual([
      'today',
      'this-week',
      'last-week',
      'this-month',
      'last-month',
      'last-30d',
    ]);
  });
});

describe('resolveClosedRange', () => {
  it('금요일 기준 6개 프리셋', () => {
    expect(resolveClosedRange('today', FRI)).toEqual({ from: '2026-10-23', to: '2026-10-23' });
    expect(resolveClosedRange('this-week', FRI)).toEqual({ from: '2026-10-19', to: '2026-10-23' });
    expect(resolveClosedRange('last-week', FRI)).toEqual({ from: '2026-10-12', to: '2026-10-18' });
    expect(resolveClosedRange('this-month', FRI)).toEqual({ from: '2026-10-01', to: '2026-10-23' });
    expect(resolveClosedRange('last-month', FRI)).toEqual({ from: '2026-09-01', to: '2026-09-30' });
    expect(resolveClosedRange('last-30d', FRI)).toEqual({ from: '2026-09-24', to: '2026-10-23' });
  });

  it('일요일은 그 주의 마지막 날 — 주가 월요일에 시작하고 연을 넘는다', () => {
    expect(resolveClosedRange('this-week', SUN_NEW_YEAR)).toEqual({ from: '2026-12-28', to: '2027-01-03' });
    expect(resolveClosedRange('last-week', SUN_NEW_YEAR)).toEqual({ from: '2026-12-21', to: '2026-12-27' });
    expect(resolveClosedRange('last-month', SUN_NEW_YEAR)).toEqual({ from: '2026-12-01', to: '2026-12-31' });
    expect(resolveClosedRange('this-month', SUN_NEW_YEAR)).toEqual({ from: '2027-01-01', to: '2027-01-03' });
  });

  it('월요일은 이번 주가 하루뿐', () => {
    const mon = new Date('2026-10-19T09:00:00+09:00');
    expect(resolveClosedRange('this-week', mon)).toEqual({ from: '2026-10-19', to: '2026-10-19' });
    expect(resolveClosedRange('last-week', mon)).toEqual({ from: '2026-10-12', to: '2026-10-18' });
  });

  it('윤년 2월 말·3월 초의 지난 달', () => {
    expect(resolveClosedRange('last-month', new Date('2028-03-05T12:00:00+09:00'))).toEqual({
      from: '2028-02-01',
      to: '2028-02-29',
    });
  });

  it('KST 날짜 기준 — UTC 로는 전날인 새벽도 KST 오늘로 센다', () => {
    // 2026-10-22T15:30Z = KST 10/23 00:30
    expect(resolveClosedRange('today', new Date('2026-10-22T15:30:00Z'))).toEqual({
      from: '2026-10-23',
      to: '2026-10-23',
    });
  });

  it('직접 지정 토큰은 그대로, 잘못된 토큰은 null', () => {
    expect(resolveClosedRange('2026-10-12~2026-10-18', FRI)).toEqual({ from: '2026-10-12', to: '2026-10-18' });
    expect(resolveClosedRange('yesterday', FRI)).toBeNull();
    expect(resolveClosedRange('2026-10-18~2026-10-12', FRI)).toBeNull();
  });
});

describe('parseClosedIn', () => {
  it('프리셋 토큰·유효한 직접 지정만 통과', () => {
    expect(parseClosedIn('last-week')).toBe('last-week');
    expect(parseClosedIn('2026-10-12~2026-10-18')).toBe('2026-10-12~2026-10-18');
    expect(parseClosedIn('2026-10-12~2026-10-12')).toBe('2026-10-12~2026-10-12');
  });
  it('모르는 토큰·없는 날짜·from>to·null·빈 값은 null', () => {
    expect(parseClosedIn('yesterday')).toBeNull();
    expect(parseClosedIn('2026-13-01~2026-13-02')).toBeNull();
    expect(parseClosedIn('2026-10-18~2026-10-12')).toBeNull();
    expect(parseClosedIn('2026-10-12')).toBeNull();
    expect(parseClosedIn('2026-10-12~')).toBeNull();
    expect(parseClosedIn('')).toBeNull();
    expect(parseClosedIn(null)).toBeNull();
  });
});

describe('closedRangeLabel', () => {
  it('프리셋은 이름과 기간을, 직접 지정은 기간만', () => {
    expect(closedRangeLabel('last-week', FRI)).toBe('지난 주 (10/12–10/18)');
    expect(closedRangeLabel('today', FRI)).toBe('오늘 (10/23)'); // 하루짜리는 날짜 한 번
    expect(closedRangeLabel('2026-10-12~2026-10-18', FRI)).toBe('10/12–10/18');
    expect(closedRangeLabel('2026-10-05~2026-10-05', FRI)).toBe('10/5');
    expect(closedRangeLabel('2025-12-31~2025-12-31', FRI)).toBe('2025/12/31'); // 연도 규칙 유지
  });
  it('올해(KST)가 아닌 쪽에만 연도를 붙인다', () => {
    expect(closedRangeLabel('2025-12-29~2026-01-04', FRI)).toBe('2025/12/29–1/4');
    expect(closedRangeLabel('2025-12-29~2025-12-31', FRI)).toBe('2025/12/29–2025/12/31');
    expect(closedRangeLabel('2026-12-28~2027-01-03', FRI)).toBe('12/28–2027/1/3');
    // 해가 바뀐 직후의 「지난 주」는 전년이라 양쪽 모두 연도가 붙는다
    expect(closedRangeLabel('last-week', SUN_NEW_YEAR)).toBe('지난 주 (2026/12/21–2026/12/27)');
  });
  it('잘못된 토큰은 빈 문자열', () => {
    expect(closedRangeLabel('yesterday', FRI)).toBe('');
  });
});

// 칩 라벨과 「기간 직접 지정」 패널 요약이 함께 쓰는 구간 표기 — 둘이 어긋나지 않게 한 함수로 지킨다.
describe('formatClosedSpan', () => {
  it('올해가 아닌 쪽에만 연도를 붙이고 하루짜리는 한 번만 보인다', () => {
    expect(formatClosedSpan('2025-12-29', '2026-01-04', FRI)).toBe('2025/12/29–1/4');
    expect(formatClosedSpan('2026-10-01', '2026-10-10', FRI)).toBe('10/1–10/10');
    expect(formatClosedSpan('2026-10-05', '2026-10-05', FRI)).toBe('10/5');
    expect(formatClosedSpan('2025-12-31', '2025-12-31', FRI)).toBe('2025/12/31');
  });
  it('직접 지정 토큰의 칩 라벨과 같은 문구다', () => {
    expect(formatClosedSpan('2025-12-29', '2026-01-04', FRI)).toBe(closedRangeLabel('2025-12-29~2026-01-04', FRI));
  });
});
