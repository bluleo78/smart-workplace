// 사이클 진행 막대 — 상태별 누적(stacked) 바 + 완료율 텍스트.
import type { CycleProgress } from '../../types/cycle';

const STATUS_COLOR: Record<string, string> = {
  TODO: 'bg-muted-foreground/40',
  IN_PROGRESS: 'bg-blue-500',
  DONE: 'bg-green-500',
  CANCELED: 'bg-red-400',
};
const STATUS_ORDER = ['DONE', 'IN_PROGRESS', 'TODO', 'CANCELED'];

export function CycleProgressBar({ progress }: { progress: CycleProgress }) {
  const { total, done, byStatus } = progress;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <div className="space-y-1" data-testid={`cycle-progress-${progress.cycleId}`}>
      <div className="flex h-2 w-full overflow-hidden rounded bg-muted">
        {total === 0 ? null : (
          STATUS_ORDER.filter((s) => byStatus[s]).map((s) => (
            <div
              key={s}
              className={STATUS_COLOR[s] ?? 'bg-muted-foreground/40'}
              style={{ width: `${((byStatus[s] ?? 0) / total) * 100}%` }}
              title={`${s}: ${byStatus[s]}`}
            />
          ))
        )}
      </div>
      <div className="text-xs text-muted-foreground">
        {done}/{total} 완료 ({pct}%)
      </div>
    </div>
  );
}
