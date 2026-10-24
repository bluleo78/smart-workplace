// groupCountsBy — 목록 그룹 헤더 총계를 어떤 기준으로 셀지(WP-472·WP-808).
import { describe, expect, it } from 'vitest';

import { groupCountsBy } from './useIssueGroupCounts';

describe('groupCountsBy', () => {
  it('상태 그룹은 프로젝트 상태별 버킷이라 statusId 로 센다', () => {
    expect(groupCountsBy('status')).toBe('statusId');
  });

  it('우선순위·담당자는 그대로, 에픽·그룹 없음은 세지 않는다', () => {
    expect(groupCountsBy('priority')).toBe('priority');
    expect(groupCountsBy('assignee')).toBe('assignee');
    expect(groupCountsBy('epic')).toBeNull();
    expect(groupCountsBy(null)).toBeNull();
  });
});
