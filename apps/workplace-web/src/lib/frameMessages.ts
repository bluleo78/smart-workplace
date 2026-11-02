/**
 * iframe 창별 message 받기(WP-1301) — 창 message 듣기를 화면마다가 아니라 모듈에 하나만 두고, 보낸 창(event.source)으로 처리기를 찾는다.
 * 노트 HTML 블록의 높이 보고(wikiHtmlEmbedFrame)와 요소 고르기(useHtmlPicker)가 함께 쓴다 — 블록이 많은 노트에서 메시지마다 모든 블록이 깨지 않게.
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
