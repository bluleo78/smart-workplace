// 노드 지시문(마크다운)을 최상위 블록으로 나누는 순수 모듈(WP-2092).
// 블록 하나만 고쳐도 나머지 글자는 한 바이트도 바뀌지 않게, 블록의 원문 위치(offset)와 블록 사이 공백(gap)을 그대로 보존한다.
import type { Nodes } from 'mdast'

import { markdownParser, mdastText } from '@/components/help/mdast'

export type InstructionBlockKind = 'heading' | 'table' | 'list' | 'code' | 'paragraph' | 'other'

export interface InstructionBlock {
  /** 원문에서 이 블록이 차지한 글자 그대로 */
  raw: string
  /** raw 끝부터 다음 블록 시작까지(마지막 블록은 원문 끝까지)의 글자 — 빈 줄 등 */
  gap: string
  /** 원문에서 raw 의 시작·끝 offset */
  start: number
  end: number
  kind: InstructionBlockKind
  /** 제목 블록일 때만 — `#` 와 앞뒤 공백을 뺀 글자 */
  heading?: { depth: number; text: string }
}

export interface InstructionDoc {
  /** 첫 블록 앞의 글자(블록이 없으면 원문 전체) */
  lead: string
  blocks: InstructionBlock[]
}

const KIND_BY_TYPE: Record<string, InstructionBlockKind> = {
  heading: 'heading',
  table: 'table',
  list: 'list',
  code: 'code',
  paragraph: 'paragraph',
}

/**
 * 원문을 mdast 최상위 노드 위치로 나눈다. 코드 펜스 안의 `## 가짜` 같은 글은 파서가 코드로 보므로 제목이 되지 않는다.
 * 위치 정보가 없는 노드는(정상적으로는 없다) 건너뛰고 앞 블록의 gap 에 흡수해 왕복 동일성을 지킨다.
 */
export function splitInstructionBlocks(src: string): InstructionDoc {
  const root = markdownParser.parse(src)
  const spans: { start: number; end: number; node: Nodes }[] = []
  for (const node of root.children as Nodes[]) {
    const start = node.position?.start.offset
    const end = node.position?.end.offset
    if (start === undefined || end === undefined) continue
    spans.push({ start, end, node })
  }
  if (spans.length === 0) return { lead: src, blocks: [] }

  const blocks = spans.map(({ start, end, node }, i): InstructionBlock => {
    const nextStart = i + 1 < spans.length ? spans[i + 1].start : src.length
    const block: InstructionBlock = {
      raw: src.slice(start, end),
      gap: src.slice(end, nextStart),
      start,
      end,
      kind: KIND_BY_TYPE[node.type] ?? 'other',
    }
    if (node.type === 'heading') {
      block.heading = { depth: node.depth, text: mdastText(node).trim() }
    }
    return block
  })
  return { lead: src.slice(0, spans[0].start), blocks }
}

/** 나눈 결과를 다시 원문으로 — `lead + Σ(raw + gap)`. */
export function joinInstructionBlocks(doc: InstructionDoc): string {
  return doc.lead + doc.blocks.map((b) => b.raw + b.gap).join('')
}

/** index 번째 블록의 원문 구간만 nextRaw 로 바꾼다 — 그 밖의 글자는 그대로다. */
export function replaceBlock(src: string, index: number, nextRaw: string): string {
  const block = splitInstructionBlocks(src).blocks[index]
  if (!block) return src
  return src.slice(0, block.start) + nextRaw + src.slice(block.end)
}

/** 끝에 새 블록을 붙인다 — 비었으면 그대로 이어 붙이고, 아니면 앞 블록과 빈 줄 하나로 띄운다. */
export function appendBlock(src: string, text: string): string {
  if (src.trim() === '') return src + text
  return src + (src.endsWith('\n') ? '\n' : '\n\n') + text
}

/** 목차용 — 2·3단계 제목만, 블록 index 와 함께. */
export function instructionHeadings(doc: InstructionDoc): { index: number; depth: 2 | 3; text: string }[] {
  const out: { index: number; depth: 2 | 3; text: string }[] = []
  doc.blocks.forEach((b, index) => {
    const d = b.heading?.depth
    if (b.kind === 'heading' && (d === 2 || d === 3)) out.push({ index, depth: d, text: b.heading!.text })
  })
  return out
}
