// 버전 진행 막대(WP-888) — 수정 버전 이슈를 완료·진행 중·할 일로 쌓아 그린다. 취소는 서버가 완료로 센다.
// 목록은 compact(막대 + 「완료/전체」 한 줄), 상세는 막대 + 범례.
import { completionPct } from '../../../lib/progress';
import type { VersionProgress } from '../../../types/version';

export function VersionProgressBar({
  progress,
  compact = false,
  testId,
}: {
  progress: VersionProgress;
  compact?: boolean;
  testId?: string;
}) {
  const { done, inProgress, todo } = progress;
  const total = done + inProgress + todo;
  const pct = completionPct(done, total);
  const seg = (n: number) => ({ width: `${(n / total) * 100}%` });

  const bar =
    total === 0 ? null : (
      <div className="flex h-1.5 w-full overflow-hidden rounded bg-muted" aria-hidden="true">
        {done > 0 && <div className="bg-success" style={seg(done)} />}
        {inProgress > 0 && <div className="bg-info" style={seg(inProgress)} />}
      </div>
    );

  if (compact) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground" data-testid={testId}>
        {total === 0 ? (
          <span>이슈 없음</span>
        ) : (
          <>
            <div className="w-16 sm:w-24">{bar}</div>
            <span className="tabular-nums" title={`${pct}%`}>
              {done}/{total}
            </span>
            <span className="sr-only">완료 ({pct}%)</span>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2" data-testid={testId}>
      {total === 0 ? (
        <p className="text-sm text-muted-foreground">이 버전에 나가는 이슈가 아직 없어요.</p>
      ) : (
        <>
          <div className="flex items-center gap-3">
            <div className="flex-1">{bar}</div>
            <span className="text-sm tabular-nums">
              {done}/{total} · {pct}%
            </span>
          </div>
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <li className="flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-success" aria-hidden /> 완료 {done}
            </li>
            <li className="flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-info" aria-hidden /> 진행 중 {inProgress}
            </li>
            <li className="flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-muted-foreground/40" aria-hidden /> 할 일 {todo}
            </li>
          </ul>
        </>
      )}
    </div>
  );
}
