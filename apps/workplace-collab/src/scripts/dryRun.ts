// DOM 전역 설치가 TipTap 변환기 import 보다 먼저여야 한다(서버 진입점과 같은 경로).
import '../dom-install'

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { markdownToYUpdate, yUpdateToMarkdown } from '../markdownCodec'

/**
 * 출시 전 드라이런(WP-286) — 기존 노트 본문이 실시간 문서로 처음 옮겨질 때(마크다운 → Yjs → 마크다운)
 * 어떻게 바뀌는지 **쓰기 없이** 확인한다. 서버 이관과 같은 코덱(markdownCodec)을 그대로 쓴다.
 *
 * 차이 분류는 정규식 휴리스틱이다 — 바뀐 줄 묶음(hunk)마다 원본 쪽 표기를 보고 알려진 정규화로 분류하고,
 * 그 정규화들을 걷어내도 남는 차이가 있으면 'other' 를 붙인다(원인 미상 = 사람이 diff 를 봐야 함).
 */

/** 알려진 정규화 범주. 'other' 는 알려진 정규화로 설명되지 않는 차이. */
export type DryRunCategory =
  | 'table-align'
  | 'blank-lines'
  | 'emphasis'
  | 'hard-break'
  | 'raw-html'
  | 'escape'
  | 'checkbox'
  | 'other'

export interface DryRunChange {
  id: number
  categories: DryRunCategory[]
  diff: string
}

export interface DryRunReport {
  total: number
  changed: DryRunChange[]
}

/** 한 노트 본문을 서버 이관 경로 그대로 한 바퀴 돌린다. */
export function roundTrip(body: string): string {
  return yUpdateToMarkdown(markdownToYUpdate(body))
}

/** 노트 목록 왕복 결과 — 바뀐 노트만 범주·diff 와 함께 돌려준다. 입력은 바꾸지 않는다. */
export function dryRunReport(pages: Array<{ id: number; body: string }>): DryRunReport {
  const changed: DryRunChange[] = []
  for (const { id, body } of pages) {
    let out: string
    try {
      out = roundTrip(body)
    } catch (e) {
      // 변환 자체가 실패한 노트 — 이관 시 로드 실패가 되므로 반드시 드러낸다.
      changed.push({ id, categories: ['other'], diff: `! 변환 실패: ${(e as Error).message}` })
      continue
    }
    if (out === body) continue
    const hunks = diffHunks(body.split('\n'), out.split('\n'))
    const categories = new Set<DryRunCategory>()
    for (const h of hunks) for (const c of classify(h.removed.join('\n'), h.added.join('\n'))) categories.add(c)
    // 줄 내용은 같고 끝 개행만 다른 경우 등 — hunk 가 비어도 바뀐 건 분명하므로 공백 정규화로 본다.
    if (categories.size === 0) categories.add('blank-lines')
    changed.push({ id, categories: [...categories], diff: renderDiff(hunks) })
  }
  return { total: pages.length, changed }
}

// ---------------------------------------------------------------------------
// 분류 휴리스틱
// ---------------------------------------------------------------------------

