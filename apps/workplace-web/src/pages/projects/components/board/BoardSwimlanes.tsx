// 그룹 보드 스윔레인(WP-1021) — 담당자·우선순위·에픽으로 묶은 보드. 그룹마다 가로 레인 하나, 열은 상태 보드와 같은 프로젝트 상태.
// 예전엔 그룹마다 세로 컬럼 하나(읽기 전용)라 상태 분포가 카드의 작은 아이콘으로만 보였고 끌어서 상태를 바꿀 수 없었다.
// 레인 안에서 다른 상태 칸으로 끌면 상태만 바뀐다. 다른 레인으로는 옮기지 않는다(담당자·우선순위 변경 없음 — boardLaneDrop).
// 드롭 처리는 상태 보드와 같은 IssueBoardView.handleDragEnd 가 맡는다 — 여기는 레인·칸(droppable)·카드만 그린다.
// 위 상태 머리줄은 보드 스크롤 기준 sticky top, 레인 머리(접기·이름·개수)는 가로로 굴려도 보이게 sticky left 다.

import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { ChevronRight, Inbox } from 'lucide-react';
import { useId, useState } from 'react';

import { cn } from '@/lib/utils';

import { IssueStatusIcon } from '../../../../components/issues/IssueStatusIcon';
import { type LaneCellDropData, laneCellDropId, laneCellTestId, laneTestId } from '../../../../lib/boardLaneDrop';
import { CLOSED_HIDDEN_NOTE } from '../../../../lib/closedHiding';
import type { IssueDragData } from '../../../../lib/epicDnd';
import type { IssueGroup } from '../../../../lib/issueGrouping';
import type { IssueResponse, IssueStatus } from '../../../../types/issue';
import type { ProjectStatus } from '../../../../types/projectStatus';
import { IssueCard } from '../IssueCard';
import { boardTrackStyle } from './boardGrid';
import { ShowAllClosedButton } from './ShowAllClosedButton';

/** 접힌 레인 요약 — 상태 순서대로 「할 일 2 · 진행 중 1」(0건 상태는 뺀다). 모두 0건이면 「이슈 없음」. */
function laneSummary(columns: ProjectStatus[], byStatus: Map<number, IssueResponse[]>): string {
  const parts = columns.flatMap((s) => {
    const n = byStatus.get(s.id)?.length ?? 0;
    return n > 0 ? [`${s.name} ${n}`] : [];
  });
  return parts.length > 0 ? parts.join(' · ') : '이슈 없음';
}

