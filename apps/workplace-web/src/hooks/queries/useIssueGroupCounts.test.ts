// groupCountsBy — 목록 그룹 헤더 총계를 어떤 기준으로 셀지(WP-472·WP-808).
import { describe, expect, it } from 'vitest';

import { groupCountsBy } from './useIssueGroupCounts';

describe('groupCountsBy', () => {
  it('상태 그룹은 상태 목록을 받았으면 statusId, 아직 모르면(로딩·실패) 범주 버킷과 맞게 status 로 센다', () => {
    expect(groupCountsBy('status', true)).toBe('statusId');
    expect(groupCountsBy('status', false)).toBe('status');
  });

  it('우선순위·담당자는 상태 목록과 상관없이 그대로, 에픽·그룹 없음은 세지 않는다', () => {
    expect(groupCountsBy('priority', false)).toBe('priority');
    expect(groupCountsBy('assignee', true)).toBe('assignee');
    expect(groupCountsBy('epic', true)).toBeNull();
    expect(groupCountsBy(null, true)).toBeNull();
  });
});
