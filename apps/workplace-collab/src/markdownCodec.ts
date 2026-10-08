import { COLLAB_FRAGMENT, docToMarkdown, getMarkdownSchema, markdownToDoc } from '@smart-workplace/wiki-editor-schema'
import { trimmedLcsPairs } from '@smart-workplace/wiki-editor-schema/merge'
import { prosemirrorToYXmlFragment, updateYFragment, yXmlFragmentToProseMirrorRootNode } from 'y-prosemirror'
import * as Y from 'yjs'
import type { Node as PMNode } from '@tiptap/pm/model'

// TipTap Collaboration 필드명 — 웹 에디터와 같은 공용 규약 값.
export const FRAGMENT = COLLAB_FRAGMENT

/** 마크다운 → Yjs 업데이트(최초 이관·reconcile 용). 새 Y.Doc(새 clientID)에서 만들어진다. */
export function markdownToYUpdate(md: string): Uint8Array {
  const doc = new Y.Doc()
  prosemirrorToYXmlFragment(markdownToDoc(md), doc.getXmlFragment(FRAGMENT))
  return Y.encodeStateAsUpdate(doc)
}

/** Yjs 문서 → 마크다운(API 에 저장하는 파생 body). */
export function yDocToMarkdown(doc: Y.Doc): string {
  return docToMarkdown(yXmlFragmentToProseMirrorRootNode(doc.getXmlFragment(FRAGMENT), getMarkdownSchema()))
}

/** Yjs 업데이트(저장된 상태) → 마크다운 — 새 Y.Doc 에 적용해 파생 body 를 만든다(드라이런·테스트 모드 저장본 읽기). */
export function yUpdateToMarkdown(update: Uint8Array): string {
  return docToMarkdown(yUpdateToRoot(update))
}

/** Yjs 업데이트 → ProseMirror 루트 노드(새 Y.Doc 에 적용해 변환). 병합 워커가 실시간 문서의 구조를 받아 쓰는 길. */
export function yUpdateToRoot(update: Uint8Array): PMNode {
  const doc = new Y.Doc()
  Y.applyUpdate(doc, update)
  return yXmlFragmentToProseMirrorRootNode(doc.getXmlFragment(FRAGMENT), getMarkdownSchema())
}

/**
 * 마크다운을 공용 스키마로 한 번 왕복 — 현재본(Yjs 직렬화)과 같은 표기로 맞춘다(AI본·기준본 정규화, 스펙 §5.1-3-0).
 * 안 하면 `|a|b|` 와 `| a | b |` 처럼 표기만 다른 블록이 "AI 가 바꾼 블록"이 되어 사람 수정을 덮는다. 멱등(WP-283 스파이크).
 */
export function normalizeMarkdown(md: string): string {
  return docToMarkdown(markdownToDoc(md))
}

/** 문서 내용 안 위치(pos) 가 속한 최상위 블록 인덱스 — pos 이하에서 시작하는 마지막 블록. */
function blockIndexAt(doc: PMNode, pos: number): number {
  let index = 0
  doc.forEach((_child, offset, i) => {
    if (offset <= pos) index = i
  })
  return index
}

/**
 * 문서를 주어진 마크다운과 같아지도록 최소 변경 적용 — 바뀐 블록만 교체되어 다른 블록의 동시 편집·커서가 유지된다
 * (WP-283 확인). origin 은 Yjs 트랜잭션 출처(편집자 기록·스냅샷 판단에 쓴다). 버전 복원(replace)·재조정처럼 "문서 = 본문" 이 목적일 때 쓴다.
 * 병합 적용은 사람 입력을 지키는 keepLive 계획(planKeepLive → applyKeepLivePlan)을 쓴다.
 * @returns 바뀐 첫 최상위 블록 인덱스(✦ 표식 위치, 적용 후 문서 기준). 바뀐 게 없으면 null — 빈 트랜잭션도 만들지 않는다.
 */
export function replaceWithMarkdown(doc: Y.Doc, md: string, origin: unknown): number | null {
  return applyRoot(doc, markdownToDoc(md), origin)
}

