// 이슈 상세 출발 화면 계산 테스트 — 상세 연속 구간 건너뛰기, 기록 없는 위치, 직접 진입(#885).
import { describe, expect, it } from 'vitest';

import { backDeltaToOrigin, isIssueDetailPath } from './issueOrigin';

describe('isIssueDetailPath', () => {
  it('이슈 상세 풀페이지 경로만 참', () => {
    expect(isIssueDetailPath('/projects/WP/issues/12')).toBe(true);
    expect(isIssueDetailPath('/projects/WP')).toBe(false);
    expect(isIssueDetailPath('/projects/WP/timeline')).toBe(false);
    expect(isIssueDetailPath('/me/tasks/assigned')).toBe(false);
  });
});

describe('backDeltaToOrigin', () => {
  it('목록 → 상세: 한 칸 되감는다', () => {
    expect(backDeltaToOrigin({ 0: false, 1: true }, 1)).toBe(-1);
  });

  it('목록 → 상세 → 하위 → 상위: 상세 연속 구간을 건너뛰어 목록까지 되감는다', () => {
    expect(backDeltaToOrigin({ 0: false, 1: false, 2: true, 3: true, 4: true }, 4)).toBe(-3);
  });

  it('직접 진입(아래 위치 없음)은 null', () => {
    expect(backDeltaToOrigin({ 0: true }, 0)).toBeNull();
  });

  it('상세만 이어지다 바닥에 닿으면 null', () => {
    expect(backDeltaToOrigin({ 0: true, 1: true }, 1)).toBeNull();
  });

  it('기록되지 않은 위치(새로고침 이전·로그인 화면)를 만나면 null', () => {
    expect(backDeltaToOrigin({ 0: false, 2: true, 3: true }, 3)).toBeNull();
  });

  it('현재보다 위쪽 위치는 읽지 않는다(뒤로가기 후 남은 앞쪽 기록 무시)', () => {
    // 목록(0) → 상세(1) → 설정(2) 에서 뒤로가기로 상세(1)에 돌아온 상태.
    expect(backDeltaToOrigin({ 0: false, 1: true, 2: false }, 1)).toBe(-1);
  });
});
