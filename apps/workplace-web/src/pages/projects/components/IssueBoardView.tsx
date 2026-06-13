// 4 컬럼 칸반 보드 — @dnd-kit.
// list 뷰와 동일한 useIssueSearch 쿼리 키를 공유해 캐시를 재사용한다.
// 첫 페이지가 가득 차면 자동으로 두번째 페이지까지 prefetch.

import {
  closestCorners,
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  KeyboardSensor,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { useEffect, useMemo, useState } from 'react';

import { useIssueSearch } from '../../../hooks/queries/useIssueSearch';
import { useUpdateIssueStatus } from '../../../hooks/queries/useUpdateIssueStatus';
import { groupIssues, type IssueGroup } from '../../../lib/issueGrouping';
import type {
  IssueFilters,
  IssueGroupBy,
  IssueResponse,
} from '../../../types/issue';
import { IssueCard } from './IssueCard';

// 기본 4컬럼(팀). 개인은 3컬럼(CANCELED 제외) 을 주입한다.
const DEFAULT_COLUMNS: { status: string; label: string }[] = [
  { status: 'TODO', label: '할 일' },
  { status: 'IN_PROGRESS', label: '진행 중' },
  { status: 'DONE', label: '완료' },
  { status: 'CANCELED', label: '취소' },
];

export function IssueBoardView({
  projectKey,
  filters,
  groupBy,
  columns = DEFAULT_COLUMNS,
  cardTo,
}: {
  projectKey: string;
  filters: IssueFilters;
  groupBy: IssueGroupBy | null;
  // 컬럼 세트 override(기본 팀 4컬럼). 컬럼에 없는 상태의 이슈는 렌더 제외.
  columns?: { status: string; label: string }[];
  // 카드 링크 대상 빌더(기본 미지정 = IssueCard 기본 상세 경로). 개인은 drawer 경로 주입.
  cardTo?: (issue: IssueResponse) => string;
}) {
  // 보드는 한 화면에 많은 카드를 보여줘야 하므로 페이지 크기를 100 으로 키운다.
  const { data, fetchNextPage, hasNextPage, isFetching } = useIssueSearch(
    projectKey,
    filters,
    100,
  );
  const updateStatus = useUpdateIssueStatus(projectKey);

  // 첫 페이지 도착 후 다음 페이지가 있으면 한 번 더 자동 로드 (최대 200 카드).
  useEffect(() => {
    if (data && data.pages.length === 1 && hasNextPage && !isFetching) {
      void fetchNextPage();
    }
  }, [data, hasNextPage, isFetching, fetchNextPage]);

  // 응답 모양이 예상과 다른 경우(p.items 누락) flatMap 이 [undefined] 를 만들지 못하게 방어.
  const allIssues: IssueResponse[] = useMemo(
    () =>
      data?.pages.flatMap((p) => p.items ?? []).filter((x) => x != null) ?? [],
    [data],
  );

  // byStatus 는 columns 기준으로 동적 생성 — 컬럼에 없는 상태(개인 CANCELED)는 자연 제외.
  const byStatus = useMemo(() => {
    const map: Record<string, IssueResponse[]> = {};
    for (const col of columns) map[col.status] = [];
    for (const it of allIssues) {
      if (map[it.status]) map[it.status].push(it);
    }
    return map;
  }, [allIssues, columns]);

  // PointerSensor distance:5 — 짧은 클릭으로 Link 가 발화되도록 보장.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // DragOverlay 로 띄울 활성 카드. 드래그 중 원본은 반투명 placeholder, overlay 가 포인터를 따라간다.
  const [activeIssue, setActiveIssue] = useState<IssueResponse | null>(null);

  function handleDragStart(e: DragStartEvent) {
    const id = e.active.id;
    const found = allIssues.find((i) => `issue-${i.id}` === id);
    setActiveIssue(found ?? null);
  }

  function handleDragEnd(e: DragEndEvent) {
    setActiveIssue(null);
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
  if (groupBy && groupBy !== 'status') {
    const grouped = groupIssues(allIssues, groupBy);
    return (
      <>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          {grouped.map((g) => (
            <ReadOnlyColumn key={g.key} group={g} projectKey={projectKey} cardTo={cardTo} />
          ))}
        </div>
        {hasNextPage && (
          <p className="text-xs text-muted-foreground mt-3">
            더 많은 결과가 있습니다 — 필터로 좁혀주세요.
          </p>
        )}
      </>
    );
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setActiveIssue(null)}
    >
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
        {columns.map((col) => (
          <BoardColumn
            key={col.status}
            status={col.status}
            label={col.label}
            issues={byStatus[col.status] ?? []}
            projectKey={projectKey}
            cardTo={cardTo}
          />
        ))}
      </div>
      {hasNextPage && (
        <p className="text-xs text-muted-foreground mt-3">
          더 많은 결과가 있습니다 — 필터로 좁혀주세요.
        </p>
      )}
      {/* DragOverlay — 컬럼 경계를 넘어도 ghost 가 포인터를 그대로 따라간다. */}
      <DragOverlay dropAnimation={null}>
        {activeIssue ? (
          <IssueCard
            projectKey={projectKey}
            issue={activeIssue}
            asOverlay
            to={cardTo?.(activeIssue)}
          />
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

// 각 컬럼은 droppable + 내부 카드들이 SortableContext 에 묶여 있다.
function BoardColumn({
  status,
  label,
  issues,
  projectKey,
  cardTo,
}: {
  status: string;
  label: string;
  issues: IssueResponse[];
  projectKey: string;
  // 카드 링크 대상 빌더 — 부모에서 thread.
  cardTo?: (issue: IssueResponse) => string;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `col-${status}`,
    data: { status },
  });
  return (
    <section
      ref={setNodeRef}
      aria-label={`${label} 컬럼`}
      data-testid={`board-col-${status}`}
      className={`rounded-md border p-2 min-h-[200px] ${isOver ? 'bg-accent/30' : ''}`}
    >
      <header className="flex items-center justify-between px-1 pb-2 text-xs font-semibold text-muted-foreground">
        <span>{label}</span>
        <span>{issues.length}</span>
      </header>
      <SortableContext
        items={issues.map((i) => `issue-${i.id}`)}
        strategy={verticalListSortingStrategy}
      >
        <div className="flex flex-col gap-2">
          {issues.map((it) => (
            <IssueCard key={it.id} projectKey={projectKey} issue={it} to={cardTo?.(it)} />
          ))}
        </div>
      </SortableContext>
    </section>
  );
}

// 담당자/우선순위 그룹 보드의 컬럼 — DnD 없는 읽기전용 (이슈는 *렌더*만 요구) (#58).
function ReadOnlyColumn({
  group,
  projectKey,
  cardTo,
}: {
  group: IssueGroup;
  projectKey: string;
  // 카드 링크 대상 빌더 — 부모에서 thread.
  cardTo?: (issue: IssueResponse) => string;
}) {
  return (
    <section
      aria-label={`${group.label} 컬럼`}
      data-testid={`board-col-${group.key}`}
      className="rounded-md border p-2 min-h-[200px]"
    >
      <header className="flex items-center justify-between px-1 pb-2 text-xs font-semibold text-muted-foreground">
        <span>{group.label}</span>
        <span>{group.issues.length}</span>
      </header>
      <div className="flex flex-col gap-2">
        {group.issues.map((it) => (
          <IssueCard key={it.id} projectKey={projectKey} issue={it} to={cardTo?.(it)} />
        ))}
      </div>
    </section>
  );
}
