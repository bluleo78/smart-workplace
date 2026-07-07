// 소속(에픽/상위 이슈) 칩 — Jira 백로그 스타일의 색상 lozenge.
// 이슈 목록 행에서 제목과 분리해, 부모 이슈 유형 색상 배경 + 아이콘 + 제목으로
// 행 오른쪽 끝(ml-auto)에 표시한다. 클릭 시 부모 상세로 이동(행 onClick 버블 차단).

import { Link } from 'react-router-dom';

import { ISSUE_TYPE_ICONS } from '../../lib/issueTypeIcons';
import { LABEL_COLORS } from '../../lib/labelColors';
import type { ParentRef } from '../../types/issue';
import type { ColorToken } from '../../types/label';

export function ParentChip({
  projectKey,
  parent,
  issueNumber,
}: {
  projectKey: string;
  parent: ParentRef;
  issueNumber: number;
}) {
  // 색상·아이콘은 부모 유형에서 파생 — 하드코딩 hex 없이 디자인시스템 색상 토큰만 사용.
  const colors = LABEL_COLORS[parent.type.colorToken as ColorToken] ?? LABEL_COLORS.GRAY;
  const Icon = ISSUE_TYPE_ICONS[parent.type.icon] ?? ISSUE_TYPE_ICONS.Circle;
  return (
    <Link
      to={`/projects/${projectKey}/issues/${parent.number}`}
      onClick={(e) => e.stopPropagation()}
      data-testid={`issue-row-${issueNumber}-parent`}
      title={`${projectKey}-${parent.number} · ${parent.title}`}
      className={`ml-auto inline-flex max-w-[12rem] shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-xs font-normal ${colors.bg} ${colors.text} hover:opacity-80`}
    >
      <Icon className="h-3 w-3 shrink-0" />
      <span className="truncate">{parent.title}</span>
    </Link>
  );
}
