import { isWikiShapeNode, sanitizeStyleSheet } from '@smart-workplace/wiki-editor-schema'
import { Extension } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { Plugin, PluginKey } from '@tiptap/pm/state'

/**
 * 노트 HTML 모양의 화면 범위(WP-1240) — 페이지 스타일(wikiStyle) CSS 를 이 노트 본문 안에만 적용하고,
 * 노트 CSS·인라인 style 의 position:fixed·z-index 가 앱 화면(헤더·사이드바·대화상자)을 덮지 못하게 가둔다.
 *
 * - 본문 루트(.ProseMirror)에 `data-wiki-html-scope="<번호>"` 를 늘 달고, 모양 노드(wikiStyle·wikiHtmlBox·wikiHtmlSpan)가
 *   하나라도 있으면 `wiki-html-scope` 클래스를 더한다 — wiki-editor.css 가 그 클래스에 `contain: layout paint; isolation: isolate` 를 준다.
 *   (모양 없는 기존 노트는 클래스가 없어 화면이 그대로다 — 페인트 가둠이 첫 줄 위로 뜨는 접속자 이름표를 자르지 않게.)
 * - 문서의 모든 wikiStyle CSS 를 이어 붙여 범위 선택자로 가둔 뒤 <head> 에 <style> 하나(에디터당)로 넣고, 에디터가 없어지면 뺀다.
 *   에디터마다 번호가 달라 편집기·판 미리보기가 한 화면에 함께 떠도 서로의 CSS 가 섞이지 않는다.
 */

/** 범위 번호 — 에디터마다 하나. 테스트에서 예측 가능하도록 난수 대신 증가 번호를 쓴다. */
let scopeSeq = 0

/** 범위 선택자 — 본문 루트의 data-wiki-html-scope 속성. */
export function wikiHtmlScopeSelector(id: string): string {
  return `[data-wiki-html-scope="${id}"]`
}

/** 따옴표·괄호·대괄호 밖의 쉼표로 선택자 목록을 나눈다(:is(.a, .b)·[title="a,b"] 는 한 선택자). */
function splitSelectorList(text: string): string[] {
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
    else if (c === '(' || c === '[') depth++
    else if (c === ')' || c === ']') depth = Math.max(0, depth - 1)
    else if (c === ',' && depth === 0) {
      parts.push(text.slice(start, i))
      start = i + 1
    }
  }
  parts.push(text.slice(start))
  return parts
}

