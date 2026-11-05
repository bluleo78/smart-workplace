// 만들기 창의 「AI 에게 맡기기」(WP-1315) — 데스크톱 대화상자(마감일 아래)와 모바일 시트(설명 아래)가 같이 쓴다.
// 늘 보이는 한 줄 「🤖 AI 에게 맡기기 — 안 함 ▸」. 누르면 펼쳐 담당 AI·실행 일정(한 번만·매일·평일·매주·매월·몇 시간마다 + 시각)·다음 실행 미리보기·안내를
// 보이고, 정하면 줄이 「내 AI 비서 · ↻ 평일 08:30」 요약이 된다. 일정 칸은 이슈 상세의 편집기와 같은 TaskRecurrenceScheduleFields 다.
// 사람의 반복 할 일처럼 보이지 않게 「반복」 대신 「실행 일정」이라 부른다(설계 §4).
import { Bot, ChevronDown, ChevronRight } from 'lucide-react';

import { TaskRecurrenceScheduleFields } from '@/components/issue/recurrence/TaskRecurrenceScheduleFields';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/overlay/select';
import { agentOptionLabel, createHandoffSummary, nextRunText, previewNextRun } from '@/lib/issueRecurrence';
import { cn } from '@/lib/utils';

import type { CreateAiHandoff } from '../hooks/useCreateAiHandoff';

export function CreateAiHandoffSection({ ai, disabled = false }: { ai: CreateAiHandoff; disabled?: boolean }) {
  const summary = ai.active ? createHandoffSummary(ai.agent, ai.form) : ai.loading ? '불러오는 중…' : '안 함';
  const preview = nextRunText(previewNextRun(ai.form)?.toISOString());
  const noAgent = ai.agents.isSuccess && ai.options.length === 0;
  return (
    <div className="rounded-md border" data-testid="create-ai-handoff">
      <button
        type="button"
        aria-expanded={ai.expanded}
        aria-controls="create-ai-handoff-panel"
        disabled={disabled}
        onClick={ai.toggle}
        className="flex min-h-11 w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent/50 disabled:opacity-60"
        data-testid="create-ai-handoff-toggle"
      >
        <Bot className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        <span className="shrink-0 font-medium">AI 에게 맡기기</span>
        <span className={cn('ml-auto min-w-0 truncate', ai.active ? 'text-foreground' : 'text-muted-foreground')} data-testid="create-ai-handoff-summary">
          {summary}
        </span>
        {ai.expanded ? <ChevronDown className="h-4 w-4 shrink-0" aria-hidden /> : <ChevronRight className="h-4 w-4 shrink-0" aria-hidden />}
      </button>

      {ai.expanded && (
        <div id="create-ai-handoff-panel" className="space-y-3 border-t px-3 py-3" data-testid="create-ai-handoff-panel">
          {/* 담당 AI — 이 프로젝트에서 서버가 실행하는 AI(내 AI 비서가 맨 앞, 남의 개인 비서는 없음, WP-1314 규칙). */}
          <div className="space-y-1">
            <span className="text-xs font-medium text-muted-foreground">담당 AI</span>
            {ai.agents.isError ? (
              <p role="alert" className="text-xs text-destructive">
                맡길 수 있는 AI 를 불러오지 못했어요
              </p>
            ) : noAgent ? (
              <p className="text-xs text-muted-foreground" data-testid="create-ai-handoff-no-agent">
                맡길 수 있는 AI 가 없습니다. 서버가 실행하는 AI 를 프로젝트 구성원으로 넣어 주세요.
              </p>
            ) : (
              <Select
                value={ai.agentId == null ? '' : String(ai.agentId)}
                onValueChange={(v) => ai.setAgentId(Number(v))}
                disabled={disabled || ai.loading}
              >
                <SelectTrigger className="h-8 w-full" aria-label="담당 AI" aria-busy={ai.loading} data-testid="create-ai-handoff-agent">
                  <SelectValue placeholder="불러오는 중…" />
                </SelectTrigger>
                <SelectContent>
                  {ai.options.map((o) => (
                    <SelectItem key={o.id} value={String(o.id)}>
                      {agentOptionLabel(o)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          <TaskRecurrenceScheduleFields
            form={ai.form}
            onChange={ai.patch}
            variant="create"
            locked={disabled}
            timeHint={
              preview ? (
                <>
                  한국 시간 · <span data-testid="create-ai-handoff-next">{preview}</span>
                </>
              ) : undefined
            }
          />

          {ai.error && (
            <p role="alert" className="text-xs text-destructive" data-testid="create-ai-handoff-error">
              {ai.error}
            </p>
          )}

          <p className="text-xs text-muted-foreground">설명이 AI 에게 주는 지시가 됩니다. 확인받을 일도 설명에 적어 주세요.</p>
          {/* 한 번만 + 만들고 지금 실행 = 지금 테스트 실행 한 번 + 정한 시각의 실행 한 번 — 두 번 도는 것을 미리 알린다. */}
          {ai.form.freq === 'ONCE' && (
            <p className="text-xs text-muted-foreground" data-testid="create-ai-handoff-once-hint">
              만들고 지금 실행하면 지금 테스트 실행을 한 번 하고, 정한 시각에 한 번 더 실행합니다.
            </p>
          )}

          <button
            type="button"
            disabled={disabled}
            onClick={ai.turnOff}
            className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline disabled:opacity-50"
          >
            맡기지 않기
          </button>
        </div>
      )}
    </div>
  );
}
