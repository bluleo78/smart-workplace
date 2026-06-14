/** Claude Agent SDK stream-json partial 메시지에서 화면용 text 토큰 델타만 추출한다.
 *  thinking_delta·signature_delta(추론 과정)는 의도적으로 버린다. 모양은 실측 캡처 기준:
 *  {"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"..."}}} */
export function extractTextDelta(o: unknown): string | null {
  const e = o as {
    type?: string;
    event?: { type?: string; delta?: { type?: string; text?: string } };
  };
  if (
    e?.type === 'stream_event' &&
    e.event?.type === 'content_block_delta' &&
    e.event.delta?.type === 'text_delta' &&
    typeof e.event.delta.text === 'string'
  ) {
    return e.event.delta.text;
  }
  return null; // thinking_delta·signature_delta·result·기타 무시
}
