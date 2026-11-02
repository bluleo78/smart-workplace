/**
 * 격리 iframe(sandbox + srcDoc)에 넣을 문서를 만든다(WP-274, WP-275, WP-427). 렌더는 SandboxedHtmlFrame 이 맡는다.
 *
 * 왜: srcDoc 문서는 앱 CSS 를 상속하지 않아 전역 슬림 스크롤바(index.css)가 적용되지 않고,
 * OS 기본(약 15px) 스크롤바가 다크 화면 안에서 튀어 보인다. 또 링크가 iframe 안에서 열리면
 * 대부분의 외부 사이트(SharePoint 등)가 프레임 표시를 거부해 '연결할 수 없음'이 뜬다.
 * 문서 앞에 링크 대상 `<base>` 와 얇은 스크롤바 스타일만 주입한다 — 스크립트가 아니므로 격리는 그대로다.
 */

/**
 * 모든 링크를 새 탭(sandbox 를 벗어난 일반 창)에서 연다(WP-427).
 * 문서 자신의 `<base target>` 보다 앞에 와서 이긴다 — 문서 순서상 첫 `<base target>` 만 쓰인다.
 * href 는 두지 않는다 — 상대 경로 해석(srcdoc 은 상위 문서 URL 기준)은 그대로 둔다.
 */
export const LINK_TARGET_BASE = '<base target="_blank">'

/**
 * 주입할 스타일. 문서 자신의 스타일보다 앞에 오고 명시도가 가장 낮아, 문서가 스크롤바를 직접 꾸몄다면 그쪽이 이긴다.
 * - scrollbar-width 는 상속되지 않아 중첩 스크롤 영역까지 얇게 하려면 `*` 에 건다.
 * - scrollbar-color 는 상속되므로 `:root` 에만 건다 — `*` 에 걸면 문서가 body 등에 준 색의 상속을 끊는다.
 * 앱 스크롤바 토큰(index.css)은 앱 배경 기준이라 쓰지 않는다 — 문서 배경을 알 수 없어
 * 밝은·어두운 배경 모두에서 보이는 반투명 회색 thumb 를 쓴다. ::-webkit-* 는 표준 속성을 모르는 구형 WebKit 폴백.
 */
export const THIN_SCROLLBAR_STYLE =
  '<style data-thin-scrollbar>' +
  '*{scrollbar-width:thin}' +
  ':root{scrollbar-color:rgb(128 128 128 / 0.45) transparent}' +
  '::-webkit-scrollbar{width:8px;height:8px}' +
  '::-webkit-scrollbar-track{background:transparent}' +
  '::-webkit-scrollbar-thumb{background-color:rgb(128 128 128 / 0.45);border-radius:9999px}' +
  '</style>'

/** srcDoc 문서 앞에 주입하는 머리말 전체. */
export const SANDBOX_HEAD = LINK_TARGET_BASE + THIN_SCROLLBAR_STYLE

/** HTML 공백(파서가 건너뛰는 문자). */
const isHtmlSpace = (c: string) => c === ' ' || c === '\n' || c === '\t' || c === '\r' || c === '\f'

/**
 * 문서 맨 앞 프롤로그(BOM·공백·주석·XML 선언) 뒤에 오는 `<!DOCTYPE ...>` 의 끝 위치. 없으면 -1.
 * 주석·XML 선언(파서는 주석으로 취급)은 DOCTYPE 앞에 와도 표준 모드를 깨지 않지만, 그 앞에 `<style>` 을 두면 깨진다.
 * 정규식이 아니라 한 번 훑는 스캔이다 — `(공백|주석)*` 꼴 정규식은 주석·공백이 길게 이어지고 DOCTYPE 이 없는
 * 입력에서 지수 백트래킹해, 신뢰 불가 HTML(메일 등) 하나로 탭을 멈출 수 있었다.
 */
function leadingDoctypeEnd(html: string): number {
  let i = html.charCodeAt(0) === 0xfeff ? 1 : 0
  for (;;) {
    while (i < html.length && isHtmlSpace(html[i])) i++
    if (html.startsWith('<!--', i)) {
      const close = html.indexOf('-->', i + 4)
      if (close < 0) return -1
      i = close + 3
    } else if (html.startsWith('<?', i)) {
      // HTML 파서는 `<?...` 를 첫 `>` 까지의 주석으로 읽는다.
      const close = html.indexOf('>', i + 2)
      if (close < 0) return -1
      i = close + 1
    } else break
  }
  if (html.slice(i, i + 9).toLowerCase() !== '<!doctype') return -1
  const close = html.indexOf('>', i + 9)
  return close < 0 ? -1 : close + 1
}

