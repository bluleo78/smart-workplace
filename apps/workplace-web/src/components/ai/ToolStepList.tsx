// AI 도구 호출/위임 단계를 어시스턴트 버블 안에 중첩 렌더.
// 위임(delegation)은 헤더, 이후 도구(tool)는 그 아래 들여쓰기. 도착 순서가 인과 순서.
// 위임 없이 바로 부른 도구(메모리·지난 대화 찾기 등)는 들여 쓰지 않아 본문 왼쪽 선에 맞추고, 상태(✓·실행 중…)는 라벨 바로 뒤에 둔다
// — 말풍선 오른쪽 끝으로 밀면 넓은 패널에서 라벨과 멀리 떨어져 어느 단계의 상태인지 읽히지 않는다(WP-384 UI 리뷰).
import { getToolStepDisplay, visibleSteps } from '@/lib/aiToolLabels';
import { cn } from '@/lib/utils';
import type { ToolStep } from '@/types/home';

function StatusMark({ status }: { status?: ToolStep['status'] }) {
  if (status === 'error') return <span className="shrink-0 text-destructive">✗ 실패</span>;
  if (status === 'done') return <span className="shrink-0 text-muted-foreground">✓</span>;
  return <span className="shrink-0 animate-pulse text-muted-foreground">실행 중…</span>;
}

/**
 * @param inDelegation 앞 그룹에서 위임이 이미 시작됐다 — 메모리 결과 줄 등으로 끊겨 이어지는 그룹도 위임 아래로 들여 쓴다.
 */
export function ToolStepList({ steps, inDelegation = false }: { steps: ToolStep[]; inDelegation?: boolean }) {
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
        const { label, icon, detail } = getToolStepDisplay(s.toolName ?? '', s.args);
        // 앞에(이 그룹이나 앞 그룹에) 위임 헤더가 있을 때만 그 아래로 들여 쓴다.
        const nested = inDelegation || vis.slice(0, i).some((p) => p.kind === 'delegation');
        return (
          <li key={i} className={cn('flex items-center gap-1.5', nested && 'pl-4')} data-testid="tool-step-tool">
            <span>{icon}</span>
            <span>{label}</span>
            {detail && <span className="truncate text-muted-foreground">{detail}</span>}
            <StatusMark status={s.status} />
          </li>
        );
      })}
    </ul>
  );
}
