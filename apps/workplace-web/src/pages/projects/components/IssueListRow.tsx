// 이슈 목록 테이블 행 — 평면/그룹 목록(IssueListView)과 사이클 구간 목록(IssueCycleGroupedList, #878)이 공유한다.
// 행 전체 클릭으로 상세 이동(#234), 체크박스로 다중 선택(#606).

import { useDraggable } from '@dnd-kit/core';
import { memo, type MouseEvent, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { useIsMobile } from '@/hooks/useIsMobile';
import { useLongPressCapture } from '@/hooks/useLongPressCapture';

import { IssueLabelMeta } from '../../../components/issue/IssueLabelMeta';
import { ChildProgress } from '../../../components/issues/ChildProgress';
import { IssueStatusIcon } from '../../../components/issues/IssueStatusIcon';
import { ParentChip } from '../../../components/issues/ParentChip';
import { IssueTypeBadge } from '../../../components/issueTypes/IssueTypeBadge';
import type { CycleSectionRef, IssueDragData } from '../../../lib/epicDnd';
import { isEpicParent } from '../../../lib/issueGrouping';
import { MULTI_SELECTED_ROW_CLASS } from '../../../lib/selectionStyles';
import { cn } from '../../../lib/utils';
import type { IssueResponse } from '../../../types/issue';
import { type OpenRowMenu, openRowMenuAtPointer } from '../hooks/useIssueRowActions';
import type { ColumnDefs, IssueListColumnDef } from './issueListColumnDefs';
import { IssueRowMobileCell } from './IssueRowMobileCell';
import { RowMenuButton } from './RowMenuButton';

// 모바일 목록 컬럼 수 — 모바일 행은 한 칸 블록(IssueRowMobileCell)이라 선택 열과 무관하게 고정이다.
// 데스크톱 열 수는 보이는 선택 열에서 계산한다(issueListColumnCount, WP-270).
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
  onOpenMenu,
  menuOpen = false,
  selectionMode = false,
  hideEpic = false,
  columns,
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
  /** 「⋯」·우클릭 메뉴(WP-273) — 목록이 소유한 메뉴를 연다. 없으면 ⋯ 를 그리지 않는다. */
  onOpenMenu?: OpenRowMenu;
  /** 이 행의 데스크톱 메뉴가 열려 있음 — 행 강조 + ⋯ 를 계속 보인다. */
  menuOpen?: boolean;
  /** 선택 모드(1건 이상 선택됨) — 모바일에서 탭이 이동 대신 선택 토글이 된다. */
  selectionMode?: boolean;
  /** 특정 에픽 필터·에픽 그룹 안 — 에픽 표시(모바일 ◆ 메타·데스크톱 칩) 생략. */
  hideEpic?: boolean;
  /**
   * 데스크톱 선택 열 정의(WP-270) — 목록이 useColumnDefs 로 한 번 만들고 ID 왼쪽 / 제목 뒤로 미리 나눠 넘긴다
   * (메모된 값이라 memo 행이 매번 다시 그려지지 않고, 행마다 열을 다시 거르지 않는다).
   */
  columns: ColumnDefs;
}) {
  const navigate = useNavigate();
  const to = `/projects/${projectKey}/issues/${it.number}`;
  // 행에 그릴 소속 칩 — 에픽 그룹·에픽 필터 안에선 에픽이 중복이라 숨긴다(상위 이슈는 그대로).
  const shownParent = it.parent && !(hideEpic && isEpicParent(it)) ? it.parent : null;
  const isMobile = useIsMobile();
  // 모바일: 체크박스 대신 길게 누르기 → 액션 시트, 선택 모드에선 탭=선택 토글(이동 없음).
  // onLongPress 는 모바일에서만 호출처(useIssueRowActions)가 넘기고, selectionMode 도 모바일에서만 켜진다.
  // 액션이 없어도(비멤버) 모바일에선 길게 눌렀다 뗀 click 을 삼킨다 — 상세로 넘어가지 않게(WP-217).
  const press = useLongPressCapture({
    onLongPress: onLongPress ? () => onLongPress(it) : undefined,
    onTap: selectionMode ? () => onToggleSelect(it.number) : undefined,
    suppressLongClick: isMobile,
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
  // 데스크톱 우클릭 — 브라우저 메뉴 대신 행 메뉴. 모바일은 useLongPressCapture 의 onContextMenu(길게 터치)를 그대로 쓴다.
  const desktopContextMenu = !isMobile && onOpenMenu
    ? (e: MouseEvent<HTMLTableRowElement>) => openRowMenuAtPointer(e, it, onOpenMenu)
    : undefined;

  return (
    <tr
      ref={ref}
      {...dragProps}
      {...press}
      {...(desktopContextMenu && { onContextMenu: desktopContextMenu })}
      onClick={() => navigate(to)}
      className={cn(
        'group border-b hover:bg-accent cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
        menuOpen && 'bg-accent',
        isDragging && 'opacity-40',
        isMobile && 'select-none [-webkit-touch-callout:none]',
        // 체크로 고른 행 — 모바일 선택 모드와 데스크톱 체크박스 선택이 같은 다중 선택 배경을 쓴다(WP-919). menuOpen 의 bg-accent 보다 뒤에 둬 이긴다.
        selected && MULTI_SELECTED_ROW_CLASS,
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
          onOpenMenu={selectionMode ? undefined : onOpenMenu}
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
          <IssueStatusIcon status={it.status} name={it.statusName} color={it.statusColor} />
        </td>
        {/* ID 왼쪽 선택 열(우선순위) — 열 정의(issueListColumnDefs)가 정한다. */}
        {columns.left.map((c) => renderCell(c, it, projectKey))}
        <td className="font-mono text-muted-foreground text-xs">
          <span className="flex items-center gap-1.5">
            {it.type && <IssueTypeBadge type={it.type} size="sm" iconOnly />}
            <span>{projectKey}-{it.number}</span>
          </span>
        </td>
        {/* pr-2 — 말줄임된 제목이 다음 칸(담당자 아바타 등)에 붙지 않게 간격을 둔다.
            w-full max-w-0 — 자동 레이아웃 표에서 nowrap 제목의 최소 폭이 글자 폭 전체라 긴 제목이 표를 가로로 넘기던 것을 막는다
            (셀이 남은 폭에 맞춰 줄어야 안쪽 flex 의 truncate/min-w-0 가 동작, WP-194). */}
        <td className="w-full max-w-0 pr-2">
          {/* @container — 레이블 노출을 뷰포트가 아니라 제목 칸 폭으로 정한다(에픽 패널을 열고 닫으면 같은 창에서도 칸 폭이 바뀐다, WP-505). */}
          <div className="@container">
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
              {/* 오른쪽 메타 묶음 — 레이블(최대 2 + N)·소속 칩을 제목과 한 줄에 둔다(WP-505, 아래 줄에 두면 행이 2줄).
                  레이블은 제목 칸 ≥40rem 일 때만 보이고, 그때 묶음은 줄지 않고 제목만 말줄임한다(함께 줄면 「A…」).
                  40rem = 6rem 레이블 둘 + N · 12rem 소속 칩 · 8rem 제목 하한 · 하위 배지가 넘치지 않는 폭. */}
              {(shownParent || it.labels.length > 0) && (
                <div
                  className={cn(
                    'flex min-w-0 shrink items-center gap-1.5 @min-[40rem]:shrink-0',
                    // 소속 칩이 없으면 레이블이 보일 때만 오른쪽으로 민다 — 숨겨진 레이블의 빈 묶음이 하위 진행률 배지를 끝으로 밀지 않게.
                    shownParent ? 'ml-auto' : '@min-[40rem]:ml-auto',
                  )}
                >
                  <IssueLabelMeta labels={it.labels} testId={`issue-row-${it.number}-labels`} />
                  {shownParent && <ParentChip projectKey={projectKey} parent={shownParent} issueNumber={it.number} />}
                </div>
              )}
              {/* 하위를 가진 이슈엔 진행률(└ done/total)을 표시한다. 목록에서 SUBTASK 를 숨긴 부모는
                  이 배지로 하위 존재를 알리고, 에픽은 자식이 행으로 노출되므로 롤업 진행률로 읽힌다.
                  childCount 는 유형과 무관하게 활성 자식 전체를 세므로(보드 카드와 동일 기준) 둘 다 표시된다. */}
              <ChildProgress
                done={it.childDoneCount}
                total={it.childCount}
                testId={`issue-row-${it.number}-child-progress`}
              />
            </div>
          </div>
        </td>
        {/* 제목 뒤 선택 열(담당자·마감·완료일 등) — 열 정의(issueListColumnDefs)가 정한다. 칸 폭은 헤더가 정한다. */}
        {columns.right.map((c) => renderCell(c, it, projectKey))}
        {/* ⋯ 메뉴(WP-273 시안 A) — 호버·포커스 때만 보인다. 행 클릭(이동)·드래그로 새지 않게 버튼이 이벤트를 막는다. */}
        <td className="w-8 pr-1">
          {onOpenMenu && <RowMenuButton issue={it} onOpenMenu={onOpenMenu} open={menuOpen} testId={`issue-row-${it.number}-menu`} />}
        </td>
        </>
      )}
    </tr>
  );
});

/** 선택 열 셀 하나 — 클래스·툴팁·testid 는 열 정의에서, 내용은 정의의 셀 렌더러에서 온다. */
function renderCell(def: IssueListColumnDef, issue: IssueResponse, projectKey: string) {
  return (
    <td
      key={def.key}
      className={def.cellClass?.(issue)}
      title={def.cellTitle?.(issue)}
      data-testid={def.testId?.(issue.number)}
    >
      {def.cell(issue, { projectKey })}
    </td>
  );
}
