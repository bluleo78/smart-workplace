import { alignBlocks } from '@smart-workplace/wiki-editor-schema/merge'
import { Fragment, Node as PMNode, type Schema } from '@tiptap/pm/model'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import DiffMatchPatch from 'diff-match-patch'

/**
 * 노트 버전 기록 "변경 표시"(WP-298, 스펙 §6.3) — 보는 판(from)과 다음 판(to)의 차이를 읽기 전용 미리보기용 데코레이션으로 계산한다.
 *
 * 왜 데코레이션만인가: 차이 전용 노드·마크를 스키마에 더하면 WIKI_SCHEMA_VERSION 핸드셰이크(WP-313)가 옛 탭을 막는다.
 * 그래서 결과 문서는 공용 스키마 그대로 — 보는 판 구조에 "다음 판에만 있는 블록"만 끼워 넣고, 표시는 좌표(marks)로 따로 준다.
 * 새로 쓴 글자는 본문에 끼우지 않고 위젯으로 그린다(텍스트 블록 구조를 건드리지 않아 위치 계산이 단순하다).
 *
 * 짝짓기는 3-way 병합과 같은 `alignBlocks`(블록 정렬, 유사도 문턱 포함)를 형제 노드 목록마다 재사용한다. 키에 노드 종류를 앞에 붙여
 * (`type:글자`) 짧은 글자(예: "셋"→"셋째")도 공통 접두가 유사도를 받쳐 같은 블록으로 짝지어지게 하고, 종류가 다른 짝은 버린다.
 * 위 접두 때문에 같은 종류의 아주 짧은 서로 다른 블록끼리 짝지어질 수 있는데, 그때는 블록 안 교체로 보일 뿐 내용은 정확하다.
 * 블록 안 비교는 낱말(어절·공백) 단위다(textDiffMarks).
 */

/** 미리보기용 차이 결과 — doc 은 "보는 판" 구조에 다음 판에만 있는 노드를 끼워 넣은 문서, marks 는 그 문서 좌표의 표시. */
export type RevisionDiffMark =
  | { kind: 'added-node' | 'removed-node'; from: number; to: number } // 블록 통째 추가(초록)·삭제(빨강 취소선)
  | { kind: 'removed-text'; from: number; to: number } // 글자 삭제(빨강 취소선)
  | { kind: 'added-text'; pos: number; text: string } // 글자 추가(초록, 위젯)

/** 낱말 diff 를 하는 텍스트 블록. */
const TEXT_BLOCKS = new Set(['paragraph', 'heading', 'codeBlock'])
/** 다르면 자식으로 내려가 비교하는 컨테이너. 나머지(표·이미지 등)는 블록 통째로 바꾼 것으로 본다. */
const CONTAINERS = new Set(['bulletList', 'orderedList', 'taskList', 'listItem', 'taskItem', 'blockquote'])
/** 블록 하나 글자 diff 상한 — 넘으면 블록 단위(지움+추가)로 낮춘다(diff 비용이 글자 수에 비례해 미리보기가 멈추지 않게). */
const MAX_TEXT_DIFF_CHARS = 10_000

const dmp = new DiffMatchPatch()
// 미리보기는 사용자를 기다리게 하므로 아주 큰 블록은 거친 diff 로 끊는다(병합과 같은 값).
dmp.Diff_Timeout = 0.2
// diff-match-patch 연산 코드(라이브러리 문서 값).
const EQUAL = 0
const DELETE = -1
const INSERT = 1

/** 형제 목록 비교 결과 — 결과 노드들과 그 좌표의 표시. */
interface ChildrenDiff {
  nodes: PMNode[]
  marks: RevisionDiffMark[]
}

/**
 * 인라인 비텍스트 노드(hardBreak·멘션·이미지)마다 글자 diff 입력에 넣는 자리표시 — 사설 영역 글자 하나.
 * 노드 종류마다 다른 글자를 써서 멘션이 줄바꿈과 짝지어지지 않게 한다. 한 글자 = nodeSize 1 이라 diff 오프셋이 곧 블록 내용 오프셋이 된다
 * (인라인 노드를 빼고 diff 하면 줄바꿈 바로 뒤에 넣은 글자가 앞 줄 끝에 붙어 보였다 — 리뷰 1차).
 */
