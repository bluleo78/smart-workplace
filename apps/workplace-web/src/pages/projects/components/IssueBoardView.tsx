// 칸반 보드 — @dnd-kit. 컬럼은 프로젝트 상태 목록 하나에 하나(WP-808), 위에 범주 띠(할 일·진행 중·완료·취소)를 둔다.
// 상태 보드는 컬럼(statusId)마다 독립 무한 쿼리(useIssueBoardColumns)로 각 컬럼 끝까지 스크롤하며 이어 받는다(#875).
// 담당자·우선순위 그룹 보드는 그룹이 동적이라 단일 쿼리로 마지막 페이지까지 순차 로드한다.

import { type DragEndEvent, useDndMonitor, useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CircleCheckBig, Inbox, Plus, TriangleAlert } from 'lucide-react';
import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from 'react';

import { ResourceErrorState } from '@/components/layout/ResourceErrorState';
import { Button } from '@/components/ui/button';
import { LoadMoreFooter } from '@/components/ui/load-more-footer';
import { useIsMobile } from '@/hooks/useIsMobile';
import { cn } from '@/lib/utils';

import { IssueStatusIcon } from '../../../components/issues/IssueStatusIcon';
import {
  type BoardColumnQuery,
  columnFilters,
  useIssueBoardColumns,
} from '../../../hooks/queries/useIssueBoardColumns';
import { useIssueSearch } from '../../../hooks/queries/useIssueSearch';
import { useCreateProjectStatus, useProjectStatuses, useRenameProjectStatus } from '../../../hooks/queries/useProjectStatuses';
import { useUpdateIssueStatus } from '../../../hooks/queries/useUpdateIssueStatus';
import { CLOSED_HIDDEN_NOTE, CLOSED_ISSUE_STATUSES } from '../../../lib/closedHiding';
import type { IssueDragData } from '../../../lib/epicDnd';
import { groupIssues, type IssueGroup } from '../../../lib/issueGrouping';
import { categorySpans } from '../../../lib/projectStatuses';
import type {
  IssueClientGroupBy,
  IssueFilters,
  IssueResponse,
  IssueStatus,
} from '../../../types/issue';
import type { ProjectStatus } from '../../../types/projectStatus';
import { useClosedHidingNotice } from '../hooks/useClosedHidingNotice';
import { useIssueRowActions } from '../hooks/useIssueRowActions';
import { BoardCategoryBand } from './board/BoardCategoryBand';
import { BoardColumnHeaderMenu } from './board/BoardColumnHeaderMenu';
import { MobileStatusSheet } from './board/MobileStatusSheet';
import { StatusNameEditor } from './board/StatusNameEditor';
import { IssueCard } from './IssueCard';
import { IssueCardMenuContext } from './issueCardMenuContext';
import { IssueDndProvider, useIssueDnd } from './IssueDndProvider';
import { MobileBoard, type MobileBoardTab } from './mobile/MobileBoard';

