// WP-1777: 이슈 목록 결과 건수 안내 문구(issueResultAnnouncement) 단위 테스트.
// 스크린리더가 읽는 문구가 건수에 따라 정확히 바뀌는지 검증한다.
import { describe, expect, it } from 'vitest';

import { issueResultAnnouncement } from './issueResultAnnouncement';

describe('issueResultAnnouncement', () => {
  it('건수가 1 이상이면 "태스크 N건" 문구를 반환한다', () => {
    expect(issueResultAnnouncement(12)).toBe('태스크 12건');
    expect(issueResultAnnouncement(1)).toBe('태스크 1건');
  });

  it('건수가 0이면 "조건에 맞는 태스크가 없습니다" 문구를 반환한다', () => {
    expect(issueResultAnnouncement(0)).toBe('조건에 맞는 태스크가 없습니다');
  });

  it('건수를 알 수 없으면(undefined) 빈 문자열을 반환한다', () => {
    expect(issueResultAnnouncement(undefined)).toBe('');
  });
});
