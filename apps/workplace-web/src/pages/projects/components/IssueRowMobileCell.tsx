// 모바일 이슈 행 셀 — 표 칸 대신 한 칸(colSpan) 안에 2줄 블록을 그린다(WP-194).
// 1줄: 상태 아이콘 + 제목(최대 2줄). 2줄: 키 · ◆에픽 · 높음 · 마감 · 하위 n/m · 첫 라벨(+N) … 담당자.
// 표 구조(<tr>)를 유지해야 평면/그룹/사이클 구간 목록이 같은 행 컴포넌트를 계속 공유할 수 있다.
import { CheckCircle2 } from 'lucide-react';
import { Link } from 'react-router-dom';

import { IssueStatusIcon } from '../../../components/issues/IssueStatusIcon';
import type { IssueResponse } from '../../../types/issue';
import { IssueMobileMeta } from './IssueMobileMeta';

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
  return (
    <td colSpan={colSpan} className="px-1 py-2.5">
      <div className="flex min-w-0 items-start gap-2">
        <span className="mt-0.5 shrink-0">
          {/* 선택 표시는 상태 아이콘과 같은 18px — 바뀌어도 제목이 밀리지 않게. */}
          {selected ? (
            <CheckCircle2 className="h-[18px] w-[18px] text-primary" aria-label="선택됨" />
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
          <IssueMobileMeta issue={it} projectKey={projectKey} testIdPrefix={`issue-row-${it.number}`} hideEpic={hideEpic} selected={selected} />
        </div>
      </div>
    </td>
  );
}
