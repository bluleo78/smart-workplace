// 이슈 목록 테이블 행 — 평면/그룹 목록(IssueListView)과 사이클 구간 목록(IssueCycleGroupedList, #878)이 공유한다.
// 행 전체 클릭으로 상세 이동(#234), 체크박스로 다중 선택(#606).

import { useDraggable } from '@dnd-kit/core';
import { memo, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { useIsMobile } from '@/hooks/useIsMobile';
import { useLongPressCapture } from '@/hooks/useLongPressCapture';

import { IssuePriorityBars } from '../../../components/issues/IssuePriorityBars';
import { IssueStatusIcon } from '../../../components/issues/IssueStatusIcon';
import { ParentChip } from '../../../components/issues/ParentChip';
import { IssueTypeBadge } from '../../../components/issueTypes/IssueTypeBadge';
import { LabelChip } from '../../../components/labels/LabelChip';
import { UserAvatar } from '../../../components/users/UserAvatar';
import type { CycleSectionRef, IssueDragData } from '../../../lib/epicDnd';
import { formatDateKorean } from '../../../lib/formatters';
import { isEpicParent } from '../../../lib/issueGrouping';
import { cn } from '../../../lib/utils';
import type { IssueResponse } from '../../../types/issue';
import { IssueRowMobileCell } from './IssueRowMobileCell';

// 목록 컬럼 수(체크박스·상태·우선순위·ID·제목·담당자·마감) — 그룹 헤더 colSpan 등에 쓴다.
// 모바일은 체크박스 컬럼이 없어 1 적다(길게 누르기 → 액션 시트로 선택).
export const ISSUE_LIST_COLUMN_COUNT = 7;
export const ISSUE_LIST_COLUMN_COUNT_MOBILE = 6;

// 리스트 행 — 평탄/그룹 렌더가 공유 (DRY). 행 전체 클릭 → 상세(#234).
// #606: 체크박스 컬럼 추가 — 클릭 시 stopPropagation 으로 행 네비게이션과 분리.
// React.memo — 콜백을 useCallback으로 안정화한 것과 짝을 이뤄, 선택 상태가 바뀐 행만 리렌더(#716).
export const IssueRow = memo(function IssueRow({
  issue: it,
  projectKey,
  selected,
  onToggleSelect,
  canDrag = false,
  dragScope,
  cycleSection,
  onLongPress,
  selectionMode = false,
  hideEpic = false,
}: {
  issue: IssueResponse;
  projectKey: string;
  selected: boolean;
  onToggleSelect: (number: number) => void;
  /** 프로젝트 멤버만 행을 에픽 패널로 끌 수 있다(비멤버·미지정이면 평범한 행). */
  canDrag?: boolean;
  /** 드래그 id 구분자 — 같은 이슈가 여러 곳(사이클 구간 M:N)에 동시에 렌더될 때 id 가 겹치지 않게 한다. */
  dragScope?: string;
  /** 사이클 그룹 목록의 행이면 속한 구간 — 다른 사이클 구간으로 끌어 사이클을 옮길 때 출발지(#881). */
  cycleSection?: CycleSectionRef;
  /** 모바일 길게 누르기(우클릭 포함) — 액션 시트를 연다. 없으면 길게 누르기 비활성. */
  onLongPress?: (issue: IssueResponse) => void;
  /** 선택 모드(1건 이상 선택됨) — 모바일에서 탭이 이동 대신 선택 토글이 된다. */
  selectionMode?: boolean;
  /** 특정 에픽 필터·에픽 그룹 안 — 에픽 표시(모바일 ◆ 메타·데스크톱 칩) 생략. */
  hideEpic?: boolean;
}) {
  const navigate = useNavigate();
  const to = `/projects/${projectKey}/issues/${it.number}`;
  const isMobile = useIsMobile();
  // 모바일: 체크박스 대신 길게 누르기 → 액션 시트, 선택 모드에선 탭=선택 토글(이동 없음).
  // onLongPress 는 모바일에서만 호출처(useIssueRowActions)가 넘기고, selectionMode 도 모바일에서만 켜진다.
  const press = useLongPressCapture({
    onLongPress: onLongPress ? () => onLongPress(it) : undefined,
    onTap: selectionMode ? () => onToggleSelect(it.number) : undefined,
  });

  // 행 전체가 드래그 소스 — 에픽 패널로 끌어 놓아 에픽을 바꾼다. 활성화 노드=행 자신(지정하지 않으면
  // KeyboardSensor 가 제목 링크 등 자손의 키 입력까지 받아 드래그를 시작한다, #881).
  // dnd-kit 은 id 로 노드를 등록하므로 한 이슈가 여러 구간에 보이면 dragScope 로 id 를 구분해야 엉뚱한 행이 잡히지 않는다.
  const { setNodeRef, setActivatorNodeRef, attributes, listeners, isDragging } = useDraggable({
    id: dragScope ? `issue-row-${dragScope}-${it.id}` : `issue-row-${it.id}`,
    data: { issue: it, source: 'row', cycleSection } satisfies IssueDragData,
    // 모바일은 드래그 대신 길게 누르기 액션을 쓴다.
    disabled: !canDrag || isMobile,
    // dnd-kit 기본 role=button 은 표 의미를 깨뜨린다 — 행 역할 유지.
    attributes: { role: 'row' },
  });
  const ref = useCallback(
    (el: HTMLTableRowElement | null) => {
      setNodeRef(el);
      setActivatorNodeRef(el);
    },
    [setNodeRef, setActivatorNodeRef],
  );
  // 비활성이면 dnd-kit 의 role·tabIndex·리스너를 붙이지 않는다(평범한 행).
  const dragProps = canDrag && !isMobile
    ? { ...attributes, ...listeners, 'aria-roledescription': '드래그 가능한 이슈' }
    : {};

  return (
    <tr
      ref={ref}
      {...dragProps}
      {...press}
      onClick={() => navigate(to)}
      className={cn(
        'border-b hover:bg-accent cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
        isDragging && 'opacity-40',
        isMobile && 'select-none [-webkit-touch-callout:none]',
        isMobile && selected && 'bg-primary/10',
      )}
      aria-selected={isMobile && selectionMode ? selected : undefined}
      data-testid={`issue-row-${it.number}`}
    >
      {isMobile ? (
        <IssueRowMobileCell
          issue={it}
          projectKey={projectKey}
          to={to}
          selected={selected}
          hideEpic={hideEpic}
          colSpan={ISSUE_LIST_COLUMN_COUNT_MOBILE}
        />
      ) : (
        <>
        <td className="py-2" onClick={(e) => e.stopPropagation()}>
            <input
              type="checkbox"
              checked={selected}
              onChange={() => onToggleSelect(it.number)}
              // 체크박스에서 시작한 포인터가 행 드래그로 이어지지 않게 한다.
              onPointerDown={(e) => e.stopPropagation()}
              aria-label={`${it.title} 선택`}
              data-testid={`select-issue-${it.number}`}
              className="h-4 w-4"
            />
        </td>
        <td className="py-2">
          <IssueStatusIcon status={it.status} />
        </td>
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
        {/* pr-2 — 말줄임된 제목이 담당자 아바타에 붙지 않게 간격을 둔다.
            w-full max-w-0 — 자동 레이아웃 표에서 nowrap 제목의 최소 폭이 글자 폭 전체라 긴 제목이 표를 가로로 넘기던 것을 막는다
            (셀이 남은 폭에 맞춰 줄어야 안쪽 flex 의 truncate/min-w-0 가 동작, WP-194). */}
        <td className="w-full max-w-0 pr-2">
          <div className="flex min-w-0 items-center gap-1.5 font-medium">
            {/* 제목 = 실제 링크(키보드 포커스·스크린리더 접근점). 행 onClick 은 마우스 편의용.
                stopPropagation 으로 링크 클릭이 행 onClick 까지 버블해 history 가 이중 push 되는 것을 막는다. */}
            <Link
              to={to}
              onClick={(e) => e.stopPropagation()}
              className="min-w-[8rem] truncate rounded hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {it.title}
            </Link>
            {/* 소속(에픽/상위 이슈) 은 Jira 처럼 제목과 분리해 행 오른쪽 끝에 색상 칩으로 표시. */}
            {it.parent && !(hideEpic && isEpicParent(it)) && (
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
        </>
      )}
    </tr>
  );
});
