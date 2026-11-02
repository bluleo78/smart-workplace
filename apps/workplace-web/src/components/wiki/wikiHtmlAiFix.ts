// 노트 HTML 블록 「AI로 고치기」(WP-1302)의 순수 판정 — 요청 만들기·요청 칩 채우기·AI 답 다듬기·줄 단위 비교.
// 화면(WikiHtmlEmbedAiPanel)은 이 함수들을 부르기만 한다 — 브라우저 없이 vitest 로 지킨다.
import DiffMatchPatch from 'diff-match-patch'

import type { PickedElement } from '@/lib/htmlPicker'

import { htmlByteLength } from './html-document/wikiHtmlDocument'
import { HTML_IMPORT_MAX_BYTES } from './wikiHtmlImportInsert'

/** 고른 요소 설명 상한 — API(WikiAiRequest.targets)·ai-agent zod 와 같다(10개 · 개당 2000자). 넘는 것은 보내기 전에 자른다. */
export const FIX_HTML_MAX_TARGETS = 10
export const FIX_HTML_MAX_TARGET_CHARS = 2000
/** 지시 상한 — API 의 WikiAiRequest.prompt(4000자)와 같다. 입력 칸 maxLength 로 막는다. */
export const FIX_HTML_MAX_PROMPT_CHARS = 4000

/**
 * 요청 칩 — 누르면 입력 칸 앞에 「시작 말」을 채우고 사용자가 뒤를 잇는다(설계 §3-3).
 * 칩이 완성된 지시를 바로 보내지 않는 이유: 「색 바꾸기」만으로는 무엇을 무슨 색으로인지 알 수 없다 — 시작 말 + 사용자가 채운 나머지가 한 지시가 된다.
 */
export const FIX_HTML_CHIPS = [
  { key: 'value', label: '값 바꾸기', starter: '값을 이렇게 바꿔 줘: ' },
  { key: 'color', label: '색 바꾸기', starter: '색을 이렇게 바꿔 줘: ' },
  { key: 'title', label: '제목 바꾸기', starter: '제목을 이렇게 바꿔 줘: ' },
  { key: 'add', label: '항목 추가', starter: '이 항목을 추가해 줘: ' },
  { key: 'line', label: '꺾은선으로', starter: '차트를 꺾은선 그래프로 바꿔 줘' },
] as const

/**
 * 칩을 눌렀을 때 입력 칸 글자 — 비어 있으면 시작 말만, 이미 쓴 글이 있으면 시작 말을 앞에 붙인다(쓴 글을 지우지 않게).
 * 같은 시작 말로 이미 시작하면 그대로 둔다 — 칩을 두 번 눌러 「색을 …: 색을 …: 」 처럼 겹치지 않게.
 */
export function prefillChip(current: string, starter: string): string {
  if (current.startsWith(starter)) return current
  const rest = current.trim()
  // 입력 칸 maxLength 는 코드로 넣은 값을 막지 않는다 — 상한에 가까운 글에 시작 말을 붙여 4000자를 넘기면 API 가 400 을 낸다.
  return rest ? clampUtf16(`${starter}${rest}`, FIX_HTML_MAX_PROMPT_CHARS) : starter
}

/**
 * 고른 요소 하나를 AI 에 보낼 설명 한 덩이로 — 선택자 경로(어디)·태그·이름표·글자·짧은 outerHTML(무엇)을 줄마다 싣는다.
 * 설명은 상한(2000자)으로 자른다 — 경로·outerHTML 은 iframe 이 이미 줄여 보내지만(앞 300자), 블록 스크립트가 흉내 낸 큰 값도 400 이 나지 않게.
 */
export function describePicked(item: PickedElement): string {
  const lines = [`선택자: ${item.path}`, `태그: ${item.tag}`, `종류: ${item.kind}`]
  if (item.text) lines.push(`글자: ${item.text}`)
  if (item.html) lines.push(`HTML: ${item.html}`)
  return clampUtf16(lines.join('\n'), FIX_HTML_MAX_TARGET_CHARS)
}

/**
 * UTF-16 길이 max 로 자른다 — API(@Size)·ai-agent(zod .max)는 UTF-16 단위로 센다(코드 포인트로 자르면 이모지 등이 섞여 상한을 넘어 400).
 * 자른 끝이 서로게이트 쌍의 앞쪽이면 그 반쪽도 뺀다(깨진 글자를 보내지 않게).
 */
