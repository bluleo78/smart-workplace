/**
 * 그래프 편집 결과를 원문 YAML 위에 덧붙이는 병합 층(WP-2040).
 *
 * 왜 필요한가: 문서 전체를 다시 쓰면(tidy 출력) 손대지 않은 줄의 공백·주석·흐름 스타일까지 바뀌어
 * diff 가 온통 흔들린다. 이 모듈은 원문 글자를 그대로 두고, 바뀐 값의 자리만 원문 범위로 잘라 교체한다.
 * 힌트로 자리 대응이 안 서는 키 이름·구조 바뀜은 건드리지 않는다 — 호출자가 정규화 출력으로 대체하게 한다.
 *
 * 안전 계약: 안전하게 병합할 수 없으면(파싱 오류·range 없음·범위 수 불일치·힌트로 설명 안 되는 키 이름 바뀜) null 을
 * 돌려준다. 결과는 반환 전에 다시 파싱해 오류 0 과 after.toJS() 깊이 일치를 검증하므로 잘못된 병합이
 * 밖으로 새지 않는다. 이 함수는 절대 던지지 않는다.
 *
 * 키 이름 바뀜(rename): 호출자(graphYaml applyOutputs)가 한 패치에서 이름만 바뀐 항목을 {@link RenameHint} 로
 * 남기면 그 항목은 **자리(index)로 대응**해 원문 자리에 키 글자만 바꿔 쓴다 — 그래야 정렬 공백·줄 끝 주석·
 * 항목 위 주석이 그대로다(WP-2040 최종 리뷰 finding 1). 힌트가 없는 키 이름 차이는 끝까지 구별할 수 없어
 * `added === gone` 안전망이 정규화 출력으로 넘긴다.
 */
import { Document, isMap, isPair, isScalar, isSeq, type Pair, parseDocument, type Range, stringify, type YAMLMap, type YAMLSeq } from 'yaml'

/**
 * 한 패치에서 키 이름만 바뀐 항목의 자리 대응 힌트(WP-2040 최종 리뷰 finding 1).
 * `path` 는 루트 contents 기준 경로, `index` 는 after 문서에서의 자리, `from`·`to` 는 바뀐 전·후 키 이름이다.
 */
export interface RenameHint {
  path: (string | number)[]
  index: number
  from: string
  to: string
}

/** 경로가 같은지 — 힌트가 어느 컨테이너의 것인지 가리는 데 쓴다. */
function samePath(a: (string | number)[], b: (string | number)[]): boolean {
  return a.length === b.length && a.every((seg, i) => seg === b[i])
}

/** 노드의 원문 범위 [start, valueEnd, nodeEnd] — 파싱으로 얻은 노드에만 있고 새로 만든 노드엔 없다. */
function rangeOf(node: unknown): Range | null {
  const r = (node as { range?: unknown } | null | undefined)?.range
  return Array.isArray(r) && typeof r[0] === 'number' && typeof r[1] === 'number' ? (r as Range) : null
}

/**
 * 노드를 평범한 JS 값으로 읽는다 — 비교·재직렬화가 같은 기준을 보게 하려고 toJSON() 을 쓴다.
 * Document.toJS() 를 쓰지 않는 이유: 노드마다 Document 를 새로 만들지 않아도 되고, before/after
 * 양쪽이 같은 방식으로 읽히면 비교 목적에는 충분하다(문서 전체 비교는 바깥에서 toJS() 로 한다).
 */
function jsValue(node: unknown): unknown {
  if (node === null || node === undefined) return null
  const n = node as { toJSON?: () => unknown }
  return typeof n.toJSON === 'function' ? n.toJSON() : node
}

/**
 * 깊이 비교 공통 본체 — {@link sameValue}·{@link sameContent} 가 ordered 만 바꿔 쓴다.
 * ordered 는 맵의 키 **순서**까지 같은 값으로 보는지다(배열 순서는 어느 쪽이든 비교한다).
 * 안 갈라 쓰면 두 함수가 한 글자씩 어긋나는 사고가 나기 쉽다(WP-2040 팀장 재반려 Minor 6).
 */
function same(a: unknown, b: unknown, ordered: boolean): boolean {
  if (Object.is(a, b)) return true
  if (a === null || b === null || typeof a !== typeof b) return false
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
    return a.every((x, i) => same(x, b[i], ordered))
  }
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime()
  if (typeof a === 'object' && typeof b === 'object') {
    const ka = Object.keys(a)
    const kb = Object.keys(b)
    if (ka.length !== kb.length) return false
    if (ordered) {
      if (!ka.every((k, i) => k === kb[i])) return false
      return ka.every((k) => same((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], ordered))
    }
    // 순서는 보지 않아도 길이가 같은데 한쪽에만 있는 키는 있을 수 있다 — 존재 확인까지 한다
    return ka.every(
      (k) => Object.prototype.hasOwnProperty.call(b, k) && same((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], ordered),
    )
  }
  return false
}

/**
 * 값을 깊이 비교한다 — 다만 **맵의 키 순서는 같은 값으로 세지 않는다**. YAML 의미론엔 키 순서가 없지만
 * 이 병합 층은 원문 그대로를 지키는 게 목표라, 순서만 바꾼 편집도 편집으로 쳐야 원문에 반영된다.
 * 순서를 무시하면 사용자가 바꾼 키 순서가 조용히 버려지고(WP-2040 재반려 finding 4) 순서 비교가
 * 성립하는 한(인용·숫자 키는 JS 객체 순서와 문서 순서가 갈릴 수 있다) 검증도 그대로 통과한다.
 */
function sameValue(a: unknown, b: unknown): boolean {
  return same(a, b, true)
}

/**
 * 값 비교(키 순서 무시) — 병합 결과의 **최종 재검증**에만 쓴다.
 * 병합 층은 흐름 컨테이너에 새 항목을 원문 자리 뒤에 이어 붙이므로(after 순서가 아닐 수 있다) 결과의 키
 * 순서가 after 와 다를 수 있는데, YAML 의미론엔 키 순서가 없어 같은 값이다. 순서까지 따지면 손대지 않은
 * 줄을 지키는 병합이 매번 거부돼 전문 정규화 dump 로 떨어진다(WP-2040 재반려 finding 4 부수 효과).
 * 「편집이 있는가」·항목별 값 비교는 같은 이름의 {@link sameValue} 가 순서까지 봐야 사용자의 키 순서
 * 바꿈이 편집으로 잡힌다.
 */
function sameContent(a: unknown, b: unknown): boolean {
  return same(a, b, false)
}

/**
 * 두 값이 얼마나 비슷한가(0~1) — 목록 항목의 짝을 고를 때 쓴다.
 * 정확히 같은 값이 아니어도(이름·값 하나만 바뀐 항목) 공통 구조가 많으면 같은 항목일 가능성이 크다.
 * 그래서 「바꿈과 지움이 섞인 목록」에서 지운 항목 자리에 바뀐 항목을 앉히지 않고, 원래 자리(주석까지)에
 * 앉힐 수 있다(WP-2040 재반려 finding 1). 값이 다르면 0, 완전히 같으면 1.
 */
