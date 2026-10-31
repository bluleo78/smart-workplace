import { docToMarkdown, getMarkdownSchema, HTML_EMBED_INFO } from '@smart-workplace/wiki-editor-schema'
import { DOMParser as PMDOMParser } from '@tiptap/pm/model'

import { scopeCss } from './wikiHtmlScope'

/**
 * HTML 파일 → 노트 변환기(WP-1241) — HTML 아티팩트(보고서·표 문서·차트 문서)를 노트 블록으로 바꾼다(순수 함수, DOM 만 쓴다).
 *
 * 무엇으로 바뀌는가:
 * - 제목·문단·목록·표·이미지·링크 → 일반 노트 블록(바로 편집·동시 편집된다).
 * - 모든 <style> → 페이지 스타일 하나(wikiStyle). 위험한 부분·@import 는 스키마 정리기(sanitizeStyleSheet)가 걷는다
 *   — Google Fonts <link> 와 @import 글꼴은 빠진다(노트는 바깥 주소 CSS 를 불러오지 않는다).
 * - class·style 을 지닌 컨테이너 → 모양 영역(wikiHtmlBox), class·style 을 지닌 인라인 → 인라인 모양(wikiHtmlSpan).
 * - 스크립트가 손대는 부분(<canvas>, 스크립트가 id·선택자로 찾는 요소) → 그 공통 조상 하나를 HTML 블록(wikiHtmlEmbed)으로.
 * - 스크립트로 스스로 모양을 입히는 문서(Tailwind CDN 등)·스크립트가 문서 전체를 다루는 문서 → 문서 통째로 HTML 블록 하나.
 *
 * 왜 마크다운을 내는가(ProseMirror JSON·HTML 조각이 아니라): 노트의 저장 형식이 마크다운이라, 들여온 결과가 저장 → 다시 열기 뒤에도
 * 같은 모양이어야 한다. 변환기가 직접 마크다운을 내면 편집기 삽입(tiptap-markdown insertContent)과 새 노트 만들기가 같은 글자를 쓰고,
 * 테스트가 그 글자의 왕복(md → doc → md) 안정성을 바로 본다. 노드는 HTML 을 공용 스키마의 parseHTML 규칙으로 읽어 만든다
 * — 규칙을 다시 구현하지 않는다(정리·허용 태그·속성 검사가 노트와 한곳에서 같다).
 */

/** 변환 결과. */
export interface WikiHtmlImportResult {
  /** <title> 글자, 없으면 첫 <h1> 글자, 둘 다 없으면 null. */
  title: string | null
  /** 노트 본문 마크다운(저장 형식 그대로). */
  markdown: string
  /** 넣지 못한 이미지 수 — data: 이미지(노트는 본문에 base64 를 두지 않는다)·상대 주소 이미지(원본 파일 옆 파일이라 닿지 않는다). */
  droppedImages: number
  /**
   * HTML 블록이 편집할 글을 많이 품었는지 — 스크립트 대상들의 공통 조상이 넓어 글이 블록 안(편집 불가)에 들어갔다.
   * 대상별로 나누지 않는 이유: 대상들이 스크립트를 함께 쓰므로 블록마다 일부만 두면 없는 요소를 찾다 스크립트가 멈춘다.
   */
  embedCapturedText: boolean
}

/** 들여오기 범위 class 접두 — 기존 노트에 넣을 때 들여온 CSS 를 이 class 의 모양 영역 안에만 적용한다(옵션 scopeClass). */
export const WIKI_IMPORT_SCOPE_PREFIX = 'wp-import-'

/** 들여오기 범위 class 하나를 만든다 — 같은 노트에 여러 번 넣어도 서로의 CSS 가 섞이지 않게 무작위 꼬리를 붙인다. */
export function newImportScopeClass(): string {
  return `${WIKI_IMPORT_SCOPE_PREFIX}${Math.random().toString(36).slice(2, 8).padEnd(6, '0')}`
}

/** 스크립트로 문서 모양을 입히는 런타임(Tailwind Play CDN·UnoCSS·Twind·Windi) — 정적 CSS 가 없어 노트로 옮기면 모양이 사라진다. */
const RUNTIME_STYLING_SRC = /cdn\.tailwindcss\.com|@tailwindcss\/browser|unocss|twind|windicss/i
/** <style type="text/tailwindcss"> 처럼 런타임이 읽는 스타일 — 이것도 런타임 스타일 문서다. */
const RUNTIME_STYLE_TYPE = /tailwind|unocss|twind/i