function clampUtf16(text: string, max: number): string {
  if (text.length <= max) return text
  const cut = text.slice(0, max)
  return /[\uD800-\uDBFF]$/.test(cut) ? cut.slice(0, -1) : cut
}

/** fix_html 요청 본문 — /wiki/pages/{id}/ai 에 그대로 보낸다. */
export interface FixHtmlRequest {
  action: 'fix_html'
  selection: string
  prompt: string
  targets?: string[]
}

/**
 * 「AI로 고치기」 요청을 만든다 — 지금 소스(selection)·지시(prompt, 앞뒤 공백 정리)·고른 요소(있을 때만, 상한 10개).
 * 고른 요소가 없으면 targets 를 빼서 블록 전체가 대상이 된다(API 도 빈 목록은 뺀다).
 */
export function buildFixHtmlRequest(source: string, prompt: string, picked: readonly PickedElement[]): FixHtmlRequest {
  const req: FixHtmlRequest = { action: 'fix_html', selection: source, prompt: prompt.trim() }
  if (picked.length) req.targets = picked.slice(0, FIX_HTML_MAX_TARGETS).map(describePicked)
  return req
}

/**
 * AI 답을 블록 소스로 쓸 글자로 다듬는다 — 앞뒤 공백을 걷고, 답 전체를 감싼 코드 울타리(```html … ```)를 벗긴다.
 * 프롬프트가 울타리 없이 답하라고 하지만 모델이 습관처럼 감싸는 일이 있어 한 번 더 거른다. 소스 가운데의 ``` 은 건드리지 않는다(글자일 수 있다).
 * 줄바꿈은 블록 소스와 같은 \n 으로 맞춘다(replaceHtmlEmbedSource 도 같은 규칙).
 */
export function cleanAiHtml(text: string): string {
  let out = text.replace(/\r\n?/g, '\n').trim()
  const fenced = /^```[\w-]*[^\S\n]*\n([\s\S]*?)\n?```$/.exec(out)
  if (fenced) out = fenced[1].trim()
  return out
}

/** 적용할 수 없는 답 — 빈 답, 블록 크기 상한(HTML 파일 넣기·다시 올리기와 같은 5MB) 초과. 문제가 없으면 null. */
export function fixHtmlResultProblem(html: string): string | null {
  if (!html.trim()) return 'AI가 빈 결과를 돌려주었습니다. 다시 요청해 주세요.'
  if (htmlByteLength(html) > HTML_IMPORT_MAX_BYTES) return '결과가 너무 큽니다 — 5MB 이하만 블록에 넣을 수 있습니다.'
  return null
}

/** 줄 비교 한 덩이 — 같은 줄·지운 줄·더한 줄. lines 는 끝 줄바꿈 없는 줄 목록. */
export interface LineDiffPart {
  kind: 'same' | 'removed' | 'added'
  lines: string[]
}

/**
 * 지금 소스와 바뀐 소스를 줄 단위로 비교한다 — 「바뀐 코드 보기」가 그린다.
 * diff-match-patch 의 줄 모드(줄마다 글자 하나로 바꿔 비교, 판 기록 비교 wikiRevisionDiff 와 같은 라이브러리)라 긴 소스도 빠르다.
 */
export function lineDiff(before: string, after: string): LineDiffPart[] {
  const dmp = new DiffMatchPatch()
  // 끝 줄바꿈을 맞춰야 마지막 줄이 「바뀐 줄」로 잘못 잡히지 않는다.
  const norm = (s: string) => (s.endsWith('\n') ? s : `${s}\n`)
  const { chars1, chars2, lineArray } = dmp.diff_linesToChars_(norm(before), norm(after))
  const diffs = dmp.diff_main(chars1, chars2, false)
  dmp.diff_charsToLines_(diffs, lineArray)
  const parts: LineDiffPart[] = []
  for (const [op, text] of diffs) {
    const kind = op === 0 ? 'same' : op < 0 ? 'removed' : 'added'
    const lines = text.replace(/\n$/, '').split('\n')
    const last = parts[parts.length - 1]
    if (last?.kind === kind) last.lines.push(...lines)
    else parts.push({ kind, lines })
  }
  return parts
}

/** 바뀐 줄 수 — 「바뀐 코드 보기」 단추 옆 요약(+3 −1). */
export function lineDiffStats(parts: readonly LineDiffPart[]): { added: number; removed: number } {
  let added = 0
  let removed = 0
  for (const p of parts) {
    if (p.kind === 'added') added += p.lines.length
    else if (p.kind === 'removed') removed += p.lines.length
  }
  return { added, removed }
}
