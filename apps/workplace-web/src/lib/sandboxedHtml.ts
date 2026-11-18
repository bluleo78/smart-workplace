/**
 * 격리 iframe(sandbox + srcDoc)에 넣을 문서를 만든다(WP-274, WP-275, WP-427). 렌더는 SandboxedHtmlFrame 이 맡는다.
 *
 * 왜: srcDoc 문서는 앱 CSS 를 상속하지 않아 전역 슬림 스크롤바(index.css)가 적용되지 않고,
 * OS 기본(약 15px) 스크롤바가 다크 화면 안에서 튀어 보인다. 또 링크가 iframe 안에서 열리면
 * 대부분의 외부 사이트(SharePoint 등)가 프레임 표시를 거부해 '연결할 수 없음'이 뜬다.
 * 문서 앞에 링크 대상 `<base>` 와 얇은 스크롤바 스타일만 주입한다 — 스크립트가 아니므로 격리는 그대로다.
 */

/**
 * 사용자 HTML 을 그리는 격리 iframe 의 배경 클래스 — 테마와 무관하게 흰 종이 캔버스로 고정한다.
 * 노트 「HTML 문서」(WP-1660)와 노트 HTML 블록·크게 보기·AI 고치기 비교, 드라이브·첨부 HTML 미리보기(WP-1661)가 함께 쓴다.
 * 왜: srcdoc 문서는 배경을 정하지 않으면 캔버스가 투명이라 iframe 요소 배경이 비친다. `bg-background` 면
 * 다크 테마에서 어두운 바탕 위에 문서가 정한 짙은 글자색이 그대로 남아 읽을 수 없다.
 * 브라우저에서 같은 HTML 을 열면 기본 캔버스가 흰색이므로 작성자는 흰 바탕을 전제로 색을 고른다 —
 * 메일 인용 원문(MailQuoteBlock)이 같은 이유로 `bg-white` 를 쓰는 선례를 따른다.
 * 문서 안에 스타일을 넣지 않고 iframe 요소 배경만 바꾸므로, 문서가 html·body 배경을 직접 정했으면 그 색이 이긴다.
 */
export const HTML_DOCUMENT_CANVAS_CLASS = 'bg-white'

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
 * thumb 색은 앱 스크롤바 토큰(index.css --scrollbar-thumb)과 같아 보이게 고른 반투명 색 하나다(WP-1749).
 * iframe 안은 앱 CSS 변수를 못 읽고, 문서 배경은 앱 테마와 무관하다(흰 종이 캔버스이거나 문서가 정한 색) — 그래서 앱 테마 값을 넘기지 않고
 * 문서 배경 위에서 섞인 결과가 토큰과 맞게 했다. Chromium 실측(스크롤바를 그린 헤드리스, 앱 다크·라이트 테마 모두 같은 값):
 * - 흰 문서 위 rgb(194,196,199) = 라이트 토큰 oklch(0.82 0.005 264) 그대로.
 * - #111 문서 위 rgb(60,62,65) ≈ 다크 토큰(흰색 18%)을 같은 배경에 얹은 rgb(60,60,60).
 * (예전 rgb(128 128 128 / 0.45) 는 각각 198 회색·67 회색 — 무채색이고 어두운 배경에서 한 단계 밝았다.)
 * hover(구형 WebKit 폴백만 — 표준 scrollbar-color 에는 hover 가 없다)도 같은 방법으로 라이트 hover 토큰 oklch(0.7 0.005 264) =
 * rgb(157,158,162) 와 다크 hover 토큰(흰색 30%)에 맞췄다. ::-webkit-* 는 표준 속성을 모르는 구형 WebKit 폴백.
 */
export const THIN_SCROLLBAR_STYLE =
  '<style data-thin-scrollbar>' +
  '*{scrollbar-width:thin}' +
  ':root{scrollbar-color:rgb(116 121 128 / 0.44) transparent}' +
  '::-webkit-scrollbar{width:8px;height:8px}' +
  '::-webkit-scrollbar-track{background:transparent}' +
  '::-webkit-scrollbar-thumb{background-color:rgb(116 121 128 / 0.44);border-radius:9999px}' +
  '::-webkit-scrollbar-thumb:hover{background-color:rgb(117 118 124 / 0.71)}' +
  '</style>'