// 정렬 표기(:---, ---:, :---:)가 있는 표 구분 줄.
const TABLE_ALIGN_ROW = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/
// 밑줄 강조(_x_, __x__) — 단어 중간 밑줄(snake_case)은 강조가 아니므로 앞이 단어 문자면 제외.
const UNDERSCORE_EMPHASIS = /(^|[^\w\\])_{1,2}[^_\s]/m
// 강제 줄바꿈: 줄 끝 공백 2개 이상 또는 <br>.
const TRAILING_SPACES_BREAK = / {2,}$/m
const BR_TAG = /<br\s*\/?>/i
// 작업 목록(GFM task list) 항목.
const TASK_ITEM = /^\s*(?:[-*+]|\d+[.)])\s+\[[ xX]\]/m
// raw HTML 태그 — 멘션 토큰(<@5>, <#page:12>)·자동 링크(<https://…>)·<br>(줄바꿈 범주)는 제외.
const HTML_TAG = /<\/?(?!br\b)[a-zA-Z][a-zA-Z0-9-]*(\s[^<>]*)?\/?>/i
// 마크다운 백슬래시 이스케이프(줄 끝 \ 는 강제 줄바꿈이라 제외).
const ESCAPE = /\\([\\`*_{}[\]()#+\-.!|<>~])/g

function countEscapes(s: string): number {
  return (s.match(ESCAPE) ?? []).length
}

/** 한 hunk(원본에서 빠진 줄 / 결과에 들어간 줄)의 범주. */
export function classify(removed: string, added: string): DryRunCategory[] {
  const cats = new Set<DryRunCategory>()
  if (removed.split('\n').some((l) => TABLE_ALIGN_ROW.test(l) && l.includes(':'))) cats.add('table-align')
  if (UNDERSCORE_EMPHASIS.test(removed) && added.includes('*')) cats.add('emphasis')
  if ((TRAILING_SPACES_BREAK.test(removed) || BR_TAG.test(removed)) && /\\$/m.test(added)) cats.add('hard-break')
  if (TASK_ITEM.test(removed)) cats.add('checkbox')
  if (HTML_TAG.test(removed)) cats.add('raw-html')
  if (countEscapes(removed) !== countEscapes(added)) cats.add('escape')
  if (onlyBlankLinesDiffer(removed, added)) cats.add('blank-lines')
  // 알려진 정규화를 양쪽에서 걷어낸 뒤에도 다르면 설명되지 않은 차이가 남은 것.
  if (canonical(removed, cats) !== canonical(added, cats)) cats.add('other')
  return [...cats]
}

/** 빈 줄·줄 끝 공백만 다른가. */
function onlyBlankLinesDiffer(a: string, b: string): boolean {
  const squash = (s: string) =>
    s
      .split('\n')
      .map((l) => l.trimEnd())
      .filter((l) => l !== '')
      .join('\n')
  return a !== b && squash(a) === squash(b)
}

/** 감지된 범주의 정규화를 걷어낸 비교용 형태. 범주에 없는 차이는 그대로 남아 'other' 로 드러난다. */
function canonical(s: string, cats: Set<DryRunCategory>): string {
  let t = s
  if (cats.has('raw-html')) t = t.replace(new RegExp(HTML_TAG.source, 'gi'), '')
  if (cats.has('escape') || cats.has('checkbox')) t = t.replace(ESCAPE, '$1')
  if (cats.has('emphasis')) t = t.replace(/_/g, '*')
  if (cats.has('hard-break')) t = t.replace(/<br\s*\/?>/gi, '\n').replace(/( {2,}|\\)$/gm, '')
  if (cats.has('table-align')) {
    // 구분 줄은 열 개수만 남긴다 — 정렬 표기와 칸 사이 공백 차이를 함께 걷어낸다.
    t = t
      .split('\n')
      .map((l) => (l.includes('|') && TABLE_ALIGN_ROW.test(l) ? `table-sep:${l.split('|').filter((c) => c.trim()).length}` : l))
      .join('\n')
  }
  // 공백 정규화는 항상 — 다른 정규화 뒤에 남는 빈 줄·끝 공백 차이는 'other' 가 아니다.
  return t
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '')
    .join('\n')
}

// ---------------------------------------------------------------------------
// 줄 단위 diff(LCS) — 공통 앞뒤를 잘라 긴 노트에서도 비교 범위를 바뀐 구간으로 줄인다.
// ---------------------------------------------------------------------------

interface Hunk {
  /** 원본 기준 시작 줄(1부터). */
  line: number
  removed: string[]
  added: string[]
}

export function diffHunks(a: string[], b: string[]): Hunk[] {
  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) start++
  let endA = a.length
  let endB = b.length
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--
    endB--
  }
  const xa = a.slice(start, endA)
  const xb = b.slice(start, endB)
  const n = xa.length
  const m = xb.length
  // LCS 길이표(뒤에서부터) — (n+1)×(m+1). 중간 구간만이라 실제 크기는 작다.
  const w = m + 1
  const lcs = new Uint32Array((n + 1) * w)
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i * w + j] = xa[i] === xb[j] ? lcs[(i + 1) * w + j + 1] + 1 : Math.max(lcs[(i + 1) * w + j], lcs[i * w + j + 1])
    }
  }
  const hunks: Hunk[] = []
  let cur: Hunk | null = null
  let i = 0
  let j = 0
  const open = () => (cur ??= { line: start + i + 1, removed: [], added: [] })
  const close = () => {
    if (cur) hunks.push(cur)
    cur = null
  }
  while (i < n || j < m) {
    if (i < n && j < m && xa[i] === xb[j]) {
      close()
      i++
      j++
    } else if (j < m && (i >= n || lcs[i * w + j + 1] >= lcs[(i + 1) * w + j])) {
      open().added.push(xb[j++])
    } else {
      open().removed.push(xa[i++])
    }
  }
  close()
  return hunks
}

function renderDiff(hunks: Hunk[]): string {
  return hunks
    .map((h) => [`@@ ${h.line}`, ...h.removed.map((l) => `- ${l}`), ...h.added.map((l) => `+ ${l}`)].join('\n'))
    .join('\n')
}

// ---------------------------------------------------------------------------
// CLI — pnpm --filter @smart-workplace/workplace-collab dryrun <bodies.json>
// 입력: scripts/export-wiki-bodies.sql 이 낸 JSON 배열 [{id, body}]. 출력: 요약표 + out/dryrun-<시각>.json.
// out/ 에는 실제 노트 내용(diff)이 담기므로 gitignore 대상이다.
// ---------------------------------------------------------------------------

function main(argv: string[]): void {
  const arg = argv[0]
  if (!arg) {
    console.error('사용법: pnpm --filter @smart-workplace/workplace-collab dryrun <bodies.json>')
    process.exit(2)
  }
  // pnpm --filter 는 cwd 를 앱 디렉터리로 바꾸므로, 상대 경로는 명령을 친 위치(INIT_CWD) 기준으로 푼다.
  const file = path.resolve(process.env.INIT_CWD ?? process.cwd(), arg)
  const parsed = JSON.parse(readFileSync(file, 'utf8')) as Array<{ id: number; body: string | null }> | null
  const pages = (parsed ?? []).map((p) => ({ id: Number(p.id), body: p.body ?? '' }))
  const report = dryRunReport(pages)

  const counts = new Map<string, number>()
  for (const c of report.changed) for (const cat of c.categories) counts.set(cat, (counts.get(cat) ?? 0) + 1)
  console.log(`전체 ${report.total} · 바뀜 ${report.changed.length} · 그대로 ${report.total - report.changed.length}`)
  console.table([...counts.entries()].sort((x, y) => y[1] - x[1]).map(([category, pages]) => ({ category, pages })))

  const outDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../out')
  mkdirSync(outDir, { recursive: true })
  const outFile = path.join(outDir, `dryrun-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
  writeFileSync(outFile, JSON.stringify(report, null, 2))
  console.log(`상세: ${outFile}`)
}

// 직접 실행될 때만 CLI 로 동작한다(테스트 import 시에는 실행하지 않음).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2))
}