/** 문서를 next 와 같게 최소 변경 적용(공통 본체) — 바뀐 첫 최상위 블록 인덱스, 바뀐 게 없으면 null. */
function applyRoot(doc: Y.Doc, next: PMNode, origin: unknown, before?: PMNode): number | null {
  const frag = doc.getXmlFragment(FRAGMENT)
  const prev = before ?? yXmlFragmentToProseMirrorRootNode(frag, getMarkdownSchema())
  const diff = prev.content.findDiffStart(next.content)
  if (diff == null) return null
  doc.transact(() => {
    // 4번째 인자는 y-prosemirror 의 바인딩 메타(노드↔Y 타입 매핑). 바인딩 없이 쓰므로 빈 맵.
    updateYFragment(doc, frag, next, { mapping: new Map(), isOMark: new Map() })
  }, origin)
  return Math.min(blockIndexAt(next, diff), Math.max(0, next.childCount - 1))
}

/**
 * keepLive 적용 계획(병합 적용 전용, WP-289) — 병합 결과의 최상위 블록마다, 실시간 문서의 그 인덱스 블록을 그대로 둔다(number) 또는
 * 이 노드로 바꾼다(ProseMirror JSON). 워커가 무거운 계산(블록 직렬화·정규화·LCS 짝짓기·끝 공백 되붙이기)을 모두 끝낸 결과라
 * 메인 스레드는 인덱스로 실시간 노드를 다시 쓰고 바뀐 블록만 JSON 에서 만든다(O(n), 직렬화·파싱 없음 — applyKeepLivePlan).
 * liveCount 는 계획을 만든 실시간 문서의 최상위 블록 수 — 적용 시점 문서와 다르면 계획이 낡은 것이다.
 */
export interface KeepLivePlan {
  liveCount: number
  blocks: Array<number | Record<string, unknown>>
}

/**
 * keepLive 계획 만들기(병합 워커에서 돈다) — live = "지금 문서"(병합이 소비한 현재본을 직렬화한 바로 그 상태), md = 병합 결과.
 * 마크다운 왕복은 사람이 친 일부를 잃는다 — 문단 끝 공백(치는 중 "단어 " 의 띄어쓰기), 빈 문단(방금 Enter 로 연 줄), 앞 공백 등.
 * 병합이 손대지 않은 블록까지 다시 파싱한 노드로 바꾸면 그게 실시간 문서에서 지워져 다음 글자가 앞 단어에 붙거나 커서 줄이 사라진다. 그래서
 *  - 병합 결과에서 그대로인 블록(블록 마크다운이 같음, 끝 공백 무시)은 실시간 노드를 그대로 둔다,
 *  - 마크다운에 안 나타나는 실시간 블록(빈 문단)은 제자리에 둔다,
 *  - 바뀐 블록도 끝이 실시간 블록 끝과 같으면 실시간 끝 공백을 그대로 다시 붙인다(새로 만들지 않는다).
 */
export function planKeepLive(live: PMNode, md: string): KeepLivePlan {
  const next = keepLiveDoc(live, markdownToDoc(md))
  const index = new Map<PMNode, number>()
  live.forEach((b, _offset, i) => index.set(b, i))
  const blocks: KeepLivePlan['blocks'] = []
  next.forEach((b) => blocks.push(index.get(b) ?? (b.toJSON() as Record<string, unknown>)))
  return { liveCount: live.childCount, blocks }
}

/**
 * keepLive 계획 적용(메인 스레드) — 실시간 블록은 인덱스로 그대로 다시 쓰고, 바뀐 블록만 JSON 에서 만든 뒤 최소 변경 적용한다.
 * 마크다운 직렬화·파싱·LCS 를 하지 않는다(그건 워커가 했다). 계획을 만든 상태와 지금 문서가 같아야 한다(호출자가 변경 순번으로 보장).
 * @returns 바뀐 첫 최상위 블록 인덱스(✦ 표식 위치). 바뀐 게 없으면 null.
 */
export function applyKeepLivePlan(doc: Y.Doc, plan: KeepLivePlan, origin: unknown): number | null {
  const schema = getMarkdownSchema()
  const before = yXmlFragmentToProseMirrorRootNode(doc.getXmlFragment(FRAGMENT), schema)
  if (before.childCount !== plan.liveCount) {
    // 계획이 적용 시점 문서와 맞지 않는다(최상위 블록 수가 다름) — 아무것도 적용하지 않고 실패로 끝낸다.
    throw new Error(`keepLive plan for ${plan.liveCount} blocks, document has ${before.childCount}`)
  }
  const children = plan.blocks.map((b) => (typeof b === 'number' ? before.child(b) : schema.nodeFromJSON(b)))
  return applyRoot(doc, schema.topNodeType.create(null, children), origin, before)
}

