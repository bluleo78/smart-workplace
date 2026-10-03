// 4 컬럼 칸반 보드 — @dnd-kit.
// 상태 보드는 컬럼마다 독립 무한 쿼리(useIssueBoardColumns)로 각 컬럼 끝까지 스크롤하며 이어 받는다(#875).
// 담당자·우선순위 그룹 보드는 그룹이 동적이라 단일 쿼리로 마지막 페이지까지 순차 로드한다.

import { type DragEndEvent, useDndMonitor, useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { Inbox, Plus } from 'lucide-react';
import { createContext, type ReactNode, useContext, useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { LoadMoreFooter } from '@/components/ui/load-more-footer';
import { useIsMobile } from '@/hooks/useIsMobile';

import {
  type BoardColumnQuery,
  useIssueBoardColumns,
} from '../../../hooks/queries/useIssueBoardColumns';
import { useIssueSearch } from '../../../hooks/queries/useIssueSearch';
import { useUpdateIssueStatus } from '../../../hooks/queries/useUpdateIssueStatus';
import { groupIssues, type IssueGroup } from '../../../lib/issueGrouping';
import type {
  IssueClientGroupBy,
  IssueFilters,
  IssueResponse,
  IssueStatus,
} from '../../../types/issue';
import { useIssueRowActions } from '../hooks/useIssueRowActions';
import { IssueCard } from './IssueCard';
import { IssueDndProvider, useIssueDnd } from './IssueDndProvider';

// 기본 4컬럼(팀). 개인은 3컬럼(CANCELED 제외) 을 주입한다.
const DEFAULT_COLUMNS: { status: string; label: string }[] = [
  { status: 'TODO', label: '할 일' },
  { status: 'IN_PROGRESS', label: '진행 중' },
  { status: 'DONE', label: '완료' },
  { status: 'CANCELED', label: '취소' },
];

function IssueBoardViewInner({
  projectKey,
  filters,
  groupBy,
  columns = DEFAULT_COLUMNS,
  cardTo,
  showType = true,
  onOpenCreate,
  canDragStatus: canDragStatusProp = true,
  canEdit = canDragStatusProp,
}: {
  projectKey: string;
  filters: IssueFilters;
  groupBy: IssueClientGroupBy | null;
  // 컬럼 세트 override(기본 팀 4컬럼). 컬럼에 없는 상태의 이슈는 렌더 제외.
  columns?: { status: string; label: string }[];
  // 카드 링크 대상 빌더(기본 미지정 = IssueCard 기본 상세 경로). 개인은 drawer 경로 주입.
  cardTo?: (issue: IssueResponse) => string;
  // 유형 아이콘 표시(기본 true). 개인 보드는 TASK 고정이라 false 로 숨김.
  showType?: boolean;
  // 빈 컬럼 CTA — "이슈 추가" 버튼 클릭 시 이슈 생성 다이얼로그를 여는 콜백.
  onOpenCreate?: () => void;
  // 서버 플래그 — 상태 drag-to-change 허용 여부(멤버만). false 이면 DnD 이벤트를 무시한다.
  canDragStatus?: boolean;
  // 길게 누르기 액션(상태·에픽) 권한 — 미지정 시 canDragStatus 와 같다(개인 보드).
  canEdit?: boolean;
}) {
  const isMobile = useIsMobile();
  // 모바일은 드래그 대신 길게 누르기 — 호출처가 넘긴 값과 무관하게 여기서도 끈다(개인 보드 포함).
  const canDragStatus = canDragStatusProp && !isMobile;
  // 노출 범위(에픽 제외 등)는 호출처가 정한다 — 팀 보드는 withDefaultIssueScope, 개인 보드는 최상위만.
  const grouped = groupBy != null && groupBy !== 'status';
  const statuses = columns.map((c) => c.status);
  // 상태 보드 — 컬럼별 쿼리. 그룹 보드에서는 비활성.
  const columnQueries = useIssueBoardColumns(projectKey, filters, statuses, !grouped);
  // 그룹 보드 — 단일 쿼리. 상태 보드에서는 비활성.
  const groupQuery = useIssueSearch(projectKey, filters, 100, grouped);
  const updateStatus = useUpdateIssueStatus(projectKey);
  // 카드 길게 누르기 액션 시트(상태·에픽) — 선택 모드 없음. 시트는 컬럼과 형제로 렌더한다.
  const cardActions = useIssueRowActions({ projectKey, canEdit, statuses: statuses as IssueStatus[] });
  // open 은 모바일 + 멤버일 때만 값이 있다(아니면 undefined → 길게 누르기 미연결).
  const onCardLongPress = cardActions.open;

  // 그룹 보드는 컬럼(그룹)이 페이지 순서와 무관하게 동적으로 생기므로 컬럼별 스크롤 로드가 불가 →
  // 마지막 페이지까지 순차로 모두 받는다(기존 200건 상한 + "필터로 좁혀주세요" 대체).
  // 다음 페이지 요청이 실패하면 멈춘다 — 안 그러면 isFetching 해제가 effect 를 다시 돌려 무한 재요청한다.
  const { hasNextPage: groupHasNext, isFetching: groupFetching, isFetchNextPageError: groupNextError, fetchNextPage } =
    groupQuery;
  useEffect(() => {
    if (grouped && groupHasNext && !groupFetching && !groupNextError) void fetchNextPage();
  }, [grouped, groupHasNext, groupFetching, groupNextError, fetchNextPage]);

  // 응답 모양이 예상과 다른 경우(p.items 누락) flatMap 이 [undefined] 를 만들지 못하게 방어.
  // 상태 보드는 모든 컬럼 쿼리를 합친 뒤 id 로 중복 제거하고 아래 byStatus 에서 it.status 로 다시 나눈다 —
  // DnD 낙관적 패치는 원래 컬럼 쿼리 캐시 안에서 status 만 바꾸므로, 쿼리 단위가 아니라 status 로 나눠야
  // 드롭 즉시 대상 컬럼에 카드가 나타난다.
  const pages = grouped
    ? (groupQuery.data?.pages ?? [])
    : statuses.flatMap((s) => columnQueries[s]?.data?.pages ?? []);
  const allIssues: IssueResponse[] = [];
  const seen = new Set<number>();
  for (const p of pages) {
    for (const it of p.items ?? []) {
      if (it == null || seen.has(it.id)) continue;
      seen.add(it.id);
      allIssues.push(it);
    }
  }

  // byStatus 는 columns 기준으로 동적 생성 — 컬럼에 없는 상태(개인 CANCELED)는 자연 제외.
  const byStatus: Record<string, IssueResponse[]> = {};
  for (const col of columns) byStatus[col.status] = [];
  for (const it of allIssues) {
    byStatus[it.status]?.push(it);
  }

  function handleDragEnd(e: DragEndEvent) {
    // 비멤버·모바일은 드래그 상태 변경 불가 — drag 이벤트 무시.
    if (!canDragStatus) return;
    const { active, over } = e;
    if (!over) return;
    const sourceStatus = active.data.current?.status as string | undefined;
    // drop 대상이 카드면 카드의 status, 컬럼이면 droppable id 에서 추출.
    const overStatus = over.data.current?.status as string | undefined;
    const targetStatus =
      overStatus ??
      (typeof over.id === 'string' && over.id.startsWith('col-')
        ? over.id.replace('col-', '')
        : undefined);
    const issueNumber = active.data.current?.issueNumber as number | undefined;
    if (!sourceStatus || !targetStatus || !issueNumber) return;
    if (sourceStatus === targetStatus) return;
    updateStatus.mutate({ number: issueNumber, status: targetStatus });
  }

  // group 이 상태/없음이 아니면(담당자·우선순위) 동적 읽기전용 그룹 컬럼을 렌더한다.
  // 상태 그룹/그룹 없음은 기존 드래그-상태변경 보드를 그대로 유지한다 (#58).
  if (grouped) {
    // 개인 3컬럼 보드에서 우선순위 그룹 시 CANCELED 누출 방지 — columns 에 없는 상태는 그룹 전에 제거.
    // 팀(DEFAULT_COLUMNS=4상태)은 모든 상태가 허용돼 필터가 아무것도 제거하지 않아 출력이 byte-identical.
    const allowedStatuses = new Set(columns.map((c) => c.status));
    const visibleIssues = allIssues.filter((it) => allowedStatuses.has(it.status));
    const groups = groupIssues(visibleIssues, groupBy);
    return (
      <>
      <BoardScroll
        footer={
          <>
            {groupHasNext && !groupNextError && (
              <p className="text-xs text-muted-foreground mt-3" data-testid="board-loading-more">
                나머지 이슈를 불러오는 중…
              </p>
            )}
            {groupNextError && (
              <p className="text-xs text-destructive mt-3" data-testid="board-load-error">
                나머지 이슈를 불러오지 못했습니다.{' '}
                <button type="button" className="underline" onClick={() => void fetchNextPage()}>
                  다시 시도
                </button>
              </p>
            )}
          </>
        }
      >
        {groups.map((g) => (
          <ReadOnlyColumn key={g.key} group={g} projectKey={projectKey} cardTo={cardTo} showType={showType} onOpenCreate={onOpenCreate} dragDisabled={!canDragStatus} onLongPress={onCardLongPress} />
        ))}
      </BoardScroll>
      {cardActions.sheets}
      </>
    );
  }

  return (
    <>
      <BoardStatusDropMonitor onDragEnd={handleDragEnd} />
      <BoardScroll>
        {columns.map((col) => (
          <BoardColumn
            key={col.status}
            status={col.status}
            label={col.label}
            issues={byStatus[col.status] ?? []}
            query={columnQueries[col.status]}
            projectKey={projectKey}
            cardTo={cardTo}
            showType={showType}
            onOpenCreate={onOpenCreate}
            dragDisabled={!canDragStatus}
            onLongPress={onCardLongPress}
          />
        ))}
      </BoardScroll>
      {cardActions.sheets}
    </>
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

// 상태 보드 전용 — 공용 provider 의 드롭 이벤트를 구독해 컬럼/카드 대상일 때만 상태를 바꾼다.
// 그룹 보드에는 두지 않는다: 다른 그룹 카드 위에 놓았을 때 그 카드의 status 로 바뀌면 안 되므로.
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
//     상태 보드·그룹 보드가 같은 구조를 쓴다.
function BoardScroll({ children, footer }: { children: ReactNode; footer?: ReactNode }) {
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  return (
    <div ref={setEl} className="h-full overflow-auto" data-testid="board-scroll">
      <BoardScrollRootContext.Provider value={el}>
        <div className="flex min-h-full gap-3">{children}</div>
        {footer}
      </BoardScrollRootContext.Provider>
    </div>
  );
}

// 컬럼 헤더 — 보드 스크롤 컨테이너 기준 sticky 라 긴 컬럼을 내려도 라벨·개수가 보인다.
// -mx-2 -mt-2 / px-3 pt-2 는 컬럼의 p-2 를 상쇄해 배경이 컬럼 폭을 덮게 한다(컬럼 패딩과 함께 바꿀 것).
const COLUMN_HEADER_CLASS =
  'sticky top-0 z-10 -mx-2 -mt-2 flex items-center justify-between rounded-t-md bg-background px-3 pt-2 pb-2 text-sm font-semibold text-foreground';

// 각 컬럼은 droppable + 내부 카드들이 SortableContext 에 묶여 있다.
function BoardColumn({
  status,
  label,
  issues,
  query,
  projectKey,
  cardTo,
  showType = true,
  onOpenCreate,
  dragDisabled = false,
  onLongPress,
}: {
  status: string;
  label: string;
  issues: IssueResponse[];
  // 이 컬럼 전용 무한 쿼리 — 끝 sentinel 로 다음 페이지를 받고, 남은 페이지가 있으면 카운트에 "+" 표시.
  query?: BoardColumnQuery;
  projectKey: string;
  // 카드 링크 대상 빌더 — 부모에서 thread.
  cardTo?: (issue: IssueResponse) => string;
  // 유형 아이콘 표시(기본 true). 개인 보드는 TASK 고정이라 false 로 숨김.
  showType?: boolean;
  // 빈 컬럼 CTA 콜백 — 제공 시 "이슈 추가" 버튼 표시.
  onOpenCreate?: () => void;
  // 비멤버는 카드 드래그 차단.
  dragDisabled?: boolean;
  onLongPress?: (issue: IssueResponse) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `col-${status}`,
    // label: 스크린리더 드래그 안내가 컬럼 이름을 읽는 데 쓴다(epicDnd.describeDropTarget).
    data: { status, label },
  });
  return (
    <section
      ref={setNodeRef}
      aria-label={`${label} 컬럼`}
      data-testid={`board-col-${status}`}
      className={`rounded-md border p-2 min-h-[200px] min-w-[240px] flex-1 ${isOver ? 'bg-accent/30' : ''}`}
    >
      <header className={COLUMN_HEADER_CLASS}>
        <span>{label}</span>
        {/* 아직 받지 않은 페이지가 있으면 로드분이 전체가 아니므로 "N+" 로 표시 */}
        <span data-testid={`board-col-count-${status}`}>
          {issues.length}
          {query?.hasNextPage ? '+' : ''}
        </span>
      </header>
      <SortableContext
        items={issues.map((i) => `issue-${i.id}`)}
        strategy={verticalListSortingStrategy}
      >
        {issues.length === 0 ? (
          /* 빈 컬럼 — 디자인 시스템 §2.5 빈 상태 패턴: 아이콘 + 제목 + 설명 + CTA */
          <div
            className="flex flex-col items-center justify-center py-8 gap-3 text-center"
            data-testid={`board-col-empty-${status}`}
          >
            <Inbox className="h-8 w-8 text-muted-foreground/50" aria-hidden="true" />
            <div className="space-y-1">
              <p className="text-sm font-medium text-muted-foreground">이슈 없음</p>
              <p className="text-xs text-muted-foreground">드래그하거나 새 이슈를 추가하세요</p>
            </div>
            {onOpenCreate && (
              <Button size="sm" variant="ghost" onClick={onOpenCreate} data-testid={`board-col-add-${status}`}>
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
      </SortableContext>
      {query && <ColumnLoadMore status={status} query={query} />}
    </section>
  );
}

// 컬럼 끝 sentinel — 화면에 들어오면 이 컬럼의 다음 페이지를 받는다(짧은 컬럼은 끝까지 연속 로드).
// 다음 페이지 요청이 실패하면 자동 로드를 멈추고 "다시 시도" 버튼을 보인다(공용 LoadMoreFooter).
function ColumnLoadMore({ status, query }: { status: string; query: BoardColumnQuery }) {
  return (
    <LoadMoreFooter
      query={query}
      root={useContext(BoardScrollRootContext)}
      className="py-2"
      data-testid={`board-col-more-${status}`}
    />
  );
}

// 담당자/우선순위 그룹 보드의 컬럼 — DnD 없는 읽기전용 (이슈는 *렌더*만 요구) (#58).
// 비-상태 그룹(담당자·우선순위)은 컬럼 헤더가 상태를 드러내지 않으므로 카드에 showStatus=true 로 상태 아이콘을 표시한다.
function ReadOnlyColumn({
  group,
  projectKey,
  cardTo,
  showType = true,
  onOpenCreate,
  dragDisabled = false,
  onLongPress,
}: {
  group: IssueGroup;
  projectKey: string;
  // 카드 링크 대상 빌더 — 부모에서 thread.
  cardTo?: (issue: IssueResponse) => string;
  // 유형 아이콘 표시(기본 true). 개인 보드는 TASK 고정이라 false 로 숨김.
  showType?: boolean;
  // 빈 컬럼 CTA 콜백 — 제공 시 "이슈 추가" 버튼 표시.
  onOpenCreate?: () => void;
  // 비멤버는 카드 드래그 차단.
  dragDisabled?: boolean;
  onLongPress?: (issue: IssueResponse) => void;
}) {
  return (
    <section
      aria-label={`${group.label} 컬럼`}
      data-testid={`board-col-${group.key}`}
      className="rounded-md border p-2 min-h-[200px] min-w-[240px] flex-1"
    >
      <header className={COLUMN_HEADER_CLASS}>
        <span>{group.label}</span>
        <span>{group.issues.length}</span>
      </header>
      {group.issues.length === 0 ? (
        /* 빈 그룹 컬럼 — 디자인 시스템 §2.5 빈 상태 패턴: 아이콘 + 제목 + 설명 + CTA */
        <div
          className="flex flex-col items-center justify-center py-8 gap-3 text-center"
          data-testid={`board-col-empty-${group.key}`}
        >
          <Inbox className="h-8 w-8 text-muted-foreground/50" aria-hidden="true" />
          <div className="space-y-1">
            <p className="text-sm font-medium text-muted-foreground">이슈 없음</p>
            <p className="text-xs text-muted-foreground">드래그하거나 새 이슈를 추가하세요</p>
          </div>
          {onOpenCreate && (
            <Button size="sm" variant="ghost" onClick={onOpenCreate} data-testid={`board-col-add-${group.key}`}>
              <Plus className="h-4 w-4" />
              이슈 추가
            </Button>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {group.issues.map((it) => (
            // dragScope: 다중 담당자 이슈는 여러 그룹 컬럼에 보이므로 컬럼별로 드래그 id 를 구분한다.
            <IssueCard key={it.id} projectKey={projectKey} issue={it} to={cardTo?.(it)} showType={showType} showStatus dragDisabled={dragDisabled} dragScope={group.key} onLongPress={onLongPress} />
          ))}
        </div>
      )}
    </section>
  );
}
