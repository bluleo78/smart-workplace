import type { WikiMentionAttrs, WikiMentionType } from '@smart-workplace/wiki-editor-schema'
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
 *
 * 표(WP-324)는 행 목록을 같은 블록 정렬로 맞추고, 짝지은 행은 셀을 자리(열)대로 짝지어, 셀 안 블록을 다시 위 규칙으로 비교한다.
 * 열 수가 다르거나 병합 셀이 있으면 행을 끼웠을 때 열이 어긋나므로 지금처럼 표 통째 지움+추가로 물러선다.
 */

/** 미리보기용 차이 결과 — doc 은 "보는 판" 구조에 다음 판에만 있는 노드를 끼워 넣은 문서, marks 는 그 문서 좌표의 표시. */
export type RevisionDiffMark =
  | { kind: 'added-node' | 'removed-node'; from: number; to: number } // 블록 통째 추가(초록)·삭제(빨강 취소선)
  | { kind: 'removed-text'; from: number; to: number } // 글자 삭제(빨강 취소선)
  | { kind: 'added-text'; pos: number; segments: AddedSegment[] } // 글자 추가(초록, 위젯)

/**
 * 추가 글자 위젯의 조각 — 글자(줄바꿈·이미지는 읽을 수 있는 기호로 바꾼 것) 또는 멘션 대상.
 * 멘션 라벨은 문서에 없고 화면이 조회하므로(WikiMentionLabelsProvider) 대상만 넘기고, 그리는 쪽(revisionDiffDecorations)이 칩과 같은 글자로 바꾼다.
 */
export type AddedSegment = string | MentionTarget

/** 멘션 대상(종류·id). */
type MentionTarget = { mtype: WikiMentionType; id: number }

/** 멘션 대상 → 위젯에 보일 글자. 미리보기는 칩과 같은 라벨(USER 는 @ 접두)을 넘긴다. */
export type MentionTextOf = (mtype: WikiMentionType, id: number) => string

/** 낱말 diff 를 하는 텍스트 블록. */
const TEXT_BLOCKS = new Set(['paragraph', 'heading', 'codeBlock'])
/** 다르면 자식으로 내려가 비교하는 컨테이너. 표·행·셀은 innerDiff 가 따로 다루고, 나머지(이미지 등)는 블록 통째로 바꾼 것으로 본다. */
const CONTAINERS = new Set(['bulletList', 'orderedList', 'taskList', 'listItem', 'taskItem', 'blockquote'])
/** 표 셀 — 행 안에서 자리대로 짝지어 셀 안 블록을 비교한다(attrs 는 보지 않는다). */
const TABLE_CELLS = new Set(['tableCell', 'tableHeader'])
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
 * 멘션은 대상(mtype·id)마다 다른 글자다 — 종류만으로 가르면 같은 자리 멘션이 다른 사람으로 바뀌어도 "같음"으로 묻혔다(WP-324).
 *
 * 배정표는 비교 한 번(buildRevisionDiff)마다 새로 만든다 — 멘션 대상마다 글자를 쓰므로 모듈 전역에 두면 끝없이 늘어난다.
 * 두 판 글에 이미 있는 사설 영역 글자는 배정에서 건너뛴다 — 대상마다 글자를 쓰면 사용자 글과 겹칠 글자가 늘어나므로(예전엔 종류 몇 개뿐이었다).
 * 대상별로 가를지(배정 방식)는 첫 배정 때 두 판 전체를 한 번 보고 정한다 — 남은 글자가 모자라면 종류 글자로 물러서는데, 비교 도중에
 * 바꾸면 같은 멘션이 두 판에서 다른 글자(대상 글자 vs 종류 글자)가 되어 "바뀜"으로 보인다. 종류 글자 모드에선 위젯에 멘션 대상 대신 '@' 를 보인다.
 * 배정은 U+F8FF 를 넘지 않는다(넘으면 실제 글자인 CJK 호환 한자와 겹친다). 사설 영역이 사용자 글로 가득 차 남은 글자가 없으면
 * 마지막 글자(U+F8FF)를 함께 쓴다 — 그 글자와는 겹치지만 결과 문서는 유효하다(현실적으로 생기지 않는 경우).
 * 한계: 사설 영역 토큰 규칙(TOKEN_RE) 때문에 사용자 글 속 사설 영역 글자는 여전히 낱말이 아닌 한 글자씩 비교된다.
 */
