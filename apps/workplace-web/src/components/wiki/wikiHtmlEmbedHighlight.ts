// 노트 HTML 블록 소스 칸 색 구분(WP-1300) — 소스(노드 글자)를 작은 HTML 토크나이저로 나눠, 소스 칸을 연 블록에만 인라인 데코레이션(class)으로 칠한다.
// 코드 편집기 라이브러리를 쓰지 않는 이유: 소스는 노드 글자(ProseMirror contentDOM → Yjs 텍스트)여야 동시 편집·판 기록이 그대로 유지된다.
// 그래서 글자는 그대로 두고 화면 꾸밈(데코레이션)만 얹는다.
import { WikiHtmlEmbedSchema } from '@smart-workplace/wiki-editor-schema'
import type { Node as PMNode } from '@tiptap/pm/model'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

import { htmlEmbedSourceKey, isHtmlEmbedSourceOpen } from './wikiHtmlEmbedSource'

/** 토큰 종류 — 태그(꺾쇠·이름)·속성 이름·속성 값(따옴표 포함)·주석·문서 선언(<!doctype …>). 그 밖 글자는 토큰을 만들지 않는다(보통 글자). */
export type HtmlTokenType = 'tag' | 'attr' | 'value' | 'comment' | 'doctype'

/** 토큰 하나 — from·to 는 소스 글자 위치(끝 미포함). */
export interface HtmlToken {
  type: HtmlTokenType
  from: number
  to: number
}

/** 이보다 긴 소스는 칠하지 않는다(글자 수) — 고칠 때마다 블록 소스 전체를 다시 나누므로, 긴 소스(5만 자 넘음)는 타자가 느려진다.
 * 칠하기는 보조 기능이라 빼도 편집은 된다. */
export const HIGHLIGHT_MAX_CHARS = 50_000

/** 몸통을 글자로 다루는 요소 — 안의 `<`·따옴표를 태그·값으로 보지 않고 닫는 태그까지 건너뛴다(스크립트·CSS 를 HTML 로 잘못 칠하지 않게). */
const RAW_TEXT_TAGS = new Set(['script', 'style', 'textarea', 'title'])

