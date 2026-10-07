// 행 메뉴 항목 노출 규칙(WP-273) 단위 테스트 — 권한·다중 선택·AI 위임 조합.
import { describe, expect, it } from 'vitest';

import { type RowMenuContext, rowMenuItems, toggleAssigneeIds } from './issueRowMenu';

const human = { id: 1, username: 'a', name: 'A', kind: 'HUMAN' as const };
const agent = { id: 9, username: 'bot', name: 'Bot', kind: 'AGENT' as const };

function ctx(over: Partial<RowMenuContext> = {}): RowMenuContext {
  return {
    issue: { assignees: [human], reporterId: 1 },
    canEdit: true,
    viewerId: 1,
    viewerIsOwner: false,
    canAssignEpic: true,
    agents: [{ userId: 9 }],
    count: 1,
    ...over,
  };
}

describe('rowMenuItems', () => {
  it('멤버·보고자·단건이면 모든 항목을 보인다', () => {
    expect(rowMenuItems(ctx())).toEqual({
      status: true, assignee: true, priority: true, epic: true, ai: true, copy: true, delete: true,
    });
  });

  it('비멤버는 복사·새 탭만 보인다', () => {
    expect(rowMenuItems(ctx({ canEdit: false }))).toEqual({
      status: false, assignee: false, priority: false, epic: false, ai: false, copy: true, delete: false,
    });
  });

  it('보고자도 OWNER 도 아니면 단건 삭제를 숨긴다', () => {
    expect(rowMenuItems(ctx({ viewerId: 2 })).delete).toBe(false);
    expect(rowMenuItems(ctx({ viewerId: 2, viewerIsOwner: true })).delete).toBe(true);
  });

  it('이미 AI 담당자가 있거나 AI 멤버가 없으면 AI에게 맡기기를 숨긴다', () => {
    expect(rowMenuItems(ctx({ issue: { assignees: [agent], reporterId: 1 } })).ai).toBe(false);
    expect(rowMenuItems(ctx({ agents: [] })).ai).toBe(false);
  });

  it('에픽을 지정할 수 없는 이슈면 에픽 항목을 숨긴다', () => {
    expect(rowMenuItems(ctx({ canAssignEpic: false })).epic).toBe(false);
  });

  it('다중 선택이면 일괄 가능한 항목(상태·담당자·우선순위·삭제)만 보인다', () => {
    expect(rowMenuItems(ctx({ count: 3, viewerId: 2 }))).toEqual({
      status: true, assignee: true, priority: true, epic: false, ai: false, copy: false, delete: true,
    });
  });
});

describe('toggleAssigneeIds', () => {
  it('없으면 넣고 있으면 뺀다', () => {
    expect(toggleAssigneeIds([1], 9)).toEqual([1, 9]);
    expect(toggleAssigneeIds([1, 9], 1)).toEqual([9]);
  });
});