const LEAF_BASE = 0xe000
const LEAF_END = 0xf8ff
/** 대상별 자리표시를 쓰려면 남겨야 하는 글자 수 — 종류 글자(hardBreak·image 등) 몫. */
const LEAF_RESERVE = 64
/** 추가된 인라인 노드를 위젯에서 읽히게 — 멘션은 대상을 아는 동안 조각으로 따로 넘기고(segments), 종류 글자 모드에서만 '@' 로 대신한다. */
const LEAF_LABELS: Record<string, string> = { hardBreak: '↵', wikiMention: '@', image: '[이미지]' }

/** 글 속 사설 영역 글자(텍스트 노드마다 정규식으로 찾는다). */
const PRIVATE_USE_RE = /[\uE000-\uF8FF]/g

/** 자리표시가 가리키는 인라인 노드 — 종류, 그리고 대상별 배정이면 멘션 대상. */
interface LeafRef {
  type: string
  mention?: MentionTarget
}

/** 비교 한 번의 자리표시 배정표 — 양쪽 판이 같은 표를 써야 같은 멘션이 같은 글자가 된다. */
class LeafCodes {
  private readonly chars = new Map<string, string>() // 키(종류 또는 종류+대상) → 자리표시
  private readonly refs = new Map<string, LeafRef>() // 자리표시 → 노드(위젯 글자·멘션 대상 복원용)
  private taken: Set<number> | null = null // 두 판 글에 이미 있는 사설 영역 글자(배정 제외). 첫 배정 때 채운다.
  private perTarget = false // 멘션을 대상별 글자로 가를지 — 첫 배정 때 한 번 정한다.
  private next = LEAF_BASE

  private readonly docs: PMNode[]

  constructor(docs: PMNode[]) {
    this.docs = docs
  }

  /**
   * 첫 배정 때 한 번만 두 판을 훑는다 — 인라인 비텍스트 노드가 없는 비교(대부분)는 글자를 훑지 않는다.
   * 종류 글자(hardBreak·image)도 사용자 글과 겹치면 안 되므로 멘션이 아니어도 첫 배정 전에 훑는다.
   */
  private prepare(): void {
    if (this.taken) return
    const taken = new Set<number>()
    const targets = new Set<string>()
    for (const doc of this.docs) {
      doc.descendants((n) => {
        if (n.isText) for (const m of n.text!.matchAll(PRIVATE_USE_RE)) taken.add(m[0].charCodeAt(0))
        else if (n.type.name === 'wikiMention') targets.add(mentionKey(mentionOf(n)))
      })
    }
    // 대상 수 + 종류 몫(LEAF_RESERVE)이 남은 글자 안에 들어갈 때만 대상별로 가른다.
    this.perTarget = targets.size + LEAF_RESERVE <= LEAF_END - LEAF_BASE + 1 - taken.size
    this.taken = taken
  }

  /** 남은 사설 영역 글자 하나 — U+F8FF 를 넘지 않는다(다 쓰면 U+F8FF 를 함께 쓴다). */
  private allocate(): string {
    while (this.next <= LEAF_END && this.taken!.has(this.next)) this.next++
    return String.fromCharCode(this.next <= LEAF_END ? this.next++ : LEAF_END)
  }

  /** 인라인 노드 → 자리표시. 대상별 배정이면 멘션은 대상까지 키에 넣는다. */
  charOf(node: PMNode): string {
    this.prepare()
    const type = node.type.name
    const mention = type === 'wikiMention' && this.perTarget ? mentionOf(node) : undefined
    const key = mention ? `${type}:${mentionKey(mention)}` : type
    let ch = this.chars.get(key)
    if (ch === undefined) {
      ch = this.allocate()
      this.chars.set(key, ch)
      if (!this.refs.has(ch)) this.refs.set(ch, { type, mention })
    }
    return ch
  }

