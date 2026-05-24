// 보드 카드 — @dnd-kit sortable.
// 부모 DndContext 의 activationConstraint(distance:5px) 가 잡혀 있어
// 짧은 클릭은 Link 내비게이션, 5px 이상 드래그는 sort/drop 으로 분리된다.

import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Paperclip } from 'lucide-react';
import { Link } from 'react-router-dom';

import { IssueTypeBadge } from '../../../components/issueTypes/IssueTypeBadge';
import { LabelChip } from '../../../components/labels/LabelChip';
import { UserAvatar } from '../../../components/users/UserAvatar';
import type { IssueResponse } from '../../../types/issue';
import { IssuePriorityBadge } from './IssuePriorityBadge';

export function IssueCard({
  projectKey,
  issue,
  asOverlay = false,
}: {
  projectKey: string;
  issue: IssueResponse;
  // DragOverlay 안에서 렌더될 때는 sortable 훅을 쓰지 않고 정적으로 그린다.
  asOverlay?: boolean;
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

  return (
    <div
      ref={asOverlay ? undefined : setNodeRef}
      style={style}
      {...(asOverlay ? {} : attributes)}
      {...(asOverlay ? {} : listeners)}
      className={`rounded-md border bg-card p-3 text-sm shadow-sm ${
        asOverlay ? 'shadow-xl ring-2 ring-primary/40' : 'cursor-grab active:cursor-grabbing'
      }`}
      data-testid={`issue-card-${issue.number}`}
    >
      <div className="flex items-center justify-between gap-2">
        <Link
          to={`/projects/${projectKey}/issues/${issue.number}`}
          className="font-medium hover:underline truncate flex items-center gap-1"
          onPointerDown={(e) => e.stopPropagation()}
        >
          {issue.type && (
            <IssueTypeBadge type={issue.type} size="sm" iconOnly />
          )}
          <span className="text-muted-foreground mr-1 font-mono text-xs">
            {identifier}
          </span>
          {issue.title}
        </Link>
        <IssuePriorityBadge priority={issue.priority} />
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
                <UserAvatar key={u.id} user={u} size="xs" ring />
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
    </div>
  );
}