/** 노드 하나를 문서로 감싸는 함수 — 하위 블록(목록 항목·표 셀 등)을 조상 구조째 직렬화해 비교 키를 만든다. */
type Wrap = (node: PMNode) => PMNode

/** 비교 키 — 블록 마크다운에서 끝 공백을 뺀 것. 빈 문단처럼 마크다운에 안 나타나면 ''. */
const keyOf = (md: string): string => md.replace(/\s+$/, '')

/** 블록을 감싼 문서의 마크다운(끝 공백 포함) — 원래 키와 정규화 키를 모두 이 한 번의 직렬화에서 만든다. */
const serialize = (node: PMNode, wrap: Wrap): string => docToMarkdown(wrap(node))

/**
 * keepLive 의 본체(워커) — 병합 결과(parsed)의 최상위 블록을 실시간 문서(live) 블록과 짝지어, 병합이 손대지 않은 블록은 실시간 노드로 되돌린다.
 * 빈 노트(보이는 블록 없음)에 처음 쓰는 경우는 남길 사람 입력이 없으니 빈 줄을 앞에 남기지 않고 병합 결과 그대로.
 */
function keepLiveDoc(live: PMNode, parsed: PMNode): PMNode {
  const wrap: Wrap = (n) => getMarkdownSchema().topNodeType.create(null, n)
  // 최상위 실시간 블록은 여기서 한 번만 직렬화해 keepLiveChildren 에 넘긴다(보이는 블록 판정과 짝짓기 키에 같이 쓴다).
  const liveMd: string[] = []
  live.forEach((b) => liveMd.push(serialize(b, wrap)))
  return liveMd.some((md) => keyOf(md) !== '') ? keepLiveChildren(live, parsed, wrap, liveMd) : parsed
}

/**
 * live·parsed 의 자식들을 짝지어 다시 짓는다(최상위 블록, 그리고 바뀐 컨테이너 블록 안에서 재귀로 목록 항목·인용 문단·표 행/셀).
 * - "손대지 않음" 판정: 병합이 소비한 현재본은 실시간 블록의 직렬화이고, 그대로 가져온 블록은 파싱되며 정규화된다. 그래서 실시간 블록 키는
 *   그 직렬화를 한 번 파싱·직렬화한(정규화한) 형태로 병합 결과 키와 비교한다 — 앞 공백처럼 왕복하지 않는 블록도 손대지 않았으면 같다.
 *   (그대로 맞는 흔한 경우엔 정규화를 생략한다 — 블록마다 파싱하는 비용을 바뀐 블록에만 쓴다.)
 * - 짝짓기는 키의 최장 공통 부분열. 짝은 실시간 노드를 그대로, 짝 사이 구간이 병합이 바꾼 자리다.
 * - 마크다운에 안 나타나는 실시간 블록(빈 문단)은 병합이 볼 수 없었으니 구간 안 제자리에 남긴다. 블록 수가 달라진 구간에선 앞뒤 것만 남고
 *   가운데 것은 빠진다(AI 가 다시 쓴 자리 — 받아들인다).
 * - 1:1 로 바뀐 블록은 같은 종류면 안으로 내려가(keepLiveNode) 사람이 막 친 끝 공백을 지킨다.
 */
