// 실행 방식 섹션 — 내부/외부 세그먼트 + (내부일 때) 실행 템플릿 카드. 작업 공간 템플릿이면 그 아래에 설정·상태(WP-1254).
// 작업 공간 템플릿으로 도는 AI 는 DB 에 EXTERNAL 로 저장되지만(서버 AI 가 이슈를 처리하지 않게) 화면에서는 「내부」다 — runtimeView.
// 공통·개인 비서는 서버에서 AI Chat 을 돌려야 하므로 외부·작업 공간 템플릿을 막고 이유를 보인다.

import { useState } from 'react';

import { DisabledReasonTooltip } from '@/components/ui/disabled-reason-tooltip';

import { useAgentRuntimeSetting, useAgentTemplates, useUseServerTemplate } from '../../../hooks/queries/useAgentRuntime';
import { useSetAgentRuntime } from '../../../hooks/queries/useAgents';
import {
  isRuntimeLocked,
  RUNTIME_LOCKED_REASON,
  RUNTIME_OPTIONS,
  runtimeDescription,
} from '../../../lib/agentRuntime';
import { runtimeView } from '../../../lib/agentRuntimeStatus';
import { cn } from '../../../lib/utils';
import type { AgentResponse } from '../../../types/agent';
import type { AgentTemplate } from '../../../types/agentRuntime';
import { AgentWorkspaceRuntime } from './AgentWorkspaceRuntime';

const STOP_FIRST = '켜져 있는 동안에는 바꿀 수 없어요. 먼저 끄세요.';

export function AgentRuntimeSection({ agent }: { agent: AgentResponse }) {
  const setRuntime = useSetAgentRuntime();
  const useServer = useUseServerTemplate(agent.id);
  const templates = useAgentTemplates();
  const setting = useAgentRuntimeSetting(agent.id);
  const locked = isRuntimeLocked(agent.type);
  // 아직 저장하지 않은 작업 공간 템플릿 선택 — 저장(또는 켜기) 전까지는 실행 방식을 바꾸지 않는다.
  const [draftTemplate, setDraftTemplate] = useState<string | null>(null);

  const saved = setting.data ?? null;
  const view = runtimeView(agent.runtime, saved != null);
  // 원하는 상태가 RUN 이면(실패 포함) 서버가 템플릿·실행 방식 변경을 409 로 막는다 — 화면도 같은 기준으로 막는다.
  const running = saved?.desired === 'RUN';
  const busy = setRuntime.isPending || useServer.isPending;
  const serverTemplate = templates.data?.find((t) => t.kind === 'SERVER');
  const selectedName = draftTemplate ?? saved?.templateName ?? serverTemplate?.name ?? null;
  const selected = templates.data?.find((t) => t.name === selectedName) ?? null;

  // 세그먼트 — 외부로 가면 실행 설정을 지운다(켜져 있으면 막힘). 내부로 오면 「기본」.
  const onPickRuntime = (value: 'INTERNAL' | 'EXTERNAL') => {
    if (value === view) return;
    setDraftTemplate(null);
    if (value === 'EXTERNAL' && saved) {
      useServer.mutate('EXTERNAL');
      return;
    }
    setRuntime.mutate({ userId: agent.id, runtime: value });
  };

  // 템플릿 카드 — 「기본」은 바로 반영(실행 설정 삭제 + INTERNAL), 작업 공간 템플릿은 아래 칸을 채운 뒤 저장할 때 반영.
  const onPickTemplate = (t: AgentTemplate) => {
    if (t.name === selectedName) return;
    if (t.kind === 'SERVER') {
      setDraftTemplate(null);
      if (saved) useServer.mutate('INTERNAL');
      return;
    }
    setDraftTemplate(t.name);
  };

  return (
    <div className="space-y-3" data-testid="agent-runtime-section">
      <div className="space-y-2">
        <h3 className="text-sm font-medium">실행 방식</h3>
        {/* 세그먼트 컨트롤 — 모바일에서는 세로로 쌓여 가로 넘침을 막는다. */}
        <div role="radiogroup" aria-label="실행 방식" className="grid grid-cols-1 gap-1 rounded-md bg-muted p-1 sm:grid-cols-2">
          {RUNTIME_OPTIONS.map((o) => {
            const checked = view === o.value;
            const blockedByRun = !checked && running;
            const button = (
              <button
                key={o.value}
                type="button"
                role="radio"
                aria-checked={checked}
                disabled={locked || busy || blockedByRun}
                data-testid={`agent-runtime-${o.value}`}
                onClick={() => onPickRuntime(o.value)}
                className={cn(
                  'w-full rounded px-3 py-1.5 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-60',
                  checked ? 'bg-background font-medium text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {o.label}
              </button>
            );
            return blockedByRun ? (
              <DisabledReasonTooltip key={o.value} reason={STOP_FIRST} className="block">
                {button}
              </DisabledReasonTooltip>
            ) : (
              button
            );
          })}
        </div>
        {/* 내부는 템플릿 카드가 설명을 대신한다 — 외부·잠김일 때만 한 줄. */}
        {(locked || view === 'EXTERNAL') && (
          <p className="text-xs text-muted-foreground" data-testid="agent-runtime-description">
            {locked ? RUNTIME_LOCKED_REASON : runtimeDescription('EXTERNAL')}
          </p>
        )}
      </div>

      {view === 'INTERNAL' && templates.data && (
        <div className="space-y-2">
          <h4 className="text-xs font-medium text-muted-foreground">템플릿</h4>
          <div role="radiogroup" aria-label="실행 템플릿" className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {templates.data.map((t) => {
              const checked = t.name === selectedName;
              // 작업 공간 템플릿은 EXTERNAL 로 저장되므로 공통·개인 비서는 고를 수 없다. 켜져 있는 동안엔 다른 템플릿으로 못 바꾼다.
              const reason = !checked && t.kind === 'WORKSPACE' && locked ? RUNTIME_LOCKED_REASON : !checked && running ? STOP_FIRST : null;
              const card = (
                <button
                  key={t.name}
                  type="button"
                  role="radio"
                  aria-checked={checked}
                  disabled={reason != null || busy}
                  data-testid={`agent-template-${t.name}`}
                  onClick={() => onPickTemplate(t)}
                  className={cn(
                    'flex h-full w-full flex-col items-start gap-1 rounded-md border px-3 py-2.5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60',
                    checked ? 'border-primary ring-1 ring-primary' : 'hover:bg-muted/50',
                  )}
                >
                  <span className="text-sm font-medium">{t.card.title}</span>
                  <span className="text-xs text-muted-foreground">{t.card.description}</span>
                  {t.card.skills.length > 0 && (
                    <span className="mt-0.5 flex flex-wrap gap-1">
                      {t.card.skills.map((s) => (
                        <span key={s} className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                          {s}
                        </span>
                      ))}
                    </span>
                  )}
                </button>
              );
              return reason ? (
                <DisabledReasonTooltip key={t.name} reason={reason} className="block">
                  {card}
                </DisabledReasonTooltip>
              ) : (
                card
              );
            })}
          </div>
        </div>
      )}

      {view === 'INTERNAL' && selected?.kind === 'WORKSPACE' && (
        <AgentWorkspaceRuntime
          key={`${agent.id}-${selected.name}`}
          agentId={agent.id}
          template={selected}
          saved={saved?.templateName === selected.name ? saved : null}
          onCancelDraft={draftTemplate ? () => setDraftTemplate(null) : undefined}
          onSaved={() => setDraftTemplate(null)}
        />
      )}
    </div>
  );
}
