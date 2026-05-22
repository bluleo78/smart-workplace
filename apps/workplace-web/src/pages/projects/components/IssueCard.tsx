// 보드 카드 — @dnd-kit sortable.
// 부모 DndContext 의 activationConstraint(distance:5px) 가 잡혀 있어
// 짧은 클릭은 Link 내비게이션, 5px 이상 드래그는 sort/drop 으로 분리된다.

import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Link } from 'react-router-dom';

import type { IssueResponse } from '../../../types/issue';
import { IssuePriorityBadge } from './IssuePriorityBadge';

export function IssueCard({
  projectKey,
  issue,
}: {
  projectKey: string;
  issue: IssueResponse;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({
      id: `issue-${issue.id}`,
      data: { issueNumber: issue.number, status: issue.status },
    });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  // identifier 는 백엔드가 별도로 내려주지 않으므로 클라이언트에서 합성한다.
  const identifier = `${projectKey}-${issue.number}`;

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className="rounded-md border bg-card p-3 text-sm shadow-sm cursor-grab active:cursor-grabbing"
      data-testid={`issue-card-${issue.number}`}
    >
      <div className="flex items-center justify-between gap-2">
        <Link
          to={`/projects/${projectKey}/issues/${issue.number}`}
          className="font-medium hover:underline truncate"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <span className="text-muted-foreground mr-1 font-mono text-xs">
            {identifier}
          </span>
          {issue.title}
        </Link>
        <IssuePriorityBadge priority={issue.priority} />
      </div>
      <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
        <span>{issue.assigneeId == null ? '미지정' : `#${issue.assigneeId}`}</span>
        {issue.dueDate && <span>~{issue.dueDate}</span>}
      </div>
    </div>
  );
}