function keepLiveChildren(live: PMNode, parsed: PMNode, wrap: Wrap, liveMd?: string[]): PMNode {
  const L: PMNode[] = []
  const N: PMNode[] = []
  live.forEach((b) => L.push(b))
  parsed.forEach((b) => N.push(b))
  const nk = N.map((n) => keyOf(serialize(n, wrap)))
  const nkSet = new Set(nk)
  // 실시간 블록은 한 번만 직렬화하고(최상위는 호출자가 이미 한 것), 원래 키가 안 맞을 때만 그 직렬화를 정규화한다.
  const lk = L.map((b, i) => {
    const md = liveMd?.[i] ?? serialize(b, wrap)
    const raw = keyOf(md)
    return raw === '' || nkSet.has(raw) ? raw : keyOf(normalizeMarkdown(md))
  })
  const hidden = (i: number) => lk[i] === ''
  const vis = L.map((_, i) => i).filter((i) => !hidden(i))
  // 가운데 구간이 LCS 표 상한(MAX_LCS_CELLS)을 넘으면(거대한 문서를 통째로 바꾼 경우) 가운데를 한 구간으로 본다(워커 시간 보호).
  // 그 구간의 블록 수가 달라졌으면 실시간 노드를 못 살려 끝 공백·빈 문단을 잃는다 — 드문 경우로 받아들인다.
  const pairs = trimmedLcsPairs(
    vis.map((i) => lk[i]),
    nk,
  ).map(([v, j]) => [vis[v], j] as const)

  const out: PMNode[] = []
  let li = 0
  let nj = 0
  const flushGap = (lEnd: number, nEnd: number) => {
    const gap = Array.from({ length: lEnd - li }, (_, k) => li + k)
    const nGap = N.slice(nj, nEnd)
    const shown = gap.filter((i) => !hidden(i))
    if (nGap.length === 0) {
      // 병합이 지운 블록 — 보이는 블록은 지우고, 빈 문단 같은 보이지 않는 블록은 남긴다.
      for (const i of gap) if (hidden(i)) out.push(L[i])
    } else if (shown.length === nGap.length) {
      // 1:1 로 바뀐 구간 — 실시간 순서대로 걸으며 보이는 블록 자리에 바뀐 블록(안쪽 사람 입력 보존)을 넣는다.
      let k = 0
      for (const i of gap) out.push(hidden(i) ? L[i] : keepLiveNode(L[i], nGap[k++], wrap))
    } else {
      // 블록 수가 달라진 구간 — 앞뒤의 보이지 않는 블록만 제자리에 두고 가운데는 병합 결과로.
      const first = shown.length ? shown[0] : lEnd
      const last = shown.length ? shown[shown.length - 1] : lEnd
      for (const i of gap) if (i < first) out.push(L[i])
      out.push(...nGap)
      for (const i of gap) if (i > last) out.push(L[i])
    }
    li = lEnd
    nj = nEnd
  }
  for (const [i, j] of pairs) {
    flushGap(i, j)
    out.push(L[i])
    li = i + 1
    nj = j + 1
  }
  flushGap(L.length, N.length)
  return parsed.type.create(parsed.attrs, out, parsed.marks)
}

/**
 * 병합이 바꾼 블록 하나 — 글 블록이면 끝 공백을 되붙이고, 같은 종류의 컨테이너(목록·인용·표·행·셀·항목)면 그 안을 다시 짝짓는다.
 * 그래서 목록 셋째 항목 끝에 친 공백도 AI 가 첫 항목을 고칠 때 지워지지 않는다.
 */
function keepLiveNode(live: PMNode, changed: PMNode, wrap: Wrap): PMNode {
  if (live.type !== changed.type) return changed
  if (live.isTextblock) return keepTrailingSpace(live, changed)
  if (live.isLeaf || live.childCount === 0 || changed.childCount === 0) return changed
  return keepLiveChildren(live, changed, (c) => wrap(changed.type.create(changed.attrs, c)))
}

/**
 * 병합이 바꾼 글 블록(changed)에 실시간 글 블록(live)의 끝 공백을 되붙인다 — 같은 문단 다른 곳을 AI 가 고쳐도 사람이 막 친
 * "단어 " 의 띄어쓰기가 사라지지 않게. 바뀐 블록의 끝이 실시간 블록의 (공백 뺀) 끝과 같을 때만, 실시간에 있던 공백 그대로를
 * 실시간 공백의 서식(마지막 글자 노드의 마크)으로 붙인다 — 굵은 글 뒤에 친 평문 공백이 굵게 바뀌지 않게.
 */
function keepTrailingSpace(live: PMNode, changed: PMNode): PMNode {
  const ws = /[ \t\u00a0]+$/.exec(live.textContent)?.[0]
  const last = changed.lastChild
  const liveLast = live.lastChild
  if (!ws || !last?.isText || !liveLast?.isText) return changed
  const tail = live.textContent.slice(0, -ws.length).slice(-8)
  if (!tail || !changed.textContent.endsWith(tail) || /\s$/.test(changed.textContent)) return changed
  const space = last.type.schema.text(ws, liveLast.marks)
  const content = last.sameMarkup(space)
    ? changed.content.replaceChild(changed.childCount - 1, last.type.schema.text(last.text + ws, last.marks))
    : changed.content.addToEnd(space)
  return changed.copy(content)
}
