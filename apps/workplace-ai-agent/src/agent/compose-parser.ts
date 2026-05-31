// 7b: claude CLI stream-json(NDJSON 파싱 객체 배열) → 홈 레이아웃 스펙 {message, widgets[]}.
// show_* tool_use 를 등장 순서대로 위젯으로, result/assistant text 를 message 로 수집한다.

export interface Widget {
  type: string;
  params: Record<string, unknown>;
  layout?: Record<string, unknown>;
}

export interface ComposeResult {
  message: string;
  widgets: Widget[];
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
  for (const ev of events) {
    const r = handleEvent(ev, widgets, textParts);
    if (r != null) resultText = r;
  }
  const message = (resultText ?? textParts.join('\n')).trim();
  return { message, widgets };
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
