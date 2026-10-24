// 부모 이슈 요약 배지 — 유형 배지 + 식별자 + 제목 링크 (Phase 4a).
// SUBTASK 상세의 부모 슬롯과 카드의 부모 표시에서 공통 사용.

import { Link } from 'react-router-dom';

import { cn } from '@/lib/utils';

import type { ParentRef } from '../../types/issue';
import { IssueTypeBadge } from '../issueTypes/IssueTypeBadge';

export function ParentBadge({
  projectKey,
  parent,
  className,
}: {
  projectKey: string;
  parent: ParentRef;
  /** 폭 제약(예: 좁은 레일에서 max-w-full) — 긴 제목이 말줄임되게. */
  className?: string;
}) {
  return (
    <Link
      to={`/projects/${projectKey}/issues/${parent.number}`}
      className={cn('inline-flex items-center gap-1 text-sm hover:underline', className)}
      data-testid={`parent-badge-${parent.number}`}
    >
      <IssueTypeBadge type={parent.type} size="sm" iconOnly />
      <span className="font-mono text-xs text-muted-foreground">
        {projectKey}-{parent.number}
      </span>
      <span className="truncate">{parent.title}</span>
    </Link>
  );
}
