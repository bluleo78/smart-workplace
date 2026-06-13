// 보드 카드 — @dnd-kit sortable.
// 카드 전체에 깔린 stretched 오버레이 Link 로 어디를 눌러도 상세가 열린다(#234).
// 부모 DndContext 의 activationConstraint(distance:5px) 덕에 5px 이상 이동은 드래그, 짧은 클릭은 네비게이션으로 분리.

import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Paperclip } from 'lucide-react';
import { Link } from 'react-router-dom';

import { IssuePriorityBars } from '../../../components/issues/IssuePriorityBars';
import { IssueStatusIcon } from '../../../components/issues/IssueStatusIcon';
import { IssueTypeBadge } from '../../../components/issueTypes/IssueTypeBadge';
import { LabelChip } from '../../../components/labels/LabelChip';
import { UserAvatar } from '../../../components/users/UserAvatar';
import type { IssueResponse } from '../../../types/issue';

export function IssueCard({
  projectKey,
  issue,
  asOverlay = false,
  to,
  showType = true,
  showStatus = false,
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
}) {
  const sortable = useSortable({
    id: `issue-${issue.id}`,
    data: { issueNumber: issue.number, status: issue.status },
    disabled: asOverlay,
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
      {...(asOverlay ? {} : attributes)}
      {...(asOverlay ? {} : listeners)}
      className={`relative rounded-md border bg-card p-3 text-sm shadow-sm ${
        asOverlay ? 'shadow-xl ring-2 ring-primary/40' : 'cursor-grab active:cursor-grabbing'
      }`}
      data-testid={`issue-card-${issue.number}`}
    >
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

      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1 font-medium">
          {showStatus && <IssueStatusIcon status={issue.status} className="h-4 w-4" />}
          {showType && issue.type && <IssueTypeBadge type={issue.type} size="sm" iconOnly />}
          {/* SUBTASK 면 부모 식별자(└ KEY-N) 를 제목 앞에 작게 표시. */}
          {isSubtask && issue.parent && (
            <span
              className="text-[10px] text-muted-foreground mr-1 font-mono"
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
                <span className="text-[10px] text-muted-foreground ml-1">
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

      {issue.labels.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {issue.labels.slice(0, 3).map((l) => (
            <LabelChip key={l.id} label={l} size="sm" />
          ))}
          {issue.labels.length > 3 && (
            <span className="text-[10px] text-muted-foreground">
              +{issue.labels.length - 3}
            </span>
          )}
        </div>
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
