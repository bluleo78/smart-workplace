// 프로젝트 사이클 — Jira 백로그 방식(#878). 위→아래: 진행 중 사이클 · 예정 사이클 · 백로그(사이클 미할당) · 완료 사이클(토글).
// 각 섹션은 이슈 행을 품고, 헤더에 기간·남은 일수·건수·진행률과 기존 편집/삭제 액션을 둔다.
// 이슈 행을 다른 섹션으로 끌어 놓으면 사이클을 옮긴다(#881) — 출발 사이클 해제 + 도착 사이클 추가, 백로그=사이클 없음.
import {
  closestCorners,
  type CollisionDetection,
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  useDndMonitor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { ArrowLeft, ChevronRight, MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react';
import { useId, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { PageHeader } from '@/components/layout/PageHeader';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DeleteConfirmDialog } from '@/components/ui/delete-confirm-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

import {
  type CycleDragData,
  type CycleDropData,
  CycleIssueDragPreview,
  CycleSectionShell,
} from '../../components/cycle/CycleBacklogSection';
import { CycleFormDialog } from '../../components/cycle/CycleFormDialog';
import { CycleProgressBar } from '../../components/cycle/CycleProgressBar';
import { useCycleProgress, useCycles, useDeleteCycle } from '../../hooks/queries/useCycles';
import { useSectionIssues } from '../../hooks/queries/useCycleSectionIssues';
import { useMoveIssueCycle } from '../../hooks/queries/useMoveIssueCycle';
import { useProject } from '../../hooks/queries/useProjects';
import { daysUntilLocalDate } from '../../lib/myTasks';
import { cn } from '../../lib/utils';
import type { CycleProgress, CycleResponse } from '../../types/cycle';
import { CYCLE_STATUS_LABEL } from '../../types/cycle';

// 날짜 오름차순 비교 — null(미정)은 맨 뒤, 같으면 id 순으로 안정 정렬. yyyy-MM-dd 문자열은 사전순=날짜순.
function byDateAsc(key: 'startDate' | 'endDate') {
  return (a: CycleResponse, b: CycleResponse) => {
    const av = a[key];
    const bv = b[key];
    if (av !== bv) {
      if (av == null) return 1;
      if (bv == null) return -1;
      return av < bv ? -1 : 1;
    }
    return a.id - b.id;
  };
}

// 진행 중 사이클 남은 일수 — 로컬 날짜 기준(D-N / 오늘=D-day / 지나면 "N일 초과" 경고).
function remainingLabel(endDate: string | null, now: Date): { text: string; overdue: boolean } | null {
  if (!endDate) return null;
  const days = daysUntilLocalDate(endDate, now);
  if (days > 0) return { text: `D-${days}`, overdue: false };
  if (days === 0) return { text: 'D-day', overdue: false };
  return { text: `${-days}일 초과`, overdue: true };
}

// 충돌 판정 — 포인터 드래그는 포인터가 실제로 들어간 섹션만 대상으로 한다.
// 가장 가까운 섹션 폴백을 포인터에도 쓰면 완료 사이클(disabled)·섹션 사이 틈에 놓았을 때 엉뚱한 이웃 섹션으로 옮겨진다.
// 포인터 좌표가 없는 키보드 드래그만 가장 가까운 섹션(closestCorners)을 쓴다.
const sectionCollision: CollisionDetection = (args) =>
  args.pointerCoordinates ? pointerWithin(args) : closestCorners(args);

export default function CyclesPage() {
  const { key = '' } = useParams();
  const navigate = useNavigate();
  const project = useProject(key);
  const cycles = useCycles(key);
  const progress = useCycleProgress(key);
  const [editing, setEditing] = useState<CycleResponse | undefined>();
  const [open, setOpen] = useState(false);
  // 완료 사이클은 기본 숨김 — 편집·삭제 접근용 토글로만 노출한다.
  const [showCompleted, setShowCompleted] = useState(false);
  const completedListId = useId();
  // 드래그 이동은 프로젝트 멤버만(서버 assertMember 와 동일) — 보드 상태 드래그와 같은 게이트.
  const canDrag = project.data?.viewerIsMember ?? false;
  const moveCycle = useMoveIssueCycle(key);
  // PointerSensor distance:5 — 짧은 클릭은 행 클릭(상세 이동)으로 남긴다.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    // 키보드 드래그 시작은 Space 만 — Enter 는 행 안 제목 링크의 상세 이동으로 남긴다.
    useSensor(KeyboardSensor, {
      keyboardCodes: { start: ['Space'], cancel: ['Escape'], end: ['Space', 'Enter'] },
    }),
  );
  // 섹션 이름·완료 여부 조회 — 드래그/드롭 데이터엔 id 만 싣고 여기서 찾는다(null=백로그).
  const cycleById = useMemo(() => new Map((cycles.data ?? []).map((c) => [c.id, c])), [cycles.data]);
  const sectionName = (id: number | null) => (id == null ? '백로그' : (cycleById.get(id)?.name ?? ''));

  const handleDragEnd = (e: DragEndEvent) => {
    const src = e.active.data.current as CycleDragData | undefined;
    const dst = e.over?.data.current as CycleDropData | undefined;
    // 같은 섹션에 놓으면 변화 없음(섹션 내 순서 변경은 범위 밖). 완료 사이클은 droppable 이 disabled 라 over 가 없다.
    if (!src || !dst || src.fromCycleId === dst.cycleId) return;
    moveCycle.mutate({
      issue: src.issue,
      from: src.fromCycleId,
      to: dst.cycleId,
      fromName: sectionName(src.fromCycleId),
      toName: sectionName(dst.cycleId),
      fromCompleted:
        src.fromCycleId != null && cycleById.get(src.fromCycleId)?.status === 'COMPLETED',
    });
  };

  const progressById = useMemo(() => {
    const m = new Map<number, CycleProgress>();
    (progress.data ?? []).forEach((p) => m.set(p.cycleId, p));
    return m;
  }, [progress.data]);

  // 상태별 섹션 그룹 — 진행 중·예정은 시작일 오름차순(미정 뒤), 완료는 최근 종료가 위로.
  const groups = useMemo(() => {
    const all = cycles.data ?? [];
    return {
      active: all.filter((c) => c.status === 'ACTIVE').sort(byDateAsc('startDate')),
      planned: all.filter((c) => c.status === 'PLANNED').sort(byDateAsc('startDate')),
      completed: all
        .filter((c) => c.status === 'COMPLETED')
        .sort(byDateAsc('endDate'))
        .reverse(),
    };
  }, [cycles.data]);

  const openEdit = (c: CycleResponse) => {
    setEditing(c);
    setOpen(true);
  };

  return (
    <div className="flex h-full flex-col overflow-hidden" data-testid="cycles-page">
      <PageHeader
        contained
        icon={
          <Button
            variant="ghost"
            size="icon"
            aria-label="프로젝트로 돌아가기"
            onClick={() => navigate(`/projects/${key}`)}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
        }
        title="사이클"
        meta={<span className="text-muted-foreground">{project.data?.key}</span>}
        actions={
          /* 헤더 주 액션 — size 미지정(default). 04-components §E 규정(#744/#747). */
          <Button
            onClick={() => {
              setEditing(undefined);
              setOpen(true);
            }}
            data-testid="cycle-new"
          >
            {/* mr-1·h-4 w-4 제거 — 간격은 Button cva 의 gap 이, 크기는 같은 cva 의
                [&_svg:not([class*='size-'])]:size-4 가 담당한다. */}
            <Plus /> 새 사이클
          </Button>
        }
      />
      <DndContext
        sensors={sensors}
        collisionDetection={sectionCollision}
        onDragEnd={handleDragEnd}
      >
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-4xl space-y-3 p-4 sm:p-6">
          {/* 진행 중 사이클만 기본 펼침 */}
          {[...groups.active, ...groups.planned].map((c) => (
            <CycleSection
              key={c.id}
              projectKey={key}
              cycle={c}
              progress={progressById.get(c.id)}
              defaultExpanded={c.status === 'ACTIVE'}
              onEdit={openEdit}
              canDrag={canDrag}
            />
          ))}
          {(cycles.data?.length ?? 0) === 0 && !cycles.isLoading && (
            <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
              아직 사이클이 없습니다.
            </p>
          )}

          <BacklogSection projectKey={key} canDrag={canDrag} />

          {groups.completed.length > 0 && (
            <div className="space-y-3 pt-1">
              {/* 완료 사이클 구분 헤더 — 기본 접힘, 펼치면 완료 사이클 섹션(각각 접힘)이 편집·삭제용으로 나온다. */}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowCompleted((v) => !v)}
                aria-expanded={showCompleted}
                aria-controls={completedListId}
                data-testid="completed-cycles-toggle"
                className="text-muted-foreground"
              >
                <ChevronRight className={cn(showCompleted && 'rotate-90')} aria-hidden="true" />
                완료된 사이클 ({groups.completed.length})
              </Button>
              {showCompleted && (
                <div id={completedListId} className="space-y-3">
                  {groups.completed.map((c) => (
                    <CycleSection
                      key={c.id}
                      projectKey={key}
                      cycle={c}
                      progress={progressById.get(c.id)}
                      onEdit={openEdit}
                      canDrag={canDrag}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <CycleDragOverlay projectKey={key} />
      </DndContext>

      <CycleFormDialog projectKey={key} cycle={editing} open={open} onOpenChange={setOpen} />
    </div>
  );
}

/**
 * 드래그 오버레이 — 활성 행 사본이 포인터를 따라간다(원본은 반투명 자리표시).
 * 드래그 상태를 이 컴포넌트에 가둬 드래그 시작·종료 때 페이지 전체(모든 섹션·행)가 다시 렌더되지 않게 한다.
 */
function CycleDragOverlay({ projectKey }: { projectKey: string }) {
  const [dragging, setDragging] = useState<CycleDragData | null>(null);
  useDndMonitor({
    onDragStart: (e: DragStartEvent) =>
      setDragging((e.active.data.current as CycleDragData | undefined) ?? null),
    onDragEnd: () => setDragging(null),
    onDragCancel: () => setDragging(null),
  });
  return (
    <DragOverlay dropAnimation={null}>
      {dragging && <CycleIssueDragPreview issue={dragging.issue} projectKey={projectKey} />}
    </DragOverlay>
  );
}

/**
 * 사이클 섹션 — 헤더(이름·상태·기간·남은 일수·건수·진행률·편집/삭제) + 펼치면 cycle={id} 이슈 행.
 * 진행 중 사이클만 기본 펼침·강조. 펼침 상태는 영속할 필요가 없어 컴포넌트 state 로 둔다.
 */
function CycleSection({
  projectKey,
  cycle: c,
  progress,
  defaultExpanded = false,
  onEdit,
  canDrag,
}: {
  projectKey: string;
  cycle: CycleResponse;
  progress: CycleProgress | undefined;
  defaultExpanded?: boolean;
  onEdit: (c: CycleResponse) => void;
  canDrag: boolean;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  // 삭제 확인 다이얼로그 — 데스크톱 삭제 버튼과 모바일 ⋯ 메뉴의 「삭제」가 함께 여는 제어형 상태.
  const [confirmDelete, setConfirmDelete] = useState(false);
  const del = useDeleteCycle(projectKey);
  const query = useSectionIssues(projectKey, c.id, expanded);
  const active = c.status === 'ACTIVE';
  // 남은 일수는 진행 중 사이클에만 의미가 있다(예정·완료는 기간만).
  const remaining = active ? remainingLabel(c.endDate, new Date()) : null;
  // 빈 본문 문구 — 섹션 행은 SUBTASK·EPIC 을 뺀 범위라, progress(전체 기준)에 이슈가 있으면 그 사실을 알려 0행과 진행률의 모순을 풀어준다.
  const total = progress?.total ?? 0;
  const emptyText =
    total > 0
      ? `표시할 상위 작업이 없습니다 (하위 이슈 ${total}건 포함)`
      : '이 사이클에 배정된 작업이 없습니다';

  return (
    <CycleSectionShell
      testId={`cycle-row-${c.id}`}
      toggleTestId={`cycle-section-toggle-${c.id}`}
      cycleId={c.id}
      dropDisabled={c.status === 'COMPLETED'}
      canDrag={canDrag}
      active={active}
      expanded={expanded}
      onToggle={() => setExpanded((v) => !v)}
      title={c.name}
      projectKey={projectKey}
      query={query}
      goal={c.goal}
      emptyText={emptyText}
      badge={
        <Badge variant={active ? 'info' : 'secondary'}>
          {active && <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />}
          {CYCLE_STATUS_LABEL[c.status] ?? c.status}
        </Badge>
      }
      meta={
        // 남은 일수는 endDate 가 있어야 나오므로 기간 유무만으로 메타 노출을 판단한다.
        (c.startDate || c.endDate) && (
          <>
            <span className="tabular-nums">
              {c.startDate ?? '—'} ~ {c.endDate ?? '—'}
            </span>
            {remaining && (
              <span
                data-testid={`cycle-remaining-${c.id}`}
                className={cn(
                  'font-medium tabular-nums',
                  remaining.overdue ? 'text-destructive' : 'text-primary',
                )}
              >
                {remaining.text}
              </span>
            )}
          </>
        )
      }
      progress={
        <CycleProgressBar
          progress={progress ?? { cycleId: c.id, total: 0, done: 0, byStatus: {} }}
        />
      }
      actions={
        <>
          <Button variant="ghost" size="icon" aria-label="수정" onClick={() => onEdit(c)}>
            <Pencil />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="삭제"
            data-testid={`cycle-delete-${c.id}`}
            onClick={() => setConfirmDelete(true)}
          >
            <Trash2 />
          </Button>
          {/* 삭제 확인 — shadcn AlertDialog (#145). 포털로 렌더되므로 한 번만 두고 두 진입점이 공유한다. */}
          <DeleteConfirmDialog
            entityName="사이클"
            itemName={c.name}
            onConfirm={() => del.mutate(c.id)}
            open={confirmDelete}
            onOpenChange={setConfirmDelete}
          />
        </>
      }
      mobileActions={
        // 좁은 화면 — 편집·삭제를 ⋯ 메뉴 하나로 합쳐 이름 폭을 확보한다.
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label="사이클 메뉴"
              data-testid={`cycle-menu-${c.id}`}
            >
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => onEdit(c)}>
              <Pencil />
              수정
            </DropdownMenuItem>
            {/* 메뉴가 닫히며 포커스를 되돌린 뒤 다이얼로그를 열어야 포커스 트랩이 충돌하지 않는다. */}
            <DropdownMenuItem
              variant="destructive"
              onSelect={() => setTimeout(() => setConfirmDelete(true), 0)}
            >
              <Trash2 />
              삭제
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      }
    />
  );
}

// 백로그 섹션 — 사이클 미할당(cycle=null) 미종료 이슈. 계획 대상이라 기본 펼침.
function BacklogSection({ projectKey, canDrag }: { projectKey: string; canDrag: boolean }) {
  const [expanded, setExpanded] = useState(true);
  const query = useSectionIssues(projectKey, null, expanded);
  return (
    <CycleSectionShell
      testId="backlog-section"
      toggleTestId="backlog-section-toggle"
      cycleId={null}
      canDrag={canDrag}
      expanded={expanded}
      onToggle={() => setExpanded((v) => !v)}
      title="백로그"
      showRowCount
      emptyText="사이클에 넣지 않은 미완료 이슈가 없습니다"
      projectKey={projectKey}
      query={query}
    />
  );
}
