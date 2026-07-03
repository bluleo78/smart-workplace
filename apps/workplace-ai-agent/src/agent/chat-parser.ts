// 러너 중립 RunnerEvent 배열 → 홈 레이아웃 스펙 {widgets[], usage}.
// show_* tool_use 를 등장 순서대로 위젯으로, 종료(result) 이벤트에서 토큰 사용량을 수집한다.
// 텍스트/메시지는 여기서 산출하지 않는다 — run-ai-chat 가 streamedText·subagent 답으로 직접 결정한다.
import type { RunnerEvent } from './runner-events.js';

export interface Widget {
  type: string;
  params: Record<string, unknown>;
  layout?: Record<string, unknown>;
}

// #432: result 이벤트의 토큰 사용량(LLM 인증 비용 가시화용).
export interface Usage {
  inputTokens: number;
  outputTokens: number;
}

export interface ChatResult {
  message: string;
  widgets: Widget[];
  usage: Usage | null;
}

// 'mcp__workplace__show_issue_list' / 'show_issue_list' → 'issue_list'. show_* 가 아니면 null.
function widgetTypeFromToolName(name: unknown): string | null {
  if (typeof name !== 'string') return null;
  const m = name.match(/show_([a-z_]+)$/);
  return m ? m[1] : null;
}

// RunnerEvent[] 를 순회하며 tool_use(show_*) → 위젯, result → 토큰 사용량을 수집한다.
// (Agent 위임·mcp 읽기 도구 등 show_* 가 아닌 tool_use 는 위젯이 아니므로 무시.)
export function parseChatEvents(events: RunnerEvent[]): { widgets: Widget[]; usage: Usage | null } {
  const widgets: Widget[] = [];
  let usage: Usage | null = null;
  for (const ev of events) {
    if (ev.type === 'tool_use') {
      const wtype = widgetTypeFromToolName(ev.name);
      if (!wtype) continue;
      const input = (ev.input ?? {}) as { params?: unknown; layout?: unknown };
      const widget: Widget = {
        type: wtype,
        params: (input.params as Record<string, unknown>) ?? {},
      };
      if (input.layout != null) widget.layout = input.layout as Record<string, unknown>;
      widgets.push(widget);
    } else if (ev.type === 'result') {
      // #432: 종료 이벤트의 토큰 사용량 수집(마지막 값 사용). mapSdkMessage 가 이미 snake/camel 정규화.
      if (ev.usage) usage = { inputTokens: ev.usage.inputTokens, outputTokens: ev.usage.outputTokens };
    }
  }
  return { widgets, usage };
}
