// 이슈 행·카드 「⋯」/우클릭 메뉴 — 데스크톱 전용(WP-273, 시안 A). 모바일은 useIssueRowActions 의 바텀시트가 맡는다.
// 목록·보드가 메뉴 하나만 소유하고(행 memo 유지), 열린 위치(x,y)에 0 크기 고정 트리거를 두어 Radix 드롭다운을 띄운다.
// 행 안이 아니라 표 밖 형제로 렌더한다 — 포털이어도 React 이벤트는 부모로 버블하므로, 행 안에 두면 항목 클릭이
// <tr onClick>(상세 이동)·드래그 리스너까지 올라간다.
import { Bot, CircleDot, ExternalLink, Hash, Layers, Link2, SignalHigh, Trash2, UserRound } from 'lucide-react';

import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

import { IssuePriorityBars } from '../../../components/issues/IssuePriorityBars';
import { IssueStatusIcon } from '../../../components/issues/IssueStatusIcon';
import { AgentBadge } from '../../../components/users/AgentBadge';
import { UserAvatar } from '../../../components/users/UserAvatar';
import { ISSUE_PRIORITY_OPTIONS, ISSUE_STATUS_LABEL } from '../../../lib/issueGrouping';
import type { RowMenuItems } from '../../../lib/issueRowMenu';
import type { IssuePriority, IssueResponse, IssueStatus } from '../../../types/issue';
import type { MemberResponse } from '../../../types/project';

/** 메뉴가 열린 대상 — at 은 뷰포트 좌표(우클릭 지점 또는 ⋯ 버튼 아래 모서리). */
export interface RowMenuTarget {
  issue: IssueResponse;
  at: { x: number; y: number };
  /** ⋯ 버튼에서 열면 오른쪽 끝 정렬(버튼 아래로 펼침), 우클릭이면 커서에서 시작. */
  align: 'start' | 'end';
  /** 적용 대상 이슈 번호 — 다중 선택 행에서 열면 선택 전체, 아니면 [issue.number]. */
  numbers: number[];
}