export function BoardSwimlanes({
  columns,
  groups,
  issues,
  pending,
  projectKey,
  cardTo,
  showType,
  dragDisabled,
  onLongPress,
  showAllClosedFor,
}: {
  // 열 = 프로젝트 상태(제외 범주 뺀 상태 보드 컬럼과 같은 목록·순서).
  columns: ProjectStatus[];
  // 레인 = groupIssues 결과(그 순서 그대로).
  groups: IssueGroup[];
  // 레인에 나눠 담기 전 이슈(중복 없음) — 머리줄 상태별 개수는 이것으로 센다(다중 담당자 이슈를 두 번 세지 않게).
  issues: IssueResponse[];
  // 첫 페이지 응답 전 — 빈 안내를 깜빡이지 않는다.
  pending: boolean;
  projectKey: string;
  cardTo?: (issue: IssueResponse) => string;
  showType: boolean;
  // 비멤버·모바일 — 카드를 끌 수 없고 드롭도 무시한다.
  dragDisabled: boolean;
  onLongPress?: (issue: IssueResponse) => void;
  // 종료 이슈 숨김(WP-606) — 숨기는 화면이면 완료·취소 범주에 「완료 모두 보기」 콜백, 아니면 undefined(IssueBoardView.showAllClosedFor).
  showAllClosedFor: (category: IssueStatus) => (() => void) | undefined;
}) {
  // 접은 레인(그룹 키) — 화면 상태만, 저장하지 않는다.
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const toggle = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  // 머리줄 상태별 개수 — 레인 합이 아니라 고유 이슈 기준.
  const countByStatus = new Map<number, number>();
  for (const it of issues) countByStatus.set(it.statusId, (countByStatus.get(it.statusId) ?? 0) + 1);
  // 레인은 groupIssues 그룹 그대로(우선순위는 빈 그룹도 레인으로 남아 분포가 보인다). 이슈가 하나도 없을 때만 레인 대신 빈 안내.
  const empty = issues.length === 0;
  // 종료 이슈 숨김 안내(WP-606) — 숨기는 완료·취소 열이 비었으면 레인마다 되풀이하지 않고 머리줄 아래 그 열에 한 번만 둔다.
  // 첫 응답 전(pending)에는 모든 열이 비어 보이므로 띄우지 않는다.
  const closedNotes = columns.map((s) =>
    !pending && (countByStatus.get(s.id) ?? 0) === 0 ? showAllClosedFor(s.category) : undefined,
  );

  return (
    // isolate — 안의 sticky z(머리줄 z-30)가 바깥(떠 있는 에픽 패널 z-30)과 겨루지 않게 쌓임 맥락을 가둔다.
    // min-w-0 을 두지 않는다 — 열 트랙 최소 폭(240px × 열 수)까지 늘어나야 머리줄 배경·레인 구분선이 가로로 넘친 열까지 덮는다.
    <div className="isolate flex flex-1 flex-col gap-3" data-testid="board-swimlanes">
      {/* 상태 머리줄 — 카드 ⋯(z-20) 위로 덮이게 z-30. */}
      <div className="sticky top-0 z-30 grid gap-x-3 bg-background" style={boardTrackStyle(columns.length)}>
        {columns.map((s) => (
          <div
            key={s.id}
            className="flex min-w-0 items-center gap-1.5 px-2 py-2 text-sm font-semibold text-foreground"
            data-testid={`board-lane-head-${s.id}`}
          >
            <IssueStatusIcon status={s.category} color={s.color} decorative className="h-4 w-4" />
            <span className="truncate" title={s.name}>
              {s.name}
            </span>
            <span className="shrink-0 font-normal text-muted-foreground" data-testid={`board-lane-head-count-${s.id}`}>
              {countByStatus.get(s.id) ?? 0}
            </span>
          </div>
        ))}
      </div>
      {/* 숨김 안내 줄 — sticky 가 아니라 위에만 둔다(세로로 굴리는 동안 자리를 차지하지 않게). */}
      {closedNotes.some(Boolean) && (
        <div className="grid gap-x-3" style={boardTrackStyle(columns.length)}>
          {columns.map((s, i) => {
            const onShowAll = closedNotes[i];
            return onShowAll ? (
              <div key={s.id} className="flex flex-col items-start gap-2 px-2" data-testid={`board-lane-closed-note-${s.id}`}>
                {/* 좁은 열에서 음절 단위로 끊기지 않게 어절 단위 줄바꿈(break-keep) */}
                <p className="break-keep text-xs text-muted-foreground">{CLOSED_HIDDEN_NOTE}</p>
                <ShowAllClosedButton testKey={s.id} onClick={onShowAll} />
              </div>
            ) : (
              <div key={s.id} />
            );
          })}
        </div>
      )}
      {!empty &&
        groups.map((g) => (
          <Lane
            key={g.key}
            group={g}
            columns={columns}
            collapsed={collapsed.has(g.key)}
            onToggle={() => toggle(g.key)}
            projectKey={projectKey}
            cardTo={cardTo}
            showType={showType}
            dragDisabled={dragDisabled}
            onLongPress={onLongPress}
          />
        ))}
      {empty && !pending && (
        /* 이슈가 하나도 없을 때 — 디자인 시스템 §2.5 빈 상태 패턴(아이콘 + 제목 + 설명). */
        <div className="flex flex-col items-center justify-center gap-3 py-12 text-center" data-testid="board-lanes-empty">
          <Inbox className="h-8 w-8 text-muted-foreground/50" aria-hidden="true" />
          <div className="space-y-1">
            <p className="text-sm font-medium text-muted-foreground">이슈 없음</p>
            <p className="text-xs text-muted-foreground">조건에 맞는 이슈가 없습니다</p>
          </div>
        </div>
      )}
    </div>
  );
}

