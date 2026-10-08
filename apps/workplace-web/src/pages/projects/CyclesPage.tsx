// 프로젝트 사이클 관리 — 목록 + 진행 막대 + 생성/수정/삭제.
import { ArrowLeft, MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { Page } from '@/components/layout/Page';
import { HeaderIconAction } from '@/components/mobile/HeaderIconAction';
import { MobileActionSheet } from '@/components/mobile/MobileActionSheet';
import { TOUCH_ROW_TRIGGER } from '@/components/mobile/TouchRowActionsMenu';
import { Button } from '@/components/ui/button';
import { DeleteConfirmDialog } from '@/components/ui/delete-confirm-dialog';
import { useIsMobile } from '@/hooks/useIsMobile';

import { CycleFormDialog } from '../../components/cycle/CycleFormDialog';
import { CycleProgressBar } from '../../components/cycle/CycleProgressBar';
import { useCycleProgress, useCycles, useDeleteCycle } from '../../hooks/queries/useCycles';
import { useProject } from '../../hooks/queries/useProjects';
import { formatDateRangeMonthDay } from '../../lib/formatters';
import type { CycleProgress, CycleResponse } from '../../types/cycle';
import { CYCLE_STATUS_LABEL } from '../../types/cycle';

export default function CyclesPage() {
  const { key = '' } = useParams();
  const navigate = useNavigate();
  const project = useProject(key);
  const cycles = useCycles(key);
  const progress = useCycleProgress(key);
  const del = useDeleteCycle(key);
  const [editing, setEditing] = useState<CycleResponse | undefined>();
  const [open, setOpen] = useState(false);
  const isMobile = useIsMobile();
  // 모바일 ⋯ 시트 대상 사이클(WP-197) — 시트·삭제 확인은 페이지에 하나만 두고 CycleMobileActions 가 그린다.
  const [sheetCycle, setSheetCycle] = useState<CycleResponse | null>(null);

  const progressById = useMemo(() => {
    const m = new Map<number, CycleProgress>();
    (progress.data ?? []).forEach((p) => m.set(p.cycleId, p));
    return m;
  }, [progress.data]);

  return (
    <Page width="reading" data-testid="cycles-page">
      <Page.Header
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
        // 모바일: 단일 주 액션은 ⋯ 로 접지 않고 ＋ 아이콘으로 인라인(같은 testid — actions 는 모바일에서 렌더 안 함).
        mobilePrimaryAction={
          <HeaderIconAction
            label="새 사이클"
            data-testid="cycle-new"
            onClick={() => {
              setEditing(undefined);
              setOpen(true);
            }}
          >
            <Plus />
          </HeaderIconAction>
        }
        mobileActions={null}
      />
      <Page.Body>
      <ul className="space-y-3">
        {(cycles.data ?? []).map((c) =>
          isMobile ? (
            <CycleRowMobile
              key={c.id}
              projectKey={key}
              cycle={c}
              progress={progressById.get(c.id)}
              onMore={() => setSheetCycle(c)}
            />
          ) : (
            <li key={c.id} className="rounded border p-4" data-testid={`cycle-row-${c.id}`}>
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{c.name}</span>
                    <span className="rounded bg-muted px-1.5 py-0.5 text-xs">
                      {CYCLE_STATUS_LABEL[c.status] ?? c.status}
                    </span>
                  </div>
                  {c.goal && <p className="mt-0.5 text-sm text-muted-foreground">{c.goal}</p>}
                  {(c.startDate || c.endDate) && (
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {c.startDate ?? '—'} ~ {c.endDate ?? '—'}
                    </p>
                  )}
                </div>
                <div className="flex gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="수정"
                    onClick={() => {
                      setEditing(c);
                      setOpen(true);
                    }}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  {/* 삭제 확인 — shadcn AlertDialog로 교체 (#145) */}
                  <DeleteConfirmDialog
                    entityName="사이클"
                    itemName={c.name}
                    onConfirm={() => del.mutate(c.id)}
                    trigger={
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="삭제"
                        data-testid={`cycle-delete-${c.id}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    }
                  />
                </div>
              </div>
              <div className="mt-3">
                <CycleProgressBar
                  progress={progressById.get(c.id) ?? { cycleId: c.id, total: 0, done: 0, byStatus: {} }}
                />
              </div>
            </li>
          ),
        )}
        {(cycles.data?.length ?? 0) === 0 && (
          <li className="rounded border border-dashed p-8 text-center text-sm text-muted-foreground">
            아직 사이클이 없습니다.
          </li>
        )}
      </ul>
      </Page.Body>

      <CycleFormDialog projectKey={key} cycle={editing} open={open} onOpenChange={setOpen} />
      {isMobile && (
        <CycleMobileActions
          cycle={sheetCycle}
          onClose={() => setSheetCycle(null)}
          onEdit={(c) => {
            setEditing(c);
            setOpen(true);
          }}
          onDelete={(c) => del.mutate(c.id)}
        />
      )}
    </Page>
  );
}

// 모바일 사이클 행 2줄째 — 「날짜 · 진행」(상태는 1줄째 배지에만, R2). 한쪽 날짜만 있으면 열린 범위로, 없으면 「—」.
function cycleMetaText(c: CycleResponse, p: CycleProgress | undefined): string {
  const range = formatDateRangeMonthDay(c.startDate, c.endDate, '—', { openEnded: true });
  const total = p?.total ?? 0;
  const progress = total > 0 ? `${Math.round(((p?.done ?? 0) / total) * 100)}%` : '이슈 없음';
  return `${range} · ${progress}`;
}

// 모바일 행(WP-197) — Link(행 탭 = 이 사이클 이슈 목록)와 ⋯ 버튼을 형제로 둬 ⋯ 탭이 이동을 일으키지 않는다.
function CycleRowMobile({
  projectKey,
  cycle: c,
  progress,
  onMore,
}: {
  projectKey: string;
  cycle: CycleResponse;
  progress: CycleProgress | undefined;
  onMore: () => void;
}) {
  return (
    <li className="flex items-start rounded border" data-testid={`cycle-row-${c.id}`}>
      <Link to={`/projects/${projectKey}?view=list&cycle=${c.id}`} className="min-w-0 flex-1 py-3 pl-4">
        <span className="flex items-center gap-2">
          <span className="min-w-0 truncate font-medium">{c.name}</span>
          <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-xs">
            {CYCLE_STATUS_LABEL[c.status] ?? c.status}
          </span>
        </span>
        <span data-testid={`cycle-row-meta-${c.id}`} className="mt-0.5 block text-xs text-muted-foreground">
          {cycleMetaText(c, progress)}
        </span>
        {c.goal && <span className="mt-0.5 block truncate text-xs text-muted-foreground">{c.goal}</span>}
      </Link>
      {/* ⋯ — 터치 행 트리거와 같은 44px 규격(TOUCH_ROW_TRIGGER). 아이콘은 세로 ⋮ 유지. */}
      <button
        type="button"
        aria-label={`${c.name} 더보기`}
        data-testid={`cycle-more-${c.id}`}
        onClick={onMore}
        className={TOUCH_ROW_TRIGGER}
      >
        <MoreHorizontal className="size-5" aria-hidden />
      </button>
    </li>
  );
}

// 모바일 ⋯ 액션 시트 + 삭제 확인. 시트를 먼저 닫고 확인창을 여므로 삭제 대상은 시트 대상과 따로 둔다(WP-197).
// 행마다 두지 않고 페이지에 하나 — 삭제 후 행이 언마운트돼도 닫히는 확인창이 함께 사라지지 않게.
function CycleMobileActions({
  cycle,
  onClose,
  onEdit,
  onDelete,
}: {
  cycle: CycleResponse | null;
  onClose: () => void;
  onEdit: (c: CycleResponse | undefined) => void;
  onDelete: (c: CycleResponse) => void;
}) {
  const [deleteTarget, setDeleteTarget] = useState<CycleResponse | null>(null);
  return (
    <>
      <MobileActionSheet
        open={cycle != null}
        onClose={onClose}
        title={cycle?.name ?? ''}
        testId="cycle-sheet"
        actions={[
          {
            key: 'edit',
            label: '수정',
            icon: <Pencil />,
            // 시트는 MobileActionSheet 가 먼저 닫는다 — 같은 클릭에서 기존 폼 다이얼로그를 연다.
            onSelect: () => onEdit(cycle ?? undefined),
          },
          { key: 'delete', label: '삭제', icon: <Trash2 />, destructive: true, onSelect: () => setDeleteTarget(cycle) },
        ]}
      />
      <DeleteConfirmDialog
        entityName="사이클"
        itemName={deleteTarget?.name ?? ''}
        open={deleteTarget != null}
        onOpenChange={(o) => { if (!o) setDeleteTarget(null); }}
        onConfirm={() => { if (deleteTarget) onDelete(deleteTarget); }}
      />
    </>
  );
}
