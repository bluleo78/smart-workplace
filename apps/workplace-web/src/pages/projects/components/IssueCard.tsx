// 보드 카드 — @dnd-kit sortable.
// 카드 전체에 깔린 stretched 오버레이 Link 로 어디를 눌러도 상세가 열린다(#234).
// 부모 DndContext 의 activationConstraint(distance:5px) 덕에 5px 이상 이동은 드래그, 짧은 클릭은 네비게이션으로 분리.

import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Paperclip } from 'lucide-react';
import { type MouseEvent, useContext } from 'react';
import { Link } from 'react-router-dom';

import { useIsMobile } from '@/hooks/useIsMobile';
import { useLongPressCapture } from '@/hooks/useLongPressCapture';

import { IssuePriorityBars } from '../../../components/issues/IssuePriorityBars';
import { IssueStatusIcon } from '../../../components/issues/IssueStatusIcon';
import { ParentChip } from '../../../components/issues/ParentChip';
import { IssueTypeBadge } from '../../../components/issueTypes/IssueTypeBadge';
import { LabelChip } from '../../../components/labels/LabelChip';
import { UserAvatar } from '../../../components/users/UserAvatar';
import type { IssueDragData } from '../../../lib/epicDnd';
import type { IssueResponse } from '../../../types/issue';
import type { OpenRowMenu } from '../hooks/useIssueRowActions';
import { IssueCardMenuContext } from './issueCardMenuContext';
import { IssueMobileMeta } from './IssueMobileMeta';
import { RowMenuButton } from './RowMenuButton';

