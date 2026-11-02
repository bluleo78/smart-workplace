/**
 * HTML 「글자 고치기」(WP-1309) 부모 쪽 — 원본 소스를 편집 화면용으로 표시하고, iframe 에서 고친 글자를 원본 소스에 되돌린다(직렬화).
 * HTML 문서 페이지의 「편집」(보이는 화면 편집)과 노트 HTML 블록의 「글자 고치기」가 함께 쓴다. iframe 안 스크립트·메시지는 lib/htmlTextEdit.
 *
 * 풀어야 하는 문제: 편집 화면은 원본의 스크립트를 실제로 돌린다(차트 등). 그래서 iframe 의 DOM 에는 스크립트가 만든 요소(런타임 DOM)가 섞여 있고,
 * 그 DOM 을 통째로 직렬화해 저장하면 차트 SVG·스크립트가 채운 숫자가 원본에 굳어 버린다(다시 열면 스크립트가 한 번 더 그려 두 벌이 된다).
 *
 * 접근(설계 메모 docs/design/wiki-html-visual-edit.md):
 * 1) 표시: 부모가 원본을 스크립트 없이 파싱(DOMParser — 문서, template — 조각)해 원본에 있던 모든 요소에 문서 순서 번호(data-wp-src)를 달고,
 *    글자를 고칠 수 있는 요소(아래 「고칠 수 있는 요소」)에는 원본 글자의 지문(data-wp-t)을 단 뒤 그 문서를 iframe 에 띄운다.
 *    번호는 속성이라 요소와 함께 다닌다 — 스크립트가 새로 만든 요소에는 번호가 없다.
 * 2) 편집: iframe 안 스크립트는 번호가 하나뿐이고(복제된 번호 아님), 자손이 모두 번호를 가졌고(런타임 자식 없음), 지금 글자 지문이 원본과 같은
 *    (스크립트가 글자를 바꾸지 않은) 요소만 고치게 한다. 고친 요소의 번호와 innerHTML 만 부모에 보낸다.
 * 3) 되돌리기: 부모는 표시 때 파싱해 둔 깨끗한 원본(번호를 달지 않은 것)의 사본에서 같은 번호의 요소를 찾고, 받은 innerHTML 을 정리기로 거른 뒤
 *    그 요소의 자식만 바꿔 직렬화한다. iframe DOM 은 저장에 쓰지 않으므로 런타임 DOM·편집 표시·주입 스크립트가 원본에 들어갈 길이 없다.
 *    고친 것이 없으면 원본 글자를 그대로 돌려준다(직렬화로 생기는 모양 차이도 없다).
 * 한계: 고친 것이 있으면 문서 전체를 DOM 직렬화로 다시 쓴다 — 속성 따옴표·빠진 닫는 태그·<tbody> 같은 파서 보정이 글자로 드러난다(보이는 모양·스크립트는 같다).
 *   DOCTYPE 과 그 앞 주석 등(머리말)은 원본 글자 그대로 둔다.
 */

import { scanHtmlProlog } from './sandboxedHtml'
import { escapeHtml } from './utils'

/** 원본 요소 번호 속성 — 문서 순서(querySelectorAll('*'))의 위치. 부모·iframe 이 같은 이름을 쓴다. */
export const HTML_EDIT_SRC_ATTR = 'data-wp-src'
/** 고칠 수 있는 요소에 다는 원본 글자 지문 — iframe 이 지금 글자와 견줘 스크립트가 바꾼 글자를 가린다. */
export const HTML_EDIT_SIG_ATTR = 'data-wp-t'

/**
 * iframe 이 보낸 고친 것 하나.
 * - 원본 요소: ref `s:<번호>`, html 은 그 요소의 지금 innerHTML.
 * - 새 문단(「문단 추가」·Enter): ref `n:<id>`, after 는 바로 앞 요소의 ref(원본 또는 다른 새 문단), cls 는 앞 문단에서 이어받은 class.
 */
export interface HtmlTextEdit {
  ref: string
  html: string
  after?: string
  cls?: string
}

const XHTML_NS = 'http://www.w3.org/1999/xhtml'