  /** 블록 내용 → diff 입력 글자. 텍스트는 그대로, 인라인 비텍스트 노드는 자리표시 한 글자(길이 = 블록 내용 크기). */
  blockText(node: PMNode): string {
    let out = ''
    node.forEach((child) => {
      out += child.isText ? child.text! : this.charOf(child)
    })
    return out
  }

  /** 노드 아래 글자 전체(인라인·잎 노드는 자리표시) — 표 행 짝짓기 키용. 멘션만 든 셀도 대상이 다르면 키가 다르다. */
  deepText(node: PMNode): string {
    let out = ''
    node.descendants((n) => {
      if (n.isText) out += n.text!
      else if (n.isLeaf) out += this.charOf(n)
    })
    return out
  }

  /** 위젯용 — 자리표시를 읽을 수 있는 기호로 바꾸고, 대상을 아는 멘션은 따로 조각으로 남긴다(라벨은 화면이 채운다). */
  segments(text: string): AddedSegment[] {
    const out: AddedSegment[] = []
    let run = ''
    for (const ch of text) {
      const ref = this.refs.get(ch)
      if (ref?.mention) {
        if (run) out.push(run)
        run = ''
        out.push(ref.mention)
      } else {
        run += ref === undefined ? ch : (LEAF_LABELS[ref.type] ?? '·')
      }
    }
    if (run) out.push(run)
    return out
  }
}

/** 멘션 노드의 대상(mtype·id) — wikiMention 노드에만 부른다. */
function mentionOf(node: PMNode): MentionTarget {
  const { mtype, id } = node.attrs as WikiMentionAttrs
  return { mtype, id }
}

/** 멘션 대상 키(mtype:id). */
function mentionKey({ mtype, id }: MentionTarget): string {
  return `${mtype}:${id}`
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
function textDiffMarks(a: PMNode, b: PMNode, pos: number, leaves: LeafCodes): RevisionDiffMark[] | null {
  const ta = leaves.blockText(a)
  const tb = leaves.blockText(b)
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
      if (text) marks.push({ kind: 'added-text', pos: base + offset, segments: leaves.segments(text) })
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
function diffChildren(a: PMNode[], b: PMNode[], startPos: number, leaves: LeafCodes): ChildrenDiff {
  const key = (n: PMNode) => (n.type.name === 'tableRow' ? rowKey(n, leaves) : `${n.type.name}:${n.textContent}`)
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
    const pair = diffPair(na, nb, pos, leaves)
    if (pair) {
      marks.push(...pair.marks)
      put(pair.node)
      return
    }
    // 이미지 등 통째 비교 대상, 서식만 바뀐(글자는 같은) 텍스트 블록, attrs·열 구성이 바뀌었거나 내용 규칙을 어긴 컨테이너 — 지움 + 바로 뒤 추가.
    // 한계: 글자와 서식이 함께 바뀐 텍스트 블록은 위 글자 diff 로 가므로 새 서식(굵게·제목 수준 등)은 표시되지 않는다.
    put(na, 'removed-node')
    put(nb, 'added-node')
  })
  flushAdded(b.length)
  return { nodes, marks }
}

/** 짝지은 노드 하나의 비교 결과 — 결과 노드(보는 판 노드 또는 자식을 바꿔 복사한 노드)와 그 표시. */
interface NodeDiff {
  node: PMNode
  marks: RevisionDiffMark[]
}

/**
 * 같은 종류로 짝지은 a→b(a 가 문서 위치 pos 에 있다) — 같으면 그대로, 텍스트 블록은 낱말 diff, 나머지는 자식 비교.
 * null 이면 호출자가 블록 통째(지움+추가)로 표시하거나(diffChildren) 행 통째로 물러선다(diffRowCells).
 */
