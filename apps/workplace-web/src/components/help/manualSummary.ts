// 매뉴얼 도움말 절 → 짧은 요약 항목(WP-1507).
// 설정 화면의 AI 화면 참고는 예전에 화면 안 설정 가이드 글(소개·주의·알아두기)에서 만들었다. 가이드 글이 매뉴얼로 옮겨 가면서
// 같은 설명을 코드에 두 번 두지 않도록, 도움말 묶음의 그 화면 대표 절(본문 + 바로 아래 절 첫 문단·주의)에서 요약을 만든다.
// 코드 블록·그림·HTML 은 싣지 않는다(옛 가이드도 명령 단계는 싣지 않았다 — AI 는 화면 규칙만 알면 되고, 명령은 상한만 먹는다).
// 표는 싣는다 — 15장은 계정 상태·에이전트 유형·실행 상태의 뜻을 표로만 적는다. 행을 「첫 칸 — 나머지」 글로 만든다.
// 본문은 도움말 패널(HelpMarkdown)과 같은 파서(remark-parse + remark-gfm)·조건 처리·자리표시 플러그인으로 읽는다 —
// 손으로 짠 줄 판정을 두면 들여쓰기·인용·표 경계가 패널과 어긋나므로, 패널이 그리는 mdast 를 그대로 걷는다.
// 요약 항목은 AI 화면 참고 꼴(facts·상한)을 모른다 — 상한에 맞춰 나누는 것은 화면 참고 builder(builders/settings.ts)가 한다.
import type { BlockContent, Blockquote, DefinitionContent, Nodes, Table } from 'mdast'

import type { HelpChapter, HelpVars } from './helpBundle'
import { applyHelpConditions, type HelpValues, remarkHelpPlaceholders } from './helpMarkup'
import { markdownParser, mdastText } from './mdast'

/** 요약 항목 — 글 하나(문단·목록 항목·알림 상자·하위 절 첫 문단) 또는 표 하나(행마다 「첫 칸 — 나머지」 글). */
export type HelpSummaryItem = { label: string; text: string } | { label: string; rows: string[] }

// 하위 절 알림 상자 중 위 절 주의와 함께 앞쪽에 싣는 라벨 — 되돌리기 어려운 동작 안내라 상한에 잘리면 안 된다.
const CHILD_CAUTION_LABELS = new Set(['주의', '경고'])

/** 절 본문을 걸어 모은 덩어리 — 문단·목록 항목은 text, 알림 상자는 라벨(없으면 null)과 글, 표는 머리 첫 칸과 행 글. */
type Block = { kind: 'text'; text: string } | { kind: 'callout'; label: string | null; text: string } | { kind: 'table'; label: string; rows: string[] }

