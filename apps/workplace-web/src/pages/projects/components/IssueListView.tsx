// 태스크 리스트 뷰 — cursor 기반 무한 스크롤.
// sentinel 이 뷰포트에 들어오면 다음 페이지를 자동 fetch.
// 행은 아이콘 중심(상태/우선순위/유형) + 담당자 + 행 전체 클릭으로 상세 이동(#234).
// #606: Drive DrivePage.tsx 의 체크박스+벌크 툴바 패턴을 재사용한 다중 선택/일괄 작업
// (상태 변경/담당자 지정/삭제) — 보드 뷰(칸반)는 업계 관행(Linear/Jira/GitHub 등)대로 제외.

import { ChevronRight, LayoutList } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { useIsMobile } from '@/hooks/useIsMobile';
import { cn } from '@/lib/utils';

import { Button } from '../../../components/ui/button';
import { LoadMoreFooter } from '../../../components/ui/load-more-footer';
import { useIssueSearch } from '../../../hooks/queries/useIssueSearch';
import { useIssueSelection } from '../../../hooks/useIssueSelection';
import { filtersToParams, withDefaultIssueScope } from '../../../lib/issueFilters';
import { groupIssues } from '../../../lib/issueGrouping';
import { LABEL_COLORS } from '../../../lib/labelColors';
import type { IssueClientGroupBy, IssueFilters, IssueResponse } from '../../../types/issue';
import type { ColorToken } from '../../../types/label';
import { useIssueRowActions } from '../hooks/useIssueRowActions';
import { BulkBarSpacer, IssueBulkActions } from './IssueBulkActions';
import { IssueFilterEmptyState } from './IssueFilterEmptyState';
import { ISSUE_LIST_COLUMN_COUNT, ISSUE_LIST_COLUMN_COUNT_MOBILE, IssueRow } from './IssueListRow';

/** 에픽 그룹 헤더 ◆ 글자색 — 그룹 첫 이슈의 부모(=그 에픽) 유형 색 토큰(배경 없는 글자용 fg). */
function epicGroupColor(first: IssueResponse | undefined): string {
  const token = first?.parent?.type.colorToken as ColorToken | undefined;
  return (token && LABEL_COLORS[token] ? LABEL_COLORS[token] : LABEL_COLORS.GRAY).fg;
}