function diffPair(na: PMNode, nb: PMNode, pos: number, leaves: LeafCodes): NodeDiff | null {
  if (na.eq(nb)) return { node: na, marks: [] }
  if (TEXT_BLOCKS.has(na.type.name)) {
    const marks = textDiffMarks(na, nb, pos, leaves)
    return marks && { node: na, marks }
  }
  return innerDiff(na, nb, pos + 1, leaves)
}

/**
 * 같은 종류 비텍스트 블록 a→b 의 자식 비교(a 내용이 문서 위치 contentStart 에서 시작). null 이면 블록 통째 비교로 물러선다.
 * - 컨테이너(목록·인용): attrs 가 같을 때만 자식 비교 — 다르면(orderedList start 등) 자식만 비교하면 그 변경이 안 보인다.
 * - 표: attrs 와 열 구성이 같을 때만 행 정렬. 행: 셀을 자리대로 짝짓는다(diffRowCells).
 * - 셀: attrs 를 보지 않고 셀 안 블록을 비교한다 — 열 폭(colwidth)은 화면 배치라, 열 폭만 조절해도 그 열 모든 셀이 통째 바뀐 것으로 보이지 않게.
 */
function innerDiff(na: PMNode, nb: PMNode, contentStart: number, leaves: LeafCodes): NodeDiff | null {
  const name = na.type.name
  if (name === 'tableRow') return copyWith(na, diffRowCells(na, nb, contentStart, leaves))
  const aligned =
    TABLE_CELLS.has(name) || (na.sameMarkup(nb) && (CONTAINERS.has(name) || (name === 'table' && sameColumns(na, nb))))
  return aligned ? copyWith(na, diffChildren(childrenOf(na), childrenOf(nb), contentStart, leaves)) : null
}

/**
 * 자식 비교 결과로 a 를 복사한다. 끼운 자식 때문에 내용 규칙(예: listItem 첫 자식은 문단)을 어기면 null — 결과 문서는 항상 유효해야 한다.
 */
function copyWith(na: PMNode, inner: ChildrenDiff | null): NodeDiff | null {
  if (!inner) return null
  const content = Fragment.fromArray(inner.nodes)
  return na.type.validContent(content) ? { node: na.copy(content), marks: inner.marks } : null
}

/** 행 구분 글자 — 셀 글자 사이에 넣는 제어 문자(사용자 글에 나오지 않는다). 사설 영역 글자는 자리표시와 겹치므로 쓰지 않는다. */
const CELL_SEPARATOR = '\u001f'

/**
 * 표 행 짝짓기 키 — 셀 글자를 구분 글자로 잇고 멘션·이미지는 자리표시로 넣는다.
 * textContent 만 쓰면 'ab|c' 와 'a|bc' 가, 멘션·이미지만 든 행끼리가 같은 키가 되어 엉뚱한 행과 짝지어졌다.
 */
function rowKey(row: PMNode, leaves: LeafCodes): string {
  return `${row.type.name}:${childrenOf(row)
    .map((cell) => leaves.deepText(cell))
    .join(CELL_SEPARATOR)}`
}

/**
 * 두 표의 열 구성이 같아 행 단위로 비교할 수 있는지 — 병합 셀(colspan·rowspan)이 없고 모든 행의 셀 수가 같아야 한다.
 * 짝 없는 행은 그대로 끼워 넣으므로, 셀 수가 다른 행이 섞이면 들쭉날쭉한 표가 된다(스키마 내용 규칙으로는 걸러지지 않는다).
 */
function sameColumns(a: PMNode, b: PMNode): boolean {
  let cols = -1
  for (const table of [a, b]) {
    for (const row of childrenOf(table)) {
      if (cols < 0) cols = row.childCount
      if (row.childCount !== cols) return false
      for (const cell of childrenOf(row)) if (cell.attrs.colspan !== 1 || cell.attrs.rowspan !== 1) return false
    }
  }
  return true
}

/**
 * 짝지은 두 행의 셀을 자리(열)대로 비교한다 — 셀 하나만 지움·추가로 표시하면 그 행만 열이 늘거나 줄어 표가 어긋나므로,
 * 셀 종류(머리·본문)가 바뀌었거나 셀 안을 비교할 수 없는 자리가 있으면 null(행 통째 지움+추가).
 */
