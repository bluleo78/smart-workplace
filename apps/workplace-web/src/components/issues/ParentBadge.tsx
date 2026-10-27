// 부모 이슈 요약 배지 — 유형 배지 + 식별자 + 제목 링크 (Phase 4a).
// SUBTASK 상세의 부모 슬롯과 카드의 부모 표시에서 공통 사용.

import { Link } from 'react-router-dom';

import { cn } from '@/lib/utils';

import { HIDDEN_PARENT_LABEL, parentIssueKey, parentIssuePath } from '../../lib/parentRef';
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
  // WP-1038 키·경로는 부모의 프로젝트 키로(다른 프로젝트 에픽). 가려진 부모는 링크 없이 「볼 수 없는 에픽」만.
  const issueKey = parentIssueKey(parent, projectKey);
  const path = parentIssuePath(parent, projectKey);
  if (issueKey == null || path == null) {
    return (
      <span
        className={cn('inline-flex max-w-full items-center gap-1 text-sm text-muted-foreground', className)}
        data-testid="parent-badge-hidden"
      >
        <span className="truncate">{HIDDEN_PARENT_LABEL}</span>
      </span>
    );
  }
  return (
    <Link
      to={path}
      // max-w-full — 링크가 부모(레일) 폭을 넘지 않아야 안쪽 제목 span 의 truncate 가 걸린다(WP-805).
      className={cn('inline-flex max-w-full items-center gap-1 text-sm hover:underline', className)}
      data-testid={`parent-badge-${parent.number}`}
    >
      <IssueTypeBadge type={parent.type} size="sm" iconOnly />
      <span className="shrink-0 font-mono text-xs text-muted-foreground">
        {issueKey}
      </span>
      <span className="truncate">{parent.title}</span>
    </Link>
  );
}