const LEAF_BASE = 0xe000
const leafChars = new Map<string, string>() // 노드 종류 → 자리표시
const leafNames = new Map<string, string>() // 자리표시 → 노드 종류(위젯 글자 복원용)
function leafChar(typeName: string): string {
  let ch = leafChars.get(typeName)
  if (ch === undefined) {
    ch = String.fromCharCode(LEAF_BASE + leafChars.size)
    leafChars.set(typeName, ch)
    leafNames.set(ch, typeName)
  }
  return ch
}
/** 추가된 인라인 노드를 위젯에서 읽히게 — 멘션 라벨은 문서에 없어(화면 조회) 기호로 대신한다. */
const LEAF_LABELS: Record<string, string> = { hardBreak: '↵', mention: '@', image: '[이미지]' }

/** 블록 내용 → diff 입력 글자. 텍스트는 그대로, 인라인 비텍스트 노드는 자리표시 한 글자(길이 = 블록 내용 크기). */
function blockText(node: PMNode): string {
  let out = ''
  node.forEach((child) => {
    out += child.isText ? child.text! : leafChar(child.type.name)
  })
  return out
}

/** 위젯용 — 자리표시를 읽을 수 있는 기호로 바꾼다. */
function readableText(text: string): string {
  let out = ''
  for (const ch of text) {
    const name = leafNames.get(ch)
    out += name === undefined ? ch : (LEAF_LABELS[name] ?? '·')
  }
  return out
}

/**
 * 낱말 단위 토큰 — 공백 묶음, 공백 아닌 글자 묶음(어절), 인라인 노드 자리표시(한 글자씩).
 * 글자 단위로 비교하면 한국어 어절이 쪼개져("CRDT 없이 병합으로" → "Yjs로" 가 "병합으"·"로" 처럼) 읽기 어려웠다(WP-298 리뷰).
 */
const TOKEN_RE = /[\uE000-\uF8FF]|\s+|[^\s\uE000-\uF8FF]+/gu

/**
 * 낱말 diff — diff-match-patch 의 linesToChars 방식처럼 토큰마다 글자 하나를 배정해 비교하고 다시 토큰 글자로 푼다.
 * 배정 글자는 1 부터 쓴다(상한 MAX_TEXT_DIFF_CHARS 라 토큰 수가 서로게이트 영역 0xD800 에 닿지 않는다).
 */
function wordDiff(ta: string, tb: string): [number, string][] {
  const tokens: string[] = []
  const codes = new Map<string, string>()
  const encode = (text: string) =>
    (text.match(TOKEN_RE) ?? [])
      .map((t) => {
        let c = codes.get(t)
        if (c === undefined) {
          tokens.push(t)
          c = String.fromCharCode(tokens.length)
          codes.set(t, c)
        }
        return c
      })
      .join('')
  const diffs = dmp.diff_main(encode(ta), encode(tb), false)
  dmp.diff_cleanupSemantic(diffs)
  return diffs.map(([op, chars]) => [op, Array.from(chars, (c) => tokens[c.charCodeAt(0) - 1]).join('')])
}

/** 두 글자열에 공통 글자가 하나라도 있는지 — 낱말이 하나도 겹치지 않을 때 블록 안 교체로 볼지, 무관한 블록으로 볼지 가른다. */
function shareAnyChar(ta: string, tb: string): boolean {
  const set = new Set(ta)
  for (const ch of tb) if (set.has(ch)) return true
  return false
}

