// 러너 중립 이벤트 유니온. Claude SDK/opencode 양쪽이 이 형태로 수렴한다.
// 기존 chat-parser/mail-parser/chat-progress-parser/wiki-delta-parser 의 SDKMessage 판별 로직을
// 그대로 이식해 provider-neutral 한 어휘로 정규화한다. 이 모듈 자체는 아무도 소비하지 않는다
// (소비는 후속 태스크에서 위젯 렌더링/진행 표시/채팅 스트리밍에 연결).

export interface RunnerUsage {
  inputTokens: number;
  outputTokens: number;
}

export type RunnerEvent =
  | { type: 'text_delta'; text: string; parentToolUseId: string | null } // 스트리밍 텍스트(라우터 vs 서브에이전트 구분용 parent)
  | { type: 'assistant_text'; text: string } // assistant 메시지의 완성 text 블록(collect 폴백)
  | { type: 'tool_use'; name: string; input: unknown; parentToolUseId: string | null } // 도구 호출 등장(위젯·위임 감지)
  | { type: 'tool_done' } // 도구 완료 근사(진행표시)
  | { type: 'result'; ok: boolean; text: string | null; usage: RunnerUsage | null }; // 종료

// result 이벤트의 usage 객체에서 토큰 수를 추출. snake_case(input_tokens)/camelCase(inputTokens) 양쪽 허용.
// 형식 불명/누락 시 null (chat-parser.extractUsage 와 동일 규칙).
function extractUsage(u: unknown): RunnerUsage | null {
  if (!u || typeof u !== 'object') return null;
  const uu = u as Record<string, unknown>;
  const inp = uu.input_tokens ?? uu.inputTokens;
  const out = uu.output_tokens ?? uu.outputTokens;
  if (typeof inp !== 'number' || typeof out !== 'number') return null;
  return { inputTokens: inp, outputTokens: out };
}

interface ContentBlock {
  type?: string;
  text?: string;
  name?: string;
  input?: unknown;
}

// Claude SDKMessage(JSON.parse 된 객체) → RunnerEvent[] (해당 없으면 빈 배열).
export function mapSdkMessage(o: unknown): RunnerEvent[] {
  if (!o || typeof o !== 'object') return [];
  const obj = o as {
    type?: string;
    parent_tool_use_id?: unknown;
    event?: { type?: string; delta?: { type?: string; text?: unknown } };
    message?: { content?: unknown };
    subtype?: string;
    result?: unknown;
    usage?: unknown;
  };

  // stream_event: content_block_delta/text_delta 만 텍스트 델타로 취급(thinking_delta 등은 버림).
  // parent_tool_use_id 는 라우터(null) vs 서브에이전트(값) 구분용으로 그대로 보존한다.
  if (obj.type === 'stream_event') {
    const d = obj.event?.delta;
    if (obj.event?.type === 'content_block_delta' && d?.type === 'text_delta' && typeof d.text === 'string') {
      const parentToolUseId = obj.parent_tool_use_id == null ? null : String(obj.parent_tool_use_id);
      return [{ type: 'text_delta', text: d.text, parentToolUseId }];
    }
    return [];
  }

  // assistant: content[] 를 순회하며 tool_use → tool_use 이벤트, text → assistant_text 이벤트.
  if (obj.type === 'assistant' && obj.message && Array.isArray(obj.message.content)) {
    const events: RunnerEvent[] = [];
    const parentToolUseId = obj.parent_tool_use_id == null ? null : String(obj.parent_tool_use_id);
    for (const raw of obj.message.content as ContentBlock[]) {
      if (!raw || typeof raw !== 'object') continue;
      if (raw.type === 'tool_use' && typeof raw.name === 'string') {
        events.push({ type: 'tool_use', name: raw.name, input: raw.input, parentToolUseId });
      } else if (raw.type === 'text' && typeof raw.text === 'string' && raw.text.trim()) {
        events.push({ type: 'assistant_text', text: raw.text.trim() });
      }
    }
    return events;
  }

  // user: tool_result 블록 존재 여부만 본다(내용은 무시, 진행표시용 근사).
  if (obj.type === 'user' && obj.message && Array.isArray(obj.message.content)) {
    const hasResult = (obj.message.content as ContentBlock[]).some((b) => b?.type === 'tool_result');
    return hasResult ? [{ type: 'tool_done' }] : [];
  }

  // result: 종료 이벤트. subtype==='success' 를 ok 판정으로, result 필드를 text 로 사용.
  if (obj.type === 'result') {
    const ok = obj.subtype === 'success';
    const text = typeof obj.result === 'string' ? obj.result : null;
    const usage = extractUsage(obj.usage);
    return [{ type: 'result', ok, text, usage }];
  }

  return [];
}

// collect 경로 공용: result.text 우선, 없으면 assistant_text join (기존 extractResultText 의미 보존).
export function finalText(events: RunnerEvent[]): string {
  const resultEvent = events.find((e): e is Extract<RunnerEvent, { type: 'result' }> => e.type === 'result');
  if (resultEvent?.text != null) return resultEvent.text.trim();
  const textParts = events
    .filter((e): e is Extract<RunnerEvent, { type: 'assistant_text' }> => e.type === 'assistant_text')
    .map((e) => e.text);
  return textParts.join('\n').trim();
}

// result 이벤트의 usage 를 반환(없으면 null).
export function finalUsage(events: RunnerEvent[]): RunnerUsage | null {
  const resultEvent = events.find((e): e is Extract<RunnerEvent, { type: 'result' }> => e.type === 'result');
  return resultEvent?.usage ?? null;
}
