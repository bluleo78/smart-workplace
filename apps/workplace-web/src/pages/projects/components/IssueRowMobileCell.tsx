// 모바일 이슈 행 셀 — 표 칸 대신 한 칸(colSpan) 안에 2줄 블록을 그린다(WP-194).
// 1줄: 상태 아이콘 + 제목(최대 2줄). 2줄: 키 · ◆에픽 · 높음 · 마감 · 하위 n/m · 첫 라벨(+N) … 담당자.
// 표 구조(<tr>)를 유지해야 평면/그룹/사이클 구간 목록이 같은 행 컴포넌트를 계속 공유할 수 있다.
import { CheckCircle2 } from 'lucide-react';
import { Link } from 'react-router-dom';

import { IssueStatusIcon } from '../../../components/issues/IssueStatusIcon';
import { UserAvatar } from '../../../components/users/UserAvatar';
import { formatDateKorean } from '../../../lib/formatters';
import { isEpicParent } from '../../../lib/issueGrouping';
import { LABEL_COLORS } from '../../../lib/labelColors';
import type { IssueResponse } from '../../../types/issue';
import type { ColorToken } from '../../../types/label';

export function IssueRowMobileCell({
  issue: it,
  projectKey,
  to,
  selected,
  hideEpic,
  colSpan,
}: {
  issue: IssueResponse;
  projectKey: string;
  to: string;
  selected: boolean;
  hideEpic: boolean;
  /** 표 컬럼 수 — IssueListRow 가 넘긴다(상수를 여기서 import 하면 순환 참조). */
  colSpan: number;
}) {
  // ◆ 에픽 메타 — 부모가 에픽일 때만. 특정 에픽 필터·에픽 그룹 안에선 중복이라 생략.
  const epic = !hideEpic && it.parent && isEpicParent(it) ? it.parent : null;
  // 에픽 색은 ParentChip 과 같은 유형 색 토큰(하드코딩 색 금지).
  const epicColor = epic ? (LABEL_COLORS[epic.type.colorToken as ColorToken] ?? LABEL_COLORS.GRAY).text : '';
  const firstLabel = it.labels[0];
  return (
    <td colSpan={colSpan} className="px-1 py-2.5">
      <div className="flex min-w-0 items-start gap-2">
        <span className="mt-0.5 shrink-0">
          {selected ? (
            <CheckCircle2 className="h-4 w-4 text-primary" aria-label="선택됨" />
          ) : (
            <IssueStatusIcon status={it.status} />
          )}
        </span>
        <div className="min-w-0 flex-1">
          {/* 제목 = 실제 링크(접근점). 행 onClick 과 history 이중 push 를 막으려 stopPropagation. */}
          <Link
            to={to}
            onClick={(e) => e.stopPropagation()}
            data-testid={`issue-row-${it.number}-title`}
            className="line-clamp-2 break-words text-sm font-medium leading-snug [-webkit-touch-callout:none]"
          >
            {it.title}
          </Link>
          <div className="mt-1 flex min-w-0 items-center gap-2">
            <p
              className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground"
              data-testid={`issue-row-${it.number}-meta`}
            >
              <span className="font-mono">{projectKey}-{it.number}</span>
              {epic && (
                <>
                  {' · '}
                  <span
                    className={`inline-block max-w-[7.5rem] truncate align-bottom ${epicColor}`}
                    data-testid={`issue-row-${it.number}-epic`}
                  >
                    ◆ {epic.title}
                  </span>
                </>
              )}
              {it.priority === 'HIGH' && <>{' · '}<span className="text-destructive">높음</span></>}
              {it.dueDate && <>{' · '}{formatDateKorean(it.dueDate)}</>}
              {it.childCount > 0 && <>{' · '}{it.childDoneCount}/{it.childCount}</>}
              {firstLabel && (
                <>
                  {' · '}
                  {firstLabel.name}
                  {it.labels.length > 1 && ` +${it.labels.length - 1}`}
                </>
              )}
            </p>
            {it.assignees.length > 0 && (
              <span className="flex shrink-0 items-center -space-x-1">
                {it.assignees.slice(0, 2).map((u) => (
                  <UserAvatar key={u.id} user={u} size="xs" ring agent={u.kind === 'AGENT'} />
                ))}
                {it.assignees.length > 2 && (
                  <span className="ml-1.5 text-[11px] text-muted-foreground">+{it.assignees.length - 2}</span>
                )}
              </span>
            )}
          </div>
        </div>
      </div>
    </td>
  );
}