/** srcDoc 문서 앞에 주입하는 머리말 전체. */
export const SANDBOX_HEAD = LINK_TARGET_BASE + THIN_SCROLLBAR_STYLE

/**
 * 고정 높이로 스스로 스크롤하는 문서 iframe 에만 더하는 스타일 — 스크롤을 창(뷰포트) 대신 body 가 맡게 한다(WP-1749).
 *
 * 왜: 창 스크롤바 칸(트랙)은 문서 배경이 아니라 바깥 iframe 요소 배경(HTML_DOCUMENT_CANVAS_CLASS = 흰색)을 비춘다 —
 * 배경이 어두운 문서도 오른쪽 끝에 흰 띠가 섰다. body 가 스크롤하면 트랙이 body(문서) 배경 위에 그려져
 * 어두운 문서는 어두운 칸, 배경 없는 문서는 흰 칸이 된다.
 * - html 을 세로 flex 로 두고 body 가 남은 높이를 채운다(min-height:0 으로 줄 수 있게) — body 기본 margin(8px)이나 문서가 준
 *   margin 이 있어도 넘치지 않는다(height:100% 였다면 margin 만큼 넘쳐 바깥 스크롤바가 하나 더 생긴다).
 * - html 은 overflow:auto 로 둔다(hidden 이 아님) — 문서가 body 의 overflow 를 visible 로 되돌리는 등 body 가 스크롤을 못 맡으면
 *   예전처럼 창이 스크롤한다(흰 띠는 남지만 내용이 잘려 못 보는 일은 없다).
 * - body 는 width:stretch — 세로 flex 의 자식은 margin:auto 면 내용 폭으로 줄어든다. 「body{max-width:900px;margin:0 auto}」 가운데
 *   칼럼 문서가 내용이 짧으면 칼럼이 좁아지지 않게, 블록 상자처럼 margin 을 뺀 폭을 채우게 한다(엔진별 접두 값을 함께 둔다).
 * - body 는 position:relative — 기준 상자 없는 absolute 요소가 창(초기 기준 상자) 대신 body 를 기준으로 삼아 내용과 함께 스크롤한다.
 *   body margin 이 있으면(스타일 없는 문서의 기본 8px 등) 그런 요소는 그 margin 만큼 안쪽에 놓인다 — 창 기준으로 두면 내용과 함께
 *   스크롤하지 않고 제자리에 떠 있게 되므로 이쪽을 고른다. 그래서 창 기준으로 쓴 「bottom:0」 바닥 띠·「height:100%」 히어로는
 *   창이 아니라 body(긴 문서면 내용 전체 높이) 기준이 된다 — 바닥 띠가 맨 끝으로 가고 히어로가 길어진다(남은 위험).
 * - 모두 :where() 라 명시도 0 — 문서가 html·body 에 display·height·overflow·position 을 직접 주면 문서가 이기고 그 부분은 예전 동작이다.
 * - 예외로 body 의 min-height:0 만 !important 다(WP-1749 리뷰) — AI 가 만든 HTML 에 흔한 「body{min-height:100vh}」가 이기면 body 가
 *   100vh + margin·padding 이 되어 창과 body 가 둘 다 스크롤하고 창 스크롤바 칸이 다시 흰 띠가 된다. body 는 flex:1 로 이미 창 높이를
 *   채우므로 「화면을 채워라」는 그 뜻은 그대로 지켜진다. 대가: 창보다 큰 min-height(예: 2000px)로 빈 공간을 일부러 둔 문서는 그 공간이 사라진다.
 *   (html 넘침을 숨기는 방식은 body 아래쪽 margin·padding 만큼 마지막 내용이 잘려 고르지 않았다.)
 * - 자동 높이 iframe(노트 HTML 블록·AI 비교 — wikiHtmlEmbedFrame 이 <html> 상자 높이로 잰다)·메일 서명에는 넣지 않는다 —
 *   html 이 iframe 높이에 묶이면 잰 높이가 iframe 높이와 같아져 프레임이 줄지 않는다. 그래서 SANDBOX_HEAD 와 따로 둔다.
 * - 메일 본문도 넣지 않는다 — iframe 배경이 투명이고 다크 변환이 html·body 배경을 칠해 흰 띠가 서지 않는다(이슈 범위 밖).
 * - 문서 자신의 스크립트가 도는 iframe 에는 넣지 않는다(buildSandboxDoc) — window.scrollY·scrollTo·창 scroll 이벤트에 기대는
 *   스크립트(발표 자료·읽기 진행 막대·위로 가기 단추)가 body 스크롤에서는 늘 0 을 읽고 이벤트도 받지 못한다.
 * 한계: 문서가 body 에 max-width + margin:auto 를 주면(가운데 칼럼) 스크롤바가 그 칼럼 오른쪽에 서고, 칼럼 밖에서 휠을 굴리면
 * 문서가 아니라 바깥 화면이 스크롤한다.
 */
