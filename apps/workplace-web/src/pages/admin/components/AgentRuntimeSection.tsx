// 실행 방식(내부·외부) 선택 섹션 — 세그먼트 컨트롤 + 방식별 설명.
// 공통·개인 비서는 서버에서 AI Chat 을 돌려야 하므로 비활성화하고 이유를 보인다.

import { useSetAgentRuntime } from '../../../hooks/queries/useAgents';
import {
  isRuntimeLocked,
  RUNTIME_LOCKED_REASON,
  RUNTIME_OPTIONS,
  runtimeDescription,
} from '../../../lib/agentRuntime';
import { cn } from '../../../lib/utils';
import type { AgentResponse } from '../../../types/agent';

export function AgentRuntimeSection({ agent }: { agent: AgentResponse }) {
  const setRuntime = useSetAgentRuntime();
  const locked = isRuntimeLocked(agent.type);

  return (
    <div className="space-y-2" data-testid="agent-runtime-section">
      <h3 className="text-sm font-medium">실행 방식</h3>
      {/* 세그먼트 컨트롤 — 모바일에서는 세로로 쌓여 가로 넘침을 막는다. */}
      <div
        role="radiogroup"
        aria-label="실행 방식"
        className="grid grid-cols-1 gap-1 rounded-md bg-muted p-1 sm:grid-cols-2"
      >
        {RUNTIME_OPTIONS.map((o) => {
          const checked = agent.runtime === o.value;
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={checked}
              disabled={locked || setRuntime.isPending}
              data-testid={`agent-runtime-${o.value}`}
              onClick={() => {
                if (!checked) setRuntime.mutate({ userId: agent.id, runtime: o.value });
              }}
              className={cn(
                'rounded px-3 py-1.5 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-60',
                checked
                  ? 'bg-background font-medium text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {o.label}
            </button>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground" data-testid="agent-runtime-description">
        {locked ? RUNTIME_LOCKED_REASON : runtimeDescription(agent.runtime)}
      </p>
    </div>
  );
}
