// 노트 본문 HTML 모양 속성 정리(WP-1240) — 모양 영역(wikiHtmlBox)·인라인 범위(wikiHtmlSpan)의 class·style 과
// 페이지 스타일(wikiStyle)의 CSS 에서 스크립트 실행·외부 추적으로 이어질 수 있는 것만 걷어낸다.
//
// 왜 공용 순수 함수인가: 같은 값이 마크다운 파싱(parseHTML)·화면 렌더(renderHTML·웹 CSS 주입)·저장(직렬화) 세 곳을 지난다.
// Yjs 로 들어온 attrs 는 파싱을 거치지 않으므로(다른 접속자가 직접 넣을 수 있다) 렌더·직렬화에서도 다시 거른다.
// 결과는 멱등이어야 한다 — 한 번 정리한 값을 다시 정리해도 같아야 저장 → 재로드 → 재저장이 바이트 동일하다.
// 그래서 걸러낼 선언만 잘라내고 나머지 글자(줄바꿈·주석·서식)는 손대지 않는다(정규화해 다시 쓰지 않는다).
//
// url() 허용 범위가 둘로 갈린다:
// - 인라인 style(모양 영역·인라인 모양)은 https: 와 data:image/ — 요소 하나에 붙은 값이라 선택자로 내용을 엿볼 수 없다.
// - 페이지 스타일(wikiStyle) CSS 는 data:image/ 만 — 외부 주소를 허용하면 공개 공유를 여는 익명 방문자까지 제3자 서버로
//   요청이 나가(추적) 속성 선택자(`[value^="a"]{background:url(https://…/a)}`)로 본문 글자를 한 자씩 밖으로 흘릴 수 있다.
//   @font-face src 의 https 글꼴도 같은 이유로 지운다.
// 페이지 스타일은 웹이 본문 범위로 가두므로(wikiHtmlScope) 가두기를 벗어날 수 있는 구조도 여기서 걷어낸다 —
// 이름을 모르는 at-rule·이름에 이스케이프가 든 at-rule 블록은 통째로 지우고, 일반 규칙 안 중첩 규칙(CSS nesting)도 지운다.

/** 모양 영역으로 살리는 HTML 태그 — CommonMark HTML 블록(6번 종류) 이름이라 여는/닫는 줄 사이가 마크다운으로 파싱된다. */
export const WIKI_HTML_BOX_TAGS = [
  'div',
  'section',
  'article',
  'header',
  'footer',
  'aside',
  'main',
  'nav',
  'figure',
  'figcaption',
] as const

export type WikiHtmlBoxTag = (typeof WIKI_HTML_BOX_TAGS)[number]

/** 허용 목록 밖 태그(옛 탭·다른 접속자가 넣은 값)는 div 로 그린다. */
export function sanitizeBoxTag(tag: unknown): WikiHtmlBoxTag {
  const t = typeof tag === 'string' ? tag.toLowerCase() : ''
  return (WIKI_HTML_BOX_TAGS as readonly string[]).includes(t) ? (t as WikiHtmlBoxTag) : 'div'
}

/**
 * class 토큰에 허용하는 글자 — 영숫자·_·- 에 더해 Tailwind 정적 내보내기가 쓰는 변형·임의값 글자(WP-1241):
 * `:`(md:grid-cols-2·hover:bg-x) `/`(w-1/2) `.`(gap-0.5) `[` `]` `(` `)` `,` `=` `%` `#` `@`(w-[calc(100%-2rem)]·bg-[#0f172a]·@container)
 * `!`(!mt-0). 이 글자들은 직렬화(escapeHtmlAttr)·마크다운 HTML 블록·GFM 표 셀(| 는 허용하지 않는다) 어디서도 뜻이 바뀌지 않는다.
 * 계속 막는 것: 공백(토큰 구분자)·따옴표·< > &·역슬래시·백틱·{ } ;·제어 문자·그 밖의 글자 — 속성 밖으로 새거나 CSS·HTML 문법이 되는 글자.
 *
 * 이 문법은 모든 호출처에 같다 — 노트끼리 붙여넣기·AI 가 쓴 본문(MCP·동기화 서버 적용)·HTML 파일 들여오기 모두 이 함수를 지난다.
 * 그래도 안전한 이유: class 는 모양을 고르는 이름일 뿐 스스로 아무것도 하지 않는다 — 실제 모양은 페이지 스타일(sanitizeStyleSheet 가 정리하고
 * 웹이 본문 범위로 가둔다)과 인라인 style(sanitizeInlineStyle)에서 오고, 노트 CSS 가 아닌 앱 CSS 의 class 를 빌려 써도 본문은 contain 으로
 * 가둬져 앱 화면을 덮지 못한다(WP-1240). 허용 글자는 속성값 안에서 따옴표를 닫거나 태그를 끝낼 수 없고, 직렬화 때 escapeHtmlAttr 를 다시 지난다.
 */
