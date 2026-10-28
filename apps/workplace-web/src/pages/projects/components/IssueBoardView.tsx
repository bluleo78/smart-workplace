// 칸반 보드 — @dnd-kit. 컬럼은 프로젝트 상태 목록 하나에 하나(WP-808), 위에 범주 띠(할 일·진행 중·완료·취소)를 둔다.
// 상태 보드는 컬럼(statusId)마다 독립 무한 쿼리(useIssueBoardColumns)로 각 컬럼 끝까지 스크롤하며 이어 받는다(#875).
// 담당자·우선순위·에픽 그룹 보드는 그룹이 동적이라 단일 쿼리로 마지막 페이지까지 순차 로드하고, 그룹 레인 × 상태 열 스윔레인으로 그린다(WP-1021).

import { type DragEndEvent, useDndMonitor, useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { Inbox, Plus } from 'lucide-react';
import { createContext, type ReactNode, useContext, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { RefreshingResults } from '@/components/RefreshingResults';
import { RemainingPagesError } from '@/components/RemainingPagesError';
import { Button } from '@/components/ui/button';
import { LoadMoreFooter } from '@/components/ui/load-more-footer';
import { Skeleton } from '@/components/ui/skeleton';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useRestoreFocusOnExit } from '@/hooks/useRestoreFocusOnExit';
import { cn } from '@/lib/utils';

import { IssueStatusIcon } from '../../../components/issues/IssueStatusIcon';
import { useFetchAllPages } from '../../../hooks/queries/useFetchAllPages';
import {
  type BoardColumnQuery,
  columnFilters,
  useIssueBoardColumns,
} from '../../../hooks/queries/useIssueBoardColumns';
import { useIssueSearchKeepingPrevious } from '../../../hooks/queries/useIssueSearch';
import { useStatusEditing } from '../../../hooks/queries/useProjectStatuses';
import { useUpdateIssueStatus } from '../../../hooks/queries/useUpdateIssueStatus';
import { useScrollTopWhenSettled } from '../../../hooks/useScrollTopWhenSettled';
import { boardDropStatusId, laneCellTestId, laneTestId } from '../../../lib/boardLaneDrop';
import { CLOSED_HIDDEN_NOTE, CLOSED_ISSUE_STATUSES } from '../../../lib/closedHiding';
import type { IssueDragData } from '../../../lib/epicDnd';
import { filtersToParams, withBoardTab } from '../../../lib/issueFilters';
import { groupIssues } from '../../../lib/issueGrouping';
import { categorySpans } from '../../../lib/projectStatuses';
import { failedWithoutData } from '../../../lib/queryFailure';
import type {
  IssueClientGroupBy,
  IssueFilters,
  IssueResponse,
  IssueStatus,
} from '../../../types/issue';
import type { ProjectStatus } from '../../../types/projectStatus';
import { useClosedHidingNotice } from '../hooks/useClosedHidingNotice';
import { useIssueRowActions } from '../hooks/useIssueRowActions';
import { useKeyboardDropFocus } from '../hooks/useKeyboardDropFocus';
import { BoardCategoryBand } from './board/BoardCategoryBand';
import { BoardColumnHeaderMenu } from './board/BoardColumnHeaderMenu';
import { boardTrackStyle } from './board/boardGrid';
import { BoardSwimlanes } from './board/BoardSwimlanes';
import { MobileStatusSheet } from './board/MobileStatusSheet';
import { ShowAllClosedButton } from './board/ShowAllClosedButton';
import { StatusNameEditor } from './board/StatusNameEditor';
import { IssueCard } from './IssueCard';
import { IssueCardMenuContext } from './issueCardMenuContext';
import { IssueDndProvider, useIssueDnd } from './IssueDndProvider';
import { IssueLoadErrorState } from './IssueLoadErrorState';
import { MobileBoard, type MobileBoardTab } from './mobile/MobileBoard';

function IssueBoardViewInner({
  projectKey,
  filters,
  groupBy,
  canEditStatuses,
  excludeCategories,
  showCategoryBand = true,
  cardTo,
  showType = true,
  onOpenCreate,
  canDragStatus: canDragStatusProp = true,
  canEdit = canDragStatusProp,
}: {
  projectKey: string;
  filters: IssueFilters;
  groupBy: IssueClientGroupBy | null;
  // 범주 띠 ＋·헤더 ⋯ 로 상태를 추가·이름 변경할 수 있는가(OWNER, 개인 프로젝트 제외 — canEditStatuses()).
  canEditStatuses: boolean;
  // 컬럼에서 뺄 범주(개인 보드 ['CANCELED']) — 그 범주 상태의 이슈는 렌더하지 않는다. 렌더마다 새 배열을 넘기지 말 것(모듈 상수).
  excludeCategories?: IssueStatus[];
  // 컬럼 위 범주 띠(기본 표시). 개인 보드는 편집이 없고 컬럼이 범주와 1:1 이라 숨긴다.
  showCategoryBand?: boolean;
  // 카드 링크 대상 빌더(기본 미지정 = IssueCard 기본 상세 경로). 개인은 drawer 경로 주입.
  cardTo?: (issue: IssueResponse) => string;
  // 유형 아이콘 표시(기본 true). 개인 보드는 TASK 고정이라 false 로 숨김.
  showType?: boolean;
  // 빈 컬럼 CTA — "이슈 추가" 버튼 클릭 시 이슈 생성 다이얼로그를 여는 콜백. 그 컬럼의 상태(statusId)로 만든다.
  onOpenCreate?: (statusId?: number) => void;
  // 서버 플래그 — 상태 drag-to-change 허용 여부(멤버만). false 이면 DnD 이벤트를 무시한다.
  canDragStatus?: boolean;
  // 길게 누르기 액션(상태·에픽) 권한 — 미지정 시 canDragStatus 와 같다(개인 보드).
  canEdit?: boolean;
}) {
  const isMobile = useIsMobile();
  // 프로젝트 상태 목록(서버 표시 순서)과 편집 동작 — 상태마다 컬럼 하나. 호출부가 ProjectStatusesGate 로 목록을 받은 뒤에 그린다(WP-870).
  const { statuses, rename: renameStatus, addAfter: addStatusAfter, addAt: addStatusAt } = useStatusEditing(projectKey);
  // 헤더 ⋯·모바일 시트 「상태 관리…」 — 설정 「상태」 섹션으로(색·순서·삭제는 거기서, WP-809). 섹션은 #statuses 로 스크롤한다.
  const navigate = useNavigate();
  const manageStatuses = () => navigate(`/projects/${projectKey}/settings#statuses`);
  // 모바일은 드래그 대신 길게 누르기 — 호출처가 넘긴 값과 무관하게 여기서도 끈다(개인 보드 포함).
  const canDragStatus = canDragStatusProp && !isMobile;
  // 노출 범위(에픽 제외 등)는 호출처가 정한다 — 팀 보드는 withDefaultIssueScope, 개인 보드는 최상위만.
  const grouped = groupBy != null && groupBy !== 'status';
  // 보드 컬럼 = 프로젝트 상태(제외 범주 빼고). 개인 보드는 취소 범주가 빠져 3컬럼이 된다.
  const columns = useMemo(
    () => (excludeCategories?.length ? statuses.filter((s) => !excludeCategories.includes(s.category)) : statuses),
    [statuses, excludeCategories],
  );
  // 상태 보드 — 컬럼(statusId)별 쿼리. 그룹 보드에서는 비활성.
  const columnQueries = useIssueBoardColumns(projectKey, filters, columns, !grouped);
  // 그룹 보드 — 단일 쿼리. 상태 보드에서는 비활성.
  // 조건을 바꾸면 새 결과가 올 때까지 이전 카드를 흐리게 둔다(WP-1049) — 상태 보드 컬럼 쿼리도 같다(useIssueBoardColumns).
  const groupQuery = useIssueSearchKeepingPrevious(projectKey, filters, 100, grouped);
  // 종료 이슈 숨김 안내(WP-606) — 팀 보드 기본 범위만 숨김이 켜진다(개인 보드·「완료 모두 보기」·상태 필터는 꺼짐).
  // 끌어 놓기·카드 메뉴로 종료한 이슈가 숨겨지면 토스트로, 빈 완료·취소 열은 안내 + 「완료 모두 보기」로 알린다.
  const closedHiding = useClosedHidingNotice(!!filters.hideInactiveClosed);
  // 범주 기준 — 완료·취소 범주의 모든 컬럼(「배포 완료」 같은 사용자 상태 포함)에 안내를 붙인다(WP-808).
  const showAllClosedFor = (category: IssueStatus) =>
    closedHiding && CLOSED_ISSUE_STATUSES.has(category) ? closedHiding.onShowAll : undefined;
  const updateStatus = useUpdateIssueStatus(projectKey, closedHiding);
  // 키보드로 다른 열에 놓은 카드는 새 열에 다시 그려져 포커스가 빠진다 — 옮긴 카드(숨겨지면 놓은 열)로 잇는다(WP-837).
  const focusKeyboardDrop = useKeyboardDropFocus();
  // 카드 길게 누르기 액션 시트(상태·에픽) — 선택 모드 없음. 시트는 컬럼과 형제로 렌더한다.
  // 카드 메뉴 상태 선택지 — 보드 컬럼과 같은 상태들(개인 보드는 취소 범주 제외, WP-808).
  const cardActions = useIssueRowActions({ projectKey, canEdit, statuses: columns, linkFor: cardTo, closedHiding });
  // 모바일 보드 선택 탭(boardTab) — 상태를 추가하면 새 탭을 고른다.
  const [, setParams] = useSearchParams();
  // 헤더 인라인 이름 변경 중인 컬럼(statusId).
  const [renamingId, setRenamingId] = useState<number | null>(null);
  // 카드 ⋯·우클릭 메뉴(WP-273) — 컬럼 컴포넌트를 거치지 않고 컨텍스트로 카드에 전달한다.
  const { openMenu, menuIssueNumber } = cardActions;
  const cardMenu = useMemo(() => ({ openMenu, menuIssueNumber }), [openMenu, menuIssueNumber]);
  // open 은 모바일에서만 값이 있다(데스크톱은 undefined → 길게 누르기 미연결, 우클릭·⋯ 메뉴를 쓴다).
  // 비멤버도 「링크 복사」가 있어 시트가 열린다(WP-273) — 변경 항목만 숨긴다.
  const onCardLongPress = cardActions.open;

  // 그룹 보드는 컬럼(그룹)이 페이지 순서와 무관하게 동적으로 생기므로 컬럼별 스크롤 로드가 불가 →
  // 마지막 페이지까지 순차로 모두 받는다(기존 200건 상한 + "필터로 좁혀주세요" 대체).
  // 다음 페이지 요청이 실패하면 멈추고(아래 「다시 시도」), 응답이 올 때마다 다시 판정한다(WP-996 — useFetchAllPages).
  const { hasNextPage: groupHasNext, isFetchNextPageError: groupNextError, fetchNextPage } = groupQuery;
  useFetchAllPages(groupQuery, grouped);
  // 컬럼이 이전 조건의 카드로 자리를 채우는 중인가(WP-1049) — 그 컬럼(그룹 보드는 보드 전체)을 흐린다.
  const refreshingOf = (s: ProjectStatus) =>
    grouped ? groupQuery.isPlaceholderData : !!columnQueries[s.id]?.isPlaceholderData;
  // 새 조건의 결과가 모두 들어오면 보드 스크롤을 맨 위로 — 자리채움 동안 스크롤 컨테이너가 남아 옛 위치에 새 카드가 보이지 않게.
  const scrollReset = {
    key: filtersToParams(filters, 'board', groupBy ?? null).toString(),
    refreshing: columns.some(refreshingOf),
  };

  // 응답 모양이 예상과 다른 경우(p.items 누락) flatMap 이 [undefined] 를 만들지 못하게 방어.
  // 상태 보드는 모든 컬럼 쿼리를 합친 뒤 id 로 중복 제거하고 아래 byStatusId 에서 it.statusId 로 다시 나눈다 —
  // DnD 낙관적 패치는 원래 컬럼 쿼리 캐시 안에서 statusId 만 바꾸므로, 쿼리 단위가 아니라 statusId 로 나눠야
  // 드롭 즉시 대상 컬럼에 카드가 나타난다.
  const pages = grouped
    ? (groupQuery.data?.pages ?? [])
    : columns.flatMap((s) => columnQueries[s.id]?.data?.pages ?? []);
  const allIssues: IssueResponse[] = [];
  const seen = new Set<number>();
  for (const p of pages) {
    for (const it of p.items ?? []) {
      if (it == null || seen.has(it.id)) continue;
      seen.add(it.id);
      allIssues.push(it);
    }
  }

  // byStatusId 는 컬럼(상태) 기준으로 동적 생성 — 컬럼에 없는 상태(개인 보드의 취소 범주)는 자연 제외.
  const byStatusId: Record<number, IssueResponse[]> = {};
  for (const col of columns) byStatusId[col.id] = [];
  for (const it of allIssues) {
    byStatusId[it.statusId]?.push(it);
  }

  // 상태 드롭 — 상태 보드·그룹 보드 스윔레인(WP-1021) 공용. 바꿀 상태는 boardDropStatusId 하나로 정한다:
  // 카드·컬럼·레인 칸 data 의 statusId 와 레인(lane)으로 판정 — 상태 보드는 레인이 없고, 스윔레인은 같은 레인일 때만 바꾼다.
  function handleDragEnd(e: DragEndEvent) {
    // 비멤버·모바일은 드래그 상태 변경 불가 — drag 이벤트 무시.
    if (!canDragStatus) return;
    const src = e.active.data.current as IssueDragData | undefined;
    const targetId = boardDropStatusId(src, e.over?.data.current);
    const target = columns.find((s) => s.id === targetId);
    const issueNumber = src?.issueNumber;
    if (!src || !target || !issueNumber) return;
    // 고른 상태를 통째로 넘긴다 — 범주(종료 안내 토스트·아이콘)와 상태 id·이름(카드 이름 즉시 갱신).
    updateStatus.mutate({ number: issueNumber, to: target });
    if (!(e.activatorEvent instanceof KeyboardEvent)) return;
    // 키보드 놓기 포커스(WP-837) — 스윔레인은 놓은 칸과 그 레인 안에서 카드를 찾는다(다중 담당자 이슈는 레인마다 사본이 있다).
    focusKeyboardDrop(
      src.lane
        ? { number: issueNumber, cellTestId: laneCellTestId(src.lane, target.id), laneTestId: laneTestId(src.lane) }
        : { number: issueNumber, column: target.id },
    );
  }

  // 순차 로드 상태 문구(그룹 보드) — 데스크톱 BoardScroll footer(mt-3)와 모바일 탭 컬럼(gap 이 간격을 맡아 여백 없음)이 같은 마크업을 쓴다.
  const groupFooter = (spacing: string) => (
    <>
      {groupHasNext && !groupNextError && (
        <p className={cn('text-xs text-muted-foreground', spacing)} data-testid="board-loading-more">
          나머지 이슈를 불러오는 중…
        </p>
      )}
      {groupNextError && (
        <RemainingPagesError message="나머지 이슈를 불러오지 못했습니다." onRetry={() => void fetchNextPage()} className={spacing} data-testid="board-load-error" />
      )}
    </>
  );

  // 첫 페이지를 못 불러온 쿼리가 있으면 보드 전체를 실패로 알린다(WP-858) — 빈 컬럼(「이슈 없음」)으로 그리면 이슈가
  // 사라진 것처럼 보인다. 컬럼 쿼리는 같은 서버·필터라 함께 실패하는 것이 보통이라 컬럼별로 나누지 않는다.
  // 다시 시도는 실패한 쿼리만 다시 부른다. 판정은 failedWithoutData — 다시 부르는 동안에도 안내를 두어 초점을 지킨다(WP-893). 다음 페이지 실패는 그룹 footer·컬럼 「더 보기」가 맡는다.
  const failedQueries = grouped
    ? (failedWithoutData(groupQuery) ? [groupQuery] : [])
    : columns.flatMap((s) => {
        const q = columnQueries[s.id];
        return q && failedWithoutData(q) ? [q] : [];
      });
  if (failedQueries.length > 0) {
    return <IssueLoadErrorState queries={failedQueries} />;
  }

  // 모바일 보드(WP-195) — 컬럼을 나란히 두지 않고 상태 탭 + 선택 상태 한 컬럼(전체 폭). DnD 없음(길게 누르기로 상태 변경).
  // 그룹 보드는 선택 탭 안에 그룹 섹션을 쌓는다.
  if (isMobile) {
    // 탭 = 프로젝트 상태(WP-808, 제외 범주 빼고). 사용자 「상태 범주」·「상태」 필터로 제외된 상태는 탭을 숨긴다 —
    // 컬럼 쿼리와 같은 판정(columnFilters)이라 그룹 보드(컬럼 쿼리 비활성)에도 같게 적용된다.
    const visible = columns.filter((s) => columnFilters(filters, s) !== null);
    // 그룹 보드는 전체 페이지 순차 로드 — 개수는 로드 건수 그대로(「+」 없음), 로드 중엔 pending 으로 기본 탭이 튀지 않게.
    const pendingOf = (s: ProjectStatus) => (grouped ? groupQuery.isPending : (columnQueries[s.id]?.isPending ?? true));
    const tabs: MobileBoardTab[] = visible.map((s) => ({
      statusId: s.id,
      category: s.category,
      label: s.name,
      count: byStatusId[s.id]?.length ?? 0,
      hasMore: !grouped && !!columnQueries[s.id]?.hasNextPage,
      pending: pendingOf(s),
    }));
    // 탭의 「이슈 추가」는 그 탭 상태로 만든다.
    const createIn = (s: ProjectStatus) => (onOpenCreate ? () => onOpenCreate(s.id) : undefined);
    // 현재 탭 헤더 ⋯ 편집(OWNER, 상태 보드만 — 데스크톱도 그룹 보드엔 상태 편집이 없다).
    const menu =
      canEditStatuses && !grouped
        ? (statusId: number) => {
            const s = visible.find((x) => x.id === statusId);
            if (!s) return null;
            return (
              <MobileStatusSheet
                status={s}
                canEdit
                statuses={statuses}
                onRename={(name) => renameStatus(s.id, name)}
                onManage={manageStatuses}
                onAddAfter={async (name) => {
                  // mutateAsync 는 상태 목록 재조회가 끝난 뒤 끝난다 — 새 상태가 이미 탭에 있으므로 바로 골라도
                  // 기본 탭 고정(MobileBoard)이 「보이지 않는 id」로 보고 덮어쓰지 않는다. 필터로 숨는 상태면 고르지 않는다.
                  const created = await addStatusAfter(s, name);
                  if (columnFilters(filters, created) !== null) {
                    setParams((prev) => withBoardTab(prev, created.id), { replace: true });
                  }
                }}
              />
            );
          }
        : undefined;
    return (
      <IssueCardMenuContext.Provider value={cardMenu}>
        <MobileBoard tabs={tabs} band={showCategoryBand} menu={menu}>
          {(statusId, root) => {
            const status = visible.find((s) => s.id === statusId);
            if (!status) return null;
            // 컬럼 내용만 흐린다(WP-1049) — 탭·헤더 메뉴는 그대로 누를 수 있다. 상태 탭은 그 컬럼 쿼리의 자리채움만 본다.
            return (
              <RefreshingResults
                refreshing={refreshingOf(status)}
              >
                {grouped ? (
                  <MobileGroupedColumn
                    status={status}
                    issues={byStatusId[status.id] ?? []}
                    groupBy={groupBy}
                    pending={groupQuery.isPending}
                    footer={groupFooter('')}
                    projectKey={projectKey}
                    cardTo={cardTo}
                    showType={showType}
                    onOpenCreate={createIn(status)}
                    onShowAllClosed={showAllClosedFor(status.category)}
                    onLongPress={onCardLongPress}
                  />
                ) : (
                  <BoardScrollRootContext.Provider value={root}>
                    <MobileStatusColumn
                      status={status}
                      issues={byStatusId[status.id] ?? []}
                      query={columnQueries[status.id]}
                      pending={pendingOf(status)}
                      projectKey={projectKey}
                      cardTo={cardTo}
                      showType={showType}
                      onOpenCreate={createIn(status)}
                      onShowAllClosed={showAllClosedFor(status.category)}
                      onLongPress={onCardLongPress}
                    />
                  </BoardScrollRootContext.Provider>
                )}
              </RefreshingResults>
            );
          }}
        </MobileBoard>
        {cardActions.sheets}
      </IssueCardMenuContext.Provider>
    );
  }

  // group 이 상태/없음이 아니면(담당자·우선순위·에픽) 그룹마다 가로 레인, 열은 프로젝트 상태인 스윔레인을 그린다(WP-1021).
  // 레인 안에서 다른 상태 칸으로 끌면 상태만 바뀌고, 다른 레인으로는 옮기지 않는다. 범주 띠·상태 편집은 그룹 보드에 두지 않는다.
  // 상태 그룹/그룹 없음은 기존 드래그-상태변경 보드를 그대로 유지한다 (#58).
  if (grouped) {
    // 개인 3컬럼 보드에서 우선순위 그룹 시 CANCELED 누출 방지 — 제외 범주 이슈는 그룹 전에 제거.
    // 상태 목록 로딩과 무관하게 범주로 거른다(팀 보드는 제외 범주가 없어 아무것도 빠지지 않는다).
    const visibleIssues = excludeCategories?.length
      ? allIssues.filter((it) => !excludeCategories.includes(it.status))
      : allIssues;
    const groups = groupIssues(visibleIssues, groupBy);
    return (
      <IssueCardMenuContext.Provider value={cardMenu}>
        {/* 레인 드롭도 상태 보드와 같은 handleDragEnd — 다른 레인 칸·카드는 boardDropStatusId 가 무시한다. */}
        <BoardStatusDropMonitor onDragEnd={handleDragEnd} />
        {/* 그룹 보드는 쿼리 하나라 보드 전체를 함께 흐린다(WP-1049) — 진행 막대는 스크롤과 상관없이 보드 위에 보인다. */}
        <RefreshingResults refreshing={groupQuery.isPlaceholderData} className="h-full">
          <BoardScroll footer={groupFooter('mt-3')} scrollReset={scrollReset}>
            <BoardSwimlanes
              columns={columns}
              groups={groups}
              issues={visibleIssues}
              pending={groupQuery.isPending}
              projectKey={projectKey}
              cardTo={cardTo}
              showType={showType}
              dragDisabled={!canDragStatus}
              onLongPress={onCardLongPress}
              showAllClosedFor={showAllClosedFor}
            />
          </BoardScroll>
        </RefreshingResults>
        {cardActions.sheets}
      </IssueCardMenuContext.Provider>
    );
  }

  // 방어 — 호출부 관문(ProjectStatusesGate)이 목록을 받은 뒤에 그리므로 보통 오지 않는다. 범주 컬럼으로 대신 그리지 않는다.
  if (columns.length === 0) return <BoardScroll />;

  return (
    <IssueCardMenuContext.Provider value={cardMenu}>
      <BoardStatusDropMonitor onDragEnd={handleDragEnd} />
      <BoardScroll columnCount={columns.length} band={showCategoryBand} scrollReset={scrollReset}>
        {showCategoryBand && (
          <BoardCategoryBand
            spans={categorySpans(columns)}
            canEdit={canEditStatuses}
            statuses={statuses}
            onAdd={addStatusAt}
          />
        )}
        {columns.map((col) => (
          <BoardColumn
            key={col.id}
            status={col}
            issues={byStatusId[col.id] ?? []}
            query={columnQueries[col.id]}
            projectKey={projectKey}
            cardTo={cardTo}
            showType={showType}
            onOpenCreate={onOpenCreate}
            onShowAllClosed={showAllClosedFor(col.category)}
            dragDisabled={!canDragStatus}
            onLongPress={onCardLongPress}
            belowBand={showCategoryBand}
            edit={
              canEditStatuses
                ? {
                    statuses,
                    renaming: renamingId === col.id,
                    onRename: () => setRenamingId(col.id),
                    onRenameCancel: () => setRenamingId(null),
                    onRenameSubmit: async (name) => {
                      await renameStatus(col.id, name);
                      setRenamingId(null);
                    },
                    onAddAfter: async (name) => {
                      await addStatusAfter(col, name);
                    },
                    onManage: manageStatuses,
                  }
                : undefined
            }
          />
        ))}
      </BoardScroll>
      {cardActions.sheets}
    </IssueCardMenuContext.Provider>
  );
}

type IssueBoardViewProps = Parameters<typeof IssueBoardViewInner>[0];

// provider(페이지)가 있으면 그 DndContext 를 쓰고, 없으면(개인 보드) 자체 provider 로 감싼다 —
// dnd-kit 은 context 없는 draggable 을 오류 없이 조용히 죽이므로 반드시 둘 중 하나가 있어야 한다.
export function IssueBoardView(props: IssueBoardViewProps) {
  const dnd = useIssueDnd();
  if (dnd) return <IssueBoardViewInner {...props} />;
  return (
    <IssueDndProvider projectKey={props.projectKey}>
      <IssueBoardViewInner {...props} />
    </IssueDndProvider>
  );
}

// 공용 provider 의 드롭 이벤트를 구독해 상태 컬럼·레인 칸·카드 대상일 때만 상태를 바꾼다(handleDragEnd).
// 그룹 보드(스윔레인)에도 둔다 — 다른 레인 카드·칸에 놓았을 때 그 status 로 바뀌지 않는 것은 boardDropStatusId 가 맡는다(WP-1021).
function BoardStatusDropMonitor({ onDragEnd }: { onDragEnd: (e: DragEndEvent) => void }) {
  useDndMonitor({ onDragEnd });
  return null;
}

// 보드 스크롤 컨테이너 — 컬럼 끝 sentinel 이 IntersectionObserver root 로 쓰도록 컨텍스트로 내려준다.
const BoardScrollRootContext = createContext<Element | null>(null);

// 무엇을: 보드 자체가 가로·세로 스크롤 컨테이너(부모가 준 높이를 h-full 로 채움) — 컬럼은 min-w-[240px] flex 행.
// 왜: 좁은 폭(1024px 등)에서 4-track grid 가 컬럼을 ~160px 로 압축해 truncate 제목이 식별 불가 →
//     컬럼 min-width + 가로 스크롤로 식별성 보존(넓은 폭은 flex-1 로 4-up 유지).
//     세로 스크롤도 같은 컨테이너가 맡아야 가로 스크롤바가 콘텐츠 끝이 아닌 영역 하단에 늘 보이고,
//     컬럼 헤더 sticky 가 이 컨테이너 기준으로 붙는다. 행은 min-h-full 로 컬럼(드롭 영역)을 영역 높이까지 늘린다.
//     상태 보드·그룹 보드가 같은 컨테이너를 쓴다 — 그룹 보드(columnCount 없음)는 스윔레인(BoardSwimlanes)이 같은 트랙 규칙의 그리드를 직접 그린다.
//     columnCount 가 있으면(상태 보드) 범주 띠 줄 + 컬럼 줄의 그리드 — 띠 칸이 걸친 컬럼 폭(gap 포함)과 정확히 맞고 함께 가로 스크롤된다.
//     컬럼 트랙은 boardTrackStyle(minmax(240px, 1fr)) — 예전 flex-1 + min-w-[240px] 과 같은 폭 규칙, 스윔레인도 같은 규칙을 쓴다.
//     band=false(개인 보드)면 띠 줄 없이 컬럼 줄 하나다.
function BoardScroll({
  children,
  footer,
  columnCount,
  band = false,
  scrollReset,
}: {
  children?: ReactNode;
  footer?: ReactNode;
  columnCount?: number;
  band?: boolean;
  /** 새 조건(key)의 결과가 모두 들어오면 세로 스크롤을 맨 위로(useScrollTopWhenSettled, WP-1049). 가로 위치는 그대로 둔다. */
  scrollReset?: { key: string; refreshing: boolean };
}) {
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  useScrollTopWhenSettled(el, scrollReset?.key ?? '', scrollReset?.refreshing ?? false);
  return (
    <div ref={setEl} className="h-full overflow-auto" data-testid="board-scroll">
      <BoardScrollRootContext.Provider value={el}>
        {columnCount ? (
          <div
            className={cn('grid min-h-full gap-x-3', band ? 'grid-rows-[auto_1fr]' : 'grid-rows-[1fr]')}
            style={boardTrackStyle(columnCount)}
          >
            {children}
          </div>
        ) : (
          <div className="flex min-h-full gap-3">{children}</div>
        )}
        {footer}
      </BoardScrollRootContext.Provider>
    </div>
  );
}

// 컬럼 헤더 — 보드 스크롤 컨테이너 기준 sticky 라 긴 컬럼을 내려도 라벨·개수가 보인다.
// -mx-2 -mt-2 / px-3 pt-2 는 컬럼의 p-2 를 상쇄해 배경이 컬럼 폭을 덮게 한다(컬럼 패딩과 함께 바꿀 것).
const COLUMN_HEADER_CLASS =
  'sticky top-0 z-10 -mx-2 -mt-2 flex items-center justify-between gap-2 rounded-t-md bg-background px-3 pt-2 pb-2 text-sm font-semibold text-foreground';

// 상태 이름 편집(OWNER) — 헤더 ⋯ 메뉴와 인라인 이름 변경에 필요한 것들. 없으면 편집 진입점을 그리지 않는다.
type ColumnEdit = {
  // 이름 중복 검사용 프로젝트 상태 목록.
  statuses: ProjectStatus[];
  renaming: boolean;
  onRename: () => void;
  onRenameCancel: () => void;
  onRenameSubmit: (name: string) => Promise<void>;
  onAddAfter: (name: string) => Promise<void>;
  onManage: () => void;
};

// 각 컬럼(프로젝트 상태 하나)은 droppable + 내부 카드들이 SortableContext 에 묶여 있다.
function BoardColumn({
  status,
  issues,
  query,
  projectKey,
  cardTo,
  showType = true,
  onOpenCreate,
  onShowAllClosed,
  dragDisabled = false,
  onLongPress,
  belowBand = false,
  edit,
}: {
  status: ProjectStatus;
  issues: IssueResponse[];
  // 이 컬럼 전용 무한 쿼리 — 끝 sentinel 로 다음 페이지를 받고, 남은 페이지가 있으면 카운트에 "+" 표시.
  query?: BoardColumnQuery;
  projectKey: string;
  // 카드 링크 대상 빌더 — 부모에서 thread.
  cardTo?: (issue: IssueResponse) => string;
  // 유형 아이콘 표시(기본 true). 개인 보드는 TASK 고정이라 false 로 숨김.
  showType?: boolean;
  // 빈 컬럼 CTA 콜백 — 제공 시 "이슈 추가" 버튼 표시. 이 컬럼 상태로 만든다.
  onOpenCreate?: (statusId?: number) => void;
  // 종료 이슈를 숨긴 완료·취소 범주 열 — 있으면 빈 열에 숨김 안내와 「완료 모두 보기」를 둔다(WP-606).
  onShowAllClosed?: () => void;
  // 비멤버는 카드 드래그 차단.
  dragDisabled?: boolean;
  onLongPress?: (issue: IssueResponse) => void;
  // 범주 띠 아래 컬럼 — 헤더가 sticky 띠(h-9) 바로 아래에 붙는다.
  belowBand?: boolean;
  // OWNER 편집 — 없으면 ⋯ 를 그리지 않는다.
  edit?: ColumnEdit;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `col-${status.id}`,
    // label: 스크린리더 드래그 안내가 컬럼 이름을 읽는 데 쓴다(epicDnd.describeDropTarget).
    data: { statusId: status.id, label: status.name },
  });
  // 인라인 이름 변경이 끝나면(Enter 저장·Esc·바깥 클릭) 이 컬럼의 ⋯ 로 포커스를 돌린다 — 입력이 사라져 포커스가 body 로 떨어지지 않게.
  // 바깥 클릭으로 다른 요소에 포커스가 갔으면 그대로 둔다(빼앗지 않는다 — useRestoreFocusOnExit 규칙).
  const menuTriggerRef = useRef<HTMLButtonElement>(null);
  useRestoreFocusOnExit(!!edit?.renaming, menuTriggerRef);
  // 첫 결과를 아직 받지 못했다(받은 카드도 없다) — 낙관적 이동으로 들어온 카드가 있으면 그대로 그린다.
  const firstLoading = issues.length === 0 && !!query?.isPending;
  return (
    <section
      ref={setNodeRef}
      aria-label={`${status.name} 컬럼`}
      data-testid={`board-col-${status.id}`}
      data-status-id={status.id}
      className={`min-h-[200px] min-w-0 rounded-md border p-2 ${isOver ? 'bg-accent/30' : ''}`}
    >
      {/* 범주 띠가 있으면 sticky 띠(h-9) 바로 아래에 붙는다 — 세로 스크롤해도 띠와 헤더가 함께 보인다. */}
      <header className={cn(COLUMN_HEADER_CLASS, belowBand && 'top-9')}>
        {edit?.renaming ? (
          // 헤더 자리 인라인 이름 변경 — Enter 저장, Esc 취소. 오류는 입력 아래.
          <StatusNameEditor
            initial={status.name}
            statuses={edit.statuses}
            excludeId={status.id}
            onSubmit={edit.onRenameSubmit}
            onCancel={edit.onRenameCancel}
            inline
            className="flex-1"
          />
        ) : (
          <>
            {/* 상태 이름은 30자까지 — 좁은 컬럼에서 말줄임하고 전체 이름은 title 로 보인다. */}
            <span className="flex min-w-0 items-center gap-1.5">
              <IssueStatusIcon status={status.category} color={status.color} decorative className="h-4 w-4" />
              <span className="truncate" title={status.name}>
                {status.name}
              </span>
              {/* 아직 받지 않은 페이지가 있으면 로드분이 전체가 아니므로 "N+" 로 표시 */}
              {/* 처음 받는 중에는 수를 비워 둔다 — 「0」으로 보였다가 실제 수로 바뀌지 않게(WP-1049). */}
              <span className="shrink-0 font-normal text-muted-foreground" data-testid={`board-col-count-${status.id}`}>
                {firstLoading ? '' : issues.length}
                {query?.hasNextPage ? '+' : ''}
              </span>
            </span>
            {edit && (
              <BoardColumnHeaderMenu
                status={status}
                canEdit
                statuses={edit.statuses}
                triggerRef={menuTriggerRef}
                onRename={edit.onRename}
                onAddAfter={edit.onAddAfter}
                onManage={edit.onManage}
              />
            )}
          </>
        )}
      </header>
      <SortableContext
        items={issues.map((i) => `issue-${i.id}`)}
        strategy={verticalListSortingStrategy}
      >
        {/* 조건을 바꾼 뒤 이 컬럼이 이전 카드로 자리를 채우는 동안만 흐린다(WP-1049) — 컬럼마다 따로 풀리고 헤더 메뉴는 그대로 쓴다. */}
        <RefreshingResults refreshing={!!query?.isPlaceholderData}>
          {firstLoading ? (
            // 처음 받는 중 — 빈 상태(「이슈 없음」)를 그렸다가 카드로 바뀌지 않게 카드 자리만 보인다(WP-1049).
            // 조건을 바꾼 뒤에는 이전 카드가 자리를 채우므로(keepPreviousInProject) 보드를 처음 열 때만 보인다.
            <div className="flex flex-col gap-2" aria-busy="true" aria-label={`${status.name} 불러오는 중`} data-testid={`board-col-pending-${status.id}`}>
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
          ) : issues.length === 0 ? (
            /* 빈 컬럼 — 디자인 시스템 §2.5 빈 상태 패턴: 아이콘 + 제목 + 설명 + CTA */
            <div
              className="flex flex-col items-center justify-center py-8 gap-3 text-center"
              data-testid={`board-col-empty-${status.id}`}
            >
              <Inbox className="h-8 w-8 text-muted-foreground/50" aria-hidden="true" />
              <div className="space-y-1">
                <p className="text-sm font-medium text-muted-foreground">이슈 없음</p>
                {/* 좁은 열에서 음절 단위로 끊기지 않게 어절 단위 줄바꿈(break-keep) */}
                <p className="break-keep px-2 text-xs text-muted-foreground">
                  {onShowAllClosed ? CLOSED_HIDDEN_NOTE : '드래그하거나 새 이슈를 추가하세요'}
                </p>
              </div>
              {onShowAllClosed && <ShowAllClosedButton testKey={status.id} onClick={onShowAllClosed} />}
              {onOpenCreate && (
                // 컬럼 상태로 만든다(WP-464, WP-808) — 「검토 중」 컬럼에서 누르면 검토 중으로 만들어진다.
                <Button size="sm" variant="ghost" onClick={() => onOpenCreate(status.id)} data-testid={`board-col-add-${status.id}`}>
                  <Plus className="h-4 w-4" />
                  이슈 추가
                </Button>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {issues.map((it) => (
                <IssueCard key={it.id} projectKey={projectKey} issue={it} to={cardTo?.(it)} showType={showType} dragDisabled={dragDisabled} onLongPress={onLongPress} />
              ))}
            </div>
          )}
        </RefreshingResults>
      </SortableContext>
      {query && <ColumnLoadMore testKey={status.id} query={query} />}
    </section>
  );
}

// 컬럼 끝 sentinel — 화면에 들어오면 이 컬럼의 다음 페이지를 받는다(짧은 컬럼은 끝까지 연속 로드).
// 다음 페이지 요청이 실패하면 자동 로드를 멈추고 "다시 시도" 버튼을 보인다(공용 LoadMoreFooter).
// testKey — 컬럼·탭의 statusId(데스크톱·모바일 공통).
function ColumnLoadMore({ testKey, query }: { testKey: number; query: BoardColumnQuery }) {
  return (
    <LoadMoreFooter
      query={query}
      root={useContext(BoardScrollRootContext)}
      className="py-2"
      data-testid={`board-col-more-${testKey}`}
    />
  );
}

// 모바일 보드 빈 상태(WP-195) — 상태 컬럼·그룹 보드 탭이 같은 모양을 쓰도록 통일.
// 추가 버튼은 터치 타깃 44px(h-11) 확보, onOpenCreate 가 있을 때만 노출.
function MobileBoardEmpty({
  status,
  onOpenCreate,
  onShowAllClosed,
}: {
  // 탭 상태 id — testid 접미사.
  status: number;
  // 이 탭 상태로 만드는 콜백(호출부가 묶어 넘긴다).
  onOpenCreate?: () => void;
  onShowAllClosed?: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-12 text-center" data-testid={`board-col-empty-${status}`}>
      <Inbox className="h-8 w-8 text-muted-foreground/50" aria-hidden="true" />
      <p className="text-sm font-medium text-muted-foreground">이슈 없음</p>
      {onShowAllClosed && (
        <>
          <p className="break-keep px-6 text-xs text-muted-foreground">{CLOSED_HIDDEN_NOTE}</p>
          <ShowAllClosedButton testKey={status} onClick={onShowAllClosed} className="h-11 px-4" />
        </>
      )}
      {onOpenCreate && (
        <Button size="sm" variant="ghost" className="h-11 px-4" onClick={onOpenCreate} data-testid={`board-col-add-${status}`}>
          <Plus className="h-4 w-4" />
          이슈 추가
        </Button>
      )}
    </div>
  );
}

// 모바일 상태 탭의 카드 목록(WP-195) — 헤더는 탭이 대신하고, 드롭 영역(DnD)도 없다. 끝 sentinel 은 데스크톱 컬럼과 같은 ColumnLoadMore.
function MobileStatusColumn({
  status,
  issues,
  query,
  pending,
  projectKey,
  cardTo,
  showType,
  onOpenCreate,
  onShowAllClosed,
  onLongPress,
}: {
  // 이 탭의 프로젝트 상태(WP-808).
  status: ProjectStatus;
  issues: IssueResponse[];
  // 이 상태 컬럼 쿼리 — 끝 sentinel 로 다음 페이지를 받는다.
  query?: BoardColumnQuery;
  // 첫 페이지 로딩 중.
  pending: boolean;
  projectKey: string;
  cardTo?: (issue: IssueResponse) => string;
  showType: boolean;
  onOpenCreate?: () => void;
  onShowAllClosed?: () => void;
  onLongPress?: (issue: IssueResponse) => void;
}) {
  // 첫 페이지 응답 전에는 빈 상태를 띄우지 않는다(「이슈 없음」 깜빡임 방지).
  if (issues.length === 0 && pending) return null;
  return (
    <section data-testid={`board-col-${status.id}`} className="flex flex-col gap-2">
      {issues.length === 0 ? (
        <MobileBoardEmpty status={status.id} onOpenCreate={onOpenCreate} onShowAllClosed={onShowAllClosed} />
      ) : (
        issues.map((it) => (
          <IssueCard key={it.id} projectKey={projectKey} issue={it} to={cardTo?.(it)} showType={showType} dragDisabled onLongPress={onLongPress} />
        ))
      )}
      {query && <ColumnLoadMore testKey={status.id} query={query} />}
    </section>
  );
}

// 모바일 그룹 보드 탭의 카드 목록(WP-195) — 선택 상태 안에 그룹 섹션(빈 그룹은 숨김). MobileStatusColumn 과 대칭, DnD 없음.
function MobileGroupedColumn({
  status,
  issues,
  groupBy,
  pending,
  footer,
  projectKey,
  cardTo,
  showType,
  onOpenCreate,
  onShowAllClosed,
  onLongPress,
}: {
  // 이 탭의 프로젝트 상태(WP-808).
  status: ProjectStatus;
  issues: IssueResponse[];
  groupBy: IssueClientGroupBy;
  pending: boolean;
  footer: ReactNode;
  projectKey: string;
  cardTo?: (issue: IssueResponse) => string;
  showType: boolean;
  onOpenCreate?: () => void;
  onShowAllClosed?: () => void;
  onLongPress?: (issue: IssueResponse) => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      {groupIssues(issues, groupBy)
        .filter((g) => g.issues.length > 0)
        .map((g) => (
          // 탭이 상태를 드러내므로 카드에 상태 아이콘을 두지 않는다.
          <section key={g.key} aria-label={g.label} data-testid={`board-group-${status.id}-${g.key}`} className="flex flex-col gap-2">
            <h3 className="flex items-center gap-1.5 px-3 text-xs font-semibold text-muted-foreground">
              <span>{g.label}</span>
              <span>{g.issues.length}</span>
            </h3>
            {g.issues.map((it) => (
              <IssueCard key={it.id} projectKey={projectKey} issue={it} to={cardTo?.(it)} showType={showType} dragDisabled dragScope={`${status.id}-${g.key}`} onLongPress={onLongPress} />
            ))}
          </section>
        ))}
      {issues.length === 0 && !pending && <MobileBoardEmpty status={status.id} onOpenCreate={onOpenCreate} onShowAllClosed={onShowAllClosed} />}
      {footer}
    </div>
  );
}
