// 4 컬럼 칸반 보드 — @dnd-kit.
// list 뷰와 동일한 useIssueSearch 쿼리 키를 공유해 캐시를 재사용한다.
// 첫 페이지가 가득 차면 자동으로 두번째 페이지까지 prefetch.

import {
  DndContext,
  type DragEndEvent,
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
import { useEffect, useMemo } from 'react';

import { useIssueSearch } from '../../../hooks/queries/useIssueSearch';
import { useUpdateIssueStatus } from '../../../hooks/queries/useUpdateIssueStatus';
import type { IssueFilters, IssueResponse } from '../../../types/issue';
import { IssueCard } from './IssueCard';

const COLUMNS: { status: string; label: string }[] = [
  { status: 'TODO', label: '할 일' },
  { status: 'IN_PROGRESS', label: '진행 중' },
  { status: 'DONE', label: '완료' },
  { status: 'CANCELED', label: '취소' },
];

export function IssueBoardView({
  projectKey,
  filters,
}: {
  projectKey: string;
  filters: IssueFilters;
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

  const allIssues: IssueResponse[] = useMemo(
    () => data?.pages.flatMap((p) => p.items) ?? [],
    [data],
  );

  const byStatus = useMemo(() => {
    const map: Record<string, IssueResponse[]> = {
      TODO: [],
      IN_PROGRESS: [],
      DONE: [],
      CANCELED: [],
    };
    for (const it of allIssues) {
      if (map[it.status]) map[it.status].push(it);
    }
    return map;
  }, [allIssues]);

  // PointerSensor distance:5 — 짧은 클릭으로 Link 가 발화되도록 보장.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over) return;
    const sourceStatus = active.data.current?.status as string | undefined;
    // drop 대상이 카드면 active 의 status, 빈 컬럼이면 droppable id 에서 추출.
    const targetStatus =
      (over.data.current?.status as string | undefined) ??
      (typeof over.id === 'string' && over.id.startsWith('col-')
        ? over.id.replace('col-', '')
        : undefined);
    const issueNumber = active.data.current?.issueNumber as number | undefined;
    if (!sourceStatus || !targetStatus || !issueNumber) return;
    if (sourceStatus === targetStatus) return;
    updateStatus.mutate({ number: issueNumber, status: targetStatus });
  }

  return (
    <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
        {COLUMNS.map((col) => (
          <BoardColumn
            key={col.status}
            status={col.status}
            label={col.label}
            issues={byStatus[col.status] ?? []}
            projectKey={projectKey}
          />
        ))}
      </div>
      {hasNextPage && (
        <p className="text-xs text-muted-foreground mt-3">
          더 많은 결과가 있습니다 — 필터로 좁혀주세요.
        </p>
      )}
    </DndContext>
  );
}

// 각 컬럼은 droppable + 내부 카드들이 SortableContext 에 묶여 있다.
function BoardColumn({
  status,
  label,
  issues,
  projectKey,
}: {
  status: string;
  label: string;
  issues: IssueResponse[];
  projectKey: string;
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
            <IssueCard key={it.id} projectKey={projectKey} issue={it} />
          ))}
        </div>
      </SortableContext>
    </section>
  );
}
