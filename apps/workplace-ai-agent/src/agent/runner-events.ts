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
  // WP-1407: 모델 호출 한 단계가 끝남(회차 실행 기록용). opencode 는 assistant 메시지의 생성·완료 시각과 토큰을 싣고,
  // Claude 는 assistant 메시지 하나를 모델 호출 하나로 보고 시각 없이(null — 기록기가 이벤트 경계로 계산) 낸다. 자식 세션·서브에이전트면 parent 가 있다.
  | {
      type: 'model_step';
      startedAt: number | null;
      endedAt: number | null;
      inputTokens: number | null;
      outputTokens: number | null;
      parentToolUseId: string | null;
    }
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
// seenModelMessageIds(WP-1407): 한 실행 동안 model_step 을 낸 API 메시지 id — SDK 는 API 메시지 하나를 내용 블록마다 같은 id·usage 의
// assistant 메시지로 나눠 보내므로, 실행마다 집합 하나를 넘겨 model_step 을 API 메시지당 한 번만 낸다(호출·토큰을 여러 번 세지 않게).
export function mapSdkMessage(o: unknown, seenModelMessageIds: Set<string>): RunnerEvent[] {
  if (!o || typeof o !== 'object') return [];
  const obj = o as {
    type?: string;
    parent_tool_use_id?: unknown;
    event?: { type?: string; delta?: { type?: string; text?: unknown } };
    message?: { content?: unknown; id?: unknown; usage?: unknown };
    subtype?: string;
    is_error?: unknown;
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
  // WP-1407: assistant 메시지 하나 = 모델 호출 하나 — 내용 이벤트보다 먼저 model_step 을 낸다(기록기가 「모델 응답을 받았다」를 먼저 보게).
  if (obj.type === 'assistant' && obj.message && Array.isArray(obj.message.content)) {
    const parentToolUseId = obj.parent_tool_use_id == null ? null : String(obj.parent_tool_use_id);
    const events: RunnerEvent[] = [];
    const messageId = typeof obj.message.id === 'string' ? obj.message.id : null;
    if (!messageId || !seenModelMessageIds.has(messageId)) {
      if (messageId) seenModelMessageIds.add(messageId);
      const usage = extractUsage(obj.message.usage);
      events.push({
        type: 'model_step',
        startedAt: null,
        endedAt: null,
        inputTokens: usage?.inputTokens ?? null,
        outputTokens: usage?.outputTokens ?? null,
        parentToolUseId,
      });
    }
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

  // user: tool_result 블록마다 tool_done 하나(내용은 무시). WP-1407: 병렬 도구 결과가 한 메시지에 여럿 오면 그 수만큼 낸다 — opencode 러너(도구마다
  // 하나)와 같게, 진행 표시는 도는 단계를 결과 수만큼 끝내고 실행 기록은 도는 도구 수를 0 으로 되돌린다.
  if (obj.type === 'user' && obj.message && Array.isArray(obj.message.content)) {
    return (obj.message.content as ContentBlock[])
      .filter((b) => b?.type === 'tool_result')
      .map((): RunnerEvent => ({ type: 'tool_done' }));
  }

  // result: 종료 이벤트. subtype==='success' 를 ok 판정으로, result 필드를 text 로 사용.
  // WP-1407: success 여도 is_error 가 true 면(제공자 오류 문구가 result 로 옴 — WP-1347) 실패로 본다 — 오류 문구를 성공 결과로 쓰지 않게.
  if (obj.type === 'result') {
    const ok = obj.subtype === 'success' && obj.is_error !== true;
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

// 실행이 성공으로 끝났는지 — result 이벤트가 있고 ok 일 때만 true. result 가 없으면(중단·타임아웃) 실패로 본다.
// finalText 는 실패 실행의 부분 텍스트도 돌려주므로, 결과를 저장하는 호출자(누적 요약 등)는 이걸 먼저 확인한다.
export function resultOk(events: RunnerEvent[]): boolean {
  const resultEvent = events.find((e): e is Extract<RunnerEvent, { type: 'result' }> => e.type === 'result');
  return resultEvent?.ok === true;
}
