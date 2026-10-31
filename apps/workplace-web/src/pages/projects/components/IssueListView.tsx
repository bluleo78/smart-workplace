// 태스크 리스트 뷰 — cursor 기반 무한 스크롤.
// sentinel 이 뷰포트에 들어오면 다음 페이지를 자동 fetch.
// 행은 아이콘 중심(상태/우선순위/유형) + 담당자 + 행 전체 클릭으로 상세 이동(#234).
// #606: Drive DrivePage.tsx 의 체크박스+벌크 툴바 패턴을 재사용한 다중 선택/일괄 작업
// (상태 변경/담당자 지정/삭제) — 보드 뷰(칸반)는 업계 관행(Linear/Jira/GitHub 등)대로 제외.

import { ChevronRight, CircleCheckBig, LayoutList } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { SelectAllCheckbox } from '@/components/SelectAllCheckbox';
import { useRegisterShareTarget } from '@/components/share/useRegisterShareTarget';
import { useIsMobile } from '@/hooks/useIsMobile';
import { LIST_HEAD_CELL_CLASS, LIST_ID_HEAD_INDENT_CLASS } from '@/lib/listStyles';
import { issueShareTarget, type ShareTarget } from '@/lib/shareTarget';
import { cn } from '@/lib/utils';

import { ListLoadingSkeleton } from '../../../components/issue/ListLoadingSkeleton';
import { RefreshingResults } from '../../../components/RefreshingResults';
import { Button } from '../../../components/ui/button';
import { LoadMoreFooter } from '../../../components/ui/load-more-footer';
import { useIssueGroupCounts } from '../../../hooks/queries/useIssueGroupCounts';
import { useIssueSearchKeepingPrevious } from '../../../hooks/queries/useIssueSearch';
import { useProjectStatusList } from '../../../hooks/queries/useProjectStatuses';
import { useIssueSelection } from '../../../hooks/useIssueSelection';
import { useScrollTopWhenSettled } from '../../../hooks/useScrollTopWhenSettled';
import { CLOSED_HIDDEN_NOTE } from '../../../lib/closedHiding';
import { filterOnlyKey, filtersToParams, withDefaultIssueScope } from '../../../lib/issueFilters';
import { groupCountsByKey, groupIssues } from '../../../lib/issueGrouping';
import { DEFAULT_COLUMNS, type IssueListColumnKey } from '../../../lib/issueListColumns';
import { sortOf } from '../../../lib/issueSort';
import { labelFg } from '../../../lib/labelColors';
import { failedWithoutData } from '../../../lib/queryFailure';
import type { IssueClientGroupBy, IssueFilters, IssueResponse } from '../../../types/issue';
import { useClosedHidingNotice } from '../hooks/useClosedHidingNotice';
import { useIssueRowActions } from '../hooks/useIssueRowActions';
import { useSetIssueSort } from '../hooks/useIssueSortParam';
import { BulkBarSpacer, IssueBulkActions } from './IssueBulkActions';
import { IssueFilterEmptyState } from './IssueFilterEmptyState';
import { columnHeadCells, issueListColumnCount, issueListMinWidthRem, useColumnDefs } from './issueListColumnDefs';
import { ISSUE_LIST_COLUMN_COUNT_MOBILE, IssueRow } from './IssueListRow';
import { IssueLoadErrorState } from './IssueLoadErrorState';
import { SortableTh } from './IssueSortHeader';

/** 에픽 그룹 헤더 ◆ 글자색 — 그룹 첫 이슈의 부모(=그 에픽) 유형 색 토큰(배경 없는 글자용 fg). */
function epicGroupColor(first: IssueResponse | undefined): string {
  return labelFg(first?.parent?.type?.colorToken);
}