/**
 * 원문 HTML 에 머리말(기본 SANDBOX_HEAD)을 주입한다.
 * DOCTYPE 앞에 요소를 두면 문서가 quirks 모드로 렌더돼 레이아웃이 달라지므로,
 * DOCTYPE 이 있으면(앞의 주석·XML 선언 포함) 그 바로 뒤에, 없으면 맨 앞에 넣는다.
 */
export function withSandboxHead(html: string, head: string = SANDBOX_HEAD): string {
  const end = leadingDoctypeEnd(html)
  if (end < 0) return head + html
  return html.slice(0, end) + head + html.slice(end)
}

/*
 * 문서 안 이동 링크(`href="#..."` — 목차 등, WP-1271).
 *
 * 왜: srcdoc 문서의 상대 URL 은 상위 앱 주소 기준으로 풀려 `#summary` 가 `…/drive/spaces/29?preview=260#summary` 가 되고,
 * 위 `<base target="_blank">` 때문에 새 탭에 앱이 다시 열렸다 — 문서 안으로 가지 않는다.
 * `<base href="about:srcdoc">` 로 고치지 않는다 — 문서 자신의 `<base href>` 를 덮고 `//cdn…`·`/…` 같은 프로토콜·루트 상대 URL 이 깨진다.
 * 그래서 스크립트 허용 여부에 따라 나눈다.
 * - 스크립트 꺼짐: 링크 자체를 `about:srcdoc#…` + `target="_self"` 로 바꾼다(rewriteInPageLinks).
 * - 스크립트 켜짐: href 를 그대로 둔다 — 목차 스크립트가 `querySelector(a.getAttribute('href'))` 를 흔히 쓴다.
 *   대신 위임 클릭 처리기(IN_PAGE_LINK_SCRIPT)가 남은 기본 동작을 막고 그 위치로 스크롤한다.
 * 둘 다 `target` 을 직접 단 링크는 건드리지 않는다 — 문서가 정한 대상을 존중한다.
 * 스크립트 꺼짐의 조각 이동은 iframe 안 이동이라 상위 창 뒤로 가기 기록에 칸이 남는다 — 스크립트 없이는 피할 수 없고,
 * 일반 웹 페이지의 목차 클릭과 같은 동작이라 받아들인다(뒤로 가기가 먼저 이전 위치로 되돌린다).
 * 엄밀한 파서가 아니라 주석·textarea·속성 값 안의 `<a href="#…">` 글자도 바꿀 수 있다 — 드물고, 격리는 그대로다.
 */

/** `<a ...>`·`<area ...>` 여는 태그. `[^<>]*` 한 덩어리라 백트래킹이 선형이다(수 MB·신뢰 불가 입력). */
const LINK_OPEN_TAG = /<(a|area)(\s[^<>]*)>/gi

/** 태그 안 속성 하나 — 이름과 (있으면) 큰따옴표·작은따옴표·따옴표 없는 값. 겹치는 반복이 없어 선형이다. */
const TAG_ATTR = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'<>=`]+)))?/g

/**
 * 스크립트 꺼진 격리 문서에서 문서 안 이동 링크를 그 문서 안에서 움직이게 바꾼다(WP-1271).
 * `target` 이 없고 href 가 `#` 으로 시작하는 `<a>`/`<area>` 만 `href="about:srcdoc#…" target="_self"` 로 바꾼다 —
 * srcdoc 문서의 주소가 `about:srcdoc` 이라 같은 문서의 조각 이동이 되고, `<base target="_blank">` 대신 자기 프레임에서 열린다.
 * 외부·상대 링크는 그대로 새 탭으로 열린다(WP-427). 엄밀한 파서가 아니다 — 속성 값에 `>` 가 든 드문 태그는 그대로 둔다.
 */
