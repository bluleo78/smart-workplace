/**
 * iframe 창별 message 받기(WP-1301) — 창 message 듣기를 화면마다가 아니라 모듈에 하나만 두고, 보낸 창(event.source)으로 처리기를 찾는다.
 * 노트 HTML 블록의 높이 보고(wikiHtmlEmbedFrame)와 요소 고르기·글자 고치기(useFrameChannel)가 함께 쓴다 — 블록이 많은 노트에서 메시지마다 모든 블록이 깨지 않게.
 * 한 창에 처리기가 여럿 붙을 수 있다(높이 + 고르기). 처리기는 보낸 창이 그 iframe 인 메시지만 받으므로 따로 창을 가릴 필요가 없다.
 */
const watchers = new Map<Window, Set<(event: MessageEvent) => void>>()

function onWindowMessage(event: MessageEvent): void {
  const source = event.source as Window | null
  const handlers = source ? watchers.get(source) : undefined
  handlers?.forEach((handler) => handler(event))
}

/**
 * iframe 창이 보낸 message 를 받기 시작한다 — 돌려준 함수로 그만 받는다. 첫 등록 때 창 message 듣기를 붙이고, 마지막 해제 때 뗀다.
 * iframe 이 문서에 붙은 뒤(contentWindow 가 생긴 뒤) 부른다 — srcdoc 문서가 바뀌어도 같은 iframe 의 창 객체는 같다.
 */
export function watchFrameMessages(frameWindow: Window, handler: (event: MessageEvent) => void): () => void {
  if (watchers.size === 0) window.addEventListener('message', onWindowMessage)
  let handlers = watchers.get(frameWindow)
  if (!handlers) watchers.set(frameWindow, (handlers = new Set()))
  handlers.add(handler)
  return () => {
    const set = watchers.get(frameWindow)
    if (!set?.delete(handler)) return
    if (set.size === 0) watchers.delete(frameWindow)
    if (watchers.size === 0) window.removeEventListener('message', onWindowMessage)
  }
}

// ── 토큰 실은 iframe 메시지(봉투) — 요소 고르기(htmlPicker)·글자 고치기(htmlTextEdit)가 같은 꼴을 쓴다 ─────────────
//
// 격리 iframe 은 allow-same-origin 이 없는 불투명 출처라 origin 이 늘 "null" 이다 — 그래서 양쪽 모두 보낸 창(event.source)과
// iframe 마다 일회 토큰을 본다. 토큰은 그 iframe 의 srcdoc 에만 들어가므로 다른 iframe·다른 창은 같은 꼴을 보내도 무시된다.
// 같은 iframe 안 문서 스크립트는 토큰을 읽을 수 있다 — 받은 내용(data)은 iframe 문서와 같은 믿음 수준의 입력이라 부르는 쪽이 다시 가린다.

/**
 * 받은 message 가 이 iframe 창·이 종류·이 토큰의 봉투이면 그 data 를, 아니면 null.
 * 내용 꼴(필드 종류)은 부르는 쪽(htmlPickerEventFromMessage·htmlTextEditEventFromMessage)이 따로 가린다.
 */
export function frameMessageData(
  event: Pick<MessageEvent, 'source' | 'data'>,
  frameWindow: Window | null | undefined,
  type: string,
  token: string,
): Record<string, unknown> | null {
  if (!frameWindow || event.source !== frameWindow) return null
  const data = event.data as Record<string, unknown> | null
  if (!data || typeof data !== 'object' || data.type !== type || data.token !== token) return null
  return data
}

/** 부모 → iframe 명령 보내기 — 종류·토큰을 실어 보낸다(iframe 은 불투명 출처라 대상 출처는 '*'). */
export function postFrameMessage(frameWindow: Window, type: string, token: string, body: object): void {
  frameWindow.postMessage({ type, token, ...body }, '*')
}

/**
 * iframe 안 스크립트 머리 — TOKEN·TYPE 과 보내기(post: 종류·토큰을 실어 parent 로), 부모 명령 가리기(fromParent: 보낸 창이 parent 이고
 * 종류·토큰이 맞으면 data, 아니면 null). 스크립트마다 자기 즉시 실행 함수 안에 넣어 이름이 겹치지 않는다.
 * 토큰은 JSON 문자열로 넣되 < 를 풀어 쓴다 — 어떤 값이 와도 </script> 로 스크립트를 끊지 못하게.
 */
export function frameScriptPrelude(type: string, token: string): string {
  const literal = (v: string) => JSON.stringify(v).replace(/</g, '\\u003c')
  return (
    `var TOKEN=${literal(token)},TYPE=${literal(type)};` +
    "function post(m){m.type=TYPE;m.token=TOKEN;parent.postMessage(m,'*')}" +
    'function fromParent(e){var d=e.data;return e.source===parent&&d&&d.type===TYPE&&d.token===TOKEN?d:null}'
  )
}