export function IssueListView({
  projectKey,
  filters,
  groupBy,
  onOpenCreate,
  onLoadedChange,
  canDrag = false,
  canEdit = canDrag,
  columns = DEFAULT_COLUMNS,
}: {
  projectKey: string;
  filters: IssueFilters;
  groupBy: IssueClientGroupBy | null;
  /** 보일 선택 열 키(표시 순서, WP-270) — 미지정이면 기본 열(우선순위·담당자·마감). 참조가 바뀌면 행이 다시 그려지니 안정된 배열을 넘긴다. */
  columns?: IssueListColumnKey[];
  /** 초기 빈 상태 CTA — "새 태스크 만들기" 버튼에 연결 */
  onOpenCreate?: () => void;
  /** WP-54: 로드된 건수·추가 로드 가능 여부를 상위(IssueArea)로 알린다 — AI 화면 컨텍스트 건수용. */
  onLoadedChange?: (count: number, hasMore: boolean) => void;
  /** 프로젝트 멤버만 행을 에픽 패널로 끌 수 있다 */
  canDrag?: boolean;
  // 길게 누르기 액션(상태·에픽) 권한 — 모바일에선 canDrag 가 꺼져도 멤버면 true. 미지정 시 canDrag(개인 화면 호환).
  canEdit?: boolean;
}) {
  // 보드와 같은 기본 범위 — 에픽 행 제외, 에픽 하위 이슈 노출, SUBTASK 숨김(withDefaultIssueScope).
  const isMobile = useIsMobile();
  // 선택 열 정의 — 커스텀 필드 열이 있을 때만 필드 정의를 불러온다(기본 열 화면은 요청이 늘지 않게).
  const columnDefs = useColumnDefs(projectKey, columns);
  // 표 최소 폭 — 기본 밖의 열을 켰을 때만(없으면 null, 제목이 남은 폭에 맞춰 줄어든다).
  const minWidthRem = issueListMinWidthRem(columnDefs.defs);
  const scopedFilters = useMemo(() => withDefaultIssueScope(filters), [filters]);
  // 열 머리 정렬(WP-1238) — 지금 정렬은 필터(URL sort·direction)에서, 바꾸기는 URL 로. 서버가 정렬한 순서를 그대로 그린다(그룹 안에서도).
  const setSort = useSetIssueSort();
  const { sort: sortKey, direction: sortDirection } = filters;
  // 정렬 두 값만 의존한다 — 다른 필터가 바뀌어도 머리 칸이 다시 그려지지 않게.
  const headSort = useMemo(() => ({ sort: sortOf({ sort: sortKey, direction: sortDirection }), onSort: setSort }), [sortKey, sortDirection, setSort]);
  // 저장한 뷰·필터를 바꾸면 새 결과가 올 때까지 이전 목록을 흐리게 둔다(WP-1049) — 스켈레톤은 처음 열 때만.
  const searchQuery = useIssueSearchKeepingPrevious(projectKey, scopedFilters);
  // 이전 조건의 결과로 자리를 채우는 중 — 흐림(RefreshingResults)·건수 보고 보류·스크롤 맨 위로의 기준.
  const refreshing = searchQuery.isPlaceholderData;
  // 프로젝트 상태 목록(WP-808) — 상태 그룹 버킷(statusId)과 행 메뉴 선택지. 호출부가 ProjectStatusesGate 로 목록을 받은 뒤에 그린다(WP-870).
  const statuses = useProjectStatusList(projectKey);
  // 그룹 헤더 수는 서버 총계(WP-472) — 30개씩 불러오므로 화면이 센 수는 불러온 행 수일 뿐이다. 총계가 오기 전·에픽 그룹은 불러온 행 수.
  const groupCounts = useIssueGroupCounts(projectKey, scopedFilters, groupBy);
  const countByKey = useMemo(() => groupCountsByKey(groupCounts.data), [groupCounts.data]);
  const { data, isLoading } = searchQuery;
  // 테이블 스크롤 컨테이너 — 목록 끝 LoadMoreFooter sentinel 의 IntersectionObserver root(콜백 ref 라 마운트 후 재부착).
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null);

  // 접힌 그룹 키 — 화면 로컬 상태(새로고침 시 펼침). 사이클 구간 헤더(IssueCycleSection)와 같은 접기 UX.
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  // 그룹 기준이 바뀌면 접힘 초기화 — 이전 기준의 키가 새 그룹을 접어버리는 것을 막는다(렌더 중 리셋 패턴).
  const [prevGroupBy, setPrevGroupBy] = useState(groupBy);
  if (prevGroupBy !== groupBy) {
    setPrevGroupBy(groupBy);
    setCollapsed(new Set());
  }
  const toggleGroup = useCallback((key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  // 누적 페이지 → 평면 목록·그룹을 한 번만 계산한다(렌더·접힘 판정 공용). 훅이라 조기 반환 전에 둔다.
  const items = useMemo(
    () => data?.pages.flatMap((p) => p.items ?? []).filter((x) => x != null) ?? [],
    [data],
  );
  const groups = useMemo(
    () => (groupBy ? groupIssues(items, groupBy, statuses).filter((g) => g.issues.length > 0) : null),
    [items, groupBy, statuses],
  );
  // 그룹 모드에서 모든 그룹이 접혀 행이 하나도 안 그려지면 sentinel 이 화면에 들어와 다음 페이지를 연쇄 로드한다 →
  // 이 경우엔 LoadMoreFooter 의 observer 를 달지 않는다(sentinel 은 그대로 마운트, 펼치면 정상 재개).
  const allGroupsCollapsed = groups != null && groups.length > 0 && groups.every((g) => collapsed.has(g.key));

  // 목록 조건(필터·그룹 직렬화) — 선택 초기화와 스크롤 맨 위로의 기준.
  const listKey = filtersToParams(filters, 'list', groupBy).toString();
  // 새 조건의 결과가 실제로 들어오면 스크롤을 맨 위로(WP-1049) — 자리채움 동안 스크롤 컨테이너가 남아 옛 위치에 새 목록이 보이지 않게.
  useScrollTopWhenSettled(scrollEl, listKey, refreshing);

  // #606: 다중 선택 상태 — 이슈 number 집합. 필터/그룹 기준(직렬화 값)이 바뀌면 초기화.
  const {
    selected,
    setSelected,
    toggle: toggleSelected,
    clear: clearSelected,
    settleBulk,
  } = useIssueSelection(listKey);

  // 모바일 길게 누르기 액션 — 훅은 조기 반환 전에 둔다. canEdit 가 곧 멤버 여부.
  // 종료 이슈 숨김 안내(WP-606) — 행 메뉴·일괄 바로 종료한 이슈가 숨겨지면 토스트로 알린다.
  const closedHiding = useClosedHidingNotice(!!scopedFilters.hideInactiveClosed);
  const rowActions = useIssueRowActions({
    projectKey, canEdit, statuses, onSelect: (i) => toggleSelected(i.number), isSelected: (i) => selected.has(i.number),
    selected, onBulkSettled: settleBulk, closedHiding,
  });
  // 체크한 줄이 하나면 ⇧⌘,·⌘. 가 그 이슈의 링크·키를 복사한다(WP-1236) — 목록 화면에는 다른 대상이 없어 selection 층으로 둔다.
  const selectedOne = selected.size === 1 ? items.find((i) => selected.has(i.number)) : undefined;
  const selectionTarget = useMemo<ShareTarget | null>(
    () => (selectedOne ? issueShareTarget(selectedOne.projectKey, selectedOne.number, selectedOne.title) : null),
    [selectedOne],
  );
  useRegisterShareTarget(selectionTarget, 'selection');

  // WP-54: 로드된 건수(무한 스크롤 누적)·다음 페이지 유무를 상위로 보고 — isLoading 조기 반환 전에 둔다.
  // data 객체(쿼리 결과)가 바뀔 때마다 보고한다 — 필터 변경으로 상위가 건수를 비운 뒤, 캐시된 새 결과의 건수가
  // 우연히 이전과 같아도 다시 채워지도록(건수 숫자만 의존하면 effect 가 돌지 않아 건수가 비어 남는다).
  const hasMore = searchQuery.hasNextPage ?? false;
  useEffect(() => {
    // 이전 조건의 자리채움 건수는 보고하지 않는다(WP-1049) — 새 조건과 옛 건수가 짝지어 AI 화면 맥락에 실리지 않게.
    if (!data || refreshing) return;
    onLoadedChange?.(data.pages.reduce((n, p) => n + (p.items?.length ?? 0), 0), hasMore);
  }, [data, hasMore, refreshing, onLoadedChange]);

  // 첫 페이지를 못 불러왔으면 빈 상태가 아니라 실패로 알린다(WP-858) — 다음 페이지 실패는 LoadMoreFooter 가 맡는다.
  // 로딩보다 먼저, failedWithoutData 로 본다 — 다시 시도로 다시 부르는 동안(pending)에도 안내를 두어 키보드 초점을 지킨다(WP-893).
  if (failedWithoutData(searchQuery)) {
    return <IssueLoadErrorState queries={[searchQuery]} />;
  }

  // 첫 로딩 — 「로딩 중…」 글자 대신 스켈레톤(DS 06 §A-2). 데스크톱은 표 자리, 모바일은 2줄 행 모양.
  // 이전 조건의 결과가 0건이면 자리채움으로 둘 목록이 없다(WP-1049) — 빈 상태(「이슈가 없습니다」·필터 빈 상태)를 새 조건에 붙여
  // 흐림 없이 보이면 결과가 있는 조건에서도 틀린 안내와 「새 태스크 만들기」가 눌린다. 첫 로딩과 같게 스켈레톤을 보인다.
  if (isLoading || (refreshing && items.length === 0)) {
    return <ListLoadingSkeleton label="이슈 불러오는 중" />;
  }

  // 검색어·필터가 하나라도 적용된 상태인지 판별.
  // filtersToParams 는 기본값(빈 배열, 빈 문자열, topLevel=false 등)을 URL 에서 생략하므로
  // toString() === '' 이면 실질 필터가 없는 초기 상태임.
  // 정렬(WP-1238)은 필터가 아니라 뺀다 — 정렬만 고른 빈 목록에 「필터 결과 없음」이 뜨지 않게.
  const hasActiveFilters = filterOnlyKey(filters) !== '';

  if (items.length === 0) {
    if (hasActiveFilters) {
      // 검색어·필터가 활성 상태에서 결과가 없는 경우 — 디자인 시스템 empty state 4요소 (#337).
      return <IssueFilterEmptyState />;
    }
    // 필터 없는 초기 빈 상태 — 첫 사용 또는 모든 이슈 완료·삭제 후 (#337).
    return (
      <div
        className="flex flex-col items-center justify-center gap-3 py-16 text-center"
        data-testid="empty-no-issues"
      >
        <LayoutList className="h-10 w-10 text-muted-foreground" aria-hidden="true" />
        <div className="space-y-1">
          <p className="text-sm font-medium">이슈가 없습니다</p>
          <p className="text-xs text-muted-foreground">
            새 태스크를 만들어 프로젝트를 시작하세요.
          </p>
          {/* 기본 범위가 종료 이슈를 숨겨 비었을 수 있다 — 숨겼다고 알리고 「완료 모두 보기」를 준다(WP-606). */}
          {closedHiding && <p className="text-xs text-muted-foreground">{CLOSED_HIDDEN_NOTE}</p>}
        </div>
        {closedHiding && (
          // 모바일은 터치 타깃 44px(h-11).
          <Button size="sm" variant="outline" className={cn(isMobile && 'h-11 px-4')} onClick={closedHiding.onShowAll} data-testid="empty-show-closed">
            <CircleCheckBig className="h-4 w-4" />
            완료 모두 보기
          </Button>
        )}
        {onOpenCreate && (
          <Button size="sm" onClick={() => onOpenCreate()} data-testid="empty-create-issue">
            새 태스크 만들기
          </Button>
        )}
      </div>
    );
  }

  // 특정 에픽으로 필터됐거나 에픽 그룹 안이면 행의 에픽 표시는 중복이라 생략(WP-194).
  const hideEpic = filters.parentNumber != null || groupBy === 'epic';

  const allNumbers = items.map((it) => it.number);
  const allSelected = allNumbers.length > 0 && allNumbers.every((n) => selected.has(n));
  // 일부만 고르면 머리 체크박스를 「일부 선택」으로(WP-1071) — 툴바의 「선택 N개」와 같은 기준(selected 전체).
  const someSelected = !allSelected && selected.size > 0;

  function toggleSelectAll() {
    setSelected(allSelected ? new Set() : new Set(allNumbers));
  }

  return (
    // 부모가 높이를 주면(h-full) 벌크 툴바는 위에 고정, 테이블 영역만 가로·세로 스크롤한다.
    // 높이를 안 주는 부모에서는 h-full 이 무시돼 기존처럼 콘텐츠 높이대로 늘어난다.
    <div className="flex h-full flex-col">
      {/* #606: 선택된 항목이 있을 때만 노출되는 벌크 액션 툴바(+삭제 확인) — 사이클 구간 목록과 공유. */}
      <IssueBulkActions projectKey={projectKey} selected={selected} onClear={clearSelected} onSettled={settleBulk} closedHiding={closedHiding} />
      {/* 테이블 스크롤 영역 — thead 가 이 컨테이너 기준 sticky 로 붙는다(래퍼가 overflow-x 만 가지면 sticky 가 무력화됨).
          border-collapse 표에서 sticky 행은 테두리가 사라지므로 하단 구분선은 tr border 대신 inset shadow 로 그린다. */}
      <RefreshingResults refreshing={refreshing} className="min-h-0 flex-1">
        <div ref={setScrollEl} className="h-full overflow-auto" data-testid="issue-list-scroll">
          {/* table-fixed — 칸 폭을 머리 행의 열 폭이 정하고 내용(긴 값·헤더 이름·칩)이 넓히지 못한다(WP-1143).
              자동 레이아웃에선 열 폭이 하한일 뿐이라 칸 상한(max-width)에 기대야 했는데, 표 칸의 max-width 는 명세상 정의되지 않아
              브라우저마다 다르다. 모바일은 한 칸 행의 메타 줄(nowrap truncate)이 표를 넓히던 것을 같은 이유로 막는다(WP-194).
              기본 밖의 열을 켜면 제목이 16rem 아래로 줄지 않게 표 최소 폭을 열 폭 합으로 잡아 가로 스크롤시킨다(사이클 구간 목록과 같다). */}
          <table
            className="w-full table-fixed text-sm"
            style={isMobile || minWidthRem == null ? undefined : { minWidth: `${minWidthRem}rem` }}
            role="table"
          >
            {!isMobile && (
              <thead className="sticky top-0 z-10 bg-background shadow-[inset_0_-1px_0_var(--color-border)]">
                {/* 이 행의 w-* 가 열 폭이다(table-fixed) — 폭을 주지 않은 제목 칸이 남은 폭을 가져간다. */}
                {/* 열 머리 모양은 공용 LIST_HEAD_CELL_CLASS — 사이클 구간 목록 헤더·내 작업과 같다(WP-919). */}
                <tr>
                  <th className={cn(LIST_HEAD_CELL_CLASS, 'w-9')}>
                    <SelectAllCheckbox
                      checked={allSelected}
                      indeterminate={someSelected}
                      onChange={toggleSelectAll}
                      aria-label="전체선택"
                      data-testid="issue-select-all"
                      className="h-4 w-4"
                    />
                  </th>
                  {/* 상태·우선순위는 아이콘 컬럼 — 헤더 라벨은 sr-only, 정렬 단추는 화살표만 보인다(WP-1238). */}
                  <SortableTh className={cn(LIST_HEAD_CELL_CLASS, 'w-9')} head={headSort} sortKey="status" label="상태" srOnlyLabel>
                    <span className="sr-only">상태</span>
                  </SortableTh>
                  {/* 선택 열(우선순위 등)은 열 정의(issueListColumnDefs)에서 — ID 왼쪽 / 제목 뒤 순서로 그린다(WP-270). */}
                  {columnHeadCells(columnDefs.left, { thClass: LIST_HEAD_CELL_CLASS, headSort })}
                  {/* 「ID」 글자를 행의 키 글자(유형 아이콘 뒤)에 맞춘다. */}
                  <th className={cn(LIST_HEAD_CELL_CLASS, LIST_ID_HEAD_INDENT_CLASS, 'w-28')}>ID</th>
                  {/* 제목 하한(16rem)은 표 최소 폭(위 style)이 지킨다 — 기본 열 구성에선 걸지 않아 좁은 데스크톱(1024px)에서 가로 스크롤 없이 제목이 줄어든다. */}
                  <th className={LIST_HEAD_CELL_CLASS}>제목</th>
                  {columnHeadCells(columnDefs.right, { thClass: LIST_HEAD_CELL_CLASS, headSort })}
                  <th className={cn(LIST_HEAD_CELL_CLASS, 'w-8')}><span className="sr-only">작업</span></th>
                </tr>
              </thead>
            )}
            {groups ? (
              groups.map((g) => (
                <tbody key={g.key} data-testid={`list-group-${g.key}`}>
                  <tr className="bg-muted/40 border-b">
                    <td
                      colSpan={isMobile ? ISSUE_LIST_COLUMN_COUNT_MOBILE : issueListColumnCount(columnDefs.defs)}
                      className="px-1 py-0"
                    >
                      <button
                        type="button"
                        onClick={() => toggleGroup(g.key)}
                        aria-expanded={!collapsed.has(g.key)}
                        data-testid={`list-group-toggle-${g.key}`}
                        className="flex min-h-8 w-full min-w-0 items-center gap-1.5 rounded text-left text-xs font-semibold text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-lg:min-h-11"
                      >
                        <ChevronRight
                          className={cn('size-3.5 shrink-0 transition-transform', !collapsed.has(g.key) && 'rotate-90')}
                          aria-hidden="true"
                        />
                        {/* 에픽 그룹은 ◆ 를 에픽 유형 색으로 — 행 메타·칩과 같은 표식(색 = 첫 이슈 부모 에픽의 유형 토큰). */}
                        {g.key.startsWith('epic-') && (
                          <span className={cn('shrink-0', epicGroupColor(g.issues[0]))} aria-hidden="true">
                            ◆
                          </span>
                        )}
                        <span className="min-w-0 truncate">{g.label}</span>
                        <span className="shrink-0 font-normal" data-testid={`list-group-count-${g.key}`}>
                          {countByKey.get(g.key) ?? g.issues.length}
                        </span>
                      </button>
                    </td>
                  </tr>
                  {!collapsed.has(g.key) && g.issues.map((it) => (
                    <IssueRow
                      key={it.id}
                      issue={it}
                      projectKey={projectKey}
                      selected={selected.has(it.number)}
                      onToggleSelect={toggleSelected}
                      canDrag={canDrag}
                      // 다중 담당자 이슈는 여러 그룹에 보이므로 그룹별로 드래그 id 를 구분한다.
                      dragScope={g.key}
                      onLongPress={rowActions.open}
                      onOpenMenu={rowActions.openMenu}
                      menuOpen={rowActions.menuIssueNumber === it.number}
                      selectionMode={isMobile && selected.size > 0}
                      hideEpic={hideEpic}
                      columns={columnDefs}
                    />
                  ))}
                </tbody>
              ))
            ) : (
              <tbody>
                {items.map((it) => (
                  <IssueRow
                    key={it.id}
                    issue={it}
                    projectKey={projectKey}
                    selected={selected.has(it.number)}
                    onToggleSelect={toggleSelected}
                    canDrag={canDrag}
                    onLongPress={rowActions.open}
                    onOpenMenu={rowActions.openMenu}
                    menuOpen={rowActions.menuIssueNumber === it.number}
                    selectionMode={isMobile && selected.size > 0}
                    hideEpic={hideEpic}
                    columns={columnDefs}
                  />
                ))}
              </tbody>
            )}
          </table>
          {/* 목록 끝 — 자동 로드, 다음 페이지 실패 시에만 다시 시도(공용 LoadMoreFooter, WP-183) */}
          <LoadMoreFooter query={searchQuery} root={scrollEl} enabled={!allGroupsCollapsed} data-testid="issue-list-more" />
        </div>
      </RefreshingResults>
      {/* 모바일 일괄 작업 바(fixed, 약 56px)가 마지막 행을 가리지 않게 같은 높이만큼 비운다. */}
      <BulkBarSpacer active={selected.size > 0} />
      {/* 액션 시트는 표 밖 형제로 — 행 안에 두면 시트 클릭이 행 이벤트로 새어 든다. */}
      {rowActions.sheets}
    </div>
  );
}