// 레인 하나 — 머리(접기 토글·이름·개수, 접히면 상태별 요약)와 상태 칸들.
function Lane({
  group,
  columns,
  collapsed,
  onToggle,
  projectKey,
  cardTo,
  showType,
  dragDisabled,
  onLongPress,
}: {
  group: IssueGroup;
  columns: ProjectStatus[];
  collapsed: boolean;
  onToggle: () => void;
  projectKey: string;
  cardTo?: (issue: IssueResponse) => string;
  showType: boolean;
  dragDisabled: boolean;
  onLongPress?: (issue: IssueResponse) => void;
}) {
  const bodyId = useId();
  // 레인 이슈를 상태별로 — 그룹 순서(서버 정렬)를 칸 안에서도 그대로 둔다.
  const byStatus = new Map<number, IssueResponse[]>();
  for (const it of group.issues) {
    const list = byStatus.get(it.statusId);
    if (list) list.push(it);
    else byStatus.set(it.statusId, [it]);
  }
  return (
    <section aria-label={`${group.label} 레인`} data-testid={laneTestId(group.key)} className="flex flex-col gap-2">
      <div className="border-b pb-1.5">
        {/* sticky left — 가로로 굴려도 레인 이름·개수·요약이 보인다. 아래 칸과 겹치지 않아 z 는 낮게 둔다. */}
        <div className="sticky left-0 z-10 flex w-fit max-w-full items-center gap-2 bg-background pr-2">
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={!collapsed}
            // 접힌 동안엔 칸을 그리지 않으므로 없는 id 를 가리키지 않게 뺀다.
            aria-controls={collapsed ? undefined : bodyId}
            aria-label={`${group.label} 레인 ${collapsed ? '펼치기' : '접기'}`}
            data-testid={`board-lane-toggle-${group.key}`}
            className="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ChevronRight className={cn('size-4 transition-transform', !collapsed && 'rotate-90')} aria-hidden="true" />
          </button>
          <span className="truncate text-sm font-semibold text-foreground" title={group.label}>
            {group.label}
          </span>
          <span className="shrink-0 text-sm text-muted-foreground" data-testid={`board-lane-count-${group.key}`}>
            {group.issues.length}
          </span>
          {collapsed && (
            <span className="truncate text-xs text-muted-foreground" data-testid={`board-lane-summary-${group.key}`}>
              {laneSummary(columns, byStatus)}
            </span>
          )}
        </div>
      </div>
      {!collapsed && (
        <div id={bodyId} className="grid gap-x-3" style={boardTrackStyle(columns.length)}>
          {columns.map((s) => (
            <LaneCell
              key={s.id}
              lane={group.key}
              laneLabel={group.label}
              status={s}
              issues={byStatus.get(s.id) ?? []}
              projectKey={projectKey}
              cardTo={cardTo}
              showType={showType}
              dragDisabled={dragDisabled}
              onLongPress={onLongPress}
            />
          ))}
        </div>
      )}
    </section>
  );
}

// 레인 × 상태 칸 — droppable. 빈 칸도 놓을 수 있게 최소 높이를 둔다(「이슈 추가」 CTA 는 없다).
// 다른 레인은 놓아도 무시되므로(boardLaneDrop) 드롭 강조도 같은 레인 카드를 끌 때만 켠다.
function LaneCell({
  lane,
  laneLabel,
  status,
  issues,
  projectKey,
  cardTo,
  showType,
  dragDisabled,
  onLongPress,
}: {
  lane: string;
  laneLabel: string;
  status: ProjectStatus;
  issues: IssueResponse[];
  projectKey: string;
  cardTo?: (issue: IssueResponse) => string;
  showType: boolean;
  dragDisabled: boolean;
  onLongPress?: (issue: IssueResponse) => void;
}) {
  const label = `${laneLabel} · ${status.name}`;
  const { setNodeRef, isOver, active } = useDroppable({
    id: laneCellDropId(lane, status.id),
    // label: 스크린리더 드래그 안내(epicDnd.describeDropTarget)가 「레인 · 상태」 컬럼으로 읽는다.
    data: { statusId: status.id, lane, label } satisfies LaneCellDropData,
  });
  const sameLane = (active?.data.current as IssueDragData | undefined)?.lane === lane;
  return (
    <div
      ref={setNodeRef}
      role="group"
      aria-label={label}
      data-testid={laneCellTestId(lane, status.id)}
      data-status-id={status.id}
      className={cn('flex min-h-16 min-w-0 flex-col gap-2 rounded-md border p-2', isOver && sameLane && 'bg-accent/30')}
    >
      {/* 카드 드래그 id 는 레인 범위(dragScope)로 구분한다 — 다중 담당자 이슈는 여러 레인에 같은 카드가 있다. */}
      <SortableContext items={issues.map((i) => `issue-${lane}-${i.id}`)} strategy={verticalListSortingStrategy}>
        {issues.map((it) => (
          <IssueCard
            key={it.id}
            projectKey={projectKey}
            issue={it}
            to={cardTo?.(it)}
            showType={showType}
            dragDisabled={dragDisabled}
            dragScope={lane}
            onLongPress={onLongPress}
          />
        ))}
      </SortableContext>
    </div>
  );
}
