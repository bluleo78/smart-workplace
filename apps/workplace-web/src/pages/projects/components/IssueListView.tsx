// 태스크 리스트 뷰 — cursor 기반 무한 스크롤.
// sentinel 이 뷰포트에 들어오면 다음 페이지를 자동 fetch.
// 행은 아이콘 중심(상태/우선순위/유형) + 담당자 + 행 전체 클릭으로 상세 이동(#234).
// #606: Drive DrivePage.tsx 의 체크박스+벌크 툴바 패턴을 재사용한 다중 선택/일괄 작업
// (상태 변경/담당자 지정/삭제) — 보드 뷰(칸반)는 업계 관행(Linear/Jira/GitHub 등)대로 제외.

import { LayoutList } from 'lucide-react';

import { Button } from '../../../components/ui/button';
import { useIssueSearch } from '../../../hooks/queries/useIssueSearch';
import { useIssueSelection } from '../../../hooks/useIssueSelection';
import { useLoadMoreSentinel } from '../../../hooks/useLoadMoreSentinel';
import { filtersToParams, withDefaultIssueScope } from '../../../lib/issueFilters';
import { groupIssues } from '../../../lib/issueGrouping';
import type { IssueClientGroupBy, IssueFilters } from '../../../types/issue';
import { IssueBulkActions } from './IssueBulkActions';
import { IssueFilterEmptyState } from './IssueFilterEmptyState';
import { ISSUE_LIST_COLUMN_COUNT, IssueRow } from './IssueListRow';

export function IssueListView({
  projectKey,
  filters,
  groupBy,
  onOpenCreate,
}: {
  projectKey: string;
  filters: IssueFilters;
  groupBy: IssueClientGroupBy | null;
  /** 초기 빈 상태 CTA — "새 태스크 만들기" 버튼에 연결 */
  onOpenCreate?: () => void;
}) {
  // 보드와 같은 기본 범위 — 에픽 행 제외, 에픽 하위 이슈 노출, SUBTASK 숨김(withDefaultIssueScope).
  const searchQuery = useIssueSearch(projectKey, withDefaultIssueScope(filters));
  const { data, isFetching, isLoading } = searchQuery;
  // sentinel 진입 시 다음 페이지 로드(공용 훅).
  const sentinelRef = useLoadMoreSentinel(searchQuery);

  // #606: 다중 선택 상태 — 이슈 number 집합. 필터/그룹 기준(직렬화 값)이 바뀌면 초기화.
  const {
    selected,
    setSelected,
    toggle: toggleSelected,
    clear: clearSelected,
  } = useIssueSelection(filtersToParams(filters, 'list', groupBy).toString());

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

  const groups = groupBy
    ? groupIssues(items, groupBy).filter((g) => g.issues.length > 0)
    : null;

  const allNumbers = items.map((it) => it.number);
  const allSelected = allNumbers.length > 0 && allNumbers.every((n) => selected.has(n));

  function toggleSelectAll() {
    setSelected(allSelected ? new Set() : new Set(allNumbers));
  }

  return (
    <div className="overflow-x-auto">
      {/* #606: 선택된 항목이 있을 때만 노출되는 벌크 액션 툴바(+삭제 확인) — 사이클 구간 목록과 공유. */}
      <IssueBulkActions projectKey={projectKey} selected={selected} onClear={clearSelected} />
      <table className="w-full text-sm" role="table">
        <thead>
          <tr className="text-left text-muted-foreground border-b">
            <th className="w-9 py-2">
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
            <th className="w-9 py-2"><span className="sr-only">상태</span></th>
            {/* 우선순위·마감은 좁은 화면(<sm)에서 행과 함께 숨긴다(IssueRow). */}
            <th className="hidden w-9 sm:table-cell"><span className="sr-only">우선순위</span></th>
            <th className="w-16 sm:w-28">ID</th>
            <th>제목</th>
            <th className="w-12 sm:w-20">담당자</th>
            <th className="hidden w-32 sm:table-cell">마감</th>
          </tr>
        </thead>
        {groups ? (
          groups.map((g) => (
            <tbody key={g.key} data-testid={`list-group-${g.key}`}>
              <tr className="bg-muted/40 border-b">
                <td
                  colSpan={ISSUE_LIST_COLUMN_COUNT}
                  className="py-1.5 px-1 text-xs font-semibold text-muted-foreground"
                >
                  {g.label}
                  <span className="ml-2 font-normal">{g.issues.length}</span>
                </td>
              </tr>
              {g.issues.map((it) => (
                <IssueRow
                  key={it.id}
                  issue={it}
                  projectKey={projectKey}
                  selected={selected.has(it.number)}
                  onToggleSelect={toggleSelected}
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
              />
            ))}
          </tbody>
        )}
      </table>
      <div ref={sentinelRef} aria-hidden="true" className="h-1" />
      {isFetching && <p className="text-muted-foreground py-2">불러오는 중…</p>}
    </div>
  );
}
