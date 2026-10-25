// 소속(에픽/상위 이슈) 칩 — Jira 백로그 스타일의 색상 lozenge.
// 부모 이슈 유형 색상 배경 + 아이콘 + 제목으로 표시한다.
// - row(기본): 이슈 목록 행 오른쪽 끝(ml-auto). 클릭 시 부모 상세로 이동(행 onClick 버블 차단).
// - card: 보드 카드 안의 정적 배지. 카드 전체가 stretched Link 라 중첩 링크를 두지 않는다.

import { Link } from 'react-router-dom';

import { ISSUE_TYPE_ICONS } from '../../lib/issueTypeIcons';
import { LABEL_COLORS } from '../../lib/labelColors';
import { cn } from '../../lib/utils';
import type { ParentRef } from '../../types/issue';
import type { ColorToken } from '../../types/label';

export function ParentChip({
  projectKey,
  parent,
  issueNumber,
  variant = 'row',
  showKey = false,
  titleClassName,
}: {
  projectKey: string;
  parent: ParentRef;
  issueNumber: number;
  variant?: 'row' | 'card';
  // AI 위임 작업처럼 칩이 좁은 화면에서 부모가 무엇인지 키로 먼저 알 수 있게 키를 제목 앞에 둔다(WP-375). 기본은 제목만.
  showKey?: boolean;
  /** 제목 글자에 덧붙일 클래스 — 좁은 폭에서 글자를 sr-only 로 접는 기준(@container 폭)은 그 레이아웃을 아는 호출처가 정한다(WP-943). */
  titleClassName?: string;
}) {
  // 색상·아이콘은 부모 유형에서 파생 — 하드코딩 hex 없이 디자인시스템 색상 토큰만 사용.
  const colors = LABEL_COLORS[parent.type.colorToken as ColorToken] ?? LABEL_COLORS.GRAY;
  const Icon = ISSUE_TYPE_ICONS[parent.type.icon] ?? ISSUE_TYPE_ICONS.Circle;
  const title = `${projectKey}-${parent.number} · ${parent.title}`;
  const content = (
    <>
      <Icon className="h-3 w-3 shrink-0" />
      {showKey && (
        <span className="shrink-0 font-mono">
          {projectKey}-{parent.number}
        </span>
      )}
      <span className={cn('truncate', titleClassName)}>{parent.title}</span>
    </>
  );
  // row 변형 칩은 줄어든다(min-w-0 shrink) — 칩이 제목을 밀어내지 않게, 제목은 min-w-[8rem] 을 보장(WP-194).
  // 오른쪽 정렬(ml-auto)은 호출처가 정한다 — 이슈 행은 레이블과 한 묶음으로 민다(WP-505).
  if (variant === 'card') {
    return (
      <span
        data-testid={`issue-card-${issueNumber}-epic`}
        title={title}
        className={`inline-flex min-w-0 max-w-full items-center gap-1 rounded px-1.5 py-0.5 text-xs ${colors.bg} ${colors.text}`}
      >
        {content}
      </span>
    );
  }
  return (
    <Link
      to={`/projects/${projectKey}/issues/${parent.number}`}
      onClick={(e) => e.stopPropagation()}
      data-testid={`issue-row-${issueNumber}-parent`}
      title={title}
      className={`inline-flex max-w-[12rem] min-w-0 shrink items-center gap-1 rounded px-1.5 py-0.5 text-xs font-normal ${colors.bg} ${colors.text} hover:opacity-80`}
    >
      {content}
    </Link>
  );
}