/** 공백을 한 칸으로 줄이고 앞뒤를 다듬는다. */
function clean(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/**
 * 알림 상자(인용) → 라벨과 글. 첫 문단이 굵은 글 하나로 시작하고 그 뒤가 비었거나 줄바꿈이면 그 굵은 글이 라벨(주의·참고·경고)이다
 * — `> **주의**` 다음 줄 또는 빈 `>` 줄 뒤에 본문이 오는 매뉴얼 꼴. 라벨이 없으면 null(부르는 쪽이 「참고」로 본다).
 */
function calloutBlock(node: Blockquote): Block {
  const [first, ...rest] = node.children
  if (first?.type === 'paragraph' && first.children[0]?.type === 'strong') {
    const [strong, ...after] = first.children
    const next = after[0]
    if (!next || next.type === 'break' || (next.type === 'text' && /^\s*\n/.test(next.value))) {
      const tail = [after.map(mdastText).join(''), ...rest.map(mdastText)].join(' ')
      return { kind: 'callout', label: clean(mdastText(strong)), text: clean(tail) }
    }
  }
  return { kind: 'callout', label: null, text: clean(node.children.map(mdastText).join(' ')) }
}

/** 표 → 머리 첫 칸 라벨(비면 「표」)과 행 글. 나머지 칸이 비었거나 「—」 뿐이면 첫 칸만 싣는다. 빈 행은 버린다. */
function tableBlock(node: Table): Block {
  const [head, ...body] = node.children
  const label = clean(head?.children[0] ? mdastText(head.children[0]) : '') || '표'
  const rows = body
    .map((row) => {
      const [first = '', ...rest] = row.children.map((cell) => clean(mdastText(cell)))
      const tail = rest.filter((c) => c && c !== '—' && c !== '-').join(' · ')
      return tail ? `${first} — ${tail}` : first
    })
    .filter(Boolean)
  return { kind: 'table', label, rows }
}

/**
 * 블록 자식들을 차례로 걸어 덩어리로 모은다. 문단은 글, 목록은 항목마다 안쪽을 다시 걷고(항목 안 문단·들여 쓴 알림 상자·안쪽 목록),
 * 인용은 알림 상자, 표는 표 덩어리. 제목·코드·그림·HTML·구분선은 싣지 않는다.
 */
function collect(nodes: Array<BlockContent | DefinitionContent | Nodes>, out: Block[]): Block[] {
  for (const node of nodes) {
    if (node.type === 'paragraph') {
      const text = clean(mdastText(node))
      if (text) out.push({ kind: 'text', text })
    } else if (node.type === 'list') {
      for (const item of node.children) collect(item.children, out)
    } else if (node.type === 'blockquote') {
      out.push(calloutBlock(node))
    } else if (node.type === 'table') {
      out.push(tableBlock(node))
    }
  }
  return out
}

/**
 * 절 본문(markdown) → 덩어리. 패널과 같은 순서로 조건 블록을 먼저 문자열로 처리하고, 패널과 같은 파서로 읽은 뒤
 * 자리표시 플러그인으로 노드 값을 채운다(값이 없으면 `<표시 이름>`). 코드 안 자리표시 규칙도 패널과 같다.
 */
function blocksOf(markdown: string, values: HelpValues, vars: HelpVars | null): Block[] {
  const md = applyHelpConditions(markdown, values.conditions, vars)
  const tree = markdownParser.parse(md)
  // 자리표시 플러그인의 변환을 바로 부른다 — 원문(file.value)으로 탈출 글자를 되짚으므로 원문을 함께 넘긴다.
  remarkHelpPlaceholders({ values: values.placeholders, vars })()(tree, { value: md })
  return collect(tree.children, [])
}

/**
 * 도움말 id 절을 요약 항목으로. 순서는 소개 → 주의(알림 상자) → 표 → 바로 아래 절 첫 문단.
 * - 본문 문단·목록 항목은 `소개`·`소개 2`… , 알림 상자는 그 라벨(`주의`·`참고`·`경고`, 없으면 `참고`), 하위 절은 그 절 label 로 싣는다.
 * - 하위 절의 주의·경고 상자는 `<하위 절 label> · 주의` 로 위 절 상자 바로 뒤에 싣는다(옛 가이드의 「섹션 · 주의」 와 같은 꼴).
 *   하위 절의 참고 상자는 싣지 않는다 — 칸마다 한 줄 요약이 목적이라 상한만 먹는다.
 * - 주의를 소개 바로 뒤에 두는 것은 되돌리기 어려운 동작이라 상한에 잘리지 않게 하려는 것이다(옛 가이드 요약과 같은 순서).
 *   표(뜻 풀이)는 그다음 — 화면에 보이는 상태·유형 이름의 뜻이라 칸별 한 줄 요약보다 먼저 둔다.
 * - 자르기·나누기는 하지 않는다(쓰는 쪽이 제 상한에 맞춘다). 절이 없으면 빈 배열.
 */
export function summarizeHelpSection(chapter: HelpChapter, helpId: string, values: HelpValues, vars: HelpVars | null): HelpSummaryItem[] {
  const section = chapter.sections.find((s) => s.id === helpId)
  if (!section) return []
  const intro: HelpSummaryItem[] = []
  const cautions: HelpSummaryItem[] = []
  const tables: HelpSummaryItem[] = []
  for (const block of blocksOf(section.markdown, values, vars)) {
    if (block.kind === 'table') {
      if (block.rows.length) tables.push({ label: block.label, rows: block.rows })
    } else if (block.kind === 'callout') {
      if (block.text) cautions.push({ label: block.label ?? '참고', text: block.text })
    } else {
      intro.push({ label: intro.length === 0 ? '소개' : `소개 ${intro.length + 1}`, text: block.text })
    }
  }
  // 바로 아래 절마다 첫 문단(알림 상자·표가 아닌 첫 글) — 화면의 칸마다 무엇을 하는지 한 줄씩 알린다. 주의 상자는 위 절 주의 뒤로.
  const children: HelpSummaryItem[] = []
  for (const child of chapter.sections.filter((s) => s.parent === helpId)) {
    const blocks = blocksOf(child.markdown, values, vars)
    for (const b of blocks) {
      if (b.kind === 'callout' && b.text && CHILD_CAUTION_LABELS.has(b.label ?? '')) cautions.push({ label: `${child.label} · ${b.label}`, text: b.text })
    }
    const first = blocks.find((b) => b.kind === 'text')
    if (first) children.push({ label: child.label, text: first.text })
  }
  return [...intro, ...cautions, ...tables, ...children]
}
