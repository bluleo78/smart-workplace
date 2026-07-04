// 태스크 리스트 뷰 — cursor 기반 무한 스크롤.
// sentinel 이 뷰포트에 들어오면 다음 페이지를 자동 fetch.
// 행은 아이콘 중심(상태/우선순위/유형) + 담당자 + 행 전체 클릭으로 상세 이동(#234).
// #606: Drive DrivePage.tsx 의 체크박스+벌크 툴바 패턴을 재사용한 다중 선택/일괄 작업
// (상태 변경/담당자 지정/삭제) — 보드 뷰(칸반)는 업계 관행(Linear/Jira/GitHub 등)대로 제외.

import { LayoutList, SearchX, UserPlus } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';

import { IssuePriorityBars } from '../../../components/issues/IssuePriorityBars';
import { IssueStatusIcon } from '../../../components/issues/IssueStatusIcon';
import { IssueTypeBadge } from '../../../components/issueTypes/IssueTypeBadge';
import { LabelChip } from '../../../components/labels/LabelChip';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../../../components/ui/alert-dialog';
import { Button } from '../../../components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../../components/ui/dropdown-menu';
import { AgentBadge } from '../../../components/users/AgentBadge';
import { UserAvatar } from '../../../components/users/UserAvatar';
import {
  useBulkAssign,
  useBulkDeleteIssues,
  useBulkUpdateStatus,
} from '../../../hooks/queries/useBulkIssueActions';
import { useIssueSearch } from '../../../hooks/queries/useIssueSearch';
import { useProjectMembers } from '../../../hooks/queries/useProjectMembers';
import { formatDateKorean } from '../../../lib/formatters';
import { filtersToParams } from '../../../lib/issueFilters';
import { groupIssues } from '../../../lib/issueGrouping';
import type {
  IssueFilters,
  IssueGroupBy,
  IssueResponse,
  IssueStatus,
} from '../../../types/issue';

// 상태 일괄 변경 드롭다운 옵션 — IssueStatusSelect 와 동일한 라벨 세트.
const STATUS_OPTIONS: { value: IssueStatus; label: string }[] = [
  { value: 'TODO', label: '할 일' },
  { value: 'IN_PROGRESS', label: '진행 중' },
  { value: 'DONE', label: '완료' },
  { value: 'CANCELED', label: '취소' },
];

