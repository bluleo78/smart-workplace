// AI 도구 호출/위임 단계를 어시스턴트 버블 안에 중첩 렌더.
// 위임(delegation)은 헤더, 이후 도구(tool)는 그 아래 들여쓰기. 도착 순서가 인과 순서.
import { getToolDetail, getToolDisplay, visibleSteps } from '@/lib/aiToolLabels';
import type { ToolStep } from '@/types/home';

function StatusMark({ status }: { status?: ToolStep['status'] }) {
  if (status === 'error') return <span className="ml-auto shrink-0 text-destructive">✗ 실패</span>;
  if (status === 'done') return <span className="ml-auto shrink-0 text-muted-foreground">✓</span>;
  return <span className="ml-auto shrink-0 animate-pulse text-muted-foreground">실행 중…</span>;
}

export function ToolStepList({ steps }: { steps: ToolStep[] }) {
  const vis = visibleSteps(steps);
  if (vis.length === 0) return null;
  return (
    <ul className="mb-1 space-y-0.5 text-xs text-muted-foreground" data-testid="tool-step-list">
      {vis.map((s, i) => {
        if (s.kind === 'delegation') {
          return (
            <li key={i} className="flex items-center gap-1.5 font-medium text-foreground/80" data-testid="tool-step-delegation">
              <span>🤖</span>
              <span>{s.label}</span>
            </li>
          );
        }
        const { label, icon } = getToolDisplay(s.toolName ?? '');
        const detail = getToolDetail(s.toolName ?? '', s.args);
        return (
          <li key={i} className="flex items-center gap-1.5 pl-4" data-testid="tool-step-tool">
            <span>{icon}</span>
            <span>{label}</span>
            {detail && <span className="truncate text-muted-foreground/70">{detail}</span>}
            <StatusMark status={s.status} />
          </li>
        );
      })}
    </ul>
  );
}