export function IssueCard({
  projectKey,
  issue,
  asOverlay = false,
  to,
  showType = true,
  showStatus = false,
  dragDisabled = false,
  dragScope,
  onLongPress,
}: {
  projectKey: string;
  issue: IssueResponse;
  // DragOverlay 안에서 렌더될 때는 sortable 훅을 쓰지 않고 정적으로 그린다.
  asOverlay?: boolean;
  // 카드 클릭 시 이동 경로 override. 미지정 시 팀 풀페이지 상세 경로(기본).
  // 개인 보드는 `?view=board&task=N`(같은 라우트 검색파라미터) 를 넘겨 drawer 를 연다.
  to?: string;
  // 유형 아이콘 표시(기본 true). 개인 보드는 TASK 고정이라 false 로 숨김.
  showType?: boolean;
  // 상태 아이콘 표시(기본 false). 비-상태 그룹(담당자/우선순위) 컬럼에서만 true — 컬럼이 상태를 안 드러내므로.
  showStatus?: boolean;
  // 비멤버는 드래그 자체를 막는다(상태·에픽 모두 서버 assertMember 대상).
  dragDisabled?: boolean;
  // 한 이슈가 여러 컬럼에 보일 때(담당자 그룹의 다중 담당자) 드래그 id 를 컬럼별로 구분하는 범위 키.
  // dnd-kit 은 id 로 노드를 등록하므로 겹치면 두 사본이 함께 흐려지고 고스트가 다른 사본 위치에서 뜬다.
  // 상태 보드는 SortableContext items(`issue-{id}`)와 맞아야 하므로 지정하지 않는다.
  dragScope?: string;
  // 모바일 길게 누르기(WP-193) — 상태 변경·에픽 지정 액션 시트를 연다. 드래그 대신.
  onLongPress?: (issue: IssueResponse) => void;
}) {
  const isMobile = useIsMobile();
  const mobileBody = isMobile && !asOverlay;
  // ⋯·우클릭 메뉴(WP-273) — 보드가 컨텍스트로 준다. 드래그 고스트(asOverlay)에는 달지 않는다.
  const { openMenu, menuIssueNumber } = useContext(IssueCardMenuContext);
  const onOpenMenu = asOverlay ? undefined : openMenu;
  const menuOpen = menuIssueNumber === issue.number;
  // 데스크톱 우클릭 — 커서 위치에 메뉴. 모바일은 useLongPressCapture 의 onContextMenu(길게 터치)를 쓴다.
  const desktopContextMenu = !isMobile && onOpenMenu
    ? (e: MouseEvent<HTMLDivElement>) => {
        e.preventDefault();
        const r = e.currentTarget.getBoundingClientRect();
        const keyboard = e.clientX === 0 && e.clientY === 0;
        onOpenMenu(issue, { x: keyboard ? r.left + 16 : e.clientX, y: keyboard ? r.bottom : e.clientY, align: 'start' });
      }
    : undefined;
  // 캡처 단계 click 억제 — 전면 오버레이 <Link> 이동까지 막는다. 콜백은 모바일·액션이 있을 때만 온다.
  // 모바일에선 액션이 없어도(비멤버) 길게 눌렀다 뗀 click 은 삼킨다 — 상세로 넘어가지 않게(WP-217).
  const press = useLongPressCapture({
    onLongPress: onLongPress ? () => onLongPress(issue) : undefined,
    suppressLongClick: mobileBody,
  });
  const sortable = useSortable({
    id: dragScope ? `issue-${dragScope}-${issue.id}` : `issue-${issue.id}`,
    // issueNumber/status: 보드 상태 드롭용, issue/source/showType: 에픽 드롭·오버레이용(IssueDragData).
    data: { issueNumber: issue.number, status: issue.status, issue, source: 'card', showType } satisfies IssueDragData,
    disabled: asOverlay || dragDisabled,
  });
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    sortable;

  // 드래그 중 원본은 placeholder 만 남기고 visible 한 카드는 DragOverlay 가 그린다.
  const style = asOverlay
    ? { cursor: 'grabbing' as const }
    : {
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.4 : 1,
      };

  // identifier 는 백엔드가 별도로 내려주지 않으므로 클라이언트에서 합성한다.
  const identifier = `${projectKey}-${issue.number}`;
  // SUBTASK 여부 — 카드 헤더에 부모 식별자(└) 표시 분기에 사용.
  const isSubtask = issue.type?.name === 'SUBTASK';

  // 링크 대상 — override(개인 drawer) 우선, 미지정 시 팀 풀페이지 상세 경로(기본).
  const linkTo = to ?? `/projects/${projectKey}/issues/${issue.number}`;

  return (
    <div
      ref={asOverlay ? undefined : setNodeRef}
      style={style}
      // 모바일에서 드래그 불가면 dnd-kit 속성(role=button·roledescription="sortable")도 붙이지 않는다 —
      // 끌 수 없는 카드를 정렬 가능으로 안내하지 않게(카드 이동은 오버레이 Link 가 담당). 데스크톱 DOM 은 그대로.
      {...(asOverlay || (dragDisabled && isMobile) ? {} : attributes)}
      {...(asOverlay || (dragDisabled && isMobile) ? {} : listeners)}
      {...(asOverlay ? {} : press)}
      {...(desktopContextMenu && { onContextMenu: desktopContextMenu })}
      // 오버레이(드래그 고스트)는 불투명 표면(bg-popover)만 쓴다 — 포인터가 항상 위에 있어 hover:bg-accent/30(반투명)이
      // 배경을 덮고, 다크의 --card 는 3% 알파라 아래 에픽 패널 글자가 비쳐 보였다(11-dark-mode: 떠 있는 레이어는 솔리드).
      className={`group relative rounded-md border p-3 text-sm transition-colors ${
        asOverlay
          ? 'bg-popover shadow-xl ring-2 ring-primary/40'
          : `${menuOpen ? 'bg-accent/30' : 'bg-card'} shadow-sm hover:bg-accent/30${dragDisabled ? '' : ' cursor-grab active:cursor-grabbing'}${isMobile ? ' select-none [-webkit-touch-callout:none]' : ''}`
      }`}
      // 오버레이는 별도 testid — 원본 카드와 testid 가 겹치면 드래그 중 카드 조회가 모호해진다.
      data-testid={asOverlay ? 'issue-card-drag-overlay' : `issue-card-${issue.number}`}
    >
      {/* 드래그 핸들 — hover 시만 표시. pointer-events-none 으로 클릭/드래그 방해 없음. */}
      {!asOverlay && (
        <div
          className="pointer-events-none absolute left-1 top-1/2 z-10 -translate-y-1/2 opacity-0 transition-opacity group-hover:opacity-40"
          data-testid="issue-card-grip"
          aria-hidden="true"
        >
          <GripVertical className="h-4 w-4 text-muted-foreground" />
        </div>
      )}

      {/* 차단된 이슈에 ⛔ 우상단 마커 — 오버레이 위로(z-10). */}
      {issue.blocked && (
        <span
          className="absolute right-2 top-2 z-10 text-destructive text-sm"
          data-testid={`issue-card-${issue.number}-blocked`}
          aria-label="차단됨"
          title="차단됨"
        >
          ⛔
        </span>
      )}

      {/* 데스크톱 ⋯ — 호버·포커스 때 오른쪽 위에 뜬다. 전면 오버레이 링크(z-0)보다 위(z-20), 차단 ⛔ 도 덮는다. */}
      {onOpenMenu && !mobileBody && (
        <RowMenuButton
          issue={issue}
          onOpenMenu={onOpenMenu}
          open={menuOpen}
          testId={`issue-card-${issue.number}-menu`}
          className="absolute right-1 top-1 z-20 bg-card"
        />
      )}

      {/* 모바일 본문(WP-195) — 드래그 고스트(asOverlay)는 데스크톱 본문 그대로. */}
      {mobileBody && <MobileCardBody issue={issue} projectKey={projectKey} showStatus={showStatus} showType={showType} onOpenMenu={onOpenMenu} />}
      {!mobileBody && (
        <>
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1 font-medium">
          {showStatus && <IssueStatusIcon status={issue.status} className="h-4 w-4" />}
          {showType && issue.type && <IssueTypeBadge type={issue.type} size="sm" iconOnly />}
          {/* SUBTASK 면 부모 식별자(└ KEY-N) 를 제목 앞에 작게 표시. */}
          {isSubtask && issue.parent && (
            <span
              className="text-xs text-muted-foreground mr-1 font-mono"
              data-testid={`issue-card-${issue.number}-parent`}
            >
              └ {projectKey}-{issue.parent.number}
            </span>
          )}
          <span className="text-muted-foreground mr-1 font-mono text-xs">{identifier}</span>
          <span className="truncate">{issue.title}</span>
        </span>
        <IssuePriorityBars priority={issue.priority} />
      </div>

      <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
        <span
          className="flex items-center -space-x-1"
          data-testid={`issue-card-${issue.number}-assignees`}
        >
          {issue.assignees.length === 0 ? (
            <span>미지정</span>
          ) : (
            <>
              {issue.assignees.slice(0, 3).map((u) => (
                // AGENT(AI) 담당자는 보라색 ring + Bot 마커로 사람과 시각 구분 (#199).
                <UserAvatar key={u.id} user={u} size="xs" ring agent={u.kind === 'AGENT'} />
              ))}
              {issue.assignees.length > 3 && (
                <span className="text-xs text-muted-foreground ml-1">
                  +{issue.assignees.length - 3}
                </span>
              )}
            </>
          )}
        </span>
        <div className="flex items-center gap-2">
          {issue.attachmentCount > 0 && (
            <span
              className="inline-flex items-center gap-0.5"
              aria-label={`첨부 ${issue.attachmentCount}개`}
              data-testid={`issue-card-${issue.number}-attachment-count`}
            >
              <Paperclip className="h-3 w-3" />
              {issue.attachmentCount}
            </span>
          )}
          {/* 비SUBTASK 인 부모 카드라면 자식 진행률 표시. */}
          {!isSubtask && issue.childCount > 0 && (
            <span
              className="inline-flex items-center gap-0.5"
              data-testid={`issue-card-${issue.number}-child-progress`}
              aria-label={`자식 SUBTASK ${issue.childDoneCount}/${issue.childCount}`}
            >
              └ {issue.childDoneCount}/{issue.childCount}
            </span>
          )}
          {issue.dueDate && <span>~{issue.dueDate}</span>}
        </div>
      </div>

      {/* 소속 에픽 배지(Jira 카드 관례) — 보드는 에픽 카드를 숨기므로 카드에서 소속을 드러낸다.
          SUBTASK 는 헤더의 └ KEY-N 로 부모를 표시하므로 제외(비SUBTASK 의 부모는 EPIC). */}
      {!isSubtask && issue.parent && (
        <div className="mt-2 flex min-w-0">
          <ParentChip projectKey={projectKey} parent={issue.parent} issueNumber={issue.number} variant="card" />
        </div>
      )}

      {issue.labels.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {issue.labels.slice(0, 3).map((l) => (
            <LabelChip key={l.id} label={l} size="sm" />
          ))}
          {issue.labels.length > 3 && (
            <span className="text-xs text-muted-foreground">
              +{issue.labels.length - 3}
            </span>
          )}
        </div>
      )}
        </>
      )}

      {/* 카드 전체 클릭 영역 — 마지막 자식 + absolute inset-0 로 카드 위를 덮는다.
          DragOverlay 고스트(asOverlay)에는 깔지 않음. pointerdown 은 루트로 버블 → dnd 가 드래그 판정. */}
      {!asOverlay && (
        <Link
          to={linkTo}
          aria-label={`${identifier} ${issue.title} 상세 보기`}
          data-testid={`issue-card-${issue.number}-link`}
          className="absolute inset-0"
        />
      )}
    </div>
  );
}