const CLASS_TOKEN = /^[A-Za-z0-9_\-:/.[\]%!#@(),=]+$/

/** class — 허용 글자(CLASS_TOKEN)로만 된 토큰만 공백 하나로 잇는다. 남는 게 없으면 null(속성을 쓰지 않는다). */
export function sanitizeClassName(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const tokens = value.split(/\s+/).filter((t) => CLASS_TOKEN.test(t))
  return tokens.length ? tokens.join(' ') : null
}

/** CSS 주석을 지운다 — 검사용(저장 글자는 그대로 둔다). 'expr/**\/ession(' 같은 우회를 막는다. */
function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?(\*\/|$)/g, '')
}

/** CSS 이스케이프(\6a·\j)를 글자로 푼다 — 검사용. '\6a avascript:' 같은 우회를 막는다. */
function decodeEscapes(css: string): string {
  return css.replace(/\\([0-9a-fA-F]{1,6})\s?|\\([\s\S])/g, (_m, hex: string | undefined, ch: string | undefined) => {
    if (hex) {
      const cp = parseInt(hex, 16)
      return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : ''
    }
    return ch ?? ''
  })
}

/** 검사용 정규형 — 주석·이스케이프를 풀고 소문자, 공백 제거. */
function normalizeForCheck(text: string): string {
  return decodeEscapes(stripComments(text)).toLowerCase().replace(/\s+/g, '')
}