function diffRowCells(a: PMNode, b: PMNode, contentStart: number, leaves: LeafCodes): ChildrenDiff | null {
  if (a.childCount !== b.childCount) return null
  const nodes: PMNode[] = []
  const marks: RevisionDiffMark[] = []
  let pos = contentStart
  for (let i = 0; i < a.childCount; i++) {
    const ca = a.child(i)
    const cb = b.child(i)
    const cell = ca.type === cb.type ? diffPair(ca, cb, pos, leaves) : null
    if (!cell) return null
    marks.push(...cell.marks)
    nodes.push(cell.node)
    pos += cell.node.nodeSize
  }
  return { nodes, marks }
}

/**
 * 보는 판(from)과 다음 판(to)의 차이. 결과 doc 은 from 구조 + to 에만 있는 블록, marks 는 그 doc 좌표.
 * to 의 노드를 from 트리에 그대로 끼우므로 스키마 인스턴스가 다르면(라이브 에디터 문서 vs markdownToDoc 리비전) from 스키마로 옮긴다 —
 * 안 옮기면 `eq` 가 모두 거짓이라 "전부 바뀜"으로 보이고 결과 문서도 섞인 스키마가 된다.
 * 결과 doc 은 from 의 스키마다. 다른 에디터에서 그리려면 `Node.fromJSON(editor.schema, doc.toJSON())` 으로 옮겨야 한다(좌표는 그대로).
 */
export function buildRevisionDiff(from: PMNode, to: PMNode): { doc: PMNode; marks: RevisionDiffMark[] } {
  const next = toSchema(from.type.schema, to)
  const { nodes, marks } = diffChildren(childrenOf(from), childrenOf(next), 0, new LeafCodes([from, next]))
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

/** 라벨을 모를 때 멘션 자리 글자 — 순수 계산·테스트 기본값. 미리보기는 칩 라벨을 넘긴다. */
const MENTION_PLACEHOLDER: MentionTextOf = () => '@'

/** 추가 글자 조각 → 위젯 글자. 멘션은 mentionText(칩과 같은 라벨)로 바꾼다. */
export function addedTextOf(segments: AddedSegment[], mentionText: MentionTextOf = MENTION_PLACEHOLDER): string {
  return segments.map((s) => (typeof s === 'string' ? s : mentionText(s.mtype, s.id))).join('')
}

/**
 * marks → DecorationSet(클래스 wiki-diff-added / wiki-diff-removed). 위젯은 span.wiki-diff-added. spec.kind 로 표시 종류를 남긴다.
 * mentionText 가 바뀌면(멘션 라벨 조회 도착) 위젯 key 가 달라져 ProseMirror 가 위젯을 새로 그린다 — key 가 같으면 옛 DOM 을 재사용한다.
 */
export function revisionDiffDecorations(
  doc: PMNode,
  marks: RevisionDiffMark[],
  mentionText: MentionTextOf = MENTION_PLACEHOLDER,
): DecorationSet {
  const decos = marks.map((m) => {
    switch (m.kind) {
      case 'added-node':
        return Decoration.node(m.from, m.to, { class: 'wiki-diff-added' }, { kind: m.kind })
      case 'removed-node':
        return Decoration.node(m.from, m.to, { class: 'wiki-diff-removed' }, { kind: m.kind })
      case 'removed-text':
        return Decoration.inline(m.from, m.to, { class: 'wiki-diff-removed' }, { kind: m.kind })
      case 'added-text': {
        const text = addedTextOf(m.segments, mentionText)
        // side -1: 위젯이 그 자리 앞 글자에 붙어 보이게(지운 글자 범위 바로 뒤에 새 글자가 이어진다).
        return Decoration.widget(m.pos, () => addedTextWidget(text), { kind: m.kind, side: -1, key: `add:${m.pos}:${text}` })
      }
    }
  })
  return DecorationSet.create(doc, decos)
}