/** 문서 루트를 가리키는 선택자(html·body·:root) — 타입 선택자로 쓰인 자리만(.body·#html·my-body 는 아니다). */
const ROOT_SELECTOR = /(^|[\s>+~(])(?:html|body|:root)(?![\w-])/gi
/** 루트 자리표시 — 선택자에 나올 수 없는 글자. */
const ROOT_MARK = '\u0000'

/** 루트 자리(범위 자신) 바로 뒤 복합 선택자 다음이 형제 조합자(~ +)인지 — `body ~ p`·`:root.dark + p` 는 범위 밖 형제를 가리킨다. */
const ROOT_THEN_SIBLING = new RegExp(`${ROOT_MARK}[^\\s>+~]*\\s*[+~]`)

/** 루트끼리 이어진 자리(html body·html > body) — scopeSelector 가 하나로 합친다. 호출마다 만들지 않게 모듈에 둔다. */
const ROOT_COLLAPSE = new RegExp(`${ROOT_MARK}\\s*>?\\s*${ROOT_MARK}`, 'g')

/**
 * 선택자 하나를 범위 안으로 — html·body·:root 는 범위 자신(본문 루트)으로, 그 밖은 범위의 자손으로 바꾼다.
 * `html body .x` → `<범위> .x`, `body.dark p` → `<범위>.dark p`, `.card p` → `<범위> .card p`.
 *
 * 범위에서 자손·자식 방향으로만 닿게 한다 — 범위 밖으로 나가는 선택자는 빈 글자(버림)로 돌려준다:
 * - 조합자로 시작하는 것(`~ .x` → `<범위> ~ .x` 는 본문 루트의 형제 = 앱 화면).
 * - 루트(=범위 자신) 뒤가 형제 조합자인 것(`body ~ div`·`:root.dark + p`). 괄호 안(:not(.a ~ .b))에 걸려도 보수적으로 버린다.
 * 범위 접두 뒤의 선택자는 그 자손에서 시작하므로, 이후의 ~ + > 는 모두 범위 안에 머문다.
 */
export function scopeSelector(selector: string, scope: string): string {
  // NUL 은 브라우저가 U+FFFD 로 바꾸는 글자다 — 루트 자리표시와 헷갈리지 않게 먼저 지운다.
  const sel = selector.split(ROOT_MARK).join('').trim()
  if (!sel || /^[>+~]/.test(sel)) return ''
  let marked = sel.replace(ROOT_SELECTOR, (_m, lead: string) => `${lead}${ROOT_MARK}`)
  // 루트끼리 이어진 것(html body·html > body)은 하나로 — 범위 안에 범위가 다시 있을 수 없다. 세 겹 이상도 합치도록 글자가 더 바뀌지 않을 때까지 바꾼다.
  for (let prev = ''; prev !== marked; ) {
    prev = marked
    marked = marked.replace(ROOT_COLLAPSE, ROOT_MARK)
  }
  if (ROOT_THEN_SIBLING.test(marked)) return ''
  if (marked.startsWith(ROOT_MARK)) return marked.split(ROOT_MARK).join(scope)
  return `${scope} ${marked.split(ROOT_MARK).join(scope)}`
}

/**
 * 페이지 스타일 CSS 를 범위에 가둔다(순수 함수) — 공용 정리(sanitizeStyleSheet: @import·위험 선언·data:image/ 밖 url()·모르는 at-rule·
 * 중첩 규칙 제거)와 같은 걷기로 일반 규칙의 선택자 목록만 바꾼다. @media·@supports 안쪽도 바꾸고, @keyframes·@font-face 는 그대로 둔다.
 * 범위 밖을 가리키는 선택자는 목록에서 빠진다(scopeSelector). 모두 빠지면 선택자 없는 규칙이 되어 브라우저가 버린다.
 * attrs 는 Yjs 로 파싱 없이 들어올 수 있어 화면에 넣기 직전에 다시 거른다.
 */
export function scopeCss(css: string, scope: string): string {
  return sanitizeStyleSheet(css, (prelude) => {
    // 앞 공백(줄바꿈)은 남긴다 — 규칙 사이 줄바꿈이 사라져 한 줄로 붙지 않게(디버깅 때 읽기 쉽게).
    const text = prelude.replace(/\/\*[\s\S]*?(\*\/|$)/g, '')
    const lead = /^\s*/.exec(text)![0]
    return `${lead}${splitSelectorList(text.trim())
      .map((s) => scopeSelector(s, scope))
      .filter(Boolean)
      .join(', ')} `
  })
}

/** 범위 플러그인 상태 — 번호, 문서의 페이지 스타일 CSS(이어 붙인 원문), 모양 노드 유무. */
interface ScopeState {
  id: string
  css: string
  shaped: boolean
}

/**
 * 문서를 한 번 훑어 페이지 스타일 CSS 와 모양 노드 유무를 모은다.
 * 모양 유무가 정해진 뒤에는 글자 블록(문단·제목) 안으로 내려가지 않는다 — 글자는 shaped 판정에만 쓰이고, 남은 일인 페이지 스타일
 * 찾기는 블록 노드라 글자 블록 안에 있을 수 없다. 문서가 바뀔 때마다 처음부터 다시 훑으므로 모양을 지운 편집은 그대로 꺼진다.
 */
function collectShape(doc: PMNode): Omit<ScopeState, 'id'> {
  const css: string[] = []
  let shaped = false
  doc.descendants((node) => {
    if (node.type.name === 'wikiStyle') {
      css.push(String(node.attrs.css ?? ''))
      shaped = true
      return false
    }
    if (!shaped && isWikiShapeNode(node)) shaped = true
    return !(shaped && node.isTextblock)
  })
  return { css: css.join('\n'), shaped }
}

export const wikiHtmlScopeKey = new PluginKey<ScopeState>('wikiHtmlScope')

/** 범위 확장 — 스키마를 바꾸지 않는다(플러그인만). 노트 본문을 그리는 모든 화면(편집기·판 미리보기·공개 공유)에 넣는다. */
export const WikiHtmlScope = Extension.create({
  name: 'wikiHtmlScope',
  addProseMirrorPlugins() {
    return [
      new Plugin<ScopeState>({
        key: wikiHtmlScopeKey,
        state: {
          init: (_config, state) => ({ id: String(++scopeSeq), ...collectShape(state.doc) }),
          // 문서가 바뀔 때만 다시 훑는다(선택·데코레이션만 바뀐 트랜잭션은 그대로). 훑은 결과가 같으면 이전 값을 그대로 돌려준다
          // (상태 객체를 새로 만들지 않는다). CSS 범위 가두기는 view 의 sync 가 원문 CSS 비교로 거른다.
          apply: (tr, value) => {
            if (!tr.docChanged || tr.doc === tr.before) return value
            const next = collectShape(tr.doc)
            return next.css === value.css && next.shaped === value.shaped ? value : { id: value.id, ...next }
          },
        },
        props: {
          attributes(state) {
            const s = wikiHtmlScopeKey.getState(state)
            if (!s) return {}
            return { 'data-wiki-html-scope': s.id, ...(s.shaped ? { class: 'wiki-html-scope' } : {}) }
          },
        },
        view(view) {
          // <style> 은 CSS 가 생길 때 만들고, 같은 내용이면 다시 쓰지 않는다(입력마다 스타일 재계산을 일으키지 않게).
          // 범위 가두기(scopeCss)는 원문 CSS 가 바뀔 때만 한다 — 지난번에 넣은 원문과 같으면 바로 끝낸다.
          let el: HTMLStyleElement | null = null
          let rawApplied: string | null = null
          const sync = () => {
            const s = wikiHtmlScopeKey.getState(view.state)
            const raw = s?.css ?? ''
            if (raw === rawApplied) return
            rawApplied = raw
            const next = s && raw.trim() ? scopeCss(raw, wikiHtmlScopeSelector(s.id)) : ''
            if (!next) {
              el?.remove()
              el = null
              return
            }
            if (!el) {
              el = document.createElement('style')
              el.setAttribute('data-wiki-html-scope-style', s!.id)
              document.head.appendChild(el)
            }
            el.textContent = next
          }
          sync()
          return {
            update: sync,
            destroy() {
              el?.remove()
              el = null
            },
          }
        },
      }),
    ]
  },
})