/** 실행·바인딩 위험 글자 — IE expression·스크립트 주소·HTC behavior·XBL 바인딩. */
const DANGEROUS_VALUE = /expression\(|javascript:|vbscript:|-moz-binding|behavior:/

/**
 * url() 주소가 허용되는지 — data:image/ 와(allowRemote 일 때만) https:. 상대 주소·http:·그 밖의 스킴은 막는다
 * (노트 첨부는 Bearer 인증이라 CSS 가 불러올 수 없고, 외부 http 는 혼합 콘텐츠·추적 경로다).
 * 페이지 스타일 CSS 는 allowRemote=false — 모듈 머리말 참조(선택자로 본문을 엿보는 외부 요청을 막는다).
 */
function urlsAllowed(normalized: string, allowRemote: boolean): boolean {
  // image-set()·src() 는 url() 없이 맨 문자열로 주소를 받는다 — 걸러 내기 어려워 통째로 막는다.
  if (/(?:^|[^a-z-])(?:-webkit-)?image-set\(|(?:^|[^a-z-])src\(/.test(normalized)) return false
  const re = /url\(/g
  let m: RegExpExecArray | null
  while ((m = re.exec(normalized))) {
    const rest = normalized.slice(m.index + 4)
    const end = rest.indexOf(')')
    const arg = (end < 0 ? rest : rest.slice(0, end)).replace(/^["']|["']$/g, '')
    if (!arg.startsWith('data:image/') && !(allowRemote && arg.startsWith('https:'))) return false
  }
  return true
}

/**
 * 선언 하나(`prop: value`, 끝 ; 없이)가 안전한지. 속성 이름이 CSS 식별자가 아니거나(빈 선언·쓰레기), behavior·-moz-binding 속성이거나,
 * 값에 실행 글자·허용 밖 url() 이 있으면 거짓. overscroll-behavior·scroll-behavior 같은 정상 속성은 이름 전체로 비교해 살린다.
 * allowRemote — https: url() 을 허용할지. 인라인 style 은 허용(기본), 페이지 스타일 CSS 는 막는다(머리말 참조).
 */
export function isSafeDeclaration(decl: string, allowRemote = true): boolean {
  const colon = decl.indexOf(':')
  if (colon < 0) return false
  const prop = decodeEscapes(stripComments(decl.slice(0, colon))).trim().toLowerCase()
  if (!/^(--[\w-]+|-?[a-z][a-z0-9-]*)$/.test(prop)) return false
  if (prop === 'behavior' || prop === '-ms-behavior' || prop === '-moz-binding') return false
  const value = normalizeForCheck(decl.slice(colon + 1))
  return !DANGEROUS_VALUE.test(value) && urlsAllowed(value, allowRemote)
}

/**
 * 따옴표·괄호 밖의 구분 글자 위치에서 자른다 — `url(data:image/png;base64,…)` 나 `content:";"` 의 ; 로 선언이 쪼개지지 않게.
 */
function splitTopLevel(text: string, sep: string): string[] {
  const parts: string[] = []
  let depth = 0
  let quote: string | null = null
  let start = 0
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (c === '\\') {
      i++
      continue
    }
    if (quote) {
      if (c === quote) quote = null
      continue
    }
    if (c === '"' || c === "'") quote = c
    else if (c === '(') depth++
    else if (c === ')') depth = Math.max(0, depth - 1)
    else if (c === sep && depth === 0) {
      parts.push(text.slice(start, i))
      start = i + 1
    }
  }
  parts.push(text.slice(start))
  return parts
}

/**
 * style 속성 — 선언 단위로 잘라 안전한 것만 남긴다. 줄바꿈 등 공백 묶음은 한 칸으로(마크다운 여는 태그가 한 줄이어야
 * HTML 블록이 끊기지 않는다). 남은 선언은 원래 글자 그대로 '; ' 로 잇는다. 남는 게 없으면 null.
 */
export function sanitizeInlineStyle(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const kept = splitTopLevel(value.replace(/\s+/g, ' '), ';')
    .map((d) => d.trim())
    .filter((d) => d && isSafeDeclaration(d))
  return kept.length ? kept.join('; ') : null
}

/** 하위 규칙 목록을 담는 그룹 at-rule — 안쪽도 규칙 목록으로 읽는다(@media 안의 선택자 등). */
const GROUP_AT_RULES = new Set(['media', 'supports', 'container', 'layer', 'document', '-moz-document', 'scope', 'starting-style'])
/** 안쪽이 키프레임 선택자(from·to·%) 목록인 at-rule. */
const KEYFRAMES_AT_RULES = new Set(['keyframes', '-webkit-keyframes', '-moz-keyframes', '-o-keyframes'])
/** 안쪽이 선언 블록인 at-rule — 선택자가 없어 범위 가두기와 무관하다. */
const DECLS_AT_RULES = new Set(['font-face', 'page', 'property', 'counter-style', 'font-palette-values'])
/** 블록 없이 ; 로 끝나는 문장 at-rule 중 남기는 것 — @import 등 나머지는 지운다. */
const STATEMENT_AT_RULES = new Set(['charset', 'layer', 'namespace'])

/**
 * at-rule 이름(소문자) — 앞 공백·주석을 건너 @ 로 시작하면 @ 바로 뒤 이름 글자, 아니면 null.
 * 이스케이프(\6d edia)는 풀지 않고 글자 그대로 둔다 — 호출부가 \ 가 든 이름을 「모르는 이름」으로 다뤄 지운다
 * (브라우저는 이스케이프를 풀어 @media 로 읽는데 여기서 놓치면 안쪽 규칙이 범위 밖에 적용된다).
 * 이름 중간의 주석(@me/＊＊/dia)은 브라우저도 이름을 끊으므로 여기서도 거기서 끊는다.
 */
function atRuleName(text: string): string | null {
  const head = text.replace(/^(?:\s|\/\*[\s\S]*?\*\/)+/, '')
  if (!head.startsWith('@')) return null
  return /^@([^\s{};(/'"]*)/.exec(head)![1].toLowerCase()
}

/**
 * 블록 종류 — rules: 규칙 목록(최상위·@media), keyframes: 키프레임 목록, decls: 선언 블록(일반 규칙·@font-face),
 * drop: 통째로 지우는 블록(모르는 at-rule·이스케이프 이름 at-rule·일반 규칙 안 중첩 규칙). drop 안쪽은 끝까지 drop 이다.
 */
type BlockKind = 'rules' | 'keyframes' | 'decls' | 'drop'

/** 규칙의 선택자(앞머리) 가공 — 웹이 범위 가두기(.wiki-html-scope 접두)에 쓴다. 일반 스타일 규칙의 앞머리에만 불린다. */
export type StyleRulePreludeRewriter = (prelude: string) => string

/**
 * i 의 '(' 가 따옴표 없는 url 토큰을 여는지 — 바로 앞 식별자(이스케이프 포함)가 url 이고 '(' 뒤 첫 글자가 따옴표가 아니면 참.
 * 브라우저 토크나이저는 따옴표 없는 url( 을 괄호 블록이 아니라 다음 ')' 까지의 토큰 하나로 읽는다(안의 ( " { } 는 뜻이 없다).
 * 괄호 깊이로 세면 `url(data:image/x(") } body{…}` 에서 블록 끝(})을 놓쳐 뒤 규칙을 범위 밖에 남기게 된다.
 * #url( 은 해시 토큰, @url( 은 at-keyword 라 url 토큰이 아니다.
 */
function opensUnquotedUrl(css: string, i: number): boolean {
  const before = /(?:[\w-]|[\u0080-\uffff]|\\[0-9a-fA-F]{1,6}[ \t\n\r\f]?|\\[^\n\r\f0-9a-fA-F])+$/.exec(css.slice(Math.max(0, i - 64), i))
  if (!before || decodeEscapes(before[0]).toLowerCase() !== 'url') return false
  const lead = css[i - before[0].length - 1]
  if (lead === '#' || lead === '@') return false
  const quoted = /[ \t\n\r\f]*["']/y
  quoted.lastIndex = i + 1
  return !quoted.test(css)
}

/** HTML 블록을 일찍 끝내는 닫는 태그(CommonMark HTML 블록 1번 종류 끝 조건) — CSS 문자열 안에 있어도 무력화한다. */
const RAW_CLOSE_TAG = /<\/(style|script|pre|textarea)/gi

/**
 * 페이지 스타일 CSS 정리 — @import 등 문장 at-rule, 위험 선언·data:image/ 밖 url() 선언(https 포함 — 머리말 참조)만 잘라내고
 * 나머지 글자는 그대로 둔다(멱등). `</style` 등 HTML 블록·style 요소를 끝내는 글자는 `<\/style` 로 바꾼다(CSS 이스케이프라 뜻은 같다).
 *
 * 범위 가두기를 벗어날 수 있는 블록은 통째로 지운다 — 이름을 모르거나 이름에 이스케이프가 든 at-rule(`@\6d edia{body{…}}` 는
 * 브라우저에겐 @media 다), 일반 규칙 안의 중첩 규칙(`.a{ :not(&){…} }` 는 & 가 있어 범위 접두가 붙지 않는다).
 *
 * rewritePrelude 를 주면 일반 스타일 규칙의 선택자를 그 결과로 바꾼다 — 웹의 범위 가두기가 같은 걷기를 재사용한다.
 * @media·@supports 등 그룹 규칙은 안쪽을 다시 규칙 목록으로 읽고, @keyframes 안 키프레임 선택자·@font-face 는 바꾸지 않는다.
 */
export function sanitizeStyleSheet(css: unknown, rewritePrelude?: StyleRulePreludeRewriter): string {
  if (typeof css !== 'string') return ''
  const stack: BlockKind[] = ['rules']
  let out = ''
  let segStart = 0
  let depth = 0 // 괄호 깊이 — url(…;…) 안의 ; { } 는 구분자가 아니다.
  const top = () => stack[stack.length - 1]

  /** 블록 안 구분 조각(선언·문장)을 남길지. */
  const keep = (seg: string, kind: BlockKind): boolean => {
    if (kind === 'drop') return false
    const body = stripComments(seg).trim().replace(/;$/, '').trim()
    if (!body) return true
    if (kind === 'decls') return isSafeDeclaration(body, false)
    // 규칙 목록 안의 문장 at-rule 은 @charset·@layer a,b·@namespace 만 — @import(외부 CSS)·이스케이프 이름(@\69mport) 등은 지운다.
    const name = atRuleName(body)
    if (name !== null && !STATEMENT_AT_RULES.has(name)) return false
    const n = normalizeForCheck(body)
    return !DANGEROUS_VALUE.test(n) && urlsAllowed(n, false)
  }

  for (let i = 0; i < css.length; i++) {
    const c = css[i]
    if (c === '/' && css[i + 1] === '*') {
      const end = css.indexOf('*/', i + 2)
      i = end < 0 ? css.length : end + 1
      continue
    }
    if (c === '\\') {
      i++
      continue
    }
    if (c === '"' || c === "'") {
      // 문자열 끝까지(줄바꿈이면 CSS 도 문자열을 끝낸다).
      let j = i + 1
      while (j < css.length && css[j] !== c && css[j] !== '\n') j += css[j] === '\\' ? 2 : 1
      i = j
      continue
    }
    if (c === '(' && opensUnquotedUrl(css, i)) {
      // 따옴표 없는 url 토큰 — 이스케이프 아닌 첫 ')' 까지가 토큰 하나다(괄호 깊이를 세지 않는다).
      let j = i + 1
      while (j < css.length && css[j] !== ')') j += css[j] === '\\' ? 2 : 1
      i = j
      continue
    }
    if (c === '(') depth++
    else if (c === ')') depth = Math.max(0, depth - 1)
    if (depth > 0) continue

    if (c === '{') {
      const prelude = css.slice(segStart, i)
      const kind = top()
      let next: BlockKind
      let written = prelude
      if (kind === 'rules') {
        const name = atRuleName(prelude)
        if (name === null) {
          next = 'decls'
          if (rewritePrelude) written = rewritePrelude(prelude)
        } else if (GROUP_AT_RULES.has(name)) next = 'rules'
        else if (KEYFRAMES_AT_RULES.has(name)) next = 'keyframes'
        else if (DECLS_AT_RULES.has(name)) next = 'decls'
        else next = 'drop' // 모르는 이름·이스케이프 든 이름(\ 는 어느 목록에도 없다)
      } else if (kind === 'keyframes') next = 'decls'
      // 선언 블록 안의 블록(중첩 규칙·@page 여백 상자 등)과 drop 안쪽은 지운다 — 중첩 선택자는 범위 접두를 받지 않는다.
      else next = 'drop'
      if (next !== 'drop') out += `${written}{`
      stack.push(next)
      segStart = i + 1
    } else if (c === ';') {
      const seg = css.slice(segStart, i + 1)
      if (keep(seg, top())) out += seg
      segStart = i + 1
    } else if (c === '}') {
      const seg = css.slice(segStart, i)
      const kind = top()
      if (keep(seg, kind)) out += seg
      if (kind !== 'drop') out += '}'
      if (stack.length > 1) stack.pop()
      segStart = i + 1
    }
  }
  const tail = css.slice(segStart)
  if (keep(tail, top())) out += tail
  return out.replace(RAW_CLOSE_TAG, '<\\/$1')
}

/**
 * HTML 속성값 이스케이프 — 직렬화 때 "…" 안에 안전하게 넣는다(DOM 파싱이 되돌려 라운드트립이 같다).
 * | 도 &#124; 로 — GFM 표 셀 안의 인라인 모양(<span style="font-family:'A|B'">)이 셀 구분자로 잘리지 않게(markdown-it 은 표 행을
 * HTML 해석 전에 | 로 나눈다). DOM 이 엔티티를 | 로 되돌리므로 다시 읽은 값은 같다.
 */
export function escapeHtmlAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\|/g, '&#124;')
}