export const SCROLLING_DOCUMENT_STYLE =
  '<style data-scrolling-document>' +
  ':where(html){height:100%;overflow:auto;display:flex;flex-direction:column}' +
  ':where(body){flex:1 1 auto;min-height:0!important;overflow:auto;position:relative;' +
  'width:-webkit-fill-available;width:-moz-available;width:stretch}' +
  '</style>'

/** HTML 공백(파서가 건너뛰는 문자). */
const isHtmlSpace = (c: string) => c === ' ' || c === '\n' || c === '\t' || c === '\r' || c === '\f'

/** 문서 머리말 훑은 결과 — end: 머리말 끝, doctypeEnd: DOCTYPE 끝(없으면 -1), unclosed: 닫히지 않은 주석·선언에서 멈췄나. */
export interface HtmlProlog {
  end: number
  doctypeEnd: number
  unclosed: boolean
}

/**
 * 문서 맨 앞 머리말(BOM·공백·주석·XML 선언·DOCTYPE 하나)을 훑는다 — 격리 머리말 주입(withSandboxHead)과
 * 글자 고치기의 문서/조각 판정(htmlTextEditSource, WP-1309)이 같은 스캔을 쓴다.
 * 주석·XML 선언(파서는 주석으로 취급)은 DOCTYPE 앞에 와도 표준 모드를 깨지 않지만, 그 앞에 `<style>` 을 두면 깨진다.
 * 정규식이 아니라 한 번 훑는 스캔이다 — `(공백|주석)*` 꼴 정규식은 주석·공백이 길게 이어지고 DOCTYPE 이 없는
 * 입력에서 지수 백트래킹해, 신뢰 불가 HTML(메일 등) 하나로 탭을 멈출 수 있었다.
 * 닫히지 않은 주석·선언을 만나면 거기서 멈춘다(unclosed) — 그 앞에서 찾은 DOCTYPE 끝은 그대로 돌려준다.
 */
export function scanHtmlProlog(html: string): HtmlProlog {
  let i = html.charCodeAt(0) === 0xfeff ? 1 : 0
  let doctypeEnd = -1
  for (;;) {
    while (i < html.length && isHtmlSpace(html[i])) i++
    let close: number
    if (html.startsWith('<!--', i)) {
      close = html.indexOf('-->', i + 4)
      if (close >= 0) close += 3
    } else if (html.startsWith('<?', i)) {
      // HTML 파서는 `<?...` 를 첫 `>` 까지의 주석으로 읽는다.
      close = html.indexOf('>', i + 2)
      if (close >= 0) close += 1
    } else if (doctypeEnd < 0 && html.slice(i, i + 9).toLowerCase() === '<!doctype') {
      close = html.indexOf('>', i + 9)
      if (close >= 0) doctypeEnd = close += 1
    } else return { end: i, doctypeEnd, unclosed: false }
    if (close < 0) return { end: i, doctypeEnd, unclosed: true }
    i = close
  }
}