function similarity(a: unknown, b: unknown): number {
  if (sameValue(a, b)) return 1
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') {
    // 글자열 항목(이름·조건 목록)은 일부만 같은 경우가 흔하니 접두·접미로 잰다 — 안 그러면
    // 바꾼 항목(`three` → `three_x`)과 지운 항목(`two`)을 구분하지 못해 짝이 어긋난다.
    if (typeof a === 'string' && typeof b === 'string') return stringSimilarity(a, b)
    return 0
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return 0
    const max = Math.max(a.length, b.length)
    if (max === 0) return 0
    let hit = 0
    for (let i = 0; i < Math.min(a.length, b.length); i++) if (sameValue(a[i], b[i])) hit++
    return hit / max
  }
  const ka = Object.keys(a)
  const kb = Object.keys(b)
  const max = Math.max(ka.length, kb.length)
  if (max === 0) return 0
  let hit = 0
  for (const k of ka) if (Object.prototype.hasOwnProperty.call(b, k) && sameValue((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) hit++
  return hit / max
}

/**
 * 글자열 두 개의 비슷함(0~1) — 공통 접두·접미 글자 수를 긴 쪽 길이로 나눈다.
 * 목록 항목이 글자열이라도 자리 대응이 성립해야, 바꾼 항목과 지운 항목을 가려
 * 지운 항목의 주석이 살아남은 항목에 붙는 일을 막을 수 있다(WP-2040 재반려 finding 1).
 */
function stringSimilarity(a: string, b: string): number {
  if (a === b) return 1
  const max = Math.max(a.length, b.length)
  if (max === 0) return 1
  let pre = 0
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++
  let suf = 0
  while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++
  return (pre + suf) / max
}

/**
 * 맵 쌍의 키를 문자열로 — `1:`·`true:` 같은 비문자열 키도 자리 대응이 어긋나지 않게 모은다.
 * graphYaml 도 같은 판정을 쓰므로 한 곳에만 두고 import 로 공유한다(WP-2040 최종 리뷰 finding 6) —
 * 두 구현이 따로 놀면 비문자열 키 하나만 한쪽에서 다른 이름으로 읽혀 대응이 어긋난다.
 */
export function pairKeyOf(pair: Pair): string {
  return isScalar(pair.key) ? String(pair.key.value) : String(pair.key)
}

/** pos 가 서 있는 줄의 시작 위치 — `\n` 다음 글자부터가 줄머리다. */
function lineStartOf(src: string, pos: number): number {
  return src.lastIndexOf('\n', pos - 1) + 1
}

/**
 * 항목 시작 위치를 원문 위에서 넓힌다 — 항목을 통째로·바로 위 주석 줄과 함께 옮기려고,
 * 키가 줄머리일 때만(흐름 컨테이너 중간의 키는 제외) 바로 위 **빈 줄·주석 줄**을 시작에 포함한다.
 * 단, 항목보다 깊이 들여쓴 주석은 포함하지 않는다 — 그 주석은 앞 항목 몸통이라 지금 항목에 딸리면
 * 앞 노드를 지워도 남고 뒷 노드를 지우면 함께 사라진다(WP-2040 재반려 finding 2).
 * 빈 줄도 함께 넣어야 항목 사이 빈 줄이 앞 항목 꼬리에 남지 않는다 — 안 넣으면 앞 항목을 지울 때
 * 그 빈 줄(그리고 빈 줄로 떨어져 있던 아래 항목의 구역 주석)이 함께 사라져 두 줄짜리 빈 줄이 남고
 * 주석이 통째로 없어진다(WP-2040 리뷰 3·5). 컨테이너 시작(floor)을 아래로 넘어가지 않는다.
 */
function expandUp(src: string, pos: number, floor: number): number {
  const ls = lineStartOf(src, pos)
  if (src.slice(ls, pos).trim() !== '') return pos // 줄 중간(흐름 스타일 키)은 위로 넓히지 않는다
  const own = /^[ \t]*/.exec(src.slice(ls))?.[0].length ?? 0 // 항목 줄 자신의 들여쓰기
  let cur = ls
  let peek = ls // 위를 살피는 자리 — 빈 줄은 딸리기만 하고 멈추지 않으니 따로 둔다
  while (peek > floor) {
    const prevStart = src.lastIndexOf('\n', peek - 2) + 1
    if (prevStart < floor) break
    const prevLine = src.slice(prevStart, peek - 1)
    const t = prevLine.trim()
    if (t !== '' && !t.startsWith('#')) break // 빈 줄·주석이 아니면 여기까지
    // 항목보다 깊이 들여쓴 주석은 앞 항목 몸통이다 — 지금 항목에 딸려 가지 않게 여기서 끊는다.
    // 안 끊으면 앞 노드의 주석이 다음 노드에 붙어, 다음 노드를 지울 때 함께 사라진다(WP-2040 재반려 finding 2).
    if (t.startsWith('#') && (/^[ \t]*/.exec(prevLine)?.[0].length ?? 0) > own) break
    cur = prevStart
    peek = prevStart
  }
  return Math.max(cur, floor)
}

/**
 * 항목이 쓰인 줄의 들여쓰기 칸 — 여러 줄 값을 쓸 때 본문을 그 아래 한 단계로 세우는 기준(옛 dump 와 같다).
 * 목록 항목 한 줄(`- |`)은 `- ` 가 선 칸, 키 줄(`- key: |`·`key: |`)은 키가 선 칸이다 —
 * 키 줄 들여쓰기에서 한 단계를 넘기지 않으면 본문이 값 시작 열(`key: ` 뒤)로 밀려 18칸처럼 어긋나게 된다(WP-2040 리뷰 1).
 */
function ownerColumnOf(src: string, pos: number): number {
  const head = src.slice(lineStartOf(src, pos), pos)
  const indent = /^[ \t]*/.exec(head)?.[0].length ?? 0
  const dash = /^[ \t]*-[ \t]+/.exec(head)
  if (!dash) return indent
  return head.slice(dash[0].length).includes(':') ? dash[0].length : indent
}

/** 항목 하나의 시작 원문 위치 — 맵 쌍은 키 시작(줄머리 정규화는 itemRegions 의 floor 가 맡는다),
 * 목록 항목은 `- ` 이 붙은 들여쓰기 줄 시작부터. */
function regionStartOf(src: string, item: unknown, floor: number): number | undefined {
  if (isPair(item)) return rangeOf(item.key)?.[0] ?? undefined
  const r = rangeOf(item)
  if (!r) return undefined
  const ls = lineStartOf(src, r[0])
  if (ls < floor) return r[0]
  return /^\s*-\s+$/.test(src.slice(ls, r[0])) ? ls : r[0]
}

/**
 * 줄 바로 위에 붙은 주석 줄들의 시작 — 블록 목록 첫 항목의 위 주석은 그 항목에 딸려 있어야
 * 항목을 지울 때 함께 빠진다. 부모(키 줄)에서 끊는 자리(valueStart)를 이 위치로 잡아
 * 주석 줄의 소유를 목록 병합 쪽으로 넘긴다. 바로 위 줄이 주석이 아니면(키 줄·빈 줄 포함)
 * 그대로 멈춘다 — 키 줄의 같은 줄 주석(`start:   # …`)은 키에 속해 건드리지 않는다.
 */
function commentAbove(src: string, lineStart: number): number {
  let cur = lineStart
  while (cur > 0) {
    const prevStart = src.lastIndexOf('\n', cur - 2) + 1
    if (prevStart >= cur - 1) break // 첫 줄 위는 없다
    if (!src.slice(prevStart, cur - 1).trim().startsWith('#')) break
    cur = prevStart
  }
  return cur
}

/**
 * 값 바로 앞의 키 끝(`:` 뒤 글자) — 값 자리에서 키를 남기고 블록을 다음 줄에 세울 때 끊는 데 쓴다.
 * 같은 줄에 콜론이 없으면(값이 줄머리에 시작하는 자리) 값 시작을 그대로 돌려준다.
 */
function keyEndOf(src: string, r: Range): number {
  const ls = lineStartOf(src, r[0])
  const colon = src.slice(ls, r[0]).lastIndexOf(':')
  return colon < 0 ? r[0] : ls + colon + 1
}

/**
 * 값 자리 바로 위에 있는(중간 빈 줄은 건너뛴) 키 줄의 칸 — 빈 목록을 `[]` 로 남길 때 그 줄보다
 * 깊지 않으면 YAML 이 줄을 키로 오해해 파싱이 깨진다(블록 목록만 키와 같은 칸을 허용한다).
 * 키 줄을 못 찾으면(최상위 목록·머리 주석) 0 을 둔다.
 */
function keyColumnAbove(src: string, vStart: number): number {
  let ls = lineStartOf(src, vStart)
  for (let guard = 0; guard < 200; guard++) {
    const prev = ls > 0 ? src.lastIndexOf('\n', ls - 2) + 1 : -1
    if (prev < 0) return 0
    ls = prev
    const nl = src.indexOf('\n', ls)
    const line = src.slice(ls, nl < 0 ? src.length : nl)
    if (line.trim() === '') continue // 빈 줄은 건너뛰고 키 줄을 찾는다
    return /^[ \t]*/.exec(line)?.[0].length ?? 0
  }
  return 0
}

/**
 * 컨테이너 값의 시작 원문 위치 — 블록(줄머리에 시작하는 맵·목록)이면 그 줄머리(들여쓰기 포함)와
 * 그 위 주석 줄까지, 흐름·줄 중간이면 값 첫 글자.
 * 부모가 여기서 끊고 항목 범위(itemRegions)도 여기서 시작해야, 첫 항목을 지워도 남는 줄의
 * 들여쓰기가 접두에 남은 만큼 이중으로 붙지 않는다(WP-2040 최종 리뷰 finding 1) —
 * 부모·항목이 접두의 들여쓰기 소유를 합의하지 않으면 내용을 안 건드린 줄의 들여쓰기가 조용히 늘어난다.
 */
function blockStartOf(src: string, r: Range): number {
  const ls = lineStartOf(src, r[0])
  if (src.slice(ls, r[0]).trim() !== '') return r[0] // 흐름·줄 중간 — 줄머리로 고치지 않는다
  return commentAbove(src, ls)
}

/**
 * 컨테이너 안 항목 각각의 원문 범위 — 시작은 위 주석 줄까지 넓히고, 끝은 다음 항목 시작
 * (마지막 항목은 컨테이너 값 끝)이다. 범위는 서로 맞물려 컨테이너 값 전체를 빠짐없이 덮는다.
 * floor 는 부모가 끊는 자리(blockStartOf)와 같은 곳 — 그래야 접두와 항목 범위가 들여쓰기 소유를
 * 어긋나게 나누지 않는다(첫 항목의 regionStartOf 는 floor 에 맞춰 줄머리로 돌아온다).
 * range 가 없거나 앞 항목과 겹치는 항목은 건너뛰므로 개수가 항목 수와 안 맞는다 — 호출자가 null 로 받는다.
 */
function itemRegions(src: string, container: unknown, items: unknown[]): { start: number; end: number }[] {
  const cRange = rangeOf(container)
  const floor = cRange ? blockStartOf(src, cRange) : 0
  const ceiling = cRange ? cRange[1] : src.length
  const starts: number[] = []
  let prev = floor - 1
  for (const item of items) {
    const raw = regionStartOf(src, item, floor)
    if (raw === undefined) continue
    const start = Math.min(expandUp(src, raw, floor), ceiling)
    if (start <= prev) continue // 앞 항목과 겹치면 자리 대응을 못 믿는다(범위 수 불일치로 떨어진다)
    starts.push(start)
    prev = start
  }
  return starts.map((start, i) => ({ start, end: i + 1 < starts.length ? starts[i + 1] : ceiling }))
}

/**
 * 줄바꿈이 있는 글자를 첫 줄 빼고 지정 칸만큼 들여쓴다 — 블록 자리를 고칠 때 새 줄이
 * 부모 키 칸에 맞춰 서게 하려고 쓴다(stringify 는 끝에 개행을 하나 더 붙이므로 그것도 뗀다).
 */
function indentLines(text: string, column: number): string {
  const body = text.endsWith('\n') ? text.slice(0, -1) : text
  const pad = ' '.repeat(Math.max(0, column))
  return body
    .split('\n')
    .map((line, i) => (i === 0 ? line : pad + line))
    .join('\n')
}

/**
 * 값 자리 시작 글자 위치 — 블록 맵·목록이면 자기 줄머리(들여쓰기 포함)와 그 위 주석 줄들, 그 밖(흐름·잎)은 값 첫 글자.
 * 컨테이너 값을 줄머리부터 고치면 부모는 줄머리에서 끊고, 지운 첫 항목의 들여쓰기 칸까지 컨테이너 병합이 책임진다 —
 * 값 첫 글자에서만 끊으면 지운 자리에 첫 항목의 들여쓰기 칸만 남아 남는 줄의 들여쓰기가 이중으로 붙는다(WP-2040 최종 리뷰 finding 1).
 * 잎·형식이 다른 값은 키 접두(`key: `)가 부모에게 남아야 하니 값 첫 글자에서 끊는다.
 * 첫 항목 위 주석 줄도 여기에 포함해 컨테이너 병합 소유로 넘긴다 — 지운 첫 항목의 주석이
 * 부모의 키 접두에 남아 다음 항목 머리에 고아로 붙지 않게(Must Fix finding).
 */
function valueStart(src: string, bVal: unknown, aVal: unknown, r: Range): number {
  const blockable = (isMap(bVal) && isMap(aVal)) || (isSeq(bVal) && isSeq(aVal))
  if (!blockable) return r[0]
  // 빈 맵에 한 줄에 못 끼우는 값이 들어가면(만들기 템플릿 `nodes: {}` → 노드 블록) 키 끝(`:`)에서 끊는다 —
  // `{` 자리에서 끊으면 흐름 괄호 안에 여러 줄을 못 끼워 병합이 정규화 dump 로 떨어진다(WP-2040 재반려 finding 6).
  // 끊는 자리와 emitEmptyMap 의 블록 세움 자리가 서로 맞물려야(콜론을 못 찾으면 둘 다 포기) 개행이 어긋나지 않는다.
  if (isMap(bVal) && bVal.items.length === 0 && isMap(aVal) && !aVal.items.every((pair) => oneLineable(pair.value))) {
    const keyEnd = keyEndOf(src, r)
    if (keyEnd !== r[0]) return keyEnd
  }
  return blockStartOf(src, r)
}

/** from 부터 가장 가까운 줄 끝 글자 위치(없으면 -1) — CRLF 은 `\r` 부터가 줄 끝이다. */
function lineBreakOf(src: string, from: number): number {
  const cr = src.indexOf('\r', from)
  const lf = src.indexOf('\n', from)
  if (cr < 0) return lf
  if (lf < 0) return cr
  return Math.min(cr, lf)
}

/**
 * 항목 자리의 칸(column) — 새 항목을 같은 칸에 세우는 기준.
 * 목록은 `- ` 줄머리, 맵은 키 머리가 그 줄의 첫 글자라 그 칸을 센다(범위 시작이 들여쓰기까지
 * 포함하므로 범위 시작 위치로는 칸을 못 구한다).
 */
function columnOf(src: string, pos: number): number {
  const ls = lineStartOf(src, Math.max(pos, 1))
  let i = ls
  while (i < src.length && (src[i] === ' ' || src[i] === '\t')) i++
  return i - ls
}

/**
 * 문서가 쓰는 개행 — CRLF 원문(`\r\n`)에 신규로 넣는 줄이 bare LF 로 섞이지 않게 고르는 데 쓴다.
 * 섞이면 편집기·diff 가 그 파일을 줄 수 다르게 읽어, 손대지 않은 줄도 개행만으로 고친 걸로 보인다(WP-2040 6번 리뷰 Minor 3).
 */
function eolOf(src: string): string {
  return src.includes('\r\n') ? '\r\n' : '\n'
}

/**
 * after 에만 있는 항목을 이웃 칸에 맞춰 끼운다 — 줄머리면 이웃 칸부터 쓰고 이어지는 줄도 같은 칸에 들여쓴다.
 * 뒤에 또 다른 항목이 이어지도록 끝에 개행을 하나 남긴다(없으면 앞뒤 글자가 붙어 YAML 가 깨진다).
 * 개행은 eol 로 — CRLF 문서에 LF 를 끼우면 줄 하나가 두 줄로 갈라진다(WP-2040 6번 리뷰 Minor 3).
 */
function placeAdded(out: string, column: number, text: string, dash: boolean, eol: string): string {
  const pad = ' '.repeat(Math.max(0, column))
  let s = out
  if (s !== '' && !s.endsWith('\n')) s += eol
  // 아직 아무것도 붙인 자리(s === '')에서도 칸을 지킨다 — 그대로 두면 첫 줄만 들여쓰기가 빠져
  // 구조가 바뀌고 재파싱 검증에서 거부돼 전문 정규화 출력으로 떨어진다(WP-2040 최종 리뷰 finding 1).
  const head = s === '' || s.endsWith('\n') ? pad : ''
  // 새 항목 안쪽 개행도 문서 개행으로 — 줄 사이만 CRLF 로 맞추고 항목 안은 LF 로 두면 여전히 섞인다
  const body = indentLines(text, dash ? column + 2 : column).replace(/\n/g, eol)
  return s + head + (dash ? '- ' : '') + body + eol
}

/**
 * 잎 — 원문 범위를 통째로 새 값으로 갈아 끼운다. 흐름 자리면 한 줄, 블록 자리면 본문을 키 줄 아래 한 단계로 세운다.
 */
function emitLeaf(src: string, bVal: unknown, aVal: unknown): string {
  const range = rangeOf(bVal)
  const orig = range ? src.slice(range[0], range[1]) : ''
  const value = jsValue(aVal)
  // 흐름 스타일 자리(원문이 `{`·`[` 로 시작하는 한 줄 묶음)는 한 줄로 다시 쓴다.
  // 블록 자리(중간에 `{` 가 섞인 글자·여러 줄 포함)는 키 줄 아래 한 단계로 다시 쓴다 —
  // 값 시작 열(`key: ` 뒤 칸)로 들여쓰면 `instructions: |` 본문이 18칸으로 밀린다(WP-2040 리뷰 1).
  const flow = /^[{[]/.test(orig.trimStart())
  let text = flow
    ? stringify(value, { lineWidth: 0, flow: true })
    : indentLines(stringify(value, { lineWidth: 0 }), range ? ownerColumnOf(src, range[0]) + 2 : 0)
  if (text.endsWith('\n')) text = text.slice(0, -1)
  // 원문 자리가 줄 끝으로 끝났으면 새 글자도 줄 끝으로 — 아니면 뒤에 오는 원문이 한 줄에 붙는다.
  if (orig.endsWith('\n') !== text.endsWith('\n')) text = orig.endsWith('\n') ? `${text}\n` : text.slice(0, -1)
  if (!flow) text = keepBlockHeaderTail(orig, text)
  // 새로 넣는 줄은 문서 개행으로 — CRLF 원문에 LF 를 끼우면 한 파일 안에서 개행이 섞인다(WP-2040 리뷰 2).
  const eol = eolOf(src)
  return eol === '\n' ? text : text.replace(/\n/g, eol)
}

/**
 * 블록 스칼라 머리 줄의 표시자 뒤 주석을 새 글자 첫 줄 끝에 다시 붙인다 — `instructions: |   # 설명`
 * 처럼 사람이 표시자 뒤에 단 주석이다. 값만 바꾸는 편집이라도 원문 범위를 통째로 갈아 끼우면 그 주석이
 * 함께 사라지니(WP-2040 리뷰 후속 ①), 원문 머리 줄(`|`·`>` 표시자 한 줄)에 주석이 있으면 남겨 붙인다.
 * 새 글자에 줄이 없으면(한 줄짜리 값) 개행 없이 뒤에 덧붙인다.
 */
function keepBlockHeaderTail(orig: string, text: string): string {
  const origBr = lineBreakOf(orig, 0)
  const origHead = origBr < 0 ? orig : orig.slice(0, origBr)
  const tail = /^[ \t]*[|>][-+0-9]*([ \t]+#[^\r\n]*)$/.exec(origHead)?.[1]
  if (!tail) return text
  const br = lineBreakOf(text, 0)
  return br < 0 ? text + tail : text.slice(0, br) + tail + text.slice(br)
}

/**
 * 흐름 컨테이너 판별 — 원문 범위가 `{` 로 시작하면 흐름 맵(emitLeaf 와 같은 기준)이고,
 * 닫는 괄호(`}` 바로 앞 글자)의 위치를 돌려준다. 블록이면 null — 호출자는 블록 줄 처리를 이어 간다.
 * 닫는 괄호를 못 찾으면(원문이 기대와 다르면) null 로 두어 병합이 검증에서 걸리게 한다.
 */
function flowCloseOf(src: string, range: Range): number | null {
  if (!src.slice(range[0], range[1]).trimStart().startsWith('{')) return null
  const close = range[1] - 1
  return src[close] === '}' ? close : null
}

/** 흐름 스타일(`{ … }`·`[ … ]`)로 파싱·생성된 컨테이너 노드 — 새 항목을 그 스타일 그대로 끼우는 데 쓴다. */
function isFlowNode(node: unknown): boolean {
  return (isMap(node) || isSeq(node)) && node.flow === true
}

/** 흐름 스타일 항목 한 줄 — `key: { … }`·`key: [ … ]` 를 한 줄로 쓰고(문자열·중첩 값 포함), 짝을 감싼 바깥 `{ }` 는 쓰지 않으니 벗긴다. */
function flowEntry(key: string, value: unknown): string {
  const text = stringify(new Map([[key, jsValue(value)]]), { lineWidth: 0, flow: true }).trim()
  return text.startsWith('{') && text.endsWith('}') ? text.slice(1, -1).trim() : text
}

/**
 * 새 컨테이너 항목 한 덩어리 — 값 **노드를 그대로** 직렬화해 흐름/블록 플래그를 지킨다(WP-2040 최종 리뷰 finding 4).
 * 평범한 JS 값(jsValue)으로 바꿔 쓰면 `flow` 플래그가 사라져, 같은 편집에서 새로 만든 컨테이너
 * (`outcomes:`·`ask:`)가 자식까지 블록 여러 줄로 흩어진다. 노드를 직접 직렬화하면
 * `outcomes:\n  done: { to: b }` 처럼 자식의 한 줄 표기가 그대로다.
 * 자식 줄은 2칸 더 받아야(placeAdded 가 부모 칸을 더한다) `key:` 아래로 들어간다 — 흐름 값·빈 컨테이너는 한 줄 접두.
 */
function containerEntry(key: string, value: unknown): string {
  const body = stringify(value, { lineWidth: 0 }).replace(/\n$/, '')
  if (isFlowNode(value) || body === '{}' || body === '[]') return `${key}: ${body}`
  const inner = body
    .split('\n')
    .map((line) => (line === '' ? line : `  ${line}`))
    .join('\n')
  return `${key}:\n${inner}`
}

/**
 * 블록 자리의 새 항목 한 덩어리 — 컨테이너는 `containerEntry` 가 노드 표기를, 잎은 흐름 한 줄을 쓴다.
 * 항목을 새로 세우는 자리와 이름 바뀐 자리 갈아끼우기가 함께 쓴다(흐름 컨테이너는 `flowEntry` 를 따로 쓴다).
 */
function blockEntry(key: string, value: unknown): string {
  if (isMap(value) || isSeq(value)) return containerEntry(key, value)
  return stringify(new Map([[key, jsValue(value)]]), { lineWidth: 0 })
}

/**
 * 줄에서 주석을 떼어 낸다 — `#` 는 앞이 공백이거나 줄 시작일 때만 주석이다(인용 안의 `#` 는 글자).
 * 흐름 항목 줄에 쉼표를 넣을 때 주석 **뒤**(즉 주석 글자 안)가 아니라 값과 주석 사이에 넣기 위해 쓴다 —
 * 주석에 쉼표를 붙이면 사용자가 쓴 주석이 바뀌고, 그 사이에 쉼표가 없으면 파싱이 깨져 전문이
 * 정규화 dump 로 떨어진다(WP-2040 6번 리뷰 Important 1).
 */
function splitTrailingComment(line: string): { code: string; comment: string } {
  let quote: string | null = null
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (quote) {
      if (ch === '\\' && quote === '"') i++ // 이스케이프 문자는 다음 글자와 한 쌍
      else if (ch === quote) quote = null
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      continue
    }
    if (ch === '#' && (i === 0 || line[i - 1] === ' ' || line[i - 1] === '\t')) {
      return { code: line.slice(0, i), comment: line.slice(i) }
    }
  }
  return { code: line, comment: '' }
}

/**
 * 흐름 컨테이너 마무리 — 닫는 괄호를 붙이기 전에 정리한다.
 * - 지운 항목이 원래 마지막이면 앞 항목 뒤에 쉼표가 남는데, 흐름의 트레일링 쉼표는 문법 오류라 그 쉼표만 걷는다.
 *   여러 줄 흐름(`}` 가 다음 줄에 있으면)은 줄바꿈까지 건너뛰어 걷는다 — 안 그러면 줄 끝 쉼표가 남아
 *   병합이 매번 정규화 출력으로 떨어진다(WP-2040 리뷰 4).
 * - 모아 둔 새 항목은 쉼표로 이어 붙여 괄호 안에 끼운다. 여러 줄이면 항목마다 줄을 바꿔 원문 모양을 지킨다.
 *   style 은 여러 줄 흐름일 때 항목 들여쓰기·개행을 넘기기 위한 것(호출자가 항상 넘긴다).
 * - 마지막 **값 줄**에만 쉼표를 넣는다 — 줄 끝 주석에 쉼표를 붙이면 주석이 바뀌고(리뷰 Important 1),
 *   주석 뒤에 쉼표가 없으면 파싱 오류로 전문이 dump 로 갈라진다. `}` 는 항상 tail 로 원래 자리(들여쓰기)에 둔다.
 */
function finishFlow(out: string, emitted: number, adds: string[], close: string, style: { indent: number; eol: string }): string {
  const noComma = out.replace(/,([ \t]*(?:\r?\n[ \t]*)?)$/, '$1')
  if (adds.length === 0) return noComma + close
  const tail = /[ \t]*\r?\n[ \t]*$/.exec(noComma) // 줄 끝 개행(없으면 한 줄 흐름)
  if (!tail) {
    const base = noComma.replace(/[ \t]+$/, '') // `}` 바로 앞 여백은 새로 앉힌다(쉼표가 오도록)
    const sep = emitted > 0 ? ', ' : base.endsWith('{') ? ' ' : ''
    return base + sep + adds.join(', ') + ' ' + close
  }
  // 여러 줄 흐름 — 항목을 원문 줄에 맞춰 한 줄씩 세우고 `}` 는 원래 줄바꿈 자리에 둔다.
  // 줄은 원문 개행 문자째 쪼개(재조립 시 eol 로 바꾸지 않아) 손대지 않은 줄의 CRLF 가 그대로다.
  const { indent, eol } = style
  const pad = ' '.repeat(indent)
  const parts = noComma.slice(0, tail.index).replace(/[ \t]+$/, '').split(/(\r?\n)/)
  // 새 항목을 이을 마지막 값 줄에만(빈 줄·주석 줄은 건너뛰어) 쉼표를 확실히 — 값과 주석 사이에 넣는다.
  // emitted 0(빈 맵)은 항목 줄이 없어 넣을 자리가 없다 — `{` 줄에 쉼표를 붙이면 깨진다.
  if (emitted > 0) {
    // split(/(\r?\n)/) 은 [글자, 개행, 글자, …] 로 글자만 짝수 번째에 오므로 끝에서 짝 칸부터 거꾸로 본다
    for (let i = parts.length - 1; i >= 0; i -= 2) {
      const t = parts[i].trim()
      if (t === '' || t.startsWith('#')) continue
      const { code, comment } = splitTrailingComment(parts[i])
      const trimmed = code.replace(/[ \t]+$/, '')
      if (!trimmed.endsWith(',')) parts[i] = trimmed + ',' + code.slice(trimmed.length) + comment
      break
    }
  }
  const body = parts.join('')
  const joined = adds.map((add) => `${eol}${pad}${add}`).join(',')
  // `}` 는 emitted 이 0 이어도 tail 자리(원래 줄바꿈·들여쓰기)를 쓴다 — 아니면 `}` 칸이 밀린다(WP-2040 6번 리뷰 Minor 3)
  return body + joined + tail[0] + close
}

/**
 * 값 하나를 흐름 한 줄 안에 끼울 수 있는가 — 잎(스칼라)·흐름 컨테이너·빈 컨테이너는 한 줄로 치고,
 * 블록 여러 줄 값(새로 만든 노드 블록처럼 흐름 표기가 없는 것)은 중괄호 안에 못 넣는다.
 * 걸러진 쪽은 호출자가 정규화 dump 로 넘겨 읽기 좋은 블록 스타일로 다시 쓰게 한다.
 */
function oneLineable(value: unknown): boolean {
  if ((isMap(value) || isSeq(value)) && value.items.length > 0) return isFlowNode(value)
  return true
}

/**
 * 빈 맵 자리에 항목을 넣는다 — 흐름 목록(`[ … ]`)이 잎 경로(emitValue)로 처리되는 것과 **대칭**으로,
 * 원문이 흐름(`{ … }`)인 빈 맵도 원래 중괄호 안에 새 키를 쉼표로 이어 붙인다(WP-2040 6번 리뷰 Important 1).
 * 안 그랬을 땐 빈 맵에 키가 생기는 순간 병합을 포기해 전문이 정규화 dump 로 갈라지고,
 * 정렬 공백·줄 끝 주석까지 손대지 않은 줄이 통째로 바뀌었다(`layout: {}` 편집 한 번에 49 줄 재작성).
 *
 * 이어 붙이지 못하는 두 경우는 null 로 두어 dump 안전망으로 넘긴다:
 * - **한 줄에 못 끼우는 값** — 블록 여러 줄 값(만들기 템플릿 `nodes: {}` 에 노드를 넣는 경로가 여기 걸린다)은
 *   흐름 괄호 안에 못 들어간다. 이때는 부모가 valueStart 로 키 끝(`:`)에서 끊어 두었으므로, 개행 뒤에
 *   키 아래 한 단계로 블록을 다시 세운다 — 세우지 못하면(콜론 없음) 그때 dump 로 넘긴다(WP-2040 재반려 finding 6).
 * - **원문에 `{ }` 표기가 없는 빈 자리** — 흐름/블록 스타일을 원문에서 읽을 수 없다. 스타일을
 *   정해 버리면 원문과 다른 모양으로 쓰게 되므로, 원래대로 재직렬화 출력이 값을 지킨다.
 */
function emitEmptyMap(src: string, range: Range, aMap: YAMLMap): string | null {
  const close = flowCloseOf(src, range)
  const fits = aMap.items.every((pair) => oneLineable(pair.value))
  if (close !== null && fits) {
    const adds: string[] = aMap.items.map((pair) => flowEntry(pairKeyOf(pair), pair.value))
    // 항목을 세울 칸 — 키 줄 아래 한 단계(빈 흐름 맵엔 원문 항목이 없어 기준을 못 잡는다)
    return finishFlow(src.slice(range[0], close), 0, adds, src.slice(close, range[1]), {
      indent: ownerColumnOf(src, range[0]) + 2,
      eol: eolOf(src),
    })
  }
  if (!fits) {
    const keyEnd = keyEndOf(src, range)
    if (keyEnd === range[0]) return null // 키 줄에 콜론이 없다 — 부모와 끊는 자리를 맞출 수 없어 포기한다
    const eol = eolOf(src)
    const pad = ' '.repeat(ownerColumnOf(src, range[0]) + 2)
    const text = aMap.items.map((pair) => containerEntry(pairKeyOf(pair), pair.value)).join('\n')
    return eol + text
      .split('\n')
      .map((line) => (line === '' ? line : pad + line))
      .join(eol)
  }
  return null
}

/**
 * 맵 병합 — 손대지 않은 항목은 원문 범위를 통째로 붙이고, 값만 바뀐 항목은 키 자리(주석 포함)는
 * 원문에 두고 값 범위만 교체한다. after 에만 있는 키는 이웃 칸에 새로 끼우고, before 에만 있는 키는
 * 건너뛴다(삭제). 흐름 컨테이너(`{ … }`)는 괄호 안에 쉼표로 이어 붙여 한 줄을 지킨다.
 * 힌트로 자리가 잡힌 이름 바뀜은 원문 자리에 키 글자만 바꿔 쓴다(정렬 공백·주석 유지).
 * 안 할 수 있으면 null — 중복 키·range 없음·범위 수 불일치·설명 안 되는 키 이름 바뀜.
 * path·hints 는 이 컨테이너가 문서 어딘에 있는지(힌트가 이 컨테이너의 것인지) 가리는 데 쓴다.
 */
function emitMap(src: string, bMap: YAMLMap, aMap: YAMLMap, path: (string | number)[], hints: readonly RenameHint[]): string | null {
  const range = rangeOf(bMap)
  if (!range) return null
  // 빈 맵은 항목 자리 대응이 없으므로 위 병합을 못 쓴다 — 원문이 흐름 자리면 그 자리에 이어 붙이고,
  // 아니면(블록·값이 여러 줄) dump 안전망으로 넘긴다(자세한 이유는 emitEmptyMap 주석)
  if (bMap.items.length === 0) return emitEmptyMap(src, range, aMap)
  const regions = itemRegions(src, bMap, bMap.items)
  if (regions.length !== bMap.items.length) return null

  const byKey = new Map<string, { pair: Pair; index: number }>()
  for (let i = 0; i < bMap.items.length; i++) {
    const pair = bMap.items[i]
    const key = pairKeyOf(pair)
    if (byKey.has(key)) return null // 중복 키는 어느 자리와 대응하는지 모호하다
    byKey.set(key, { pair, index: i })
  }
  const aKeys = aMap.items.map(pairKeyOf)
  const aSet = new Set(aKeys)

  // 한 패치에서 이름만 바뀐 항목 — after 자리를 before 옛 키에 대응시킨다(호출자가 남긴 힌트뿐).
  // 힌트 자리에 after 키가 실제로 앉아 있고, 옛 키는 원문에만 남아 있어야 대응으로 본다 —
  // 어긋나면(다른 편집이 섞인 힌트) 무시하고 아래 added·gone 안전망으로 넘긴다.
  const renameAt = new Map<number, string>() // after 자리 → 원문에서 바꿔 쓸 옛 키
  for (const h of hints) {
    if (!samePath(h.path, path)) continue
    const item = aMap.items[h.index]
    if (!item || pairKeyOf(item) !== h.to) continue
    if (!byKey.has(h.from) || aSet.has(h.from)) continue
    renameAt.set(h.index, h.from)
  }

  // 이름이 바뀐 항목은 추가·삭제가 아니다 — 힌트로 자리 대응이 끝난 뒤에도 개수가 어긋나면
  // (설명 안 되는 키 이름 차이) 구별할 수 없으니 그대로 병합을 포기한다. 힌트가 있으면
  // 남은 added·gone 은 진짜 추가·삭제뿐이라 이 안전망은 더 이상 rename 을 오인하지 않는다.
  const renamedKeys = new Set(renameAt.values())
  const added = aKeys.filter((k, i) => !byKey.has(k) && !renameAt.has(i)).length
  const gone = [...byKey.keys()].filter((k) => !aSet.has(k) && !renamedKeys.has(k)).length
  if (added > 0 && gone > 0 && added === gone) return null // 힌트로 설명 안 되는 키 이름 차이 — 원문 병합을 포기한다

  const close = flowCloseOf(src, range) // 흐름이면 닫는 `}` 위치, 블록이면 null
  let out = src.slice(range[0], regions[0].start)
  let anchor: number | null = null // 새 항목을 세울 기준 자리(마지막으로 붙인 기존 항목의 키 시작)
  let emitted = 0 // 흐름 마무리에서 "원래 항목을 그대로 냈는지"를 가리는 데 쓴다
  const flowAdds: string[] = [] // 흐름에 끼울 새 항목 — 닫는 괄호 앞에 한 번에 붙인다
  // 흐름의 마지막 원문 항목은 원래 쉼표가 없는데 재배치로 뒤·가운데로 밀리면 그 뒤 조각과 사이에
  // 쉼표가 없어 파싱이 깨지고 전문이 정규화 dump 로 떨어진다(WP-2040 팀장 재반려 Important 2).
  // 값 끝 자리를 기억해 두었다가 뒤 조각을 붙이기 직전에 그 자리에 쉼표를 끼운다.
  let openComma = -1
  for (let i = 0; i < aMap.items.length; i++) {
    const ap = aMap.items[i]
    const key = pairKeyOf(ap)
    // 이름이 바뀐 항목은 옛 키의 원문 자리(주석까지)를 쓰고, 키 글자만 새 이름으로 바꾼다
    const oldKey = renameAt.get(i)
    const hit = byKey.get(key) ?? (oldKey !== undefined ? byKey.get(oldKey) : undefined)
    if (!hit) {
      if (close !== null) {
        flowAdds.push(flowEntry(key, ap.value))
        continue
      }
      const pos = anchor ?? rangeOf(bMap.items[bMap.items.length - 1].key)?.[0] ?? 0
      // 항목을 새로 세운다 — 컨테이너는 노드 표기를, 잎은 흐름 한 줄을 그대로 두어 flow 표기가 흩어지지 않는다(WP-2040 최종 리뷰 finding 3·4)
      out = placeAdded(out, columnOf(src, pos), blockEntry(key, ap.value), false, eolOf(src))
      continue
    }
    const region = regions[hit.index]
    // 흐름의 마지막 항목은 닫는 괄호 바로 앞까지가 범위다(컨테이너 값 끝에는 `}` 가 포함되므로)
    const end = close !== null && hit.index === bMap.items.length - 1 ? close : region.end
    const bVal = hit.pair.value
    const bRange = rangeOf(bVal)
    if (!bRange) return null
    if (openComma >= 0) {
      out = out.slice(0, openComma) + ',' + out.slice(openComma) // 앞 조각(원문 마지막 항목) 뒤에 쉼표
      openComma = -1
    }
    // 쉼표가 원문에 이미 있으면(트레일링 쉼표 스타일) 다시 넣지 않는다 — 값 뒤 주석·다음 줄 쉼표도 원문 것으로 본다
    const suffix = src.slice(bRange[1], end)
    const needsComma =
      close !== null && hit.index === bMap.items.length - 1 && !/^[ \t]*(?:#[^\r\n]*)?(?:\r?\n[ \t]*)?,/.test(suffix)
    anchor = rangeOf(hit.pair.key)?.[0] ?? anchor
    // 키 자리: 이름이 바뀌었으면 원문 키 글자 자리에 새 이름만 쓰고(위 주석 줄은 region.start 에 남는다),
    // 아니면 원문 그대로 — 둘 다 `src.slice(region.start, …)` 로 이어 붙이면 글자가 빠짐없이 이어진다.
    const keyRange = oldKey !== undefined ? rangeOf(hit.pair.key) : null
    if (oldKey !== undefined && (!keyRange || !isScalar(hit.pair.key))) return null
    const through = (to: number) =>
      keyRange ? src.slice(region.start, keyRange[0]) + key + src.slice(keyRange[1], to) : src.slice(region.start, to)
    if (sameValue(jsValue(bVal), jsValue(ap.value))) {
      out += through(end) // 깊이 같으면(키 이름만 바뀐 경우 포함) 원문 글자를 그대로
      if (needsComma) openComma = out.length - suffix.length // 값 바로 뒤 자리 — 사이에 조각이 오면 그때 끼운다
    } else {
      // 자식 경로는 after 의 키 이름으로 — 힌트도 after 자리(path)를 기준으로 남긴다
      const mid = emitValue(src, bVal, ap.value, [...path, key], hints)
      if (mid === null) {
        // 이름이 바뀐 자리인데 값 모양이 달라 자리 병합이 안 된다(잎 ↔ 컨테이너 교체 — ask 줄임 표기를
        // outcomes 로 펼치는 자리). 병합을 포기해 전문 정규화 출력으로 넘기지 않고, 그 자리(키 줄) 전체를
        // 새 항목 하나로 갈아 끼운다 — 손대지 않은 줄은 여전히 원문 그대로다(WP-2040 리뷰 후속 ③).
        if (oldKey === undefined || !keyRange) return null
        const entry = close !== null ? flowEntry(key, ap.value) : blockEntry(key, ap.value)
        anchor = rangeOf(hit.pair.key)?.[0] ?? anchor
        // 열 기준은 키가 선 칸으로 — 위 주석 줄·빈 줄을 region 시작으로 삼으면 0칸이라 본문이 틀린 곳에 선다.
        const indented = indentLines(entry.replace(/\n+$/, ''), columnOf(src, keyRange[0])).replace(/\n/g, eolOf(src))
        const rest = src.slice(bRange[1], end) // 값 뒤 원문(줄 끝 주석·개행) — 새 값 끝에 그대로 이어 붙인다
        let body = indented + rest
        // 원문 자리가 줄 끝으로 끝나는데 그 개행을 블록 값 range 가 삼켜 rest 에 없으면, 새 항목 끝에 직접
        // 넣어야 뒤에 오는 줄이 한 줄로 붙지 않는다(indentLines 는 끝 개행을 남기지 않으므로 받은 뒤 더한다).
        if (/\n$/.test(src.slice(region.start, end)) && !/\n$/.test(body)) body += eolOf(src)
        out += src.slice(region.start, keyRange[0]) + body
        emitted++
        continue
      }
      const cut = valueStart(src, bVal, ap.value, bRange)
      let keyTail = '' // 키 줄에 남길 값 뒤 글자(줄 끝 주석 등) — 값을 아래 줄로 옮길 때만 쓴다
      let tail = src.slice(bRange[1], end)
      // 키와 값이 같은 줄에 있는데 값을 아래로 끊았다(빈 맵을 블록으로 다시 세움) — 원문 줄 끝의
      // 주석은 키 줄에 남아야 한다. mid 뒤에 붙이면 블록 마지막 항목의 주석으로 바뀌어 없던 곳에
      // 붙어 버린다(WP-2040 재반려 finding 6). 줄 끝이 컨테이너 범위 밖이면 옮길 수 없어 포기한다.
      const lineStart = lineStartOf(src, bRange[0])
      if (cut > lineStart && cut < bRange[0]) {
        const br = lineBreakOf(src, bRange[1])
        if (br > end) return null
        if (br >= 0) {
          keyTail = src.slice(bRange[1], br)
          tail = src.slice(br, end)
        } else {
          // 끝 개행이 없는 파일 — 값 뒤로 끝까지가 전부 키 줄이다. tail 로 두면 줄 끝 주석이
          // 새로 세운 마지막 항목 줄 뒤에 붙어 없던 자리에 오므로(WP-2040 팀장 재반려 Minor 7) 키 줄로 옮긴다.
          keyTail = src.slice(bRange[1], end)
          tail = ''
        }
      }
      // 블록 목록 값은 줄머리(들여쓰기 포함)부터 — 지운 첫 항목 자리에 빈 들여쓰기 칸이 남지 않게
      out += through(cut) + keyTail + mid + tail // 자리·주석만 두고 값만
      if (needsComma) openComma = out.length - tail.length // 새 값(mid) 바로 뒤 — tail 은 값 뒤 원문이다
    }
    emitted++
  }
  if (close === null) return out
  // 여러 줄 흐름의 새 항목 칸·개행 — 원문 마지막 항목 **키**가 쓰인 칸을 그대로 쓴다.
  // 항목 위 빈 줄·주석 줄까지 항목 범위에 포함한 뒤라(regions 시작이 공백 줄이 될 수 있다)
  // 그 위치로 칸을 세면 0 이 되어 새 항목이 들여쓰기를 잃고 병합이 정규화 dump 로 떨어진다(WP-2040 6번 리뷰 Important 2)
  const lastKeyPos = rangeOf(bMap.items[bMap.items.length - 1].key)?.[0]
  return finishFlow(out, emitted, flowAdds, src.slice(close, range[1]), {
    indent: lastKeyPos !== undefined ? columnOf(src, lastKeyPos) : columnOf(src, regions[regions.length - 1].start),
    eol: eolOf(src),
  })
}

/**
 * 목록 병합 — 항목 대응은 두 포인터로 값이 같은 것끼리(순서 유지) 짝 짓는다. 자리 번호로만 대응하면
 * 가운데 항목을 지울 때 지운 줄이 아니라 마지막 줄이 빠지고 남은 항목의 줄을 고쳐 쓰게 된다.
 * 바꿈과 지움이 섞인 자리는 뒤쪽에 **더 비슷한 짝**이 있을 때만 지금 항목을 지운 것으로 본다 —
 * 지운 항목 자리에 바뀐 항목을 앉히면 지운 항목의 주석이 남고 살아남은 항목의 주석이 사라진다
 * (WP-2040 재반려 finding 1). 짝이 안 된 항목끼리는 같은 자리에서 값만 교체하고(제자리 갱신),
 * 목록이 먼저 끝나면 남는 항목은 이웃 `- ` 칸에 한 줄(흐름 괴식)로 끼운다 — 추가를 블록 맵 꼴로
 * 다시 쓰면 여러 줄로 흩어진다.
 */
function emitSeq(src: string, bSeq: YAMLSeq, aSeq: YAMLSeq, path: (string | number)[], hints: readonly RenameHint[]): string | null {
  const range = rangeOf(bSeq)
  if (!range || bSeq.items.length === 0) return null
  // 목록이 통째로 비었다(예: start 마지막 조건의 노드를 지움) — 자리에 `[]` 을 남긴다.
  // 비면 값 자리가 비어 `start:`(null)로 남아 재검증에 거부돼 전문 정규화 dump 로 떨어지고,
  // 스키마 필수 키(start)는 통째로 사라진다(WP-2040 재반려 finding 3). 블록 목록 자리(줄머리)는
  // 키 줄보다 깊은 칸에 세우고, 그 위에 남은 주석 줄은 함께 남긴다.
  if (aSeq.items.length === 0) {
    const vStart = valueStart(src, bSeq, aSeq, range)
    const ls = lineStartOf(src, range[0])
    const gap = ls > vStart ? src.slice(vStart, ls) : '' // 첫 항목 위 주석 줄 — 값의 일부라 버리지 않는다
    // 마지막 항목 줄의 개행은 값 범위 안에 들어 있다 — 안 남기면 다음 키와 글자가 붙어 YAML 이 깨진다.
    // 항목 주석(지운 자리)은 개행 찾는 자리에서 이미 걸러져 남지 않는다.
    const lastEnd = rangeOf(bSeq.items[bSeq.items.length - 1])?.[1] ?? range[1]
    const br = lineBreakOf(src, lastEnd)
    const eol = br >= 0 && br < range[1] ? src.slice(br, src.startsWith('\r\n', br) ? br + 2 : br + 1) : ''
    if (lineStartOf(src, vStart) !== vStart) return gap + '[]' + eol // 줄 중간(흐름 목록·`- - a` 중첩) — 그 자리에 그대로 붙인다
    const column = Math.max(columnOf(src, range[0]), keyColumnAbove(src, vStart) + 1)
    return gap + ' '.repeat(column) + '[]' + eol
  }
  const regions = itemRegions(src, bSeq, bSeq.items)
  if (regions.length !== bSeq.items.length) return null

  // 두 포인터 대응: 같으면 짝, 뒤에 같은 값이 남아 있으면 지금 항목은 지운 것(b 쪽)·바로 넣은 것(a 쪽),
  // 그 밖은 제자리 교체. 값만 바뀐 항목은 뒤쪽에 더 비슷한 짝이 있을 때만 지운 것으로 본다.
  const bFor = new Array<number>(aSeq.items.length).fill(-1)
  const bVal = (k: number) => jsValue(bSeq.items[k])
  const aVal = (k: number) => jsValue(aSeq.items[k])
  let i = 0
  let j = 0
  while (j < aSeq.items.length && i < bSeq.items.length) {
    if (sameValue(bVal(i), aVal(j))) {
      bFor[j] = i
      i++
      j++
      continue
    }
    let laterB = false
    for (let k = i + 1; k < bSeq.items.length; k++) {
      if (sameValue(bVal(k), aVal(j))) {
        laterB = true
        break
      }
    }
    if (laterB) {
      i++ // 지금 b 항목은 지운 것(같은 값이 뒤에 남아 있다)
      continue
    }
    let laterA = false
    for (let k = j + 1; k < aSeq.items.length; k++) {
      if (sameValue(aVal(k), bVal(i))) {
        laterA = true
        break
      }
    }
    if (laterA) {
      j++ // 지금 a 항목은 새로 넣은 것(같은 값이 뒤에 나온다)
      continue
    }
    // 정확히 맞지 않는 자리 — 뒤에 지금 자리보다 더 비슷한 짝이 있으면 지금 b 항목은 지운 것이다
    const cur = similarity(bVal(i), aVal(j))
    let better = -1
    for (let k = i + 1; k < bSeq.items.length; k++) better = Math.max(better, similarity(bVal(k), aVal(j)))
    if (better > cur) {
      i++
      continue
    }
    bFor[j] = i // 제자리 값 교체
    i++
    j++
  }

  const vStart = valueStart(src, bSeq, aSeq, range)
  // 머리는 **첫으로 내는** 항목에만 붙인다 — 앞 항목이 지워져도 그 자리를 잃지 않게
  let lead = src.slice(vStart, regions[0].start) // 첫 항목 위에 남은 자리 — 부모가 값 시작에서 끊어 남긴 것
  let out = ''
  let anchor: number | null = null // 새 항목을 세울 기준 자리(마지막으로 낸 항목의 값 시작)
  for (let n = 0; n < aSeq.items.length; n++) {
    const bi = bFor[n]
    if (bi < 0) {
      const pos = anchor ?? rangeOf(bSeq.items[bSeq.items.length - 1])?.[0] ?? 0
      out = placeAdded(out, columnOf(src, pos), stringify(aVal(n), { lineWidth: 0, flow: true }), true, eolOf(src))
      continue
    }
    const region = regions[bi]
    const bv = bSeq.items[bi]
    const bRange = rangeOf(bv)
    if (!bRange) return null
    anchor = bRange[0]
    const headPart = lead
    lead = '' // 머리는 한 번만 — 다음 항목부터는 자기 범위에 이미 들어 있다
    if (sameValue(bVal(bi), aVal(n))) {
      out += headPart + src.slice(region.start, region.end)
      continue
    }
    const mid = emitValue(src, bv, aSeq.items[n], [...path, n], hints)
    if (mid === null) return null
    out += headPart + src.slice(region.start, valueStart(src, bv, aSeq.items[n], bRange)) + mid + src.slice(bRange[1], region.end)
  }
  return out
}

/**
 * 값 단위 재귀 — 깊이 같으면 원문 슬라이스, 맵·목록이면 자리별 병합, 그 밖은 잎으로 교체한다. null 은 병합 포기.
 * path·hints 는 아래 컨테이너의 자리 대응 힌트를 넘기기 위한 것.
 */
function emitValue(src: string, bVal: unknown, aVal: unknown, path: (string | number)[], hints: readonly RenameHint[]): string | null {
  const range = rangeOf(bVal)
  if (!range) return null
  // 같아도 호출자가 끊은 자리(valueStart)부터 붙인다 — 목록을 줄머리에서 끊었다면 앞 들여쓰기까지 이어져야 한다
  if (sameValue(jsValue(bVal), jsValue(aVal))) return src.slice(valueStart(src, bVal, aVal, range), range[1])
  if (isMap(bVal) && isMap(aVal)) return emitMap(src, bVal, aVal, path, hints)
  if (isSeq(bVal) && isSeq(aVal)) {
    // 흐름 목록(`[ … ]`)은 항목 사이라 줄을 끼워 넣을 자리가 없다 — emitSeq 의 줄바꿈 splice 는
    // 괄호 안에 들어가지 않아 병합이 항상 null 로 떨어진다(호출자가 전문 재직렬화로 대체).
    // 그 대신 잎으로 갈아 끼운다: 편집된 그 한 줄만 다시 쓰고(불가피) 파일 나머지는 원문 그대로 남는다(WP-2040 최종 리뷰 finding 2).
    if (/^\[/.test(src.slice(range[0], range[1]).trimStart())) return emitLeaf(src, bVal, aVal)
    return emitSeq(src, bVal, aVal, path, hints)
  }
  return emitLeaf(src, bVal, aVal)
}

/**
 * 원문 source 위에 편집 결과(after)를 덧붙인다 — 손대지 않은 항목은 글자 그대로, 바뀐 값은 원문 자리를 교체.
 * 안전하게 못 하면 null(호출자가 정규화 출력으로 대체). 반환 전 결과를 다시 파싱해 오류 0 ∧
 * 깊이 비교(after.toJS())를 검증하고, 아니면 null. 절대 던지지 않는다.
 * hints 는 한 패치에서 키 이름만 바뀐 항목을 원문 자리에 그대로 두기 위한 자리 대응 힌트다(없으면 기본값).
 */
export function mergeEditedSource(source: string, before: Document.Parsed, after: Document.Parsed, hints: readonly RenameHint[] = []): string | null {
  try {
    if (before.errors.length > 0 || after.errors.length > 0) return null
    if (sameValue(jsValue(before.contents), jsValue(after.contents))) return source // 편집 없으면 원문 그대로
    const range = rangeOf(before.contents)
    if (!range) return null
    const merged = emitValue(source, before.contents, after.contents, [], hints)
    if (merged === null) return null
    // contents.range 밖의 머리·끝(머리 주석·`---` 지시문·끝 주석·공백)은 원문 글자를 그대로 이어 붙인다.
    // 안 그러면 실제 편집이 있을 때마다 범위 밖 텍스트가 조용히 지워지는데, 검증(toJS 비교)은 주석을 보지 못해 성공으로 위장된다.
    // 끊는 자리는 emitSeq 와 같은 valueStart — 최상위 목록의 첫 항목 위 주석이 head 와 머리에 이중으로 실리지 않게 한다.
    const cut = valueStart(source, before.contents, after.contents, range)
    const out = source.slice(0, cut) + merged + source.slice(range[1])
    const check = parseDocument(out)
    if (check.errors.length > 0) return null
    if (!sameContent(check.toJS(), after.toJS())) return null
    return out
  } catch {
    return null // 읽지 못하는 노드(별칭 등)가 섞여도 던지지 않고 대체하게 넘긴다
  }
}