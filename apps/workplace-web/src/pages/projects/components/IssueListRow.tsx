// 이슈 목록 테이블 행 — 평면/그룹 목록(IssueListView)과 사이클 구간 목록(IssueCycleGroupedList, #878)이 공유한다.
// 행 전체 클릭으로 상세 이동(#234), 체크박스로 다중 선택(#606).

import { memo } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { IssuePriorityBars } from '../../../components/issues/IssuePriorityBars';
import { IssueStatusIcon } from '../../../components/issues/IssueStatusIcon';
import { ParentChip } from '../../../components/issues/ParentChip';
import { IssueTypeBadge } from '../../../components/issueTypes/IssueTypeBadge';
import { LabelChip } from '../../../components/labels/LabelChip';
import { UserAvatar } from '../../../components/users/UserAvatar';
import { formatDateKorean } from '../../../lib/formatters';
import type { IssueResponse } from '../../../types/issue';

// 목록 컬럼 수(체크박스·상태·우선순위·ID·제목·담당자·마감) — 그룹 헤더 colSpan 등에 쓴다.
export const ISSUE_LIST_COLUMN_COUNT = 7;

// 리스트 행 — 평탄/그룹 렌더가 공유 (DRY). 행 전체 클릭 → 상세(#234).
// #606: 체크박스 컬럼 추가 — 클릭 시 stopPropagation 으로 행 네비게이션과 분리.
// React.memo — 콜백을 useCallback으로 안정화한 것과 짝을 이뤄, 선택 상태가 바뀐 행만 리렌더(#716).
export const IssueRow = memo(function IssueRow({
  issue: it,
  projectKey,
  selected,
  onToggleSelect,
}: {
  issue: IssueResponse;
  projectKey: string;
  selected: boolean;
  onToggleSelect: (number: number) => void;
}) {
  const navigate = useNavigate();
  const to = `/projects/${projectKey}/issues/${it.number}`;

  return (
    <tr
      onClick={() => navigate(to)}
      className="border-b hover:bg-accent cursor-pointer"
      data-testid={`issue-row-${it.number}`}
    >
      <td className="py-2" onClick={(e) => e.stopPropagation()}>
        <input
          type="checkbox"
          checked={selected}
          onChange={() => onToggleSelect(it.number)}
          aria-label={`${it.title} 선택`}
          data-testid={`select-issue-${it.number}`}
          className="h-4 w-4"
        />
      </td>
      <td className="py-2"><IssueStatusIcon status={it.status} /></td>
      {/* 좁은 화면(<sm)에선 우선순위·마감 컬럼을 숨겨 제목 폭을 확보한다 — 헤더의 같은 컬럼도 함께 숨긴다. */}
      <td className="hidden sm:table-cell"><IssuePriorityBars priority={it.priority} /></td>
      <td className="font-mono text-muted-foreground text-xs">
        <span className="flex items-center gap-1.5">
          {/* 좁은 화면(<sm)에선 유형 아이콘을 숨겨 좁은 ID 컬럼(w-16)에 키만 남긴다. */}
          {it.type && (
            <span className="hidden sm:inline-flex">
              <IssueTypeBadge type={it.type} size="sm" iconOnly />
            </span>
          )}
          <span>{projectKey}-{it.number}</span>
        </span>
      </td>
      {/* pr-2 — 말줄임된 제목이 담당자 아바타에 붙지 않게 간격을 둔다. */}
      <td className="pr-2">
        <div className="flex min-w-0 items-center gap-1.5 font-medium">
          {/* 제목 = 실제 링크(키보드 포커스·스크린리더 접근점). 행 onClick 은 마우스 편의용.
              stopPropagation 으로 링크 클릭이 행 onClick 까지 버블해 history 가 이중 push 되는 것을 막는다. */}
          <Link
            to={to}
            onClick={(e) => e.stopPropagation()}
            className="min-w-0 truncate rounded hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {it.title}
          </Link>
          {/* 소속(에픽/상위 이슈) 은 Jira 처럼 제목과 분리해 행 오른쪽 끝에 색상 칩으로 표시. */}
          {it.parent && (
            <ParentChip projectKey={projectKey} parent={it.parent} issueNumber={it.number} />
          )}
          {/* 하위를 가진 이슈엔 진행률(└ done/total)을 표시한다. 목록에서 SUBTASK 를 숨긴 부모는
              이 배지로 하위 존재를 알리고, 에픽은 자식이 행으로 노출되므로 롤업 진행률로 읽힌다.
              childCount 는 유형과 무관하게 활성 자식 전체를 세므로(보드 카드와 동일 기준) 둘 다 표시된다. */}
          {it.childCount > 0 && (
            <span
              className="shrink-0 text-xs text-muted-foreground"
              data-testid={`issue-row-${it.number}-child-progress`}
              aria-label={`하위 작업 ${it.childDoneCount}/${it.childCount}`}
            >
              └ {it.childDoneCount}/{it.childCount}
            </span>
          )}
        </div>
        {it.labels.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {it.labels.map((l) => (
              <LabelChip key={l.id} label={l} size="sm" />
            ))}
          </div>
        )}
      </td>
      <td>
        <span className="flex items-center -space-x-1">
          {it.assignees.length === 0 ? (
            <span className="text-muted-foreground">—</span>
          ) : (
            <>
              {it.assignees.slice(0, 3).map((u) => (
                // AGENT(AI) 담당자는 보라색 ring + Bot 마커로 사람과 시각 구분.
                <UserAvatar key={u.id} user={u} size="xs" ring agent={u.kind === 'AGENT'} />
              ))}
              {it.assignees.length > 3 && (
                <span className="text-xs text-muted-foreground ml-1">
                  +{it.assignees.length - 3}
                </span>
              )}
            </>
          )}
        </span>
      </td>
      <td className="hidden text-muted-foreground sm:table-cell" data-testid={`issue-row-${it.number}-due`}>
        {formatDateKorean(it.dueDate)}
      </td>
    </tr>
  );
});