export function IssueListView({
  projectKey,
  filters,
  groupBy,
  onOpenCreate,
}: {
  projectKey: string;
  filters: IssueFilters;
  groupBy: IssueGroupBy | null;
  /** 초기 빈 상태 CTA — "새 태스크 만들기" 버튼에 연결 */
  onOpenCreate?: () => void;
}) {
  const { data, fetchNextPage, hasNextPage, isFetching, isLoading } =
    useIssueSearch(projectKey, filters);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const [params, setParams] = useSearchParams();

  // #606: 다중 선택 상태 — 이슈 number 집합. 필터/그룹 변경 시 초기화(아래 useEffect).
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const members = useProjectMembers(projectKey);
  const bulkStatus = useBulkUpdateStatus(projectKey);
  const bulkAssign = useBulkAssign(projectKey);
  const bulkDelete = useBulkDeleteIssues(projectKey);

  function toggleSelected(number: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(number)) next.delete(number);
      else next.add(number);
      return next;
    });
  }
  function clearSelected() {
    setSelected(new Set());
  }

  // 필터/그룹 기준이 바뀌면 이전 화면 기준 선택은 의미가 없어지므로 초기화.
  useEffect(() => {
    clearSelected();
  }, [filters, groupBy]);

  // IntersectionObserver — sentinel 진입 시 다음 페이지 로드.
  useEffect(() => {
    const node = sentinelRef.current;
    if (!node) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && hasNextPage && !isFetching) {
          void fetchNextPage();
        }
      },
      { rootMargin: '200px' },
    );
    io.observe(node);
    return () => io.disconnect();
  }, [hasNextPage, isFetching, fetchNextPage]);

  if (isLoading) {
    return <p className="text-muted-foreground py-4">로딩 중…</p>;
  }

  const items =
    data?.pages.flatMap((p) => p.items ?? []).filter((x) => x != null) ?? [];

  // 검색어·필터가 하나라도 적용된 상태인지 판별.
  // filtersToParams 는 기본값(빈 배열, 빈 문자열, topLevel=true 등)을 URL 에서 생략하므로
  // toString() === '' 이면 실질 필터가 없는 초기 상태임.
  const hasActiveFilters = filtersToParams(filters, 'list', null).toString() !== '';

  // view·group 은 유지하고 나머지 필터 파라미터만 초기화.
  function handleResetFilters() {
    const p = new URLSearchParams();
    const view = params.get('view');
    const group = params.get('group');
    if (view) p.set('view', view);
    if (group) p.set('group', group);
    setParams(p, { replace: true });
  }

  if (items.length === 0) {
    if (hasActiveFilters) {
      // 검색어·필터가 활성 상태에서 결과가 없는 경우 — 디자인 시스템 empty state 4요소 (#337).
      return (
        <div
          className="flex flex-col items-center justify-center gap-3 py-16 text-center"
          data-testid="empty-filter"
        >
          <SearchX className="h-10 w-10 text-muted-foreground" aria-hidden="true" />
          <div className="space-y-1">
            <p className="text-sm font-medium">검색 결과가 없습니다</p>
            <p className="text-xs text-muted-foreground">
              다른 키워드나 필터 조건을 사용해 보세요.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleResetFilters}
            data-testid="empty-reset-filter"
          >
            필터 초기화
          </Button>
        </div>
      );
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

  const selectedNumbers = [...selected];

  function onBulkStatus(status: IssueStatus) {
    bulkStatus.mutate(
      { numbers: selectedNumbers, status },
      { onSuccess: clearSelected },
    );
  }
  function onBulkAssign(userIds: number[]) {
    bulkAssign.mutate(
      { numbers: selectedNumbers, userIds },
      { onSuccess: clearSelected },
    );
  }
  function onBulkDeleteConfirm() {
    bulkDelete.mutate(selectedNumbers, { onSuccess: clearSelected });
    setConfirmDeleteOpen(false);
  }

  return (
    <div className="overflow-x-auto">
      {/* #606: 선택된 항목이 있을 때만 노출되는 벌크 액션 툴바 — Drive DrivePage.tsx 패턴 재사용. */}
      {selected.size > 0 && (
        <div
          data-testid="issue-bulk-toolbar"
          className="mb-2 flex items-center gap-2 rounded bg-muted px-3 py-2 text-sm"
        >
          <span>선택 {selected.size}개</span>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                data-testid="bulk-status-trigger"
                className="text-muted-foreground hover:underline"
              >
                상태 변경
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              {STATUS_OPTIONS.map((o) => (
                <DropdownMenuItem
                  key={o.value}
                  data-testid={`bulk-status-option-${o.value}`}
                  onClick={() => onBulkStatus(o.value)}
                >
                  {o.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                data-testid="bulk-assignee-trigger"
                className="text-muted-foreground hover:underline"
              >
                담당자 지정
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem
                data-testid="bulk-assignee-option-unassign"
                onClick={() => onBulkAssign([])}
              >
                <UserPlus className="h-4 w-4" />
                미지정
              </DropdownMenuItem>
              {(members.data ?? []).map((m) => (
                <DropdownMenuItem
                  key={m.userId}
                  data-testid={`bulk-assignee-option-${m.userId}`}
                  onClick={() => onBulkAssign([m.userId])}
                >
                  <UserAvatar
                    user={{ id: m.userId, username: m.username, name: m.name }}
                    size="xs"
                  />
                  <span>{m.name}</span>
                  {m.kind === 'AGENT' && <AgentBadge size="xs" />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <button
            type="button"
            data-testid="bulk-delete"
            onClick={() => setConfirmDeleteOpen(true)}
            className="text-destructive hover:underline"
          >
            삭제
          </button>
          <button
            type="button"
            data-testid="bulk-clear"
            onClick={clearSelected}
            className="ml-auto text-muted-foreground hover:underline"
          >
            선택 해제
          </button>
        </div>
      )}
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
            <th className="w-9"><span className="sr-only">우선순위</span></th>
            <th className="w-28">ID</th>
            <th>제목</th>
            <th className="w-20">담당자</th>
            <th className="w-32">마감</th>
          </tr>
        </thead>
        {groups ? (
          groups.map((g) => (
            <tbody key={g.key} data-testid={`list-group-${g.key}`}>
              <tr className="bg-muted/40 border-b">
                <td
                  colSpan={7}
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
                  onToggleSelect={() => toggleSelected(it.number)}
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
                onToggleSelect={() => toggleSelected(it.number)}
              />
            ))}
          </tbody>
        )}
      </table>
      <div ref={sentinelRef} aria-hidden="true" className="h-1" />
      {isFetching && <p className="text-muted-foreground py-2">불러오는 중…</p>}

      {/* #606: 벌크 삭제 확인 — IssueDetailPage 단건 삭제와 동일한 제어형 AlertDialog 패턴. */}
      <AlertDialog open={confirmDeleteOpen} onOpenChange={setConfirmDeleteOpen}>
        <AlertDialogContent data-testid="issue-bulk-delete-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>태스크 일괄 삭제</AlertDialogTitle>
            <AlertDialogDescription>
              선택한 {selected.size}개 태스크를 삭제할까요? 이 작업은 되돌릴 수 없습니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              data-testid="issue-bulk-delete-confirm"
              onClick={onBulkDeleteConfirm}
            >
              삭제
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// 리스트 행 — 평탄/그룹 렌더가 공유 (DRY). 행 전체 클릭 → 상세(#234).
// #606: 체크박스 컬럼 추가 — 클릭 시 stopPropagation 으로 행 네비게이션과 분리.
function IssueRow({
  issue: it,
  projectKey,
  selected,
  onToggleSelect,
}: {
  issue: IssueResponse;
  projectKey: string;
  selected: boolean;
  onToggleSelect: () => void;
}) {
  const navigate = useNavigate();
  const to = `/projects/${projectKey}/issues/${it.number}`;
  const isSubtask = it.type?.name === 'SUBTASK';

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
          onChange={onToggleSelect}
          aria-label={`${it.title} 선택`}
          data-testid={`select-issue-${it.number}`}
          className="h-4 w-4"
        />
      </td>
      <td className="py-2"><IssueStatusIcon status={it.status} /></td>
      <td><IssuePriorityBars priority={it.priority} /></td>
      <td className="font-mono text-muted-foreground text-xs">
        <span className="flex items-center gap-1.5">
          {it.type && <IssueTypeBadge type={it.type} size="sm" iconOnly />}
          <span>{projectKey}-{it.number}</span>
        </span>
      </td>
      <td>
        <div className="flex items-center gap-1.5 font-medium">
          {/* SUBTASK 면 부모 식별자(↳ KEY-N) 를 제목 앞에 작게 표시. */}
          {isSubtask && it.parent && (
            <span className="text-xs text-muted-foreground font-mono">
              ↳ {projectKey}-{it.parent.number}
            </span>
          )}
          {/* 제목 = 실제 링크(키보드 포커스·스크린리더 접근점). 행 onClick 은 마우스 편의용.
              stopPropagation 으로 링크 클릭이 행 onClick 까지 버블해 history 가 이중 push 되는 것을 막는다. */}
          <Link
            to={to}
            onClick={(e) => e.stopPropagation()}
            className="rounded hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {it.title}
          </Link>
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
      <td className="text-muted-foreground" data-testid={`issue-row-${it.number}-due`}>
        {formatDateKorean(it.dueDate)}
      </td>
    </tr>
  );
}