/**
 * 원문 HTML 에 머리말(기본 SANDBOX_HEAD)을 주입한다.
 * DOCTYPE 앞에 요소를 두면 문서가 quirks 모드로 렌더돼 레이아웃이 달라지므로,
 * DOCTYPE 이 있으면(앞의 주석·XML 선언 포함) 그 바로 뒤에, 없으면 맨 앞에 넣는다.
 */
export function withSandboxHead(html: string, head: string = SANDBOX_HEAD): string {
  const end = scanHtmlProlog(html).doctypeEnd
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
 * - 맨 위로(`#`·`#top` — 그 id 요소가 없을 때)는 창과 body 를 함께 맨 위로 — body 가 스크롤을 맡는 문서(SCROLLING_DOCUMENT_STYLE)는 창 스크롤이 늘 0 이다.
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
  'if(el)el.scrollIntoView();else if(!id||id.toLowerCase()==="top"){scrollTo(0,0);if(document.body)document.body.scrollTop=0}' +
  '})})</script>'

/** 스크립트 허용 문서에 주입하는 머리말 — 기본 머리말 + 문서 안 이동 처리기. */
export const SCRIPT_SANDBOX_HEAD = SANDBOX_HEAD + IN_PAGE_LINK_SCRIPT

/**
 * 격리 iframe 의 srcdoc 을 만든다 — 스크립트 허용 여부에 맞춰 문서 안 이동 링크를 처리하고 머리말을 주입한다(WP-1271).
 * scrollingDocument 면(고정 높이로 스스로 스크롤하는 표면) body 가 스크롤을 맡는 스타일을 더한다(WP-1749) —
 * 다만 문서 자신의 스크립트가 돌 때(스크립트 허용 + 「우리 스크립트만」 아님 + 문서에 스크립트가 있음)는 넣지 않는다(SCROLLING_DOCUMENT_STYLE 참고).
 */
export function buildSandboxDoc(html: string, allowScripts: boolean, own?: OwnScripts, scrollingDocument = false): string {
  // 스크립트 판정은 스크롤 표면일 때만 — 메일 본문 등 수 MB 문서에서 정규식을 더 돌리지 않게.
  const bodyScrolls = scrollingDocument && !(allowScripts && !own?.nonce && htmlHasScripts(html))
  const base = bodyScrolls ? SANDBOX_HEAD + SCROLLING_DOCUMENT_STYLE : SANDBOX_HEAD
  if (allowScripts && own?.nonce) {
    // 우리 스크립트만(WP-1290 × WP-1309) — CSP 를 맨 앞에 두고, 우리 스크립트(문서 안 이동·own.script)에만 nonce 를 단다.
    const head = ownScriptsCsp(own.nonce) + base + withScriptNonce(IN_PAGE_LINK_SCRIPT, own.nonce)
    return withSandboxHead(html + withScriptNonce(own.script ?? '', own.nonce), head)
  }
  const body = html + (allowScripts ? (own?.script ?? '') : '')
  return withSandboxHead(allowScripts ? body : rewriteInPageLinks(body), allowScripts ? base + IN_PAGE_LINK_SCRIPT : base)
}

/**
 * 문서 뒤에 붙이는 우리 스크립트(높이 보고·고르기·글자 고치기 — 신뢰하는 문자열) — buildSandboxDoc 의 세 번째 인자.
 * nonce 가 있으면 「우리 스크립트만」 문서를 만든다(WP-1290 × WP-1309): 노트 스크립트가 멈춘 동안에도 편집 도구는 돌아야 해서
 * iframe 은 allow-scripts 로 띄우되, 문서 맨 앞 CSP 가 nonce 없는 스크립트 — 문서의 `<script>`·인라인 이벤트(onclick=)·`javascript:` 주소 —
 * 를 막고, 하위 프레임·object 도 막는다(srcdoc 하위 문서는 CSP 를 물려받지만 data: 문서는 아니다).
 * 스크립트가 꺼져 있으면(allowScripts=false) 우리 스크립트도 붙이지 않는다 — 어차피 돌지 않는다.
 */
export interface OwnScripts {
  script?: string
  nonce?: string
}

/** 우리 스크립트만 돌리는 CSP(meta) — 문서 맨 앞(머리말 첫 자리)에 와야 그 뒤 문서 스크립트에 걸린다. */
export function ownScriptsCsp(nonce: string): string {
  return `<meta http-equiv="Content-Security-Policy" content="script-src 'nonce-${nonce}'; object-src 'none'; frame-src 'none'; child-src 'none'">`
}

/** 우리가 만든 스크립트 문자열의 `<script` 여는 태그마다 nonce 를 단다 — 신뢰하는 문자열에만 쓴다(문서 HTML 에 쓰면 문서 스크립트도 풀린다). */
export function withScriptNonce(script: string, nonce: string): string {
  return script.replace(/<script(\s[^<>]*)?>/gi, (_, attrs: string | undefined) => `<script${attrs ?? ''} nonce="${nonce}">`)
}

/** CSP nonce — 문서를 만들 때마다 새로(128비트, 16진). 문서 스크립트가 미리 알 수 없어야 한다. */
export function newScriptNonce(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * 스크립트가 든 HTML 인지(WP-1260) — 미리보기가 「스크립트 실행」 단추를 보일지 고른다.
 * `<script>` 요소, 태그 안 인라인 이벤트(onclick= 등), `javascript:`·`vbscript:` 주소(링크로 넘기는 발표 자료), 하위 프레임(iframe·frame·object·embed —
 * srcdoc·data: 문서 안에서 스크립트가 돈다)이 있으면 참. 주소는 문자 참조(`&#106;`·`&colon;`)와 탭·줄바꿈을 브라우저처럼 풀고 본다(WP-1290 — 노트는
 * 스크립트가 없다고 본 블록을 점검 없이 실행하므로 가린 주소를 놓치면 안 된다). 엄밀한 파서가 아니다 — 본문 글자 「<script>」 처럼 드물게 거짓 양성이 나도
 * 단추가 하나 더 보일 뿐 격리는 그대로다. 정규식은 백트래킹이 선형인 꼴만 쓴다(수 MB 문서·신뢰 불가 입력). 서버 HtmlScriptRules 와 같은 규칙이다
 * (htmlHasScripts.cases.json 으로 함께 시험).
 */
export function htmlHasScripts(html: string): boolean {
  return (
    /<script[\s>/]/i.test(html) ||
    /<[a-z][^<>]*\son[a-z]+\s*=/i.test(html) ||
    /<(?:iframe|frame|object|embed)[\s>/]/i.test(html) ||
    /=\s*["']?\s*(?:java|vb)script:/i.test(decodeUrlChars(html))
  )
}

/** 주소 판정 전에 브라우저가 푸는 것을 푼다 — 숫자 문자 참조, `&Tab;`·`&NewLine;`·`&colon;`, 그리고 주소 안 탭·줄바꿈(지운다). */
function decodeUrlChars(html: string): string {
  // 가린 주소가 될 수 없는 문서(「script」 글자·문자 참조가 없음)는 그대로 — 수 MB 문서를 매번 세 번 다시 쓰지 않게.
  if (!/script|&#|&(?:colon|tab|newline);/i.test(html)) return html
  return html
    .replace(/&#(x[0-9a-f]+|[0-9]+);?/gi, (m, code: string) => {
      const n = code[0] === 'x' || code[0] === 'X' ? parseInt(code.slice(1), 16) : parseInt(code, 10)
      return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : m
    })
    .replace(/&(tab|newline|colon);/gi, (_, name: string) => ({ tab: '\t', newline: '\n', colon: ':' })[name.toLowerCase() as 'tab'])
    .replace(/[\t\n\r]/g, '')
}