export function IssueRowMenu({
  target,
  onClose,
  items,
  statuses,
  members,
  agents,
  epics,
  assigneeIds,
  onStatus,
  onPriority,
  onToggleAssignee,
  onBulkAssign,
  onEpic,
  onDelegate,
  onCopyLink,
  onCopyKey,
  onOpenTab,
  onDelete,
}: {
  target: RowMenuTarget | null;
  onClose: () => void;
  items: RowMenuItems;
  statuses: IssueStatus[];
  members: MemberResponse[];
  agents: MemberResponse[];
  /** 지정 가능한 진행 중 에픽 — 에픽 항목을 열 때만 쓰인다. */
  epics: IssueResponse[];
  /** 단건 메뉴의 현재 담당자 id — 체크 토글 중에도 메뉴가 열려 있으므로 호출처가 로컬 상태로 들고 있다. */
  assigneeIds: number[];
  onStatus: (s: IssueStatus) => void;
  onPriority: (p: IssuePriority) => void;
  onToggleAssignee: (m: MemberResponse) => void;
  /** 다중 선택 담당자 지정 — 일괄 바와 같은 집합 교체(빈 배열 = 미지정). */
  onBulkAssign: (userIds: number[]) => void;
  onEpic: (epic: IssueResponse | null) => void;
  onDelegate: (agent: MemberResponse) => void;
  onCopyLink: () => void;
  onCopyKey: () => void;
  onOpenTab: () => void;
  onDelete: () => void;
}) {
  const issue = target?.issue;
  const count = target?.numbers.length ?? 0;
  const bulk = count > 1;
  // 단건 현재 값 — 라디오처럼 ✓ 를 보여 준다(다중 선택은 행마다 달라 표시하지 않음).
  const cur = bulk ? null : issue;

  return (
    <DropdownMenu open={target != null} onOpenChange={(o) => !o && onClose()} modal>
      <DropdownMenuTrigger asChild>
        {/* 0 크기 고정 앵커 — 우클릭 지점·⋯ 버튼 모서리. 탭 순서·스크린리더에서 뺀다. */}
        <span
          aria-hidden="true"
          tabIndex={-1}
          className="pointer-events-none fixed size-0"
          style={{ left: target?.at.x ?? 0, top: target?.at.y ?? 0 }}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align={target?.align ?? 'start'}
        sideOffset={4}
        className="w-56"
        data-testid="issue-row-menu"
        // 앵커가 보이지 않는 span 이라 닫힐 때 포커스를 되돌리지 않는다(행으로 튀어 스크롤되는 것 방지).
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        {bulk && <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">선택한 {count}개 이슈</DropdownMenuLabel>}

        {items.status && (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger data-testid="row-menu-status"><CircleDot />상태</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              {statuses.map((s) => (
                <DropdownMenuCheckboxItem key={s} checked={cur?.status === s} onSelect={() => onStatus(s)} data-testid={`row-menu-status-${s}`}>
                  <IssueStatusIcon status={s} decorative />
                  {ISSUE_STATUS_LABEL[s]}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        )}

        {items.assignee && (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger data-testid="row-menu-assignee"><UserRound />담당자</DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="max-h-72 w-56 overflow-y-auto">
              {bulk && (
                <DropdownMenuItem onSelect={() => onBulkAssign([])} data-testid="row-menu-assignee-none">미지정</DropdownMenuItem>
              )}
              {members.map((m) =>
                bulk ? (
                  <DropdownMenuItem key={m.userId} onSelect={() => onBulkAssign([m.userId])} data-testid={`row-menu-assignee-${m.userId}`}>
                    <UserAvatar user={{ id: m.userId, username: m.username, name: m.name }} size="xs" agent={m.kind === 'AGENT'} />
                    <span className="truncate">{m.name}</span>
                  </DropdownMenuItem>
                ) : (
                  // 단건은 다중 담당자 토글 — 고른 뒤에도 메뉴를 열어 두어 여러 명을 연달아 바꿀 수 있게 한다.
                  <DropdownMenuCheckboxItem
                    key={m.userId}
                    checked={assigneeIds.includes(m.userId)}
                    onSelect={(e) => {
                      e.preventDefault();
                      onToggleAssignee(m);
                    }}
                    data-testid={`row-menu-assignee-${m.userId}`}
                  >
                    <UserAvatar user={{ id: m.userId, username: m.username, name: m.name }} size="xs" agent={m.kind === 'AGENT'} />
                    <span className="truncate">{m.name}</span>
                    {m.kind === 'AGENT' && <AgentBadge size="xs" />}
                  </DropdownMenuCheckboxItem>
                ),
              )}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        )}

        {items.priority && (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger data-testid="row-menu-priority"><SignalHigh />우선순위</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              {ISSUE_PRIORITY_OPTIONS.map((o) => (
                <DropdownMenuCheckboxItem key={o.value} checked={cur?.priority === o.value} onSelect={() => onPriority(o.value)} data-testid={`row-menu-priority-${o.value}`}>
                  <IssuePriorityBars priority={o.value} />
                  {o.label}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        )}

        {items.epic && (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger data-testid="row-menu-epic"><Layers />에픽</DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="max-h-72 w-64 overflow-y-auto">
              <DropdownMenuCheckboxItem checked={cur?.parent == null} onSelect={() => onEpic(null)} data-testid="row-menu-epic-none">
                에픽 없음
              </DropdownMenuCheckboxItem>
              {epics.map((e) => (
                <DropdownMenuCheckboxItem key={e.number} checked={cur?.parent?.number === e.number} onSelect={() => onEpic(e)} data-testid={`row-menu-epic-${e.number}`}>
                  <span className="min-w-0 flex-1 truncate">{e.title}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{e.childDoneCount}/{e.childCount}</span>
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        )}

        {items.ai &&
          (agents.length === 1 ? (
            <DropdownMenuItem onSelect={() => onDelegate(agents[0])} className="text-ai-accent [&_svg]:text-ai-accent" data-testid="row-menu-ai">
              <Bot />AI에게 맡기기
            </DropdownMenuItem>
          ) : (
            // AI 멤버가 여럿이면 누구에게 맡길지 고른다.
            <DropdownMenuSub>
              <DropdownMenuSubTrigger className="text-ai-accent [&_svg]:text-ai-accent" data-testid="row-menu-ai"><Bot />AI에게 맡기기</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {agents.map((a) => (
                  <DropdownMenuItem key={a.userId} onSelect={() => onDelegate(a)} data-testid={`row-menu-ai-${a.userId}`}>
                    <UserAvatar user={{ id: a.userId, username: a.username, name: a.name }} size="xs" agent />
                    {a.name}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          ))}

        {items.copy && (
          <>
            {(items.status || items.ai) && <DropdownMenuSeparator />}
            <DropdownMenuItem onSelect={onCopyLink} data-testid="row-menu-copy-link"><Link2 />링크 복사</DropdownMenuItem>
            <DropdownMenuItem onSelect={onCopyKey} data-testid="row-menu-copy-key">
              <Hash />키 복사
              <span className="ml-auto font-mono text-xs text-muted-foreground">{issue ? `${issue.projectKey}-${issue.number}` : ''}</span>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onOpenTab} data-testid="row-menu-open-tab"><ExternalLink />새 탭에서 열기</DropdownMenuItem>
          </>
        )}

        {items.delete && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={onDelete} data-testid="row-menu-delete">
              <Trash2 />{bulk ? `${count}개 삭제` : '삭제'}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