/**
 * 스크립트 글자로 판정할 인라인 스크립트 상한(글자 수) — 이보다 크면 문서에 통째로 넣은 라이브러리(Chart.js 압축본 등)로 보고
 * document.body·선택자 판정에 쓰지 않는다. 라이브러리 안의 document.body 같은 글자가 문서 전체 HTML 블록·엉뚱한 대상을 만들지 않게.
 */
const SCRIPT_ANALYSIS_MAX_CHARS = 20_000

/** 스크립트가 문서 전체를 다루는 표지 — body 에 붙이거나 document.write 로 쓰는 문서는 부분만 떼면 깨진다. */
const WHOLE_DOCUMENT_SCRIPT = /document\.(?:body|write(?:ln)?\s*\()|\.select\(\s*['"`]body['"`]\s*\)|querySelector\(\s*['"`](?:body|html)['"`]\s*\)/

/** 분석·추적 스크립트 주소 — 화면을 그리지 않으므로 HTML 블록 소스에도 넣지 않는다(익명 열람자까지 추적 요청이 나가지 않게). */
const ANALYTICS_SRC = /googletagmanager\.com|google-analytics\.com|plausible\.io|segment\.(?:com|io)|hotjar\.com|clarity\.ms|mixpanel\.com|amplitude\.com/i

/** 인라인 분석 조각 — gtag('config', …)·dataLayer.push·ga('create', …) 처럼 추적 설정만 하는 짧은 스크립트. */
const ANALYTICS_INLINE = /\bgtag\s*\(|\bdataLayer\b|\bga\s*\(\s*['"]create/

/** 분석·추적 스크립트인지 — 주소가 추적 서비스거나, 주소 없이 추적 조각만 든 짧은 스크립트. */
function isAnalyticsSnippet(src: string | null, text: string): boolean {
  if (src) return ANALYTICS_SRC.test(src)
  return text.length < SCRIPT_ANALYSIS_MAX_CHARS && ANALYTICS_INLINE.test(text)
}

/** 요소판 isAnalyticsSnippet. */
function isAnalyticsScript(el: Element): boolean {
  return isAnalyticsSnippet(el.getAttribute('src'), el.textContent ?? '')
}

/**
 * 원문 HTML 글자에서 분석·추적 스크립트만 지운다 — 문서 통째 HTML 블록은 원본 글자를 그대로 두므로(DOM 으로 다시 쓰면 속성 따옴표 등이
 * 바뀐다) 글자에서 <script>…</script> 덩어리를 찾아 지운다. 다른 글자는 한 바이트도 바꾸지 않는다.
 */
export function stripAnalyticsScripts(html: string): string {
  return html.replace(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>[ \t]*\r?\n?/gi, (whole, attrs: string, text: string) => {
    const src = /\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attrs)
    return isAnalyticsSnippet(src ? (src[1] ?? src[2] ?? src[3] ?? '') : null, text) ? '' : whole
  })
}

/** 실행되는 스크립트인지 — type 이 없거나 자바스크립트·모듈이면 참. application/json 같은 데이터 스크립트는 거짓. */
function isExecutableScript(el: Element): boolean {
  const type = (el.getAttribute('type') ?? '').trim().toLowerCase()
  return !type || type === 'module' || /^(?:text|application)\/(?:x-)?(?:java|ecma)script$/.test(type)
}

/**
 * 스크립트 글자가 찾는 요소 — getElementById('x')·querySelector(All)('…')·d3.select('…')·'#x' 문자열로 가리킨 본문 요소.
 * 글자만 보고 짐작한다(실행하지 않는다) — 동적으로 만든 선택자는 놓치지만, 놓친 대상은 캔버스·차트 SVG 판정이 대부분 받는다.
 */
function referencedElements(code: string, body: HTMLElement): Element[] {
  const doc = body.ownerDocument
  const out: Element[] = []
  const byId = (id: string) => {
    const el = doc.getElementById(id)
    if (el && body.contains(el)) out.push(el)
  }
  for (const m of code.matchAll(/getElementById\(\s*['"`]([^'"`]+)['"`]\s*\)/g)) byId(m[1])
  for (const m of code.matchAll(/['"`]#([A-Za-z][\w-]*)['"`]/g)) byId(m[1])
  for (const m of code.matchAll(/(?:querySelector(?:All)?|select(?:All)?)\(\s*['"`]([^'"`]+)['"`]\s*\)/g)) out.push(...safeQueryAll(body, m[1]))
  return out.filter((el) => el.tagName.toLowerCase() !== 'script')
}

/** 선택자로 요소 찾기 — 잘못된 선택자(스크립트 글자 조각)는 빈 목록. */
function safeQueryAll(root: ParentNode, selector: string): Element[] {
  try {
    return Array.from(root.querySelectorAll(selector))
  } catch {
    return []
  }
}

/** 두 요소의 가장 가까운 공통 조상(자기 자신 포함). */
function commonAncestor(a: Element, b: Element): Element {
  for (let cur: Element | null = a; cur; cur = cur.parentElement) {
    if (cur.contains(b)) return cur
  }
  return a.ownerDocument.documentElement
}

/** 인라인 요소 — HTML 블록(블록 노드)은 문단 안에 들 수 없어 이 안에 있으면 바깥 블록으로 올라간다. */
const INLINE_TAGS = new Set([
  'a', 'abbr', 'b', 'bdi', 'bdo', 'big', 'cite', 'code', 'data', 'del', 'dfn', 'em', 'font', 'i', 'ins', 'kbd', 'label',
  'mark', 'q', 'rp', 'rt', 'ruby', 's', 'samp', 'small', 'span', 'strike', 'strong', 'sub', 'sup', 'time', 'tt', 'u', 'var',
  'wbr', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'button',
])

/**
 * HTML 블록으로 뗄 요소를 블록 자리로 올린다 — 인라인·문단 안이면 바깥 블록으로, 표 안이면 표 전체로(표 셀은 한 줄 마크다운이라
 * 여러 줄 소스 블록을 담지 못한다 — 슬래시 「HTML 블록」이 표 안에서 숨는 것과 같은 이유).
 */
function liftToBlock(el: Element): Element {
  let cur = el
  for (;;) {
    const table = cur.parentElement?.closest('table')
    if (table) {
      cur = table
      continue
    }
    const parent = cur.parentElement
    if (parent && INLINE_TAGS.has(parent.tagName.toLowerCase())) {
      cur = parent
      continue
    }
    return cur
  }
}

/** 넓힐 컨테이너의 글자 상한 — 이보다 글자가 많으면 차트 카드가 아니라 본문 구획이라 넓히지 않는다(편집할 글을 HTML 블록에 가두지 않게). */
const WIDEN_MAX_TEXT = 300
/** HTML 블록이 이만큼(WIDEN_MAX_TEXT 의 배수) 넘는 글을 품으면 알린다 — 차트 카드 몇 개 분량을 넘는 글은 본문 글이다. */
const CAPTURED_TEXT_NOTICE_FACTOR = 3

/** 차트 컨테이너 이름 — class 토큰·id 가 chart·graph·plot 이거나 하이픈·밑줄로 나뉜 한 조각일 때(chart-wrap·bar-chart·plot-area). paragraph·graphic 은 아니다. */
const CHART_NAME = /(?:^|[-_])(?:chart|graph|plot)s?(?:$|[-_])/i

/** svg 의 조상(본문 아래) 중 차트 컨테이너가 있는지. */
function inChartContainer(svg: Element): boolean {
  for (let cur = svg.parentElement; cur && !isRoot(cur); cur = cur.parentElement) {
    if (Array.from(cur.classList).some((c) => CHART_NAME.test(c)) || CHART_NAME.test(cur.id)) return true
  }
  return false
}

/**
 * 스크립트 대상이 하나뿐이면(차트 캔버스 하나) 그 대상을 감싼 가장 가까운 모양 컨테이너(class·style)까지 넓힌다 — 차트 높이를 정하는
 * 카드·래퍼(`.chart-wrap{height:300px}`)를 함께 옮겨 원본 크기대로 그린다. 그 컨테이너 글자가 많으면(본문 구획) 넓히지 않는다.
 */
function widenToStyledContainer(el: Element): Element {
  for (let cur = el.parentElement; cur && !isRoot(cur); cur = cur.parentElement) {
    if (!cur.hasAttribute('class') && !cur.hasAttribute('style')) continue
    return visibleTextExceeds(cur, WIDEN_MAX_TEXT) ? el : cur
  }
  return el
}

/** 공백을 한 칸으로 접고 앞뒤를 뗀다 — 제목·보이는 글자 비교용. */
function norm(text: string | null | undefined): string {
  return (text ?? '').replace(/\s+/g, ' ').trim()
}

/**
 * 요소의 보이는 글자(스크립트·스타일 제외, 공백 접음)가 limit 자를 넘는지 — 글자 노드를 차례로 더하다 넘는 순간 멈춘다.
 * 복제(cloneNode)하지 않고 TreeWalker 로 script·style 하위를 건너뛴다 — 큰 문서의 본문 구획에서도 앞부분만 읽고 끝난다.
 */
function visibleTextExceeds(el: Element, limit: number): boolean {
  const walker = el.ownerDocument.createTreeWalker(el, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode: (n) =>
      n.nodeType === Node.ELEMENT_NODE && /^(?:script|style)$/i.test((n as Element).tagName)
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT,
  })
  let text = ''
  while (walker.nextNode()) {
    if (walker.currentNode.nodeType !== Node.TEXT_NODE) continue
    text = (text + (walker.currentNode.textContent ?? '')).replace(/\s+/g, ' ')
    if (text.trim().length > limit) return true
  }
  return false
}

/** 변환 중 만든 HTML 블록 자리(<pre><code> 안 글자) 안인지 — 그 안은 소스 글자라 정리 대상이 아니다. */
function inCode(el: Element): boolean {
  return !!el.closest('pre > code')
}

/** CSS 글자 정돈 — 줄마다 앞뒤 공백을 떼고 빈 줄을 뺀다(원본 <style> 들여쓰기는 뜻이 없다). */
function tidyCss(css: string): string {
  return css
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n')
}

/** html·body 인지 — 공통 조상이 여기면 문서 통째로 HTML 블록이다. */
function isRoot(el: Element): boolean {
  const t = el.tagName.toLowerCase()
  return t === 'html' || t === 'body' || t === 'head'
}

/** HTML 블록 소스의 <head> — 원본의 모든 <style>·스타일시트 <link> 를 순서대로. 떼어 낸 부분이 원본 CSS 그대로 그려지게. */
function embedHeadStyles(doc: Document): string {
  return Array.from(doc.querySelectorAll('style, link[rel~="stylesheet" i]'))
    .map((el) => el.outerHTML)
    .join('\n')
}

/**
 * 떼어 낸 부분의 HTML 블록 소스 — `<!doctype html>` + 원본 스타일 + (앞선 스크립트) + 부분 + (뒤따르는 스크립트).
 * 부분 밖 스크립트는 원본 순서를 지키려 부분 앞뒤로 나눠 둔다 — <head> 의 Chart.js 가 카드 안 인라인 스크립트보다 먼저 실행돼야 한다.
 * 부분 안 스크립트(데이터 JSON 포함)는 outerHTML 에 그대로 들어 있다.
 */
function partialEmbedSource(doc: Document, part: Element, scripts: Element[]): string {
  const outside = scripts.filter((s) => !part.contains(s))
  const before = outside.filter((s) => part.compareDocumentPosition(s) & Node.DOCUMENT_POSITION_PRECEDING)
  const after = outside.filter((s) => !before.includes(s))
  const lang = doc.documentElement.getAttribute('lang')
  return [
    '<!doctype html>',
    `<html${lang ? ` lang="${lang.replace(/"/g, '')}"` : ''}>`,
    '<head>',
    '<meta charset="utf-8">',
    embedHeadStyles(doc),
    ...before.map((s) => s.outerHTML),
    '</head>',
    '<body>',
    part.outerHTML,
    ...after.map((s) => s.outerHTML),
    '</body>',
    '</html>',
  ]
    .filter((line) => line !== '')
    .join('\n')
}

/** HTML 블록 자리 요소 — 공용 스키마 parseHTML 이 받는 `<pre><code class="language-html-embed">` 꼴(마크다운 펜스와 같은 DOM). */
function embedPlaceholder(doc: Document, source: string): HTMLElement {
  const pre = doc.createElement('pre')
  const code = doc.createElement('code')
  code.className = `language-${HTML_EMBED_INFO}`
  code.textContent = source
  pre.appendChild(code)
  return pre
}

/** 문서 통째로 HTML 블록 하나 — 원본 글자 그대로(앞뒤 공백만 뗀다). 분석·추적 스크립트만 지운다. */
function wholeDocument(html: string, title: string | null): WikiHtmlImportResult {
  const source = stripAnalyticsScripts(html).trim()
  return { title, markdown: blockToMarkdown(embedPlaceholder(document, source)), droppedImages: 0, embedCapturedText: false }
}

/** 블록 요소 하나를 노트 마크다운으로(공용 스키마로 읽어 직렬화). */
function blockToMarkdown(el: Element): string {
  const host = el.ownerDocument.createElement('div')
  host.appendChild(el)
  return elementToMarkdown(host)
}

/** 요소 안쪽을 공용 스키마 parseHTML 규칙으로 문서로 읽고 노트 마크다운으로 직렬화한다. */
function elementToMarkdown(host: Element): string {
  const doc = PMDOMParser.fromSchema(getMarkdownSchema()).parse(host)
  return docToMarkdown(doc).trim()
}

/** 문단처럼 글자를 담는 블록 — class·style 이 붙으면 모양 영역(div)으로 감싸 모양을 살린다(이 태그들은 모양 영역 허용 태그가 아니다). */
const WRAP_BLOCK_TAGS = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'ul', 'ol', 'table', 'dl', 'li'])
/** class·style 을 인라인 모양(span)으로 옮길 인라인 요소 — span 은 스키마가 그대로 받고, 링크는 링크 마크라 건드리지 않는다. */
const WRAP_INLINE_TAGS = new Set([
  'b', 'strong', 'em', 'i', 'u', 's', 'del', 'ins', 'strike', 'big', 'tt', 'small', 'mark', 'label', 'abbr', 'cite', 'q', 'sub',
  'sup', 'time', 'code', 'kbd',
])

/** 모양 속성(class·style)을 from 에서 떼어 to 에 단다(빈 값은 달지 않는다). */
function moveShapeAttrs(from: Element, to: Element): void {
  for (const name of ['class', 'style']) {
    const value = from.getAttribute(name)
    from.removeAttribute(name)
    if (value) to.setAttribute(name, value)
  }
}

/**
 * 스키마가 모양으로 받지 않는 자리의 class·style 을 받는 자리로 옮긴다.
 * - 문단·제목·목록·표 등: 바깥을 모양 영역 div 로 감싼다 — 글자 블록 자체는 일반 노드라 속성을 지니지 못한다.
 *   li 는 안쪽을 div 로 감싼다(목록 항목 자리를 지킨다).
 * - b·em·small 등 인라인: 안쪽을 span 으로 감싼다(굵게·기울임 마크는 그대로 따로 읽힌다).
 */
function relocateShapeAttrs(body: HTMLElement): void {
  const doc = body.ownerDocument
  for (const el of Array.from(body.querySelectorAll('[class], [style]'))) {
    // 코드 블록의 <code class="language-…">(HTML 블록 자리 포함)는 스키마가 언어로 읽는 자리라 건드리지 않는다.
    if (el.closest('pre')) continue
    const tag = el.tagName.toLowerCase()
    const block = WRAP_BLOCK_TAGS.has(tag)
    if (!block && !WRAP_INLINE_TAGS.has(tag)) continue
    const holder = doc.createElement(block ? 'div' : 'span')
    moveShapeAttrs(el, holder)
    if (block && tag !== 'li') {
      // 바깥을 감싼다 — 문단·제목·목록·표 자체가 모양 영역 안에 든다.
      el.replaceWith(holder)
      holder.appendChild(el)
    } else {
      // 안쪽을 감싼다 — li 는 목록 항목 자리를, 인라인은 굵게·기울임 마크를 지킨다.
      while (el.firstChild) holder.appendChild(el.firstChild)
      el.appendChild(holder)
    }
  }
}

/** 이미지 정리 — https·http 절대 주소만 남기고 나머지(data:·상대 주소)는 지운다. 지운 수를 돌려준다. */
function dropUnreachableImages(body: HTMLElement): number {
  let dropped = 0
  for (const img of Array.from(body.querySelectorAll('img'))) {
    const src = img.getAttribute('src') ?? ''
    if (/^https?:\/\//i.test(src)) continue
    dropped++
    img.remove()
  }
  return dropped
}

/** on* 속성(이벤트 처리기)을 모두 지운다 — 스키마 정리기도 지우지만 변환 중간 DOM 에도 남기지 않는다. */
function stripEventHandlers(root: Element): void {
  for (const el of Array.from(root.querySelectorAll('*'))) {
    for (const attr of Array.from(el.attributes)) {
      if (/^on/i.test(attr.name)) el.removeAttribute(attr.name)
    }
  }
}

/** 주석 노드를 모두 지운다. */
function stripComments(root: Node): void {
  const doc = root.ownerDocument ?? (root as Document)
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_COMMENT)
  const comments: Node[] = []
  while (walker.nextNode()) comments.push(walker.currentNode)
  for (const c of comments) c.parentNode?.removeChild(c)
}

/** 정적 SVG 를 HTML 블록으로 뗄 크기 기준 — 안쪽 요소가 이만큼 이상이면 그림(차트·도식), 그보다 적으면 아이콘으로 보고 버린다. */
const STATIC_SVG_MIN_ELEMENTS = 4

/**
 * 페이지 스타일이 쓰지 않는 class 를 뗀다 — 아무 모양도 주지 않는 class(`wrapper`·`container`)로 모양 영역이 생기면 노트에 쓸모없는
 * 경계와 HTML 태그만 늘어난다. CSS 글자에 `.이름` 이 나오는 class 만 남긴다(글자 검사라 넉넉하게 남는 쪽이다).
 */
export function pruneUnusedClasses(body: HTMLElement, css: string): void {
  const used = cssClassNames(css)
  for (const el of Array.from(body.querySelectorAll('[class]'))) {
    if (el.closest('pre')) continue
    const kept = Array.from(el.classList).filter((c) => used.has(c))
    if (kept.length) el.setAttribute('class', kept.join(' '))
    else el.removeAttribute('class')
  }
}

/** CSS 클래스 선택자 조각 — `.` 뒤 식별자 글자·CSS 이스케이프(\:·\/·\3a )·비 ASCII 의 연속. */
const CLASS_SELECTOR = /\.((?:[\w-]|\\[0-9a-fA-F]{1,6}[ \t\r\n\f]?|\\[^\r\n\f0-9a-fA-F]|[^\p{ASCII}])+)/gu

/** CSS 이스케이프 숫자를 글자 번호로 — 0·범위 밖은 대체 글자(CSS 규칙과 같다). */
function validCodePoint(cp: number): number {
  return cp > 0 && cp <= 0x10ffff ? cp : 0xfffd
}

/**
 * CSS 글자가 선택자로 쓰는 class 이름 모음 — 한 번 훑어 날것과 이스케이프를 푼 꼴을 함께 담는다(`.md\:grid-cols-2`·`.md\3a grid-cols-2`
 * → `md:grid-cols-2`). 글자 검사라 숫자(`0.5em`)·주소 조각이 섞여도 남는 쪽으로만 틀린다(class 를 잘못 지우지 않는다).
 */
export function cssClassNames(css: string): Set<string> {
  const names = new Set<string>()
  for (const m of css.matchAll(CLASS_SELECTOR)) {
    names.add(m[1])
    names.add(
      m[1].replace(/\\([0-9a-fA-F]{1,6})[ \t\r\n\f]?|\\(.)/g, (_e, hex: string | undefined, ch: string | undefined) =>
        hex ? String.fromCodePoint(validCodePoint(parseInt(hex, 16))) : (ch ?? ''),
      ),
    )
  }
  return names
}

/** 블록을 담는 컨테이너 — 안의 맨 글자·인라인 요소 묶음을 문단으로 감쌀 자리. */
const BLOCK_CONTAINER_TAGS = new Set(['body', 'div', 'section', 'article', 'header', 'footer', 'aside', 'main', 'nav', 'figure', 'figcaption', 'blockquote', 'details', 'summary', 'center'])

/** 인라인 내용인지 — 글자 노드이거나 인라인 요소(이미지·줄바꿈 포함). */
function isInlineNode(node: Node): boolean {
  if (node.nodeType === Node.TEXT_NODE) return true
  if (node.nodeType !== Node.ELEMENT_NODE) return false
  const tag = (node as Element).tagName.toLowerCase()
  return (INLINE_TAGS.has(tag) && !/^(?:p|h[1-6])$/.test(tag)) || tag === 'img' || tag === 'br'
}

/**
 * 컨테이너 안의 맨 글자·인라인 요소 묶음을 문단(<p>)으로 감싼다 — `<div class="card"><h3>신규</h3>고객 120곳</div>` 의 「고객 120곳」이
 * 앞 공백을 단 문단으로 읽혀(저장 때 ` 고객 120곳`) 다시 열 때 글자가 달라지지 않게, 묶음 앞뒤 공백을 떼고 감싼다.
 */
function wrapLooseInline(root: HTMLElement): void {
  const doc = root.ownerDocument
  const containers = [root, ...Array.from(root.querySelectorAll('*'))].filter(
    (el) => BLOCK_CONTAINER_TAGS.has(el.tagName.toLowerCase()) && !el.closest('pre'),
  )
  for (const el of containers) {
    let run: Node[] = []
    const flush = () => {
      const text = run.map((n) => n.textContent ?? '').join('')
      const hasContent = text.trim() || run.some((n) => n.nodeType === Node.ELEMENT_NODE && (n as Element).matches('img, br'))
      if (hasContent) {
        const p = doc.createElement('p')
        run[0].parentNode!.insertBefore(p, run[0])
        for (const n of run) p.appendChild(n)
        if (p.firstChild?.nodeType === Node.TEXT_NODE) p.firstChild.textContent = (p.firstChild.textContent ?? '').replace(/^\s+/, '')
        if (p.lastChild?.nodeType === Node.TEXT_NODE) p.lastChild.textContent = (p.lastChild.textContent ?? '').replace(/\s+$/, '')
      }
      run = []
    }
    for (const child of Array.from(el.childNodes)) {
      if (isInlineNode(child)) run.push(child)
      else flush()
    }
    flush()
  }
}

/** 제목 — <title>, 없으면 첫 <h1> 글자. 공백은 한 칸으로(norm). */
function documentTitle(doc: Document): string | null {
  const title = norm(doc.querySelector('title')?.textContent)
  if (title) return title
  const h1 = norm(doc.querySelector('body h1')?.textContent)
  return h1 || null
}

/**
 * HTML 문서(파일 내용·붙여넣은 소스)를 노트 마크다운으로 바꾼다.
 * opts.stripTitleHeading — 제목(<title>·첫 h1)과 같은 글자의 첫 <h1> 을 본문에서 뺀다(새 노트 만들기). 통째 HTML 블록이면 원본 그대로다.
 * opts.scopeClass — 기존 노트에 넣을 때(슬래시·문서 붙여넣기). 들여온 본문을 이 class 의 모양 영역(div)으로 감싸고, 페이지 스타일 선택자를
 *   모두 그 class 아래로 가둔다(html·body·:root 는 그 영역 자신) — 들여온 `p{…}`·`body{…}` 가 노트의 기존 글을 바꾸지 않게.
 *   웹의 노트 전체 범위 가두기(wikiHtmlScope)는 그 위에 그대로 걸린다. 빈 새 노트는 감쌀 필요가 없어 주지 않는다.
 *
 * 순서: ① 런타임 스타일 문서면 통째로 HTML 블록. ② 스크립트가 손대는 요소의 공통 조상을 HTML 블록으로 뗀다(조상이 body 면 통째로).
 * 손대는 요소가 없는 스크립트(분석 도구 등)는 버린다. ③ 남은 본문의 큰 정적 SVG 를 HTML 블록으로. ④ meta·link·noscript·주석·on* 를
 * 걷고 <style> 을 페이지 스타일 하나로 모은다. ⑤ 모양 속성을 스키마가 받는 자리로 옮기고 공용 스키마로 읽어 직렬화한다.
 */
export function convertHtmlToWiki(html: string, opts: { stripTitleHeading?: boolean; scopeClass?: string } = {}): WikiHtmlImportResult {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const title = documentTitle(doc)
  // 새 노트로 만들 때 — 노트 제목이 본문 밖 입력란이라 같은 글자의 첫 <h1> 을 남기면 제목이 두 번 보인다(AI 초안의 WP-255 와 같은 이유).
  if (opts.stripTitleHeading && title) {
    const h1 = doc.querySelector('body h1')
    if (h1 && norm(h1.textContent) === title) h1.remove()
  }
  // 스크립트는 한 번 모은다. 분석·추적 스크립트는 처음부터 뺀다 — 대상 판정에도, HTML 블록 소스에도 들지 않는다.
  const allScripts = Array.from(doc.querySelectorAll('script'))
  const scripts = allScripts.filter((s) => !isAnalyticsScript(s))
  const executable = scripts.filter(isExecutableScript)

  // ① 런타임 스타일 — 모양이 스크립트에서 나오므로 떼어 옮기면 모양이 없다.
  const runtimeStyled =
    executable.some((s) => RUNTIME_STYLING_SRC.test(s.getAttribute('src') ?? '')) ||
    Array.from(doc.querySelectorAll('style[type]')).some((s) => RUNTIME_STYLE_TYPE.test(s.getAttribute('type') ?? ''))
  if (runtimeStyled) return wholeDocument(html, title)

  // ② 스크립트가 손대는 요소 — 캔버스, 차트 컨테이너 안 SVG, 스크립트가 id·선택자로 찾는 요소.
  const body = doc.body
  let embedCapturedText = false
  if (executable.length) {
    // 큰 인라인 스크립트(통째로 넣은 라이브러리)는 글자 판정에서 뺀다 — SCRIPT_ANALYSIS_MAX_CHARS 참조.
    const code = executable
      .map((s) => s.textContent ?? '')
      .filter((t) => t.length < SCRIPT_ANALYSIS_MAX_CHARS)
      .join('\n')
    if (WHOLE_DOCUMENT_SCRIPT.test(code)) return wholeDocument(html, title)
    const targets = new Set<Element>(body.querySelectorAll('canvas'))
    for (const svg of Array.from(body.querySelectorAll('svg'))) {
      if (inChartContainer(svg)) targets.add(svg)
    }
    for (const el of referencedElements(code, body)) targets.add(el)
    if (targets.size) {
      const list = Array.from(targets)
      let part = list.reduce(commonAncestor)
      if (list.length === 1 || part === list[0]) part = widenToStyledContainer(part)
      // 검사는 올린 뒤 한 번 — 넓히기는 루트에서 멈추고, 루트(body)를 올려도 그대로 루트라 앞에서 따로 볼 필요가 없다.
      part = liftToBlock(part)
      if (isRoot(part)) return wholeDocument(html, title)
      embedCapturedText = visibleTextExceeds(part, WIDEN_MAX_TEXT * CAPTURED_TEXT_NOTICE_FACTOR)
      // 소스는 떼기 전(원본 DOM)에서 만든다 — 스타일·스크립트가 아직 제자리에 있다.
      part.replaceWith(embedPlaceholder(doc, partialEmbedSource(doc, part, scripts)))
    }
  }
  // 떼어 낸 부분 밖 스크립트는 HTML 블록 소스에 이미 들었거나(대상이 있을 때) 손대는 요소가 없는 것(분석 도구 등)이라 버린다.
  // (떼어 낸 부분 안 스크립트는 이미 문서에서 빠져 있어 remove 가 아무 일도 하지 않는다.)
  for (const s of allScripts) s.remove()

  // ③ 큰 정적 SVG(스크립트 없는 차트·도식) — 노트 블록으로 옮길 수 없어 그 SVG 만 HTML 블록으로. 작은 아이콘은 버린다(스키마가 무시).
  for (const svg of Array.from(body.querySelectorAll('svg'))) {
    if (!svg.isConnected || svg.parentElement?.closest('svg') || inCode(svg)) continue
    if (svg.querySelectorAll('*').length < STATIC_SVG_MIN_ELEMENTS) continue
    const part = liftToBlock(svg)
    if (isRoot(part)) continue
    part.replaceWith(embedPlaceholder(doc, partialEmbedSource(doc, part, [])))
  }

  // ④ 걷어낼 것 — 메타·링크(외부 CSS·글꼴)·noscript·template·주석·on* 속성.
  for (const el of Array.from(doc.querySelectorAll('meta, link, noscript, template, title, base'))) {
    if (!inCode(el)) el.remove()
  }
  stripComments(doc)
  stripEventHandlers(body)

  // 페이지 스타일 — 문서의 모든 <style> 을 순서대로 이어 하나로. 정리(위험 선언·@import 제거)는 스키마 parseHTML 이 한다.
  const styles = Array.from(doc.querySelectorAll('style')).filter((s) => !inCode(s))
  const css = tidyCss(styles.map((s) => s.textContent ?? '').join('\n'))
  for (const s of styles) s.remove()

  // ⑤ 이미지·모양 속성 정리 후 공용 스키마로 읽는다. 속성 없는 레이아웃 래퍼(div·section…)는 스키마 규칙이 없어 안쪽만 살아난다.
  const droppedImages = dropUnreachableImages(body)
  pruneUnusedClasses(body, css)
  relocateShapeAttrs(body)
  wrapLooseInline(body)
  let pageCss = css
  // 기존 노트에 넣기 — 본문을 범위 영역으로 감싸고 CSS 를 그 아래로 가둔다(CSS 가 없으면 가둘 것이 없어 감싸지 않는다).
  if (css && opts.scopeClass) {
    const wrapper = doc.createElement('div')
    wrapper.className = opts.scopeClass
    while (body.firstChild) wrapper.appendChild(body.firstChild)
    body.appendChild(wrapper)
    pageCss = tidyCss(scopeCss(css, `.${opts.scopeClass}`))
  }
  if (pageCss) {
    const style = doc.createElement('style')
    style.setAttribute('data-wp-style', '')
    style.textContent = pageCss
    body.insertBefore(style, body.firstChild)
  }
  return { title, markdown: elementToMarkdown(body), droppedImages, embedCapturedText }
}

/**
 * 붙여넣은 글자가 HTML 문서 전체(파일 소스)인지 — 앞 공백 뒤 `<!doctype html` 또는 `<html` 로 시작하면 참.
 * 일반 웹 복사(조각 HTML)는 여기에 걸리지 않아 지금처럼 모양을 거른 붙여넣기(WP-1240)로 간다.
 */
export function looksLikeHtmlDocument(text: string): boolean {
  return /^\s*(?:<!doctype\s+html|<html[\s>])/i.test(text)
}

/** 파일 이름에서 확장자(.html·.htm)를 뗀다 — 새 노트 제목의 마지막 대안. */
export function htmlFileBaseName(name: string): string {
  return name.replace(/\.html?$/i, '').trim()
}