/**
 * 같은 종류 텍스트 블록 a→b 의 낱말 차이 표시(a 가 문서 위치 pos 에 있다). null 이면 호출자가 블록 단위(지움+추가)로 표시:
 * 글자가 같음(서식·attrs 만 다름), 상한 초과, 공통 글자가 하나도 없음(무관한 짧은 문단이 줄 전체 취소선 + 위젯으로 보이지 않게).
 * 겹치는 낱말은 없지만 글자는 겹치면("셋"→"셋째", 줄바꿈만 지움) 블록 구조는 두고 안에서 전체 지움 + 새 글자 위젯으로 보인다.
 */
function textDiffMarks(a: PMNode, b: PMNode, pos: number): RevisionDiffMark[] | null {
  const ta = blockText(a)
  const tb = blockText(b)
  if (ta === tb || ta.length > MAX_TEXT_DIFF_CHARS || tb.length > MAX_TEXT_DIFF_CHARS) return null
  let diffs = wordDiff(ta, tb)
  if (!diffs.some(([op]) => op === EQUAL)) {
    if (!shareAnyChar(ta, tb)) return null
    diffs = [
      [DELETE, ta],
      [INSERT, tb],
    ]
  }
  const marks: RevisionDiffMark[] = []
  const base = pos + 1 // 블록 내용 시작
  let offset = 0 // a 내용 기준 오프셋(자리표시 덕에 문서 오프셋과 같다)
  for (const [op, text] of diffs) {
    if (op === DELETE) {
      if (text) marks.push({ kind: 'removed-text', from: base + offset, to: base + offset + text.length })
      offset += text.length
    } else if (op === INSERT) {
      if (text) marks.push({ kind: 'added-text', pos: base + offset, text: readableText(text) })
    } else {
      offset += text.length
    }
  }
  return marks
}

/**
 * 형제 노드 목록 a(보는 판)·b(다음 판)를 비교해 결과 노드와 표시를 만든다. startPos = 첫 결과 노드가 놓일 문서 위치.
 * 짝 없는 a 는 제자리에 removed-node, 짝 없는 b 는 다음 짝 직전(같은 틈 안에선 지운 블록 뒤)에 끼워 added-node.
 */
function diffChildren(a: PMNode[], b: PMNode[], startPos: number): ChildrenDiff {
  const key = (n: PMNode) => `${n.type.name}:${n.textContent}`
  const raw = alignBlocks(a.map(key), b.map(key))
  // 종류가 다른 짝은 버리고, 순서가 뒤집힌 짝도 버린다(alignBlocks 는 단조 증가지만 끼워 넣기 순서가 이에 기대므로 방어).
  let last = -1
  const match = raw.map((j, i) => {
    if (j < 0 || j <= last || a[i].type !== b[j].type) return -1
    last = j
    return j
  })

  const nodes: PMNode[] = []
  const marks: RevisionDiffMark[] = []
  let pos = startPos
  let bCursor = 0
  /** 결과에 노드를 놓고(선택적으로 블록 표시) 위치를 넘긴다. */
  const put = (node: PMNode, kind?: 'added-node' | 'removed-node') => {
    if (kind) marks.push({ kind, from: pos, to: pos + node.nodeSize })
    nodes.push(node)
    pos += node.nodeSize
  }
  /** b[bCursor..until) 를 추가 블록으로 끼운다. */
  const flushAdded = (until: number) => {
    for (; bCursor < until; bCursor++) put(b[bCursor], 'added-node')
  }

  a.forEach((na, i) => {
    const j = match[i]
    if (j < 0) {
      put(na, 'removed-node')
      return
    }
    flushAdded(j)
    bCursor = j + 1
    const nb = b[j]
    if (na.eq(nb)) {
      put(na)
      return
    }
    const name = na.type.name
    if (TEXT_BLOCKS.has(name)) {
      const textMarks = textDiffMarks(na, nb, pos)
      if (textMarks) {
        marks.push(...textMarks)
        put(na)
        return
      }
    } else if (CONTAINERS.has(name) && na.sameMarkup(nb)) {
      // attrs 가 다르면(orderedList start·taskItem checked 등) 자식만 비교하면 그 변경이 안 보인다 — 아래 블록 단위로 낮춘다.
      const inner = diffChildren(childrenOf(na), childrenOf(nb), pos + 1)
      const content = Fragment.fromArray(inner.nodes)
      // 끼운 자식 때문에 내용 규칙(예: listItem 첫 자식은 문단)을 어기면 블록 단위로 낮춘다 — 결과 문서는 항상 유효해야 한다.
      if (na.type.validContent(content)) {
        marks.push(...inner.marks)
        put(na.copy(content))
        return
      }
    }
    // 표·이미지 등 통째 비교 대상, 서식만 바뀐(글자는 같은) 텍스트 블록, attrs 가 바뀌었거나 내용 규칙을 어긴 컨테이너 — 지움 + 바로 뒤 추가.
    // 한계: 글자와 서식이 함께 바뀐 텍스트 블록은 위 글자 diff 로 가므로 새 서식(굵게·제목 수준 등)은 표시되지 않는다.
    put(na, 'removed-node')
    put(nb, 'added-node')
  })
  flushAdded(b.length)
  return { nodes, marks }
}

