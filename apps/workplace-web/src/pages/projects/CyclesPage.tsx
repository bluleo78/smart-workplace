// 프로젝트 사이클 — Jira 백로그 방식(#878). 위→아래: 진행 중 사이클 · 예정 사이클 · 백로그(사이클 미할당) · 완료 사이클(토글).
// 각 섹션은 이슈 행을 품고, 헤더에 기간·남은 일수·건수·진행률과 기존 편집/삭제 액션을 둔다.
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

import { CycleSectionShell } from '../../components/cycle/CycleBacklogSection';
import { CycleFormDialog } from '../../components/cycle/CycleFormDialog';
import { CycleProgressBar } from '../../components/cycle/CycleProgressBar';
import { useCycleProgress, useCycles, useDeleteCycle } from '../../hooks/queries/useCycles';
import {
  backlogSectionFilters,
  cycleSectionFilters,
  useSectionIssues,
} from '../../hooks/queries/useCycleSectionIssues';
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
            />
          ))}
          {(cycles.data?.length ?? 0) === 0 && !cycles.isLoading && (
            <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
              아직 사이클이 없습니다.
            </p>
          )}

          <BacklogSection projectKey={key} />

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
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <CycleFormDialog projectKey={key} cycle={editing} open={open} onOpenChange={setOpen} />
    </div>
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
}: {
  projectKey: string;
  cycle: CycleResponse;
  progress: CycleProgress | undefined;
  defaultExpanded?: boolean;
  onEdit: (c: CycleResponse) => void;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  // 삭제 확인 다이얼로그 — 데스크톱 삭제 버튼과 모바일 ⋯ 메뉴의 「삭제」가 함께 여는 제어형 상태.
  const [confirmDelete, setConfirmDelete] = useState(false);
  const del = useDeleteCycle(projectKey);
  const filters = useMemo(() => cycleSectionFilters(c.id), [c.id]);
  const query = useSectionIssues(projectKey, filters, expanded);
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
function BacklogSection({ projectKey }: { projectKey: string }) {
  const [expanded, setExpanded] = useState(true);
  const filters = useMemo(() => backlogSectionFilters(), []);
  const query = useSectionIssues(projectKey, filters, expanded);
  return (
    <CycleSectionShell
      testId="backlog-section"
      toggleTestId="backlog-section-toggle"
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