const isSpace = (c: string | undefined) => c === ' ' || c === '\n' || c === '\t' || c === '\r' || c === '\f'
const TAG_NAME = /[A-Za-z0-9:_-]/
const ATTR_STOP = /[\s"'>/=]/

/**
 * HTML 소스를 색 구분용 토큰으로 나눈다(순수 함수). 브라우저 파서만큼 엄밀하지 않고 「사람이 읽기 좋게 칠하기」만 한다 —
 * 닫히지 않은 주석·따옴표·태그는 소스 끝까지 그 종류로 본다. 보통 글자는 토큰이 없다.
 * - `<!-- … -->` 주석, `<!…>` 선언(doctype 등)
 * - `<이름` · `</이름` · `>` · `/>` 는 tag, 태그 안 속성 이름은 attr, `=` 뒤 값(따옴표 포함·없는 값)은 value
 * - script·style 등은 여는 태그 뒤부터 닫는 태그 앞까지 보통 글자
 */
export function tokenizeHtml(src: string): HtmlToken[] {
  const out: HtmlToken[] = []
  const n = src.length
  // 닫는 태그 찾기용 소문자 사본 — 필요할 때 한 번만 만든다(script·style 여는 태그마다 수 MB 를 다시 바꾸지 않게).
  let lower: string | null = null
  let i = 0
  while (i < n) {
    const lt = src.indexOf('<', i)
    if (lt < 0) break
    i = lt
    if (src.startsWith('<!--', i)) {
      const end = src.indexOf('-->', i + 4)
      const to = end < 0 ? n : end + 3
      out.push({ type: 'comment', from: i, to })
      i = to
      continue
    }
    if (src[i + 1] === '!' || src[i + 1] === '?') {
      const end = src.indexOf('>', i + 2)
      const to = end < 0 ? n : end + 1
      out.push({ type: 'doctype', from: i, to })
      i = to
      continue
    }
    const closing = src[i + 1] === '/'
    let j = i + (closing ? 2 : 1)
    const nameStart = j
    while (j < n && TAG_NAME.test(src[j])) j++
    // `<` 뒤에 이름이 없으면(비교식 `a < b` 등) 보통 글자.
    if (j === nameStart) {
      i++
      continue
    }
    const name = src.slice(nameStart, j).toLowerCase()
    out.push({ type: 'tag', from: i, to: j })
    i = scanAttributes(src, j, out)
    if (!closing && RAW_TEXT_TAGS.has(name)) {
      // 몸통은 닫는 태그(대소문자 무시) 앞까지 건너뛴다 — 없으면 소스 끝까지 몸통.
      lower ??= src.toLowerCase()
      const close = lower.indexOf(`</${name}`, i)
      i = close < 0 ? n : close
    }
  }
  return out
}

/** 태그 이름 뒤부터 태그 끝(`>`·`/>`)까지 속성을 읽어 토큰을 넣고, 태그 다음 위치를 돌려준다. */
function scanAttributes(src: string, start: number, out: HtmlToken[]): number {
  const n = src.length
  let k = start
  while (k < n) {
    const c = src[k]
    if (isSpace(c)) {
      k++
      continue
    }
    if (c === '>') {
      out.push({ type: 'tag', from: k, to: k + 1 })
      return k + 1
    }
    if (c === '/' && src[k + 1] === '>') {
      out.push({ type: 'tag', from: k, to: k + 2 })
      return k + 2
    }
    if (c === '"' || c === "'") {
      // 이름 없는 따옴표(잘못 쓴 소스) — 값처럼 칠하고 넘어간다.
      k = scanQuoted(src, k, out)
      continue
    }
    if (c === '=' || c === '/') {
      k++
      continue
    }
    // 속성 이름
    let e = k
    while (e < n && !ATTR_STOP.test(src[e])) e++
    if (e === k) {
      k++
      continue
    }
    out.push({ type: 'attr', from: k, to: e })
    k = e
    let v = k
    while (isSpace(src[v])) v++
    if (src[v] !== '=') continue
    v++
    while (isSpace(src[v])) v++
    if (src[v] === '"' || src[v] === "'") {
      k = scanQuoted(src, v, out)
    } else {
      let ve = v
      while (ve < n && !isSpace(src[ve]) && src[ve] !== '>') ve++
      if (ve > v) out.push({ type: 'value', from: v, to: ve })
      k = ve
    }
  }
  return n
}

/** q 위치의 따옴표 값을 짝 따옴표까지(없으면 끝까지) value 토큰으로 넣고 다음 위치를 돌려준다. */
function scanQuoted(src: string, q: number, out: HtmlToken[]): number {
  const end = src.indexOf(src[q], q + 1)
  const to = end < 0 ? src.length : end + 1
  out.push({ type: 'value', from: q, to })
  return to
}

/** 토큰 종류 → class. 색은 wiki-editor.css 가 시맨틱 토큰으로 준다(밝은·어두운 테마 모두). */
export const tokenClass = (type: HtmlTokenType) => `wiki-html-tok wiki-html-tok--${type}`

/** 노드별 토큰 캐시 — ProseMirror 노드는 바뀌지 않는 값이라 같은 노드면 다시 나누지 않는다(다른 블록을 고칠 때 이 블록은 그대로). */
const tokenCache = new WeakMap<PMNode, HtmlToken[]>()

function tokensOf(node: PMNode): HtmlToken[] {
  let tokens = tokenCache.get(node)
  if (!tokens) {
    const text = node.textContent
    tokens = text.length > HIGHLIGHT_MAX_CHARS ? [] : tokenizeHtml(text)
    tokenCache.set(node, tokens)
  }
  return tokens
}

/** 블록 하나(앞 위치 pos)의 토큰 → 인라인 데코레이션. 글자는 pos + 1 부터다. */
function blockDecorations(pos: number, node: PMNode): Decoration[] {
  const base = pos + 1
  return tokensOf(node).map((t) => Decoration.inline(base + t.from, base + t.to, { class: tokenClass(t.type) }))
}

/** 소스 칸을 연 HTML 블록들 — 앞 위치와 노드. */
function openBlocks(doc: PMNode, open: DecorationSet | undefined): Array<{ pos: number; node: PMNode }> {
  if (!open || open === DecorationSet.empty) return []
  const out: Array<{ pos: number; node: PMNode }> = []
  for (const d of open.find()) {
    const node = doc.nodeAt(d.from)
    if (node?.type.name === WikiHtmlEmbedSchema.name) out.push({ pos: d.from, node })
  }
  return out
}

/** 플러그인 상태 — 칠한 데코레이션과, 칠할 때 쓴 블록 노드들(다음 거래에서 바뀐 블록만 다시 칠하려고 노드 정체로 비교). */
interface HighlightState {
  set: DecorationSet
  nodes: Set<PMNode>
}

/** 처음부터 칠한다 — 편집기를 만들 때. */
function buildHighlight(doc: PMNode, open: DecorationSet | undefined): HighlightState {
  const blocks = openBlocks(doc, open)
  const decos = blocks.flatMap((b) => blockDecorations(b.pos, b.node))
  return { set: decos.length ? DecorationSet.create(doc, decos) : DecorationSet.empty, nodes: new Set(blocks.map((b) => b.node)) }
}

export const htmlEmbedHighlightKey = new PluginKey<HighlightState>('wikiHtmlEmbedHighlight')

/**
 * 소스 칸 색 구분 플러그인 — 열림 상태 플러그인(htmlEmbedSourcePlugin) 뒤에 둔다(apply 때 그 플러그인의 새 상태를 읽는다).
 * 문서가 바뀌었거나 연 블록 목록이 바뀐 거래에서만 손댄다 — 지난 데코레이션을 위치 매핑으로 옮기고, 바뀐 블록(노드가 달라짐·새로 염)만
 * 지우고 다시 칠하며, 닫힌 블록의 칠은 걷어 낸다. 연 블록이 없으면 비용이 없다.
 */
export function htmlEmbedHighlightPlugin(): Plugin<HighlightState> {
  return new Plugin<HighlightState>({
    key: htmlEmbedHighlightKey,
    state: {
      init: (_config, state) => buildHighlight(state.doc, htmlEmbedSourceKey.getState(state)),
      apply(tr, prev, oldState, newState) {
        const open = htmlEmbedSourceKey.getState(newState)
        const oldOpen = htmlEmbedSourceKey.getState(oldState)
        if (!tr.docChanged && open === oldOpen) return prev
        let set = prev.set.map(tr.mapping, tr.doc)
        // 닫힌(또는 열림 표지가 사라진) 블록의 칠을 걷는다 — 지워진 블록의 칠은 매핑이 이미 지웠다.
        for (const d of oldOpen?.find() ?? []) {
          const from = tr.mapping.mapResult(d.from, 1)
          if (from.deleted || isHtmlEmbedSourceOpen(newState, from.pos)) continue
          set = set.remove(set.find(from.pos, tr.mapping.map(d.to, -1)))
        }
        const blocks = openBlocks(newState.doc, open)
        for (const { pos, node } of blocks) {
          const end = pos + node.nodeSize
          const kept = set.find(pos, end)
          // 같은 노드이고 매핑 뒤에도 칠이 남아 있으면 그대로 — 동기화 반영(문서 통째 바꾸기)은 매핑이 칠을 지우므로 다시 칠한다.
          if (prev.nodes.has(node) && (kept.length > 0 || tokensOf(node).length === 0)) continue
          set = set.remove(kept).add(newState.doc, blockDecorations(pos, node))
        }
        return { set, nodes: new Set(blocks.map((b) => b.node)) }
      },
    },
    props: {
      decorations: (state) => htmlEmbedHighlightKey.getState(state)?.set,
    },
  })
}
