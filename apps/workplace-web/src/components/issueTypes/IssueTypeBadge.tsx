// 이슈 유형 배지 — 아이콘 + 색상 + 이름.
// 색상은 Phase 3a LABEL_COLORS 12종 재사용. 아이콘은 8종 정적 매핑.
// fallback: 알 수 없는 토큰/아이콘은 GRAY + Circle.

import { ISSUE_TYPE_ICONS } from '../../lib/issueTypeIcons';
import { getIssueTypeLabel } from '../../lib/issueTypeLabels';
import { LABEL_COLORS } from '../../lib/labelColors';
import type { IssueTypeSummary } from '../../types/issueType';
import type { ColorToken } from '../../types/label';

export function IssueTypeBadge({
  type,
  size = 'md',
  iconOnly = false,
}: {
  type: IssueTypeSummary;
  size?: 'sm' | 'md';
  iconOnly?: boolean;
}) {
  const colors = LABEL_COLORS[type.colorToken as ColorToken] ?? LABEL_COLORS.GRAY;
  const Icon = ISSUE_TYPE_ICONS[type.icon] ?? ISSUE_TYPE_ICONS.Circle;
  const padding = size === 'sm' ? 'px-1 py-0 text-[10px]' : 'px-2 py-0.5 text-xs';
  return (
    <span
      className={`inline-flex items-center gap-1 rounded ${padding} ${colors.bg} ${colors.text}`}
      aria-label={getIssueTypeLabel(type.name)}
      title={getIssueTypeLabel(type.name)}
      data-testid={`issue-type-badge-${type.id}`}
    >
      <Icon className="h-3 w-3" />
      {!iconOnly && getIssueTypeLabel(type.name)}
    </span>
  );
}