/**
 * 보는 판(from)과 다음 판(to)의 차이. 결과 doc 은 from 구조 + to 에만 있는 블록, marks 는 그 doc 좌표.
 * to 의 노드를 from 트리에 그대로 끼우므로 스키마 인스턴스가 다르면(라이브 에디터 문서 vs markdownToDoc 리비전) from 스키마로 옮긴다 —
 * 안 옮기면 `eq` 가 모두 거짓이라 "전부 바뀜"으로 보이고 결과 문서도 섞인 스키마가 된다.
 * 결과 doc 은 from 의 스키마다. 다른 에디터에서 그리려면 `Node.fromJSON(editor.schema, doc.toJSON())` 으로 옮겨야 한다(좌표는 그대로).
 */
export function buildRevisionDiff(from: PMNode, to: PMNode): { doc: PMNode; marks: RevisionDiffMark[] } {
  const { nodes, marks } = diffChildren(childrenOf(from), childrenOf(toSchema(from.type.schema, to)), 0)
  return { doc: from.copy(Fragment.fromArray(nodes)), marks }
}

/** 같은 스키마면 그대로, 아니면 JSON 왕복으로 대상 스키마 노드로 옮긴다(노드 구조가 같아 좌표는 그대로다). */
export function toSchema(schema: Schema, doc: PMNode): PMNode {
  return doc.type.schema === schema ? doc : PMNode.fromJSON(schema, doc.toJSON())
}

/** 노드의 직속 자식 배열. */
function childrenOf(node: PMNode): PMNode[] {
  const out: PMNode[] = []
  node.forEach((c) => out.push(c))
  return out
}

/** 추가 글자 위젯 — 본문에 없는 글자를 초록으로 끼워 보인다. */
function addedTextWidget(text: string): HTMLElement {
  const span = document.createElement('span')
  span.className = 'wiki-diff-added'
  span.textContent = text
  return span
}

/** marks → DecorationSet(클래스 wiki-diff-added / wiki-diff-removed). 위젯은 span.wiki-diff-added. spec.kind 로 표시 종류를 남긴다. */
export function revisionDiffDecorations(doc: PMNode, marks: RevisionDiffMark[]): DecorationSet {
  const decos = marks.map((m) => {
    switch (m.kind) {
      case 'added-node':
        return Decoration.node(m.from, m.to, { class: 'wiki-diff-added' }, { kind: m.kind })
      case 'removed-node':
        return Decoration.node(m.from, m.to, { class: 'wiki-diff-removed' }, { kind: m.kind })
      case 'removed-text':
        return Decoration.inline(m.from, m.to, { class: 'wiki-diff-removed' }, { kind: m.kind })
      case 'added-text':
        // side -1: 위젯이 그 자리 앞 글자에 붙어 보이게(지운 글자 범위 바로 뒤에 새 글자가 이어진다).
        return Decoration.widget(m.pos, () => addedTextWidget(m.text), { kind: m.kind, side: -1, key: `add:${m.pos}:${m.text}` })
    }
  })
  return DecorationSet.create(doc, decos)
}
