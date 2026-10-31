/**
 * 노트 HTML 블록(WP-1242) iframe 높이 맞추기 — 화면 없이 판정되는 순수 부분(문서 만들기·메시지 해석·높이 범위).
 *
 * 왜 iframe 이 높이를 알려 주는가: 격리 iframe 은 불투명 출처(sandbox 에 allow-same-origin 없음)라 부모가 contentDocument 를
 * 읽을 수 없다. 그래서 문서 끝에 작은 스크립트를 붙여, 안 문서가 자기 높이를 재 postMessage 로 부모에 보낸다.
 * 부모는 출처(origin 은 "null")가 아니라 보낸 창(event.source)이 그 iframe 의 contentWindow 인지로 가린다 — 다른 블록·다른 창이
 * 보낸 같은 꼴의 메시지는 받지 않는다. 받은 값은 범위로 자른다(안 스크립트가 아주 큰 값을 보내도 화면이 늘어나지 않게).
 */

/** 높이 메시지 종류 — 안 문서 스크립트와 부모가 같은 이름을 쓴다. */
export const HTML_EMBED_HEIGHT_MESSAGE = 'wp-html-embed-height'

/** 높이 보고가 오기 전 기본 높이(px). */
export const HTML_EMBED_DEFAULT_HEIGHT = 400
/** 높이 하한(px) — 빈 블록·한 줄짜리도 블록으로 보이게. */
export const HTML_EMBED_MIN_HEIGHT = 80
/** 높이 상한(px) — 넘으면 iframe 안에서 스크롤한다(100vh 같은 내용이 iframe 을 끝없이 키우지 않게). */
export const HTML_EMBED_MAX_HEIGHT = 1200

/**
 * 안 문서에 붙이는 높이 보고 스크립트.
 * - 잴 값: <html> 상자 높이(body 여백 포함, iframe 높이와 무관해 줄어들 수도 있다)와 body 의 스크롤 높이(넘친 자식) 중 큰 값.
 *   documentElement.scrollHeight 는 iframe 높이보다 작아지지 않아 한 번 커진 뒤 줄지 않으므로 쓰지 않는다.
 * - 언제: 처음, load(이미지·CDN 스크립트가 다 온 뒤), 그리고 ResizeObserver 가 html·body 크기 변화를 볼 때마다 — 프레임당 한 번으로 묶고
 *   값이 바뀔 때만 보낸다.
 * - 대상 출처 '*': 부모 출처를 안 문서가 알 수 없고(불투명 출처), 보내는 것은 높이 숫자뿐이라 숨길 것이 없다.
 * - 문서 끝에 붙인다 — 원문 앞(DOCTYPE 앞)에 두면 quirks 모드가 되고, </html> 뒤 스크립트도 파서가 body 끝으로 옮겨 실행한다.
 */
export const HTML_EMBED_HEIGHT_SCRIPT =
  '<script data-wp-html-embed-height>(function(){' +
  'var last=-1,queued=false;' +
  'function measure(){var d=document.documentElement,b=document.body;' +
  'return Math.ceil(Math.max(d.getBoundingClientRect().height,b?b.scrollHeight:0))}' +
  'function send(){queued=false;var h=measure();if(h===last)return;last=h;' +
  `parent.postMessage({type:'${HTML_EMBED_HEIGHT_MESSAGE}',height:h},'*')}` +
  'function schedule(){if(queued)return;queued=true;(window.requestAnimationFrame||setTimeout)(send)}' +
  'if(window.ResizeObserver){var ro=new ResizeObserver(schedule);ro.observe(document.documentElement);if(document.body)ro.observe(document.body)}' +
  "window.addEventListener('load',schedule);schedule()" +
  '})()</script>'

/** iframe 에 넣을 문서 — 블록 소스 뒤에 높이 보고 스크립트를 붙인다. 소스는 손대지 않는다. */
export function htmlEmbedDocument(source: string): string {
  return source + HTML_EMBED_HEIGHT_SCRIPT
}

/** 높이를 범위 안으로 — 숫자가 아니거나 유한하지 않으면 null(무시). */
export function clampEmbedHeight(height: unknown): number | null {
  if (typeof height !== 'number' || !Number.isFinite(height)) return null
  return Math.min(HTML_EMBED_MAX_HEIGHT, Math.max(HTML_EMBED_MIN_HEIGHT, Math.ceil(height)))
}

/**
 * 받은 message 이벤트가 이 iframe 의 높이 보고면 잘라낸 높이를, 아니면 null.
 * 보낸 창이 이 iframe 의 contentWindow 일 때만 받는다 — origin 은 불투명 출처라 늘 "null" 이어서 가릴 수 없다.
 */
export function embedHeightFromMessage(
  event: Pick<MessageEvent, 'source' | 'data'>,
  frameWindow: Window | null | undefined,
): number | null {
  if (!frameWindow || event.source !== frameWindow) return null
  const data = event.data as { type?: unknown; height?: unknown } | null
  if (!data || typeof data !== 'object' || data.type !== HTML_EMBED_HEIGHT_MESSAGE) return null
  return clampEmbedHeight(data.height)
}

/** iframe 창 → 그 블록의 높이 받기. 창 메시지 듣기는 블록마다가 아니라 모듈에 하나만 둔다(블록이 많은 노트에서 메시지마다 모든 블록이 깨지 않게). */
const heightWatchers = new Map<Window, (height: number) => void>()

/** 모듈 하나짜리 message 듣기 — 보낸 창으로 그 블록을 찾고, 같은 창인지·모양·범위를 embedHeightFromMessage 로 다시 가린다. */
function onEmbedMessage(event: MessageEvent): void {
  const source = event.source as Window | null
  const onHeight = source ? heightWatchers.get(source) : undefined
  if (!onHeight) return
  const height = embedHeightFromMessage(event, source)
  if (height != null) onHeight(height)
}

/**
 * iframe 창의 높이 보고를 받기 시작한다 — 돌려준 함수로 그만 받는다. 첫 등록 때 창 message 듣기를 붙이고, 마지막 해제 때 뗀다.
 * iframe 이 문서에 붙은 뒤(contentWindow 가 생긴 뒤) 부른다 — srcdoc 문서가 바뀌어도 같은 iframe 의 창 객체는 같다.
 */
export function watchEmbedHeight(frameWindow: Window, onHeight: (height: number) => void): () => void {
  if (heightWatchers.size === 0) window.addEventListener('message', onEmbedMessage)
  heightWatchers.set(frameWindow, onHeight)
  return () => {
    if (heightWatchers.get(frameWindow) !== onHeight) return
    heightWatchers.delete(frameWindow)
    if (heightWatchers.size === 0) window.removeEventListener('message', onEmbedMessage)
  }
}