/** 글자를 고칠 수 있는 태그 — 글 블록·표 칸·인라인 글. 단추·입력 칸·pre 는 뺀다(클릭이 동작이거나 줄바꿈 규칙이 다르다). */
const EDITABLE_TAGS = new Set([
  'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'td', 'th', 'dt', 'dd', 'blockquote', 'figcaption', 'caption', 'label', 'div', 'summary',
  'span', 'a', 'b', 'strong', 'i', 'em', 'u', 's', 'small', 'code', 'mark', 'sub', 'sup', 'abbr', 'time', 'q', 'cite', 'del', 'ins',
])
/** 고칠 수 있는 요소 안에 와도 되는 자손 — 인라인 글·줄바꿈·그림. 블록 자식이 있으면 그 블록들이 따로 고칠 단위가 된다. */
const INLINE_CONTENT = new Set([
  'a', 'b', 'strong', 'i', 'em', 'u', 's', 'small', 'code', 'mark', 'sub', 'sup', 'span', 'br', 'wbr', 'abbr', 'time', 'q', 'cite', 'img', 'del',
  'ins', 'kbd', 'var',
])
/** 이 안에 있는 요소는 고치지 않는다 — 그림(svg·canvas)·스크립트·폼 조작부·머리. */
const NO_EDIT_ANCESTORS = 'svg,math,template,noscript,button,select,option,textarea,script,style,iframe,object,canvas,head'
/** 「문단 추가」·Enter 로 뒤에 새 문단을 둘 수 있는 요소 — 목록 항목이면 새 항목, 나머지는 새 <p>. iframe 스크립트도 같은 목록을 쓴다. */
export const HTML_EDIT_PARAGRAPH_TAGS = ['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'div', 'blockquote', 'figcaption', 'li'] as const
const PARAGRAPH_TAGS = new Set<string>(HTML_EDIT_PARAGRAPH_TAGS)

/** 정리기가 그대로 남기는 새 인라인 태그(원본에 없던 요소) — 서식 도구·붙여넣기가 만드는 것. a·span 은 속성을 따로 거른다. */
const ALLOWED_INLINE = new Set(['b', 'strong', 'i', 'em', 'u', 's', 'a', 'span', 'code', 'sub', 'sup', 'small', 'mark'])
/** 통째로 버리는 요소(내용까지) — 실행·스타일·폼·머리·미디어 틀. */
const DROP_TAGS = new Set([
  'script', 'style', 'template', 'iframe', 'object', 'embed', 'noscript', 'head', 'meta', 'link', 'title', 'textarea', 'select', 'input', 'button',
  'svg', 'math', 'canvas', 'video', 'audio', 'picture', 'source', 'form',
])
/** 풀어 쓰는 블록 — 붙여 넣은 문단·목록 등은 내용만 남기고 사이에 줄바꿈(<br>)을 둔다(고치는 요소 안에 블록을 넣지 않게). */
const BLOCK_TAGS = new Set([
  'p', 'div', 'li', 'ul', 'ol', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'section', 'article', 'header', 'footer', 'main', 'aside', 'nav',
  'table', 'tr', 'pre', 'dl', 'dt', 'dd', 'figure', 'figcaption', 'address', 'hr',
])

/**
 * 글자 지문 — 공백을 하나로 줄이고 앞뒤를 걷은 글자의 FNV-1a 32비트(36진수). iframe 스크립트(HTML_TEXT_EDIT_CORE 의 wpSig)와 같은 계산이다
 * (htmlTextEdit.test 가 둘이 같은 값을 내는지 지킨다). 같으면 「스크립트가 이 요소의 글자를 바꾸지 않았다」로 본다 — 충돌은 드물고 결과는 고칠 수 있게 될 뿐이다.
 */
export function htmlTextSignature(text: string): string {
  const s = text.replace(/\s+/g, ' ').trim()
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(36)
}

/**
 * 이 소스가 「문서」인지와 머리말(BOM·공백·주석·XML 선언·DOCTYPE)의 끝 — 머리말 스캔은 격리 머리말 주입과 같은 것(sandboxedHtml.scanHtmlProlog).
 * DOCTYPE 이 있거나 머리말 뒤가 <html>·<head>·<body> 면 문서, 아니면 조각(노트 HTML 블록처럼 <div>…<script> 만 있는 소스)으로 다룬다 —
 * 조각을 DOMParser 로 읽으면 앞의 <style>·<script> 가 <head> 로 옮겨져 순서가 바뀌므로 template 으로 읽는다. 닫히지 않은 주석 등은 조각으로 본다.
 */
function documentProlog(html: string): { end: number; isDocument: boolean } {
  const { end, doctypeEnd, unclosed } = scanHtmlProlog(html)
  if (unclosed) return { end: 0, isDocument: false }
  const isDocument = doctypeEnd >= 0 || /^<(html|head|body)[\s>/]/i.test(html.slice(end, end + 6))
  return { end: isDocument ? end : 0, isDocument }
}

/** 파싱한 원본 — 요소 목록(번호 = 위치), 다시 글자로 만드는 함수, 같은 꼴의 깨끗한 사본 만들기. */
interface ParsedSource {
  doc: Document
  elements: Element[]
  serialize: () => string
  clone: () => ParsedSource
}

/** 파싱한 문서(DOMParser) 하나를 ParsedSource 로 — 머리말은 원본 글자 그대로 붙인다. */
function documentSource(doc: Document, prolog: string): ParsedSource {
  // </html> 뒤 주석(「<!-- end -->」 등)은 파서가 문서(Document) 바로 아래에 둬 documentElement.outerHTML 에 들어가지 않는다 — 고친 뒤 저장에서 사라지지 않게 뒤에 붙인다.
  const tail = () => {
    let out = ''
    for (let n = doc.documentElement.nextSibling; n; n = n.nextSibling) if (n.nodeType === Node.COMMENT_NODE) out += `<!--${(n as Comment).data}-->`
    return out
  }
  return {
    doc,
    elements: Array.from(doc.querySelectorAll('*')),
    serialize: () => prolog + doc.documentElement.outerHTML + tail(),
    clone: () => documentSource(doc.cloneNode(true) as Document, prolog),
  }
}

/** 조각(template) 하나를 ParsedSource 로 — 직렬화는 template.innerHTML(<tr> 같은 문맥 요소도 그대로). 깊은 복제는 template 내용까지 복제한다. */
function fragmentSource(doc: Document, tpl: HTMLTemplateElement): ParsedSource {
  return {
    doc,
    elements: Array.from(tpl.content.querySelectorAll('*')),
    serialize: () => tpl.innerHTML,
    clone: () => fragmentSource(doc, tpl.cloneNode(true) as HTMLTemplateElement),
  }
}

/**
 * 원본을 스크립트 없이 파싱한다 — DOMParser·template 문서는 스크립트를 돌리지 않고 그림도 받지 않는다(불활성).
 * 같은 소스면 같은 순서의 요소 목록이 나오고, clone() 사본도 같은 순서다(번호 = 위치가 맞는다).
 */
function parseSource(source: string): ParsedSource {
  const { end, isDocument } = documentProlog(source)
  // 머리말(DOCTYPE·앞 주석)은 원본 글자 그대로 — 파서가 DOCTYPE 을 고쳐 쓰거나 표준 모드가 바뀌지 않게.
  if (isDocument) return documentSource(new DOMParser().parseFromString(source, 'text/html'), source.slice(0, end))
  const doc = document.implementation.createHTMLDocument('')
  const tpl = doc.createElement('template')
  tpl.innerHTML = source
  return fragmentSource(doc, tpl)
}

const tagOf = (el: Element) => el.localName.toLowerCase()

/**
 * 글자를 고칠 수 있는 요소 — 고칠 수 있는 태그이고, 자손이 모두 인라인 글이고, 글자가 있고, 그림·스크립트·폼 조작부 안이 아니다.
 * 그중 가장 바깥 것만(부모도 고칠 수 있으면 부모가 한 단위) — 문단 안 <b> 를 따로 고치지 않고 문단 하나로 고친다.
 * 번호(위치) 집합으로 돌려준다 — 표시 때 한 번 판정해 되돌리기에도 쓴다. 되돌리기는 이 집합에 없는 번호(스크립트·스타일 등)를 고치라는 메시지를 버린다.
 */
function editableIndexes(elements: readonly Element[]): Set<number> {
  // 자손부터(문서 순서의 거꾸로) 「인라인 글만 담았나」를 쌓는다.
  const inlineOnly = new Map<Element, boolean>()
  for (let i = elements.length - 1; i >= 0; i--) {
    const el = elements[i]
    let ok = true
    for (const child of Array.from(el.children)) {
      if (child.namespaceURI !== XHTML_NS || !INLINE_CONTENT.has(tagOf(child)) || !inlineOnly.get(child)) {
        ok = false
        break
      }
    }
    inlineOnly.set(el, ok)
  }
  const candidate = (el: Element | null): boolean =>
    !!el &&
    el.namespaceURI === XHTML_NS &&
    EDITABLE_TAGS.has(tagOf(el)) &&
    inlineOnly.get(el) === true &&
    (el.textContent ?? '').trim() !== '' &&
    el.closest(NO_EDIT_ANCESTORS) === null
  const out = new Set<number>()
  elements.forEach((el, i) => {
    if (candidate(el) && !candidate(el.parentElement)) out.add(i)
  })
  return out
}

/**
 * 노트 스크립트가 멈춘 채 띄우는 편집 화면(WP-1290 × WP-1309) — 띄울 사본에서 문서가 스스로 움직일 길을 걷는다.
 * iframe 은 우리 편집 스크립트 때문에 allow-scripts 로 뜨고, 문서 스크립트는 CSP nonce 가 막는다(SandboxedHtmlFrame pageScripts=false).
 * 여기서는 CSP 가 못 막는 것과 겹쳐 막을 것을 사본 DOM 에서 지운다:
 * - `<meta http-equiv=refresh>` — allow-scripts 면 자동 이동이 풀려 data: 문서(CSP 없음)로 넘어갈 수 있다
 * - 링크의 `target` — `_self`·프레임 이름으로 iframe 자체를 data: 문서로 옮기지 못하게(지우면 `<base target=_blank>` 새 탭 — 최상위 data: 는 브라우저가 막는다)
 * - `<script>`·`<noscript>`·인라인 이벤트(on*) — CSP 와 겹치는 막기. noscript 는 스크립트 꺼짐으로 파싱한 사본을 스크립트 켜짐 iframe 이 다르게 읽어
 *   (속성 안 `</noscript><script>`) 스크립트가 되살아나는 길이라 통째로 뺀다(어차피 스크립트 켜짐 iframe 에서는 보이지 않는다)
 */
function inertShownPage(elements: readonly Element[]): void {
  for (const el of elements) {
    const tag = tagOf(el)
    if (tag === 'script' || tag === 'noscript' || (tag === 'meta' && /^\s*refresh\s*$/i.test(el.getAttribute('http-equiv') ?? ''))) {
      el.remove()
      continue
    }
    if (tag === 'a' || tag === 'area') el.removeAttribute('target')
    for (const name of el.getAttributeNames()) if (/^on/i.test(name)) el.removeAttribute(name)
  }
}

/** 편집 화면 하나 — 띄울 문서와 고칠 수 있는 요소 수, 그 화면에서 고친 것을 기준 원본에 되돌리는 함수. */
export interface PreparedHtmlTextEdit {
  /** iframe 에 띄울 문서 — 모든 원본 요소에 번호(data-wp-src), 고칠 수 있는 요소에 글자 지문(data-wp-t). */
  html: string
  /** 고칠 수 있는 요소 수 — 0 이면 화면이 「고칠 글자가 없다」를 안내한다. */
  editable: number
  /** 고친 것들을 기준 원본에 되돌린 소스(applyHtmlTextEdits 와 같은 규칙). 바로 전과 같은 고친 것이면 다시 직렬화하지 않고 그 결과를 돌려준다. */
  apply: (edits: readonly HtmlTextEdit[]) => string
}

/**
 * 편집 화면을 준비한다 — 원본을 한 번만 파싱해 깨끗한 원본(pristine)과 고칠 수 있는 번호 집합을 쥐고, 번호·지문은 사본에 달아 띄울 문서를 만든다.
 * 원본에 같은 이름의 속성이 있었으면 덮거나 지운다(원본이 「고칠 수 있다」고 스스로 표시하지 못하게 — 되돌리기는 쥔 번호 집합으로 다시 가린다).
 * apply 는 입력이 쉴 때마다 불린다 — 수 MB 문서를 매번 다시 파싱하지 않고 깨끗한 원본의 사본(cloneNode)에 되돌린다.
 */
export function prepareHtmlTextEdit(source: string, { inertPage = false }: { inertPage?: boolean } = {}): PreparedHtmlTextEdit {
  const pristine = parseSource(source)
  const editable = editableIndexes(pristine.elements)
  const shown = pristine.clone()
  shown.elements.forEach((el, i) => {
    el.setAttribute(HTML_EDIT_SRC_ATTR, String(i))
    el.removeAttribute(HTML_EDIT_SIG_ATTR)
  })
  for (const i of editable) shown.elements[i].setAttribute(HTML_EDIT_SIG_ATTR, htmlTextSignature(pristine.elements[i].textContent ?? ''))
  // 번호를 단 뒤에 걷는다 — 띄울 사본에서만 빼므로 번호(위치)·되돌리기(깨끗한 원본)에는 영향이 없다.
  if (inertPage) inertShownPage(shown.elements)
  // 마지막 되돌리기 — 같은 항목 객체들이 다시 오면(새로 받은 것 없는 flush) 직렬화를 건너뛴다.
  let last: { edits: readonly HtmlTextEdit[]; html: string } | null = null
  const apply = (edits: readonly HtmlTextEdit[]): string => {
    if (edits.length === 0) return source
    if (last && last.edits.length === edits.length && last.edits.every((e, i) => e === edits[i])) return last.html
    const work = pristine.clone()
    const html = applyEditsTo(work, editable, edits) ? work.serialize() : source
    last = { edits: [...edits], html }
    return html
  }
  return { html: shown.serialize(), editable: editable.size, apply }
}

// ── 정리기 ───────────────────────────────────────────────────────────────

/** 받은 HTML 을 읽을 불활성 문서 — template 안이라 스크립트·그림이 돌지 않는다. */
let inertDoc: Document | null = null
function parseInert(html: string): DocumentFragment {
  inertDoc ??= document.implementation.createHTMLDocument('')
  const tpl = inertDoc.createElement('template')
  tpl.innerHTML = html
  return tpl.content
}

/** style 속성을 {이름: 값} 으로 — 소문자 이름, 앞뒤 공백 정리. !important 는 걷는다. */
function parseStyle(style: string | null): Record<string, string> {
  const out: Record<string, string> = {}
  if (!style) return out
  for (const decl of style.split(';')) {
    const at = decl.indexOf(':')
    if (at < 0) continue
    const name = decl.slice(0, at).trim().toLowerCase()
    const value = decl.slice(at + 1).replace(/!important/i, '').trim()
    if (name && value) out[name] = value
  }
  return out
}

/** 글자색으로 받을 값 — #hex, rgb()/rgba()/hsl()/hsla(), 이름(red·inherit 등). url()·expression 같은 것은 받지 않는다. */
export function safeTextColor(value: string | null | undefined): string | null {
  const v = (value ?? '').trim()
  if (/^#[0-9a-f]{3,8}$/i.test(v) || /^(rgba?|hsla?)\([\d\s.,%/deg+-]+\)$/i.test(v) || /^[a-z]{3,20}$/i.test(v)) return v
  return null
}

/** 링크 주소로 받을 값 — http(s)·mailto 만. 그 밖(javascript:·data: 등)은 null — 링크를 풀고 글자만 남긴다. */
export function safeLinkHref(value: string | null | undefined): string | null {
  const v = (value ?? '').trim()
  return /^(https?:\/\/|mailto:)/i.test(v) && !/[\s<>"]/.test(v) ? v : null
}

const isBold = (w: string | undefined) => !!w && (/^(bold|bolder)$/i.test(w) || (/^\d+$/.test(w) && Number(w) >= 600))
const isNormalWeight = (w: string | undefined) => !!w && (/^(normal|lighter)$/i.test(w) || (/^\d+$/.test(w) && Number(w) < 600))
const isItalic = (s: string | undefined) => /^(italic|oblique)/i.test(s ?? '')
/**
 * 물려받은 굵게·기울임을 끄는 값 — 이미 굵은 제목(<h1>)에서 「굵게」를 누르면 브라우저(execCommand)가 <span style="font-weight: normal"> 을,
 * 기울임 스타일 안에서 「기울임」을 누르면 font-style: normal 을 만든다. 편집 경로(고친 것)에서만 span 으로 남긴다 — 보이는 대로 저장되게.
 * 붙여넣기에서는 버린다 — 웹에서 복사한 HTML 은 거의 모든 span 에 font-weight: 400·font-style: normal 을 달아, 남기면 붙인 곳(제목 등)의 모양을 깬다.
 * 엄격하게 키워드 normal(굵기는 400 도)만 받는다(lighter·숫자 굵기·그 밖의 CSS 는 받지 않는다).
 */
const isWeightReset = (w: string | undefined) => /^(normal|400)$/i.test(w ?? '')
const isStyleReset = (s: string | undefined) => /^normal$/i.test(s ?? '')

/** 원본 요소 되살리기 문맥 — owner(고치는 원본 요소) 아래에 있던 번호 요소는 원본 속성(class·style 등)째 되살린다. used 는 한 번만 되살리게(복사된 번호). */
interface SanitizeContext {
  doc: Document
  /** 편집 경로(iframe 이 보낸 고친 것)인가 — 굵게·기울임 끄기(font-weight/font-style: normal)를 남긴다. 붙여넣기 정리는 false. */
  edit?: boolean
  owner?: Element
  elements?: readonly Element[]
  used?: Set<number>
}

/** 자식이 보이는 내용(글자·그림)을 담았나 — 블록을 풀 때 앞에 줄바꿈을 둘지 본다. */
const hasContent = (node: Node) => node.childNodes.length > 0

/**
 * 받은 innerHTML 을 고치는 요소 안에 넣을 노드로 거른다(정리기).
 * - 원본 요소(같은 owner 아래·같은 태그·처음 나온 번호): 원본 속성째 되살린다 — 원래 있던 <a class href>·<span style> 를 잃지 않게.
 * - 새 요소: b·strong·i·em·u·s·code·sub·sup·small·mark 는 속성 없이, a 는 http(s)·mailto href 만,
 *   span 은 글자색(style color)과 — 편집 경로에서만 — 굵게·기울임 끄기(font-weight: normal·font-style: normal)만.
 *   그 밖의 인라인(font 등)은 풀되 글자색·굵게(font-weight ≥ 600)·기울임(font-style italic)은 b·i·span 으로 옮긴다 — 웹에서 붙인 모양이 남게.
 *   굵게 태그라도 font-weight 가 normal 이면 굵게로 치지 않는다(Google Docs 가 전체를 <b style="font-weight:normal"> 로 감싼다).
 * - 원본 요소를 되살릴 때도, 받은 요소의 굵기·기울임·글자색이 원본 style 과 다르면(브라우저가 기존 span 의 style 을 고친 경우) 안쪽에 같은 서식을 더한다.
 * - 블록(p·div·li·제목 등)은 풀고 사이에 <br>, script·style·iframe·svg·폼 등은 내용까지 버린다. 주석은 버린다.
 */
function cleanInto(src: Node, out: Node, ctx: SanitizeContext): void {
  const { doc } = ctx
  for (const child of Array.from(src.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      out.appendChild(doc.createTextNode((child as Text).data))
      continue
    }
    if (child.nodeType !== Node.ELEMENT_NODE) continue
    const el = child as Element
    const tag = tagOf(el)
    if (el.namespaceURI !== XHTML_NS || DROP_TAGS.has(tag)) continue
    const restored = restoreOriginal(el, ctx)
    if (restored) {
      out.appendChild(restored)
      // 원본 style 과 달라진 서식만 골라 안쪽에 더한다 — 원본 속성은 그대로 되살리므로 브라우저가 이 요소의 style 에 넣은 서식은 여기서만 남는다.
      const before = parseStyle(restored.getAttribute('style'))
      const after = parseStyle(el.getAttribute('style'))
      const changed: Record<string, string> = {}
      for (const name of ['font-weight', 'font-style', 'color']) if (after[name] && after[name] !== before[name]) changed[name] = after[name]
      cleanInto(el, wrapFormat(restored, changed, tag, true), ctx)
      continue
    }
    if (tag === 'br') {
      out.appendChild(doc.createElement('br'))
      continue
    }
    if (BLOCK_TAGS.has(tag)) {
      if (hasContent(out) && out.lastChild?.nodeName !== 'BR') out.appendChild(doc.createElement('br'))
      cleanInto(el, out, ctx)
      continue
    }
    const style = parseStyle(el.getAttribute('style'))
    if (tag === 'font' && !style.color && el.getAttribute('color')) style.color = el.getAttribute('color')!
    let target: Node = out
    const boldTag = tag === 'b' || tag === 'strong'
    if (ALLOWED_INLINE.has(tag) && tag !== 'a' && tag !== 'span' && !(boldTag && isNormalWeight(style['font-weight']))) target = append(target, tag)
    if (tag === 'a') {
      const href = safeLinkHref(el.getAttribute('href'))
      if (href) target = append(target, 'a', { href })
    }
    cleanInto(el, wrapFormat(target, style, tag, !!ctx.edit), ctx)
  }
}

/** parent 아래에 새 요소를 붙이고 돌려준다(속성은 그대로 쓴다 — 부르는 쪽이 이미 거른 값). */
function append(parent: Node, name: string, attrs?: Record<string, string>): Element {
  const n = (parent.ownerDocument ?? (parent as Document)).createElement(name)
  for (const [k, v] of Object.entries(attrs ?? {})) n.setAttribute(k, v)
  parent.appendChild(n)
  return n
}

/**
 * style 의 서식을 허용한 꼴로 parent 아래에 감싸고 가장 안쪽을 돌려준다 — 굵게(≥600)는 <b>, 기울임은 <i>,
 * 글자색과(keepReset 일 때) 굵게·기울임 끄기는 <span style> 하나로. tag 가 이미 그 서식이면(b·strong / i·em) 겹쳐 감싸지 않는다.
 */
function wrapFormat(parent: Node, style: Record<string, string>, tag: string, keepReset: boolean): Node {
  let target = parent
  const weight = style['font-weight']
  const fontStyle = style['font-style']
  if (tag !== 'b' && tag !== 'strong' && isBold(weight)) target = append(target, 'b')
  if (tag !== 'i' && tag !== 'em' && isItalic(fontStyle)) target = append(target, 'i')
  const decls: string[] = []
  const color = safeTextColor(style.color)
  if (color) decls.push(`color: ${color}`)
  if (keepReset && isWeightReset(weight)) decls.push('font-weight: normal')
  if (keepReset && isStyleReset(fontStyle)) decls.push('font-style: normal')
  if (decls.length > 0) target = append(target, 'span', { style: decls.join('; ') })
  return target
}

/** 번호가 달린 요소가 owner 아래 원본 요소이면 원본의 얕은 복제(속성 그대로), 아니면 null. */
function restoreOriginal(el: Element, ctx: SanitizeContext): Element | null {
  const { owner, elements, used } = ctx
  const raw = el.getAttribute(HTML_EDIT_SRC_ATTR)
  if (raw == null || !owner || !elements || !used || !/^\d+$/.test(raw)) return null
  const index = Number(raw)
  const orig = elements[index]
  if (!orig || orig === owner || !owner.contains(orig) || tagOf(orig) !== tagOf(el) || used.has(index)) return null
  used.add(index)
  return orig.cloneNode(false) as Element
}

/** 정리한 결과를 새 조각으로. 내용이 끝의 <br> 하나뿐(편집기가 빈 칸에 남기는 자리표)이면 비운다. */
function sanitizeToFragment(html: string, ctx: SanitizeContext): DocumentFragment {
  const frag = ctx.doc.createDocumentFragment()
  cleanInto(parseInert(html), frag, ctx)
  if (frag.childNodes.length > 0 && (frag.textContent ?? '').trim() === '' && !frag.querySelector('img')) {
    const onlyBr = Array.from(frag.childNodes).every((n) => n.nodeName === 'BR' || (n.nodeType === Node.TEXT_NODE && !(n as Text).data.trim()))
    if (onlyBr) frag.replaceChildren()
  }
  return frag
}

/** 조각을 HTML 글자로 — 견주기·테스트용. */
function fragmentHtml(frag: DocumentFragment): string {
  const box = frag.ownerDocument.createElement('div')
  box.appendChild(frag.cloneNode(true))
  return box.innerHTML
}

/**
 * 고친 글자나 붙여 넣을 HTML 을 정리기로 걸러 HTML 글자로 돌려준다 — 붙여넣기(useHtmlTextEdit 가 iframe 에 다시 넣는다)와 테스트가 쓴다.
 * 원본 요소 되살리기 없이 거른다(붙인 내용의 번호 속성은 버린다).
 */
export function sanitizeEditedHtml(html: string): string {
  inertDoc ??= document.implementation.createHTMLDocument('')
  return fragmentHtml(sanitizeToFragment(html, { doc: inertDoc }))
}

/** 붙인 일반 글자를 HTML 로 — 특수 문자를 풀어 쓰고 줄바꿈은 <br>. */
export function plainTextToHtml(text: string): string {
  return escapeHtml(text.replace(/\r\n?/g, '\n')).replace(/\n/g, '<br>')
}

/** ref → 원본 번호(`s:12` → 12). 꼴이 틀리면 null. */
function sourceIndex(ref: string | undefined): number | null {
  const m = ref ? /^s:(\d+)$/.exec(ref) : null
  return m ? Number(m[1]) : null
}

/** 새 문단 class 로 받을 값 — 글자·숫자·밑줄·하이픈·공백만(앞 문단에서 이어받은 값이라 그 밖은 버린다). */
const SAFE_CLASS = /^[\w -]{1,200}$/

/**
 * iframe 에서 고친 것들을 원본 소스에 되돌린다 — 원본을 다시 파싱해 같은 번호 요소의 자식만 바꾸고 새 문단을 넣은 뒤 직렬화한다.
 * - 고칠 수 있는 요소(editableIndexes)가 아닌 번호는 버린다 — iframe 안 스크립트가 토큰을 읽어 <script>·<style> 을 고치라고 보내도 원본이 다치지 않게.
 * - 바깥 요소보다 안쪽(번호가 큰) 것을 먼저 바꾼다 — 같은 묶음에 둘 다 있으면 바깥의 최신 글자가 이긴다.
 * - 정리한 결과가 지금 원본 innerHTML 과 같으면 건드리지 않는다. 바뀐 것이 하나도 없으면 원본 글자를 그대로 돌려준다.
 * - 새 문단: after 가 가리키는 요소(원본은 문단을 둘 수 있는 태그만) 바로 뒤에 넣는다. 비었으면 넣지 않고, 그 뒤 새 문단은 그 자리를 이어받는다.
 */
export function applyHtmlTextEdits(source: string, edits: readonly HtmlTextEdit[]): string {
  if (edits.length === 0) return source
  const parsed = parseSource(source)
  return applyEditsTo(parsed, editableIndexes(parsed.elements), edits) ? parsed.serialize() : source
}

/** 파싱한 원본(되돌리기 전용 사본)에 고친 것들을 넣는다 — 바뀐 것이 있으면 true. editable 은 고칠 수 있는 번호 집합(editableIndexes). */
function applyEditsTo(parsed: ParsedSource, editable: ReadonlySet<number>, edits: readonly HtmlTextEdit[]): boolean {
  const { doc, elements } = parsed
  const used = new Set<number>()
  let changed = false

  const sourceEdits = edits
    .map((e) => ({ index: sourceIndex(e.ref), edit: e }))
    .filter((x): x is { index: number; edit: HtmlTextEdit } => x.index != null)
    .sort((a, b) => b.index - a.index)
  for (const { index, edit } of sourceEdits) {
    const el = elements[index]
    if (!el || !editable.has(index)) continue
    const frag = sanitizeToFragment(edit.html, { doc, owner: el, elements, used, edit: true })
    if (fragmentHtml(frag) === el.innerHTML) continue
    el.replaceChildren(frag)
    changed = true
  }

  // 새 문단 — 만든 순서대로. created: 새 문단 ref → 넣은 요소(비어 넣지 않았으면 그 앞 요소), root: 그 사슬의 원본 요소(되살리기 기준).
  const created = new Map<string, { el: Element; root: Element }>()
  const anchorOf = (ref: string | undefined): { el: Element; root: Element } | null => {
    const index = sourceIndex(ref)
    if (index != null) {
      const el = elements[index]
      return el && editable.has(index) && PARAGRAPH_TAGS.has(tagOf(el)) ? { el, root: el } : null
    }
    return (ref && created.get(ref)) || null
  }
  for (const edit of edits) {
    if (!/^n:[\w-]{1,40}$/.test(edit.ref)) continue
    const anchor = anchorOf(edit.after)
    if (!anchor || !anchor.el.parentNode) continue
    const tag = tagOf(anchor.root) === 'li' ? 'li' : 'p'
    const frag = sanitizeToFragment(edit.html, { doc, owner: anchor.root, elements, used, edit: true })
    if ((frag.textContent ?? '').trim() === '' && !frag.querySelector('img')) {
      created.set(edit.ref, anchor)
      continue
    }
    const node = doc.createElement(tag)
    if (edit.cls && SAFE_CLASS.test(edit.cls)) node.setAttribute('class', edit.cls)
    node.appendChild(frag)
    anchor.el.after(node)
    created.set(edit.ref, { el: node, root: anchor.root })
    changed = true
  }
  return changed
}
