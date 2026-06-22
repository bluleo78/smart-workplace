// 7b: claude CLI stream-json(NDJSON 파싱 객체 배열) → 홈 레이아웃 스펙 {message, widgets[]}.
// show_* tool_use 를 등장 순서대로 위젯으로, result/assistant text 를 message 로 수집한다.

export interface Widget {
  type: string;
  params: Record<string, unknown>;
  layout?: Record<string, unknown>;
}

// #432: claude CLI result 이벤트의 토큰 사용량(LLM 인증 비용 가시화용).
export interface Usage {
  inputTokens: number;
  outputTokens: number;
}

export interface ComposeResult {
  message: string;
  widgets: Widget[];
  usage: Usage | null;
}

// #432: result 이벤트의 usage 객체에서 토큰 수를 추출. CLI 는 snake_case(input_tokens)로 내보내지만
// 변형 대비 camelCase 도 허용한다. 형식 불명/누락 시 null.
function extractUsage(obj: { usage?: unknown }): Usage | null {
  const u = obj.usage;
  if (!u || typeof u !== 'object') return null;
  const uu = u as Record<string, unknown>;
  const inp = uu.input_tokens ?? uu.inputTokens;
  const out = uu.output_tokens ?? uu.outputTokens;
  if (typeof inp !== 'number' || typeof out !== 'number') return null;
  return { inputTokens: inp, outputTokens: out };
}

// 'mcp__workplace__show_issue_list' / 'show_issue_list' → 'issue_list'. show_* 가 아니면 null.
function widgetTypeFromToolName(name: unknown): string | null {
  if (typeof name !== 'string') return null;
  const m = name.match(/show_([a-z_]+)$/);
  return m ? m[1] : null;
}

interface ContentBlock {
  type?: string;
  text?: string;
  name?: string;
  input?: { params?: unknown; layout?: unknown };
}

// 단일 stream-json 이벤트 객체를 누적기에 반영.
function handleEvent(ev: unknown, widgets: Widget[], textParts: string[]): string | null {
  if (!ev || typeof ev !== 'object') return null;
  const obj = ev as { type?: string; result?: unknown; message?: { content?: unknown } };

  // 종료 이벤트: 최종 텍스트.
  if (obj.type === 'result') {
    return typeof obj.result === 'string' ? obj.result : null;
  }

  // assistant: content[] 에서 tool_use(show_*) → 위젯, text → message 후보.
  if (obj.type === 'assistant' && obj.message && Array.isArray(obj.message.content)) {
    for (const raw of obj.message.content as ContentBlock[]) {
      if (!raw || typeof raw !== 'object') continue;
      if (raw.type === 'tool_use') {
        const wtype = widgetTypeFromToolName(raw.name);
        if (!wtype) continue;
        const input = raw.input ?? {};
        const widget: Widget = {
          type: wtype,
          params: (input.params as Record<string, unknown>) ?? {},
        };
        if (input.layout != null) widget.layout = input.layout as Record<string, unknown>;
        widgets.push(widget);
      } else if (raw.type === 'text' && typeof raw.text === 'string' && raw.text.trim()) {
        textParts.push(raw.text.trim());
      }
    }
  }
  return null;
}

export function parseCompose(events: unknown[]): ComposeResult {
  const widgets: Widget[] = [];
  const textParts: string[] = [];
  let resultText: string | null = null;
  let usage: Usage | null = null;
  for (const ev of events) {
    const r = handleEvent(ev, widgets, textParts);
    if (r != null) resultText = r;
    // #432: 종료(result) 이벤트의 토큰 사용량 수집(마지막 값 사용).
    if (ev && typeof ev === 'object' && (ev as { type?: string }).type === 'result') {
      const u = extractUsage(ev as { usage?: unknown });
      if (u) usage = u;
    }
  }
  const message = (resultText ?? textParts.join('\n')).trim();
  return { message, widgets, usage };
}

// #463: 라우터 자기 텍스트(text_delta)만 추출. parent_tool_use_id 가 null 인 stream_event 의
//   content_block_delta/text_delta 텍스트를 반환. 서브에이전트 누수(parent 설정)·비-text 는 null.
//   이 필터가 없으면 위임 중 서브에이전트 내부 prose 가 사용자에게 노출된다(이중 답변 위험).
export function extractRouterTextDelta(obj: unknown): string | null {
  if (!obj || typeof obj !== 'object') return null;
  const o = obj as {
    type?: string;
    parent_tool_use_id?: unknown;
    event?: { type?: string; delta?: { type?: string; text?: unknown } };
  };
  if (o.type !== 'stream_event' || o.parent_tool_use_id != null) return null;
  const d = o.event?.delta;
  if (o.event?.type !== 'content_block_delta' || d?.type !== 'text_delta') return null;
  return typeof d.text === 'string' && d.text ? d.text : null;
}

// NDJSON 문자열 라인 배열을 안전 파싱(잘못된 줄 건너뜀) 후 parseCompose.
export function parseComposeLines(lines: string[]): ComposeResult {
  const events: unknown[] = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    try {
      events.push(JSON.parse(t));
    } catch {
      // 비 JSON 줄 무시
    }
  }
  return parseCompose(events);
}
