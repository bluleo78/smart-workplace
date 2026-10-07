// 이슈 행·카드 「⋯」 메뉴(WP-273)의 항목 노출 규칙 — 데스크톱 드롭다운과 모바일 시트가 같은 판정을 쓰도록 순수 함수로 둔다.
// 왜 분리했나: 권한(멤버·삭제)·다중 선택·AI 멤버 유무 조합이 많아 UI 안에 흩어지면 두 화면이 서로 다르게 어긋난다.
import type { IssueResponse } from '../types/issue';
import type { MemberResponse } from '../types/project';

export interface RowMenuContext {
  issue: Pick<IssueResponse, 'assignees' | 'reporterId'>;
  /** 프로젝트 멤버 여부 — 아니면 변경 항목을 숨긴다(서버 assertMember). */
  canEdit: boolean;
  /** 보는 사람 id — 삭제 권한(보고자) 판정용. 미로그인이면 null. */
  viewerId: number | null;
  /** 보는 사람이 프로젝트 OWNER 인가 — 삭제 권한(서버 IssueService: 보고자 또는 OWNER). */
  viewerIsOwner: boolean;
  /** 에픽을 지정할 수 있는 이슈인가(프로젝트에 EPIC 유형이 있고, 이슈가 에픽·SUBTASK 가 아님). */
  canAssignEpic: boolean;
  /** 프로젝트 AI(AGENT) 멤버. */
  agents: Pick<MemberResponse, 'userId'>[];
  /** 메뉴가 적용될 이슈 수 — 2 이상이면 다중 선택 메뉴. */
  count: number;
}

export interface RowMenuItems {
  status: boolean;
  assignee: boolean;
  priority: boolean;
  epic: boolean;
  /** AI에게 맡기기 — 이미 AI 담당자가 있으면 숨긴다(위임 상태). */
  ai: boolean;
  /** 링크·키 복사, 새 탭 열기 — 한 건일 때만. */
  copy: boolean;
  delete: boolean;
}

/** 메뉴에 보일 항목을 계산한다. */
export function rowMenuItems(ctx: RowMenuContext): RowMenuItems {
  const single = ctx.count <= 1;
  const edit = ctx.canEdit;
  const delegated = ctx.issue.assignees.some((a) => a.kind === 'AGENT');
  // 다중 선택 삭제는 일괄 바와 같이 서버가 건별로 판정한다(권한 없는 건은 실패 토스트) — 한 건일 때만 미리 거른다.
  const canDeleteOne = ctx.viewerIsOwner || (ctx.viewerId != null && ctx.viewerId === ctx.issue.reporterId);
  return {
    status: edit,
    assignee: edit,
    priority: edit,
    // 에픽·AI 위임은 한 건 전용 — 일괄 바에 없는 동작이라 다중 선택에선 뺀다.
    epic: edit && single && ctx.canAssignEpic,
    ai: edit && single && ctx.agents.length > 0 && !delegated,
    copy: single,
    delete: edit && (single ? canDeleteOne : true),
  };
}

/** 담당자 집합에서 id 를 넣거나 뺀 새 id 목록 — 메뉴의 담당자 항목은 체크 토글이다(집합 교체 API 라 전체를 보낸다). */
export function toggleAssigneeIds(current: number[], id: number): number[] {
  return current.includes(id) ? current.filter((x) => x !== id) : [...current, id];
}
