// 부모 이슈 요약 배지 — 유형 배지 + 식별자 + 제목 링크 (Phase 4a).
// SUBTASK 상세의 부모 슬롯과 카드의 부모 표시에서 공통 사용.

import { Link } from 'react-router-dom';

import type { ParentRef } from '../../types/issue';
import { IssueTypeBadge } from '../issueTypes/IssueTypeBadge';

export function ParentBadge({
  projectKey,
  parent,
}: {
  projectKey: string;
  parent: ParentRef;
}) {
  return (
    <Link
      to={`/projects/${projectKey}/issues/${parent.number}`}
      className="inline-flex items-center gap-1 text-sm hover:underline"
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