export function rewriteInPageLinks(html: string): string {
  // `#` 이 없으면 바꿀 링크도 없다 — 대부분의 메일·문서는 여기서 끝나 수 MB 문자열을 다시 만들지 않는다.
  if (!html.includes('#')) return html
  return html.replace(LINK_OPEN_TAG, (tag: string, name: string, attrs: string) => {
    if (!attrs.includes('#')) return tag
    let href: { attr: string; value: string; quote: string; start: number; end: number } | null = null
    let hasTarget = false
    for (const m of attrs.matchAll(TAG_ATTR)) {
      const attr = m[1].toLowerCase()
      const value = m[2] ?? m[3] ?? m[4]
      // 빈 target(공백뿐 포함)은 브라우저가 없는 것으로 보고 `<base target>` 을 따른다 — 정한 대상으로 치지 않는다.
      if (attr === 'target') hasTarget ||= (value ?? '').trim() !== ''
      // 같은 속성이 두 번이면 HTML 파서는 첫 것만 쓴다. SVG 안 링크는 xlink:href 를 쓰기도 한다.
      else if ((attr === 'href' || attr === 'xlink:href') && !href && value !== undefined) {
        const quote = m[2] !== undefined ? '"' : m[3] !== undefined ? "'" : '"'
        href = { attr: m[1], value, quote, start: m.index, end: m.index + m[0].length }
      }
    }
    // URL 파서는 앞 공백을 버린다 — ` #x` 도 문서 안 이동이다.
    if (hasTarget || !href || !/^\s*#/.test(href.value)) return tag
    const rewritten = `${href.attr}=${href.quote}about:srcdoc${href.value.trimStart()}${href.quote}`
    return `<${name} target="_self"${attrs.slice(0, href.start)}${rewritten}${attrs.slice(href.end)}>`
  })
}

/**
 * 스크립트 허용 격리 문서에 넣는 문서 안 이동 처리기(WP-1271).
 * - 기본 동작(`<base target="_blank">` 로 새 탭에 앱 주소 열기)을 막고 `location.hash` 로 같은 문서의 조각 이동을 한다 —
 *   스크립트 꺼짐의 `about:srcdoc#…` 링크와 같게 `hashchange`·`:target` 이 살아 해시 라우팅 탭·CSS 탭도 움직인다.
 *   이미 같은 조각이면 해시를 다시 넣어도 스크롤하지 않으므로 그 요소로 직접 스크롤한다.
 * - DOMContentLoaded 뒤에 window 버블 단계로 건다 — 문서가 파싱 중에 건 처리기(요소·document·window)가 먼저 돈다.
 *   그쪽이 `preventDefault` 했거나, 수정키·가운데 단추이거나, 링크가 비지 않은 `target` 을 직접 달았으면 건너뛴다.
 * - 링크는 composedPath 로 찾는다 — 웹 컴포넌트 그림자 트리 안 링크도 잡는다. SVG 링크의 xlink:href 도 본다.
 * 한계: 문서 처리기가 stopPropagation 만 하고 기본 동작을 막지 않으면 여기까지 오지 않아 예전처럼 새 탭이 열린다.
 */
export const IN_PAGE_LINK_SCRIPT =
  '<script data-in-page-links>addEventListener("DOMContentLoaded",function(){addEventListener("click",function(e){' +
  'if(e.defaultPrevented||e.button!==0||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey)return;' +
  'var p=e.composedPath?e.composedPath():[e.target],a=null;' +
  'for(var i=0;i<p.length;i++){var n=p[i];if(n.tagName&&/^(a|area)$/i.test(n.tagName)){a=n;break}}' +
  'if(!a)return;var t=a.getAttribute("target");if(t&&t.trim())return;' +
  'var h=a.getAttribute("href");if(h==null)h=a.getAttributeNS("http://www.w3.org/1999/xlink","href");' +
  'if(h==null)return;h=h.trim();if(h.charAt(0)!=="#")return;' +
  'e.preventDefault();if(location.hash!==h&&h.length>1){location.hash=h;return}' +
  'var id=h.slice(1);try{id=decodeURIComponent(id)}catch(_){}' +
  'var el=id?document.getElementById(id)||document.getElementsByName(id)[0]:null;' +
  'if(el)el.scrollIntoView();else if(!id||id.toLowerCase()==="top")scrollTo(0,0)' +
  '})})</script>'

/** 스크립트 허용 문서에 주입하는 머리말 — 기본 머리말 + 문서 안 이동 처리기. */
export const SCRIPT_SANDBOX_HEAD = SANDBOX_HEAD + IN_PAGE_LINK_SCRIPT

/**
 * 격리 iframe 의 srcdoc 을 만든다 — 스크립트 허용 여부에 맞춰 문서 안 이동 링크를 처리하고 머리말을 주입한다(WP-1271).
 */
export function buildSandboxDoc(html: string, allowScripts: boolean): string {
  return withSandboxHead(allowScripts ? html : rewriteInPageLinks(html), allowScripts ? SCRIPT_SANDBOX_HEAD : SANDBOX_HEAD)
}

/**
 * 스크립트가 든 HTML 인지(WP-1260) — 미리보기가 「스크립트 실행」 단추를 보일지 고른다.
 * `<script>` 요소, 태그 안 인라인 이벤트(onclick= 등), `javascript:` 주소(링크로 넘기는 발표 자료)가 있으면 참. 스크립트가 없는 문서에 단추를 띄우지 않으려는 판정이라
 * 엄밀한 파서가 아니다 — 본문 글자 「<script>」 처럼 드물게 거짓 양성이 나도 단추가 하나 더 보일 뿐 격리는 그대로다.
 * 정규식은 백트래킹이 선형인 꼴만 쓴다(수 MB 문서·신뢰 불가 입력).
 */
export function htmlHasScripts(html: string): boolean {
  return /<script[\s>/]/i.test(html) || /<[a-z][^<>]*\son[a-z]+\s*=/i.test(html) || /=\s*["']?\s*javascript:/i.test(html)
}
