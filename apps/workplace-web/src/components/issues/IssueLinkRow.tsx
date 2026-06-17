// 의존성/관련 이슈 한 행 (Phase 4b).
// 구성: 유형 아이콘 + KEY-N + 제목 + 상태 + 제거 버튼.
// 제거는 confirm 없이 즉시 호출 — 소규모 작업이므로 토스트 + invalidate 만으로 충분.

import { X } from 'lucide-react';
import { Link } from 'react-router-dom';

import { Button } from '@/components/ui/button';

import { IssueTypeBadge } from '../issueTypes/IssueTypeBadge';
import { IssueStatusBadge } from '../../pages/projects/components/IssueStatusBadge';
import type { IssueLinkSummary, IssueStatus } from '../../types/issue';

export function IssueLinkRow({
  projectKey,
  link,
  onRemove,
}: {
  projectKey: string;
  link: IssueLinkSummary;
  onRemove: () => void;
}) {
  return (
    // group: hover-reveal 패턴 — hover 시 배경 + 삭제 버튼 표시 (IssueAttachmentItem 동일 패턴)
    <li
      className="group flex items-center gap-2 rounded px-1 -mx-1 text-sm py-1 hover:bg-accent/50"
      data-testid={`issue-link-row-${link.number}`}
    >
      <IssueTypeBadge type={link.type} size="sm" iconOnly />
      <span className="font-mono text-xs text-muted-foreground">
        {projectKey}-{link.number}
      </span>
      <Link
        to={`/projects/${projectKey}/issues/${link.number}`}
        className="flex-1 truncate hover:underline"
      >
        {link.title}
      </Link>
      <IssueStatusBadge status={link.status as IssueStatus} />
      {/* hover 시에만 노출 — 파괴적 작업 보호 */}
      <Button
        variant="ghost"
        size="icon"
        onClick={onRemove}
        aria-label="의존성 제거"
        className="hidden group-hover:inline-flex"
        data-testid={`issue-link-remove-${link.number}`}
      >
        <X className="h-4 w-4" />
      </Button>
    </li>
  );
}