export function IssueListView({
  projectKey,
  filters,
  groupBy,
  onOpenCreate,
  onLoadedChange,
  canDrag = false,
  canEdit = canDrag,
}: {
  projectKey: string;
  filters: IssueFilters;
  groupBy: IssueClientGroupBy | null;
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
  const searchQuery = useIssueSearch(projectKey, withDefaultIssueScope(filters));
  const { data, isLoading } = searchQuery;
  // 테이블 스크롤 컨테이너 — 목록 끝 LoadMoreFooter sentinel 의 IntersectionObserver root(콜백 ref 라 마운트 후 재부착).
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null);

  // 접힌 그룹 키 — 화면 로컬 상태(새로고침 시 펼침). 사이클 구간 헤더(IssueCycleSection)와 같은 접기 UX.
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const toggleGroup = useCallback((key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  // 그룹 모드에서 모든 그룹이 접혀 행이 하나도 안 그려지면 sentinel 이 화면에 들어와 다음 페이지를 연쇄 로드한다 →
  // 이 경우엔 LoadMoreFooter 에 hasNextPage 를 꺼서 넘겨 sentinel 을 내린다(펼치면 정상 재개).
  const allGroupsCollapsed = useMemo(() => {
    if (!groupBy || !data) return false;
    const items = data.pages.flatMap((p) => p.items ?? []).filter((x) => x != null);
    const keys = groupIssues(items, groupBy).filter((g) => g.issues.length > 0).map((g) => g.key);
    return keys.length > 0 && keys.every((k) => collapsed.has(k));
  }, [groupBy, data, collapsed]);
  const loadMoreQuery = allGroupsCollapsed ? { ...searchQuery, hasNextPage: false } : searchQuery;

  // #606: 다중 선택 상태 — 이슈 number 집합. 필터/그룹 기준(직렬화 값)이 바뀌면 초기화.
  const {
    selected,
    setSelected,
    toggle: toggleSelected,
    clear: clearSelected,
  } = useIssueSelection(filtersToParams(filters, 'list', groupBy).toString());

  // 모바일 길게 누르기 액션 — 훅은 조기 반환 전에 둔다. canEdit 가 곧 멤버 여부.
  const rowActions = useIssueRowActions({ projectKey, canEdit, onSelect: (i) => toggleSelected(i.number), isSelected: (i) => selected.has(i.number) });

  // WP-54: 로드된 건수(무한 스크롤 누적)·다음 페이지 유무를 상위로 보고 — isLoading 조기 반환 전에 둔다.
  // data 객체(쿼리 결과)가 바뀔 때마다 보고한다 — 필터 변경으로 상위가 건수를 비운 뒤, 캐시된 새 결과의 건수가
  // 우연히 이전과 같아도 다시 채워지도록(건수 숫자만 의존하면 effect 가 돌지 않아 건수가 비어 남는다).
  const hasMore = searchQuery.hasNextPage ?? false;
  useEffect(() => {
    if (!data) return;
    onLoadedChange?.(data.pages.reduce((n, p) => n + (p.items?.length ?? 0), 0), hasMore);
  }, [data, hasMore, onLoadedChange]);

  if (isLoading) {
    return <p className="text-muted-foreground py-4">로딩 중…</p>;
  }

  const items =
    data?.pages.flatMap((p) => p.items ?? []).filter((x) => x != null) ?? [];

  // 검색어·필터가 하나라도 적용된 상태인지 판별.
  // filtersToParams 는 기본값(빈 배열, 빈 문자열, topLevel=false 등)을 URL 에서 생략하므로
  // toString() === '' 이면 실질 필터가 없는 초기 상태임.
  const hasActiveFilters = filtersToParams(filters, 'list', null).toString() !== '';

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
        </div>
        {onOpenCreate && (
          <Button size="sm" onClick={onOpenCreate} data-testid="empty-create-issue">
            새 태스크 만들기
          </Button>
        )}
      </div>
    );
  }

  // 특정 에픽으로 필터됐거나 에픽 그룹 안이면 행의 에픽 표시는 중복이라 생략(WP-194).
  const hideEpic = filters.parentNumber != null || groupBy === 'epic';
  const groups = groupBy
    ? groupIssues(items, groupBy).filter((g) => g.issues.length > 0)
    : null;

  const allNumbers = items.map((it) => it.number);
  const allSelected = allNumbers.length > 0 && allNumbers.every((n) => selected.has(n));

  function toggleSelectAll() {
    setSelected(allSelected ? new Set() : new Set(allNumbers));
  }

  return (
    // 부모가 높이를 주면(h-full) 벌크 툴바는 위에 고정, 테이블 영역만 가로·세로 스크롤한다.
    // 높이를 안 주는 부모에서는 h-full 이 무시돼 기존처럼 콘텐츠 높이대로 늘어난다.
    <div className="flex h-full flex-col">
      {/* #606: 선택된 항목이 있을 때만 노출되는 벌크 액션 툴바(+삭제 확인) — 사이클 구간 목록과 공유. */}
      <IssueBulkActions projectKey={projectKey} selected={selected} onClear={clearSelected} />
      {/* 테이블 스크롤 영역 — thead 가 이 컨테이너 기준 sticky 로 붙는다(래퍼가 overflow-x 만 가지면 sticky 가 무력화됨).
          border-collapse 표에서 sticky 행은 테두리가 사라지므로 하단 구분선은 tr border 대신 inset shadow 로 그린다. */}
      <div ref={setScrollEl} className="min-h-0 flex-1 overflow-auto" data-testid="issue-list-scroll">
        {/* 모바일은 table-fixed — 자동 레이아웃이면 한 칸 행의 메타 줄(nowrap truncate)의 min-content 가
            열 너비가 되어 표가 컨테이너보다 넓어지고, 긴 제목이 오른쪽에서 잘린다(WP-194). 데스크톱은 그대로. */}
        <table className={cn('w-full text-sm', isMobile && 'table-fixed')} role="table">
          {!isMobile && (
            <thead className="sticky top-0 z-10 bg-background shadow-[inset_0_-1px_0_var(--color-border)]">
              {/* min-w-* — 제목 칸이 w-full(IssueRow)로 남은 폭을 가져가면 자동 레이아웃 표는 다른 칸의 w-* 를 무시하고
                  최소 내용폭까지 줄인다(ID 가 제목에 붙음). min-width 로 기존 칸 폭을 하한으로 고정한다(WP-194). */}
              <tr className="text-left text-muted-foreground">
                <th className="w-9 min-w-9 py-2">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleSelectAll}
                    aria-label="전체선택"
                    data-testid="issue-select-all"
                    className="h-4 w-4"
                  />
                </th>
                {/* 상태·우선순위는 아이콘 컬럼 — 헤더 라벨은 sr-only. */}
                <th className="w-9 min-w-9 py-2"><span className="sr-only">상태</span></th>
                {/* 우선순위·마감은 좁은 화면(<sm)에서 행과 함께 숨긴다(IssueRow). */}
                <th className="hidden w-9 min-w-9 sm:table-cell"><span className="sr-only">우선순위</span></th>
                <th className="w-16 min-w-16 sm:w-28 sm:min-w-28">ID</th>
                <th>제목</th>
                <th className="w-12 min-w-12 sm:w-20 sm:min-w-20">담당자</th>
                <th className="hidden w-32 min-w-32 sm:table-cell">마감</th>
              </tr>
            </thead>
          )}
          {groups ? (
            groups.map((g) => (
              <tbody key={g.key} data-testid={`list-group-${g.key}`}>
                <tr className="bg-muted/40 border-b">
                  <td
                    colSpan={isMobile ? ISSUE_LIST_COLUMN_COUNT_MOBILE : ISSUE_LIST_COLUMN_COUNT}
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
                      <span className="shrink-0 font-normal">{g.issues.length}</span>
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
                    selectionMode={isMobile && selected.size > 0}
                    hideEpic={hideEpic}
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
                  selectionMode={isMobile && selected.size > 0}
                  hideEpic={hideEpic}
                />
              ))}
            </tbody>
          )}
        </table>
        {/* 목록 끝 — 자동 로드, 다음 페이지 실패 시에만 다시 시도(공용 LoadMoreFooter, WP-183) */}
        <LoadMoreFooter query={loadMoreQuery} root={scrollEl} data-testid="issue-list-more" />
      </div>
      {/* 모바일 일괄 작업 바(fixed, 약 56px)가 마지막 행을 가리지 않게 같은 높이만큼 비운다. */}
      <BulkBarSpacer active={selected.size > 0} />
      {/* 액션 시트는 표 밖 형제로 — 행 안에 두면 시트 클릭이 행 이벤트로 새어 든다. */}
      {rowActions.sheets}
    </div>
  );
}