// 모바일 카드 본문(WP-195) — 시안 B: 제목은 자기 줄에서 최대 2줄, 키·에픽·꼬리·담당자는 목록 행과 같은 메타 한 줄.
// 좁은 폭에서 「WP-/1047」 처럼 ID 가 꺾이던 문제를 메타 줄(nowrap)로 옮겨 없앤다. 차단 ⛔ 자리는 pr-5 로 비운다.
function MobileCardBody({
  issue,
  projectKey,
  showStatus,
  showType,
  onOpenMenu,
}: {
  issue: IssueResponse;
  projectKey: string;
  showStatus: boolean;
  showType: boolean;
  /** 「⋯」 → 액션 시트(WP-273 시안 M1). 전면 링크 위로 올려(z-10) 탭이 상세 이동으로 새지 않게 한다. */
  onOpenMenu?: OpenRowMenu;
}) {
  return (
    <>
      <div className={`flex min-w-0 items-start gap-1.5${issue.blocked ? ' pr-5' : ''}`}>
        {showStatus && <IssueStatusIcon status={issue.status} className="mt-0.5 h-4 w-4 shrink-0" />}
        {showType && issue.type && (
          <span className="mt-0.5 shrink-0">
            <IssueTypeBadge type={issue.type} size="sm" iconOnly />
          </span>
        )}
        <span
          className="line-clamp-2 min-w-0 flex-1 break-words font-medium leading-snug"
          data-testid={`issue-card-${issue.number}-title`}
        >
          {issue.title}
        </span>
        {onOpenMenu && (
          <RowMenuButton issue={issue} onOpenMenu={onOpenMenu} alwaysVisible testId={`issue-card-${issue.number}-menu`} className="relative z-10" />
        )}
      </div>
      <IssueMobileMeta issue={issue} projectKey={projectKey} testIdPrefix={`issue-card-${issue.number}`} className="mt-1.5" />
    </>
  );
}
