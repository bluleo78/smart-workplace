// 프로젝트 사이클 관리 — 목록 + 진행 막대 + 생성/수정/삭제.
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { DeleteConfirmDialog } from '@/components/ui/delete-confirm-dialog';

import { CycleFormDialog } from '../../components/cycle/CycleFormDialog';
import { CycleProgressBar } from '../../components/cycle/CycleProgressBar';
import { useCycleProgress, useCycles, useDeleteCycle } from '../../hooks/queries/useCycles';
import { CYCLE_STATUS_LABEL } from '../../types/cycle';
import type { CycleProgress, CycleResponse } from '../../types/cycle';

export default function CyclesPage() {
  const { key = '' } = useParams();
  const cycles = useCycles(key);
  const progress = useCycleProgress(key);
  const del = useDeleteCycle(key);
  const [editing, setEditing] = useState<CycleResponse | undefined>();
  const [open, setOpen] = useState(false);

  const progressById = useMemo(() => {
    const m = new Map<number, CycleProgress>();
    (progress.data ?? []).forEach((p) => m.set(p.cycleId, p));
    return m;
  }, [progress.data]);

  return (
    <div className="mx-auto max-w-3xl p-6" data-testid="cycles-page">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">사이클</h1>
        <Button
          size="sm"
          onClick={() => {
            setEditing(undefined);
            setOpen(true);
          }}
          data-testid="cycle-new"
        >
          <Plus className="mr-1 h-4 w-4" /> 새 사이클
        </Button>
      </div>

      <ul className="space-y-3">
        {(cycles.data ?? []).map((c) => (
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
        ))}
        {(cycles.data?.length ?? 0) === 0 && (
          <li className="rounded border border-dashed p-8 text-center text-sm text-muted-foreground">
            아직 사이클이 없습니다.
          </li>
        )}
      </ul>

      <CycleFormDialog projectKey={key} cycle={editing} open={open} onOpenChange={setOpen} />
    </div>
  );
}
