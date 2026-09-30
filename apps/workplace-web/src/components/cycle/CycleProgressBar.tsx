// 사이클 진행 막대 — 상태별 누적(stacked) 바 + 완료율 텍스트.
import type { CycleProgress } from '../../types/cycle';

// DONE만 강조색을 갖고 나머지(TODO/IN_PROGRESS/CANCELED)는 트랙색으로 통일.
// (바의 채워진 비율이 항상 done/total 과 일치해야 아래 완료율 텍스트와 모순되지 않음 — #771)
const STATUS_COLOR: Record<string, string> = {
  DONE: 'bg-success',
};
const STATUS_ORDER = ['DONE', 'IN_PROGRESS', 'TODO', 'CANCELED'];

/**
 * @param compact 한 줄 표기(막대 + "38%") — 목록 사이클 구간 헤더처럼 높이를 한 줄로 맞춰야 하는 곳(#878).
 *   done/total 은 title·스크린리더 텍스트로 옮기고, 이슈가 없으면 막대 대신 "이슈 없음"을 보인다.
 *   기본(false)은 사이클 페이지의 기존 두 줄 표기.
 */
export function CycleProgressBar({
  progress,
  compact = false,
}: {
  progress: CycleProgress;
  compact?: boolean;
}) {
  const { total, done, byStatus } = progress;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const bar =
    total === 0
      ? null
      : STATUS_ORDER.filter((s) => byStatus[s]).map((s) => (
          <div
            key={s}
            className={STATUS_COLOR[s] ?? 'bg-muted-foreground/40'}
            style={{ width: `${((byStatus[s] ?? 0) / total) * 100}%` }}
            title={compact ? undefined : `${s}: ${byStatus[s]}`}
          />
        ));

  if (compact) {
    return (
      <div
        className="flex items-center gap-2 text-xs text-muted-foreground"
        data-testid={`cycle-progress-${progress.cycleId}`}
        title={total > 0 ? `${done}/${total} 완료` : undefined}
      >
        {total === 0 ? (
          <span>이슈 없음</span>
        ) : (
          <>
            <div className="flex h-1.5 w-12 overflow-hidden rounded bg-muted sm:w-20" aria-hidden="true">
              {bar}
            </div>
            <span className="tabular-nums" aria-hidden="true">
              {pct}%
            </span>
            <span className="sr-only">
              {done}/{total} 완료 ({pct}%)
            </span>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-1" data-testid={`cycle-progress-${progress.cycleId}`}>
      <div className="flex h-2 w-full overflow-hidden rounded bg-muted">{bar}</div>
      <div className="text-xs text-muted-foreground">
        {done}/{total} 완료 ({pct}%)
      </div>
    </div>
  );
}