function IssueBoardViewInner({
  projectKey,
  filters,
  groupBy,
  statuses,
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
  // 프로젝트 상태 목록(표시 순서, useSortedProjectStatuses) — 상태마다 컬럼 하나. 로딩 중(빈 배열)엔 컬럼을 그리지 않는다.
  statuses: ProjectStatus[];
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
  const groupQuery = useIssueSearch(projectKey, filters, 100, grouped);
  // 종료 이슈 숨김 안내(WP-606) — 팀 보드 기본 범위만 숨김이 켜진다(개인 보드·「완료 모두 보기」·상태 필터는 꺼짐).
  // 끌어 놓기·카드 메뉴로 종료한 이슈가 숨겨지면 토스트로, 빈 완료·취소 열은 안내 + 「완료 모두 보기」로 알린다.
  const closedHiding = useClosedHidingNotice(!!filters.hideInactiveClosed);
  // 범주 기준 — 완료·취소 범주의 모든 컬럼(「배포 완료」 같은 사용자 상태 포함)에 안내를 붙인다(WP-808).
  const showAllClosedFor = (category: IssueStatus) =>
    closedHiding && CLOSED_ISSUE_STATUSES.has(category) ? closedHiding.onShowAll : undefined;
  const updateStatus = useUpdateIssueStatus(projectKey, closedHiding);
  // 카드 길게 누르기 액션 시트(상태·에픽) — 선택 모드 없음. 시트는 컬럼과 형제로 렌더한다.
  // 카드 메뉴 상태 선택지 — 보드 컬럼과 같은 상태들(개인 보드는 취소 범주 제외, WP-808).
  const cardActions = useIssueRowActions({ projectKey, canEdit, statuses: columns, linkFor: cardTo, closedHiding });
  // 상태 추가·이름 변경(OWNER) — 실패는 입력기가 받아 그 자리에 보인다(reject 전달).
  const createStatus = useCreateProjectStatus(projectKey);
  const renameStatus = useRenameProjectStatus(projectKey);
  // 헤더 인라인 이름 변경 중인 컬럼(statusId).
  const [renamingId, setRenamingId] = useState<number | null>(null);
  // 상태 목록 조회 실패 — 컬럼을 만들 수 없으니 빈 보드 대신 오류와 다시 시도를 보인다(호출부와 같은 캐시).
  const statusesQuery = useProjectStatuses(projectKey);
  const statusesFailed = statuses.length === 0 && statusesQuery.isError;
  // 카드 ⋯·우클릭 메뉴(WP-273) — 컬럼 컴포넌트를 거치지 않고 컨텍스트로 카드에 전달한다.
  const { openMenu, menuIssueNumber } = cardActions;
  const cardMenu = useMemo(() => ({ openMenu, menuIssueNumber }), [openMenu, menuIssueNumber]);
  // open 은 모바일에서만 값이 있다(데스크톱은 undefined → 길게 누르기 미연결, 우클릭·⋯ 메뉴를 쓴다).
  // 비멤버도 「링크 복사」가 있어 시트가 열린다(WP-273) — 변경 항목만 숨긴다.
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

  function handleDragEnd(e: DragEndEvent) {
    // 비멤버·모바일은 드래그 상태 변경 불가 — drag 이벤트 무시.
    if (!canDragStatus) return;
    const { active, over } = e;
    if (!over) return;
    const src = active.data.current as IssueDragData | undefined;
    // drop 대상이 카드면 카드의 statusId, 컬럼이면 컬럼 data(droppable id col-{statusId} 는 예비).
    const overId = over.data.current?.statusId;
    const targetId =
      typeof overId === 'number'
        ? overId
        : typeof over.id === 'string' && over.id.startsWith('col-')
          ? Number(over.id.slice('col-'.length))
          : undefined;
    const target = columns.find((s) => s.id === targetId);
    const issueNumber = src?.issueNumber;
    if (!src || !target || !issueNumber || src.statusId === target.id) return;
    // 범주(종료 안내 토스트·아이콘)와 상태 id·이름(카드 이름 즉시 갱신)을 함께 넘긴다.
    updateStatus.mutate({ number: issueNumber, status: target.category, statusId: target.id, statusName: target.name });
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
        <p className={cn('text-xs text-destructive', spacing)} data-testid="board-load-error">
          나머지 이슈를 불러오지 못했습니다.{' '}
          <button type="button" className="underline" onClick={() => void fetchNextPage()}>
            다시 시도
          </button>
        </p>
      )}
    </>
  );

  // 모바일 보드(WP-195) — 컬럼을 나란히 두지 않고 상태 탭 + 선택 상태 한 컬럼(전체 폭). DnD 없음(길게 누르기로 상태 변경).
  // 그룹 보드는 선택 탭 안에 그룹 섹션을 쌓는다.
  // 상태 보드는 컬럼(상태) 없이는 그릴 수 없다 — 데스크톱 그룹 보드는 상태 목록 없이도 그린다.
  // 모바일은 그룹 보드도 상태 탭이라 상태 목록이 있어야 한다.
  if ((!grouped || isMobile) && statusesFailed) {
    return (
      <div data-testid="board-statuses-error">
        <ResourceErrorState
          icon={TriangleAlert}
          title="상태 목록을 불러오지 못했습니다"
          description="보드 컬럼을 만들 수 없습니다. 잠시 후 다시 시도해 주세요."
          actionLabel="다시 시도"
          onAction={() => void statusesQuery.refetch()}
        />
      </div>
    );
  }

  if (isMobile) {
    // 탭 = 프로젝트 상태(WP-808, 제외 범주 빼고). 사용자 「상태 범주」·「상태」 필터로 제외된 상태는 탭을 숨긴다 —
    // 컬럼 쿼리와 같은 판정(columnFilters)이라 그룹 보드(컬럼 쿼리 비활성)에도 같게 적용된다.
    // 상태 목록 로딩 중이면 탭이 없다 → MobileBoard 가 기본 탭을 미리 고르지 않는다.
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
                onRename={async (name) => {
                  await renameStatus.mutateAsync({ id: s.id, body: { name } });
                }}
                onAddAfter={async (name) => {
                  await createStatus.mutateAsync({ name, category: s.category, afterStatusId: s.id });
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
            return grouped ? (
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
            );
          }}
        </MobileBoard>
        {cardActions.sheets}
      </IssueCardMenuContext.Provider>
    );
  }

  // group 이 상태/없음이 아니면(담당자·우선순위) 동적 읽기전용 그룹 컬럼을 렌더한다.
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
      <BoardScroll
        footer={groupFooter('mt-3')}
      >
        {groups.map((g) => (
          <ReadOnlyColumn key={g.key} group={g} projectKey={projectKey} cardTo={cardTo} showType={showType} onOpenCreate={onOpenCreate} dragDisabled={!canDragStatus} onLongPress={onCardLongPress} />
        ))}
      </BoardScroll>
      {cardActions.sheets}
      </IssueCardMenuContext.Provider>
    );
  }

  // 상태 목록을 불러오는 동안은 컬럼 없이 빈 보드 — 범주 컬럼으로 그렸다가 상태 컬럼으로 바뀌며 튀지 않게.
  if (columns.length === 0) return <BoardScroll />;

  return (
    <IssueCardMenuContext.Provider value={cardMenu}>
      <BoardStatusDropMonitor onDragEnd={handleDragEnd} />
      <BoardScroll columnCount={columns.length} band={showCategoryBand}>
        {showCategoryBand && (
          <BoardCategoryBand
            spans={categorySpans(columns)}
            canEdit={canEditStatuses}
            statuses={statuses}
            onAdd={async (category, name) => {
              await createStatus.mutateAsync({ name, category });
            }}
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
                      await renameStatus.mutateAsync({ id: col.id, body: { name } });
                      setRenamingId(null);
                    },
                    onAddAfter: async (name) => {
                      await createStatus.mutateAsync({ name, category: col.category, afterStatusId: col.id });
                    },
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
//     columnCount 가 있으면(상태 보드) 범주 띠 줄 + 컬럼 줄의 그리드 — 띠 칸이 걸친 컬럼 폭(gap 포함)과 정확히 맞고 함께 가로 스크롤된다.
//     컬럼 트랙은 minmax(240px, 1fr) 로 예전 flex-1 + min-w-[240px] 과 같은 폭 규칙이다.
//     band=false(개인 보드)면 띠 줄 없이 컬럼 줄 하나다.
function BoardScroll({
  children,
  footer,
  columnCount,
  band = false,
}: {
  children?: ReactNode;
  footer?: ReactNode;
  columnCount?: number;
  band?: boolean;
}) {
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  return (
    <div ref={setEl} className="h-full overflow-auto" data-testid="board-scroll">
      <BoardScrollRootContext.Provider value={el}>
        {columnCount ? (
          <div
            className={cn('grid min-h-full gap-x-3', band ? 'grid-rows-[auto_1fr]' : 'grid-rows-[1fr]')}
            style={{ gridTemplateColumns: `repeat(${columnCount}, minmax(240px, 1fr))` }}
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
              <IssueStatusIcon status={status.category} decorative className="h-4 w-4" />
              <span className="truncate" title={status.name}>
                {status.name}
              </span>
              {/* 아직 받지 않은 페이지가 있으면 로드분이 전체가 아니므로 "N+" 로 표시 */}
              <span className="shrink-0 font-normal text-muted-foreground" data-testid={`board-col-count-${status.id}`}>
                {issues.length}
                {query?.hasNextPage ? '+' : ''}
              </span>
            </span>
            {edit && (
              <BoardColumnHeaderMenu
                status={status}
                canEdit
                statuses={edit.statuses}
                onRename={edit.onRename}
                onAddAfter={edit.onAddAfter}
              />
            )}
          </>
        )}
      </header>
      <SortableContext
        items={issues.map((i) => `issue-${i.id}`)}
        strategy={verticalListSortingStrategy}
      >
        {issues.length === 0 ? (
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

// 빈 완료·취소 열의 「완료 모두 보기」(WP-606) — 필터 바 토글과 같은 상태(closed=all)를 켠다. 데스크톱·모바일 공용.
// testKey — 컬럼·탭의 statusId(데스크톱·모바일 공통).
function ShowAllClosedButton({ testKey, onClick, className }: { testKey: number; onClick: () => void; className?: string }) {
  return (
    <Button size="sm" variant="outline" className={className} onClick={onClick} data-testid={`board-col-show-closed-${testKey}`}>
      <CircleCheckBig className="h-4 w-4" />
      완료 모두 보기
    </Button>
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
          // 탭이 상태를 드러내므로 카드 showStatus 는 기본(끔) 그대로 둔다.
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
  onOpenCreate?: (statusId?: number) => void;
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
          {/* 그룹(담당자·우선순위) 컬럼은 상태가 아니라 기본(할 일)으로 만든다. */}
          {onOpenCreate && (
            <Button size="sm" variant="ghost" onClick={() => onOpenCreate()} data-testid={`board-col-add-${group.key}`}>
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
