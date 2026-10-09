import DiffMatchPatch from 'diff-match-patch'
import MarkdownIt from 'markdown-it'

/**
 * 노트 3-way 블록 병합(WP-289, 스펙 §5.1-3) — 기준본(AI 가 읽은 판)·현재본(실시간 문서)·AI본을 합친다.
 *
 * 왜 블록 단위인가: 사람은 실시간 문서에서 글자 단위로 고치고, AI 는 전체 본문을 다시 써서 보낸다. 통째로 덮으면 그사이 사람 입력이
 * 사라진다. 블록(문단·표·코드·목록 항목)마다 "누가 바꿨나"를 보고 한쪽만 바꿨으면 그쪽을, 둘 다 바꿨으면 글자 단위로 합친다.
 *
 * 입력 규칙: 기준본·AI본은 공용 스키마 정규화본(collab normalizeMarkdown), 현재본은 공용 직렬화기 출력(docToMarkdown)이어야 한다
 * (호출자 collab 책임). 표기 차이만으로 블록이 "바뀐" 것으로 보이면 손대지 않은 블록의 사람 수정을 AI 가 덮거나(WP-283 스파이크) 같은
 * 내용이 두 번 나온다. 강제 줄바꿈은 직렬화기가 늘 `\` + 줄바꿈으로 쓰므로 세 입력이 이미 같은 표기다 — 블록 병합은 표기를 맞추지
 * 않으므로, 원문을 그대로 넣으면(줄 끝 공백 둘 ↔ `\` + 줄바꿈이 섞임) 같은 문단이 두 번 나올 수 있다.
 *
 * 순수 함수(DOM·Yjs 없음) — WP-298 변경 표시가 같은 분할·정렬을 재사용한다(스펙 §6.3).
 */

// 블록 경계만 쓴다 — tiptap-markdown 과 같은 html 허용(원문 HTML 블록이 한 블록으로 잡히게). 표는 기본 preset 에 포함.
const md = new MarkdownIt({ html: true })
const dmp = new DiffMatchPatch()
// 블록 하나의 글자 diff 가 오래 걸리면 거친 diff 로 끊는다(병합은 실시간 문서 잠금 안에서 돈다).
dmp.Diff_Timeout = 0.2

// diff-match-patch 연산 코드(라이브러리 문서 값).
const EQUAL = 0
const DELETE = -1

/** 목록 글머리 — 글머리(-+*) 또는 번호(1. 1)). LIST_ITEM·ITEM_HEAD 가 함께 쓴다. */
const MARKER = String.raw`[-+*]|\d{1,9}[.)]`
/** 목록 항목 첫 줄 — 0~3칸 들여쓰기 + 글머리 + 공백/끝. */
const LIST_ITEM = new RegExp(String.raw`^ {0,3}(${MARKER})(?:[ \t]|$)`)
/**
 * 정확 일치 LCS 표 크기 상한(같은 자리 삽입 블록 중복 제거용) — 넘으면 짝 없이 둘 다 남긴다(메모리·시간 보호).
 * 동기화 서버 keepLive 짝짓기(trimmedLcsPairs)도 같은 상한을 쓴다.
 */
export const MAX_LCS_CELLS = 4_000_000
/**
 * 유사도 짝짓기 전체 표 크기 상한. 넘으면 내용 기반 후보(2-gram 역색인) + 순서 보존 최대 가중 부분열로 짝짓는다.
 * 어느 경우에도 위치로 짝짓지 않고 MIN_SIMILARITY 미만은 짝짓지 않는다 — 위치(순서·창·띠)에 기대면 대량 삽입·삭제 뒤
 * 사람 수정이 이웃 문단에 붙거나 "AI 가 지움"으로 사라진다(WP-289 리뷰 1·2차).
 */
const MAX_GAP_CELLS = 300_000
/** 블록 하나의 후보를 찾을 때 훑는 역색인 항목 수 예산 — 드문 2-gram 부터 쓴다(흔한 2-gram 은 변별력이 없고 비싸다). */
const CANDIDATE_SCAN_BUDGET = 2_000
/** 블록 하나당 유사도를 실제로 계산할 후보 수(공유 2-gram 이 많은 순, 같으면 틈 안 상대 위치가 가까운 순). */
const MAX_CANDIDATES = 8
/**
 * 유사도가 같거나 거의 같을 때 쓰는 작은 감점(유사도 1 당 1e-6 규모) — 반복되는 같은 블록(### 액션 아이템, ---, 같은 표)이
 * 엉뚱한 회차 사본과 짝지어지지 않게 한다(WP-289 리뷰 3·4차). 작은 틈 DP 와 큰 틈 내용 사슬 모두 틈 앞 앵커에 가까운 짝(앞쪽)을
 * 고른다(WP-325 — 둘이 다르면 틈 크기에 따라 같은 입력의 짝이 달라졌다). 큰 틈 후보 가지치기(MAX_CANDIDATES)만 상대 위치를 쓴다.
 */
const PROXIMITY_WEIGHT = 1e-6
/** 이 유사도 미만이면 "같은 블록을 고친 것"이 아니라 삭제 + 새 블록으로 본다. */
const MIN_SIMILARITY = 0.3
/** 정확 문맥 패치의 첫 문맥 길이(앞뒤 글자 수). 여러 곳에서 맞으면 두 배씩 늘린다. */
const MIN_MARGIN = 8
const MAX_MARGIN = 256

/**
 * 마크다운 → 병합 블록(원문 그대로의 문자열, 끝 공백 제거). 목록은 최상위 항목마다 한 블록.
 * markdown-it 이 토큰을 내지 않는 줄(참조 정의 `[r]: http://…`)은 빈 줄로 나뉜 덩어리마다 한 블록으로 그대로 싣는다 —
 * 빠뜨리면 병합 결과에서 조용히 사라진다(WP-289 리뷰).
 */
export function splitBlocks(src: string): string[] {
  return splitParsed(src).blocks.map((b) => b.text)
}

/** splitBlocks + 파싱 토큰 — 병합은 최상위 목록 항목·인용의 토큰 자리를 컨테이너 병합에 넘겨 다시 파싱하지 않는다(seedOf). */
function splitParsed(src: string): { blocks: SplitBlock[]; tokens: Token[] } {
  const tokens = md.parse(src, {})
  return { blocks: collectBlocks(src.split('\n'), tokens, 0, tokens.length, 0, 0), tokens }
}

/** markdown-it 토큰 (번역 없이 구조만 쓴다). */
type Token = ReturnType<typeof md.parse>[number]

/** 나눈 블록 하나 — 원문과 그 여는 토큰 인덱스(토큰 없는 줄 덩어리는 -1). 컨테이너 안을 다시 파싱하지 않고 열 때 쓴다. */
interface SplitBlock {
  text: string
  open: number
}

/**
 * splitBlocks 의 핵심 — 이미 파싱한 토큰 범위 [from,to) 에서 level 단계의 블록을 모은다. lines[k] 는 토큰 map 줄 offset + k 에 해당한다.
 * 컨테이너(목록 항목·인용) 안쪽 자식을 나눌 때, 컨테이너를 연 파싱의 토큰을 그대로 써서 안쪽을 다시 파싱하지 않는다(WP-326 성능 —
 * 병합은 실시간 문서 잠금 안에서 돈다). 최상위(splitBlocks)는 from 0·level 0·offset 0.
 */
function collectBlocks(lines: string[], tokens: Token[], from: number, to: number, level: number, offset: number): SplitBlock[] {
  const out: SplitBlock[] = []
  const slice = (map: [number, number]) =>
    lines
      .slice(map[0] - offset, map[1] - offset)
      .join('\n')
      // trimEnd 는 정규식 \s 와 같은 공백 집합이다 — /\s+$/ 는 깊게 들여쓴 큰 블록에서 공백 구간마다 되짚어 매우 느렸다(WP-326 성능).
      .trimEnd()
  // covered 이전 줄은 이미 블록에 들어갔다. 다음 토큰 시작 전까지 남은 줄을 빈 줄 기준으로 끊어 블록으로 싣는다.
  let covered = 0
  const flushUncovered = (until: number) => {
    let start = -1
    for (let k = covered; k <= until; k++) {
      const blank = k === until || lines[k].trim() === ''
      if (!blank && start < 0) start = k
      if (blank && start >= 0) {
        out.push({ text: slice([start + offset, k + offset]), open: -1 })
        start = -1
      }
    }
    covered = Math.max(covered, until)
  }
  for (let i = from; i < to; i++) {
    const t = tokens[i]
    if (t.level !== level || !t.map || t.nesting === -1) continue
    flushUncovered(Math.min(t.map[0] - offset, lines.length))
    covered = Math.max(covered, t.map[1] - offset)
    if (t.type === 'bullet_list_open' || t.type === 'ordered_list_open') {
      const close = t.type.replace('_open', '_close')
      let j = i + 1
      for (; j < to && !(tokens[j].level === level && tokens[j].type === close); j++) {
        const item = tokens[j]
        if (item.type === 'list_item_open' && item.level === level + 1 && item.map) out.push({ text: slice(item.map as [number, number]), open: j })
      }
      i = j // 다음 반복의 i++ 가 목록 닫힘 토큰을 건너뛴다
      continue
    }
    out.push({ text: slice(t.map as [number, number]), open: i })
  }
  flushUncovered(lines.length)
  return out
}

/** 목록 종류 — 글머리 문자 또는 번호 구분자. 목록 항목이 아니면 null. */
function listKind(block: string): string | null {
  const m = LIST_ITEM.exec(block)
  if (!m) return null
  return /\d/.test(m[1]) ? `ol${m[1].slice(-1)}` : `ul${m[1]}`
}

/** 블록 → 마크다운. 같은 종류 목록 항목끼리는 줄바꿈 하나(한 목록), 나머지는 빈 줄. */
export function joinBlocks(blocks: string[]): string {
  let out = ''
  blocks.forEach((b, i) => {
    if (i > 0) {
      const k = listKind(blocks[i - 1])
      out += k != null && k === listKind(b) ? '\n' : '\n\n'
    }
    out += b
  })
  return out
}

/** 블록의 글자 2-gram 다중집합 — 큰 틈에서 같은 블록을 여러 번 비교하므로 한 번만 만든다. */
interface Profile {
  text: string
  grams: Map<string, number>
  size: number
}

function profileOf(text: string): Profile {
  const grams = new Map<string, number>()
  for (let i = 0; i < text.length - 1; i++) {
    const g = text.slice(i, i + 2)
    grams.set(g, (grams.get(g) ?? 0) + 1)
  }
  return { text, grams, size: Math.max(0, text.length - 1) }
}

/** 두 프로필의 Dice 유사도 — 작은 쪽 2-gram 만 돈다. */
function dice(a: Profile, b: Profile): number {
  if (a.text === b.text) return 1
  if (a.size === 0 || b.size === 0) return 0
  const [small, large] = a.grams.size <= b.grams.size ? [a.grams, b.grams] : [b.grams, a.grams]
  let hit = 0
  for (const [g, c] of small) hit += Math.min(c, large.get(g) ?? 0)
  return (2 * hit) / (a.size + b.size)
}

/**
 * Dice 유사도가 min 이상임이 공통 앞·뒤만으로 확실한지 — 공통 앞 p 글자·뒤 q 글자(겹치지 않게)는 각각 p-1·q-1 개의 같은 2-gram 을
 * 양쪽에 준다(다중집합 교집합의 하한). false 는 "모름"이다(실제 유사도는 더 높을 수 있다).
 */
function similarityAtLeast(a: string, b: string, min: number): boolean {
  const limit = Math.min(a.length, b.length)
  let p = 0
  while (p < limit && a.charCodeAt(p) === b.charCodeAt(p)) p++
  let q = 0
  while (q < limit - p && a.charCodeAt(a.length - 1 - q) === b.charCodeAt(b.length - 1 - q)) q++
  const size = Math.max(0, a.length - 1) + Math.max(0, b.length - 1)
  return size > 0 && (2 * (Math.max(0, p - 1) + Math.max(0, q - 1))) / size >= min
}

/** 두 블록의 글자 2-gram Dice 유사도(0~1) — 같은 블록을 고친 것인지 판단용(가볍고 결정적). */
export function similarity(a: string, b: string): number {
  return dice(profileOf(a), profileOf(b))
}

/** a[a0..a1)·b[b0..b1) 의 정확 일치 LCS 쌍(오름차순). 표가 상한을 넘으면 빈 배열. */
function lcsPairs(a: string[], a0: number, a1: number, b: string[], b0: number, b1: number): Array<[number, number]> {
  const n = a1 - a0
  const m = b1 - b0
  if (n === 0 || m === 0 || n * m > MAX_LCS_CELLS) return []
  const w = m + 1
  const dp = new Uint32Array((n + 1) * w)
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i * w + j] = a[a0 + i] === b[b0 + j] ? dp[(i + 1) * w + j + 1] + 1 : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1])
    }
  }
  const out: Array<[number, number]> = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[a0 + i] === b[b0 + j]) {
      out.push([a0 + i, b0 + j])
      i++
      j++
    } else if (dp[(i + 1) * w + j] >= dp[i * w + j + 1]) i++
    else j++
  }
  return out
}

/**
 * 두 키 목록의 최장 공통 부분열 짝(인덱스 쌍, 오름차순). 앞뒤 공통 구간은 바로 짝짓고 가운데만 DP 한다 — 가운데 표가 상한을 넘으면
 * 앞뒤 공통 구간만 짝짓는다. 동기화 서버 keepLive(병합 결과 블록 ↔ 실시간 블록 짝짓기)가 쓴다.
 */
export function trimmedLcsPairs(a: string[], b: string[]): Array<[number, number]> {
  let p = 0
  while (p < a.length && p < b.length && a[p] === b[p]) p++
  let s = 0
  while (s < a.length - p && s < b.length - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++
  const pairs: Array<[number, number]> = []
  for (let i = 0; i < p; i++) pairs.push([i, i])
  const n = a.length - p - s
  const m = b.length - p - s
  if (n > 0 && m > 0 && n * m <= MAX_LCS_CELLS) {
    // dp[i][j] = a[p+i..] 와 b[p+j..] 의 LCS 길이(뒤에서부터).
    const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1))
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        dp[i][j] = a[p + i] === b[p + j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
      }
    }
    let i = 0
    let j = 0
    while (i < n && j < m) {
      if (a[p + i] === b[p + j]) {
        pairs.push([p + i, p + j])
        i++
        j++
      } else if (dp[i + 1][j] >= dp[i][j + 1]) i++
      else j++
    }
  }
  for (let k = s; k > 0; k--) pairs.push([a.length - k, b.length - k])
  return pairs
}

/** 틈 안 상대 위치 거리(0~1) — i 는 n 개 중, j 는 m 개 중. 큰 틈 후보 가지치기에만 쓴다(동점 규칙은 frontPenalty). */
function relDistance(i: number, n: number, j: number, m: number): number {
  return Math.abs((i + 0.5) / n - (j + 0.5) / m)
}

/**
 * 근접 동점 감점 — 작은 틈 DP 와 큰 틈 내용 사슬이 함께 쓰는 하나의 규칙(WP-325). 틈 앞 앵커에 가까운 짝(앞쪽)일수록 작다.
 * 유사도 1 당 PROXIMITY_WEIGHT 규모라 유사도가 실제로 다르면 뒤집지 못하고, 같거나 거의 같을 때만 앞쪽 사본을 고르게 한다.
 */
function frontPenalty(i: number, n: number, j: number, m: number): number {
  return PROXIMITY_WEIGHT * ((i + 0.5) / n + (j + 0.5) / m)
}

/**
 * 양쪽 범위에서 각각 **한 번만** 나오는 같은 블록 쌍 중 순서를 지키는 최장 집합(patience 앵커).
 * 반복 블록은 앵커가 되지 않는다 — 어느 사본끼리 짝인지 정확 일치만으로는 알 수 없어서, 옛 LCS 앵커는 다른 회차 사본과 짝지어
 * 사람 수정을 이웃 문단에 붙이거나 "AI 가 지움"으로 잃었다(WP-289 리뷰 3차).
 */
function uniqueAnchors(base: string[], bs: number, be: number, other: string[], os: number, oe: number): Array<[number, number]> {
  const seen = new Map<string, { b: number; bi: number; o: number; oi: number }>()
  for (let i = bs; i < be; i++) {
    const e = seen.get(base[i])
    if (e) e.b++
    else seen.set(base[i], { b: 1, bi: i, o: 0, oi: -1 })
  }
  for (let j = os; j < oe; j++) {
    const e = seen.get(other[j])
    if (e) {
      e.o++
      e.oi = j
    }
  }
  const pairs: Array<[number, number]> = []
  for (const e of seen.values()) if (e.b === 1 && e.o === 1) pairs.push([e.bi, e.oi])
  pairs.sort((x, y) => x[0] - y[0])
  // other 인덱스의 최장 증가 부분열(patience 정렬, O(k log k)).
  const tails: number[] = []
  const prev = new Int32Array(pairs.length).fill(-1)
  pairs.forEach(([, oi], k) => {
    let lo = 0
    let hi = tails.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (pairs[tails[mid]][1] < oi) lo = mid + 1
      else hi = mid
    }
    if (lo > 0) prev[k] = tails[lo - 1]
    tails[lo] = k
  })
  const out: Array<[number, number]> = []
  for (let k = tails.length > 0 ? tails[tails.length - 1] : -1; k >= 0; k = prev[k]) out.push(pairs[k])
  return out.reverse()
}

/**
 * 작은 틈 — 순서를 지키며 유사도 합이 최대가 되게 짝짓는다(제자리 수정). MIN_SIMILARITY 미만은 짝짓지 않는다.
 * 유사도 합이 같으면 앞쪽(틈 앞 앵커에 붙은) 사본끼리 짝짓는다(PROXIMITY_WEIGHT) — 틈은 고유 블록(보통 회차 제목) 바로 뒤에서
 * 시작하므로, AI 가 회차를 새로 넣거나 통째로 지우면 남은 쪽 꼬리는 앞 제목에 붙은 사본이다. 틈 안 상대 위치로 고르면 늘어나거나
 * 줄어든 좌표 때문에 새로 넣은/지운 회차의 사본이 더 가까워 보여 사람 수정이 다른 회차로 가거나 사라졌다(WP-289 리뷰 4차).
 */
function pairSmallGap(P: Profile[], Q: Profile[], bs: number, os: number, match: number[]): void {
  const n = P.length
  const m = Q.length
  const w = m + 1
  // 문턱 미만은 -1, 이상이면 위치 감점을 뺀 가중치(항상 0 이상).
  const sim = new Float64Array(n * m)
  const dp = new Float64Array((n + 1) * w)
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      const s = dice(P[i], Q[j])
      const v = s >= MIN_SIMILARITY ? s - frontPenalty(i, n, j, m) : -1
      sim[i * m + j] = v
      const take = v >= 0 ? v + dp[(i + 1) * w + j + 1] : -Infinity
      dp[i * w + j] = Math.max(take, dp[(i + 1) * w + j], dp[i * w + j + 1])
    }
  }
  let i = 0
  let j = 0
  while (i < n && j < m) {
    const v = sim[i * m + j]
    if (v >= 0 && dp[i * w + j] === v + dp[(i + 1) * w + j + 1]) {
      match[bs + i] = os + j
      i++
      j++
    } else if (dp[(i + 1) * w + j] >= dp[i * w + j + 1]) i++
    else j++
  }
}

/**
 * 큰 틈의 내용 기반 짝 사슬 — 위치와 무관하게 내용으로 후보를 찾고, 순서를 지키는 후보 쌍 중 가중치 합이 최대인 부분열.
 * 1) Q 의 2-gram 역색인(useJ 인 블록만). 2) useI 인 P 블록마다 드문 2-gram 부터 예산만큼 훑어, 공유 수가 많고(같으면 상대 위치가 가까운)
 * 상위 MAX_CANDIDATES 개의 실제 유사도를 잰다(문턱 이상만). 3) i·j 모두 증가하는 최대 가중 부분열(펜윅 접두 최대) — 가중치는
 * 유사도에서 작은 틈과 같은 앞쪽 감점을 뺀 값. 결과는 지역 인덱스 쌍.
 */
function contentChain(P: Profile[], Q: Profile[], useI: (i: number) => boolean, useJ: (j: number) => boolean): Array<[number, number]> {
  const n = P.length
  const m = Q.length
  const postings = new Map<string, number[]>()
  Q.forEach((q, j) => {
    if (!useJ(j)) return
    for (const g of q.grams.keys()) {
      const list = postings.get(g)
      if (list) list.push(j)
      else postings.set(g, [j])
    }
  })
  const hits = new Int32Array(m)
  const pi: number[] = []
  const pj: number[] = []
  const pw: number[] = []
  P.forEach((p, i) => {
    if (!useI(i)) return
    const lists: number[][] = []
    for (const g of p.grams.keys()) {
      const list = postings.get(g)
      if (list) lists.push(list)
    }
    lists.sort((a, b) => a.length - b.length)
    const touched: number[] = []
    let scanned = 0
    for (const list of lists) {
      if (scanned > 0 && scanned + list.length > CANDIDATE_SCAN_BUDGET) break
      scanned += list.length
      for (const j of list) if (hits[j]++ === 0) touched.push(j)
    }
    // 공유 수 상위 MAX_CANDIDATES 개 — 동점이면 상대 위치가 가까운 쪽(반복 사본은 제자리 근처가 후보에 든다).
    // 이건 동점 규칙이 아니라 가지치기다: 앞쪽 우선으로 고르면 3000 블록 노트의 --- 사본이 모두 처음 8개만 후보가 돼 사슬이 끊긴다.
    // 받아들인 한계: 공유 수가 같은 사본이 MAX_CANDIDATES(8)개보다 많으면 앞쪽 규칙(frontPenalty)은 상대 위치가 가까운 8개 안에서만
    // 고른다 — 그 밖의 더 앞쪽 사본은 후보에 없으므로, 그런 경우엔 작은 틈(전체 DP)과 큰 틈의 짝이 여전히 다를 수 있다.
    const better = (a: number, b: number) => hits[a] > hits[b] || (hits[a] === hits[b] && relDistance(i, n, a, m) < relDistance(i, n, b, m))
    const top: number[] = []
    for (const j of touched) {
      let k = top.length
      while (k > 0 && better(j, top[k - 1])) k--
      if (k < MAX_CANDIDATES) {
        top.splice(k, 0, j)
        if (top.length > MAX_CANDIDATES) top.pop()
      }
    }
    for (const j of touched) hits[j] = 0
    for (const j of top) {
      const s = dice(p, Q[j])
      if (s >= MIN_SIMILARITY) {
        pi.push(i)
        pj.push(j)
        // 근접 동점은 작은 틈과 같은 앞쪽 우선(WP-325) — 틈 앞 앵커에 붙은 사본을 고른다(pairSmallGap 주석 참고).
        pw.push(s - frontPenalty(i, n, j, m))
      }
    }
  })
  // i 오름차순, 같은 i 안에서는 j 내림차순 — 같은 기준 블록의 두 후보가 한 사슬에 같이 들어가지 못하게.
  const order = pi.map((_, k) => k).sort((a, b) => pi[a] - pi[b] || pj[b] - pj[a])
  const treeVal = new Float64Array(m + 1)
  const treeAt = new Int32Array(m + 1).fill(-1)
  const total = new Float64Array(pi.length)
  const prev = new Int32Array(pi.length).fill(-1)
  let bestEnd = -1
  for (const k of order) {
    // j 보다 작은 Q 위치에서 끝나는 사슬 중 최대(펜윅 접두 최대, 1-기반).
    let best = 0
    let from = -1
    for (let x = pj[k]; x > 0; x -= x & -x) {
      if (treeVal[x] > best) {
        best = treeVal[x]
        from = treeAt[x]
      }
    }
    total[k] = best + pw[k]
    prev[k] = from
    for (let x = pj[k] + 1; x <= m; x += x & -x) {
      if (total[k] > treeVal[x]) {
        treeVal[x] = total[k]
        treeAt[x] = k
      }
    }
    if (bestEnd < 0 || total[k] > total[bestEnd]) bestEnd = k
  }
  const chain: Array<[number, number]> = []
  for (let k = bestEnd; k >= 0; k = prev[k]) chain.push([pi[k], pj[k]])
  return chain.reverse()
}

/** 틈 안에서 한 번만 나오는 블록인지 — 반복 블록은 큰 틈의 앵커에서 빼고, 앵커 사이 작은 틈에서 짝짓는다. */
function uniqueMask(profiles: Profile[]): boolean[] {
  const counts = new Map<string, number>()
  for (const p of profiles) counts.set(p.text, (counts.get(p.text) ?? 0) + 1)
  return profiles.map((p) => counts.get(p.text) === 1)
}

/** 두 범위가 블록 하나하나까지 똑같은지 — 그러면 짝은 제자리 하나뿐이다(빠른 길). */
function sameRange(a: string[], as: number, ae: number, b: string[], bs: number, be: number): boolean {
  if (ae - as !== be - bs) return false
  for (let k = 0; k < ae - as; k++) if (a[as + k] !== b[bs + k]) return false
  return true
}

/**
 * 기준 블록마다 other 쪽 대응 블록 인덱스(-1 = 지워짐). 단조 증가. 위치에 기대지 않는다.
 * 공통 앞·뒤 떼기는 하지 않는다 — 반복 블록(### 액션 아이템, ---)을 범위 끝끼리 정확 일치로 짝지어, AI 가 같은 틀의 회차를 새로 넣거나
 * 지우면 사람 수정이 다른 회차로 가거나 사라졌다(WP-289 리뷰 4차). 같은 고유 블록은 어차피 patience 앵커가 된다.
 * 범위마다: 범위 전체가 똑같으면 제자리로 짝짓고 → 양쪽에 한 번만 나오는 같은 블록(patience 앵커)으로 나눠 재귀 →
 * 앵커가 없으면 작은 틈은 유사도 DP, 큰 틈은 내용 기반 사슬(고유 블록만)을 앵커로 다시 나누고, 그것도 없으면 전체 블록으로 내용 사슬.
 */
export function alignBlocks(base: string[], other: string[]): number[] {
  const match = new Array<number>(base.length).fill(-1)
  const stack: Array<[number, number, number, number]> = [[0, base.length, 0, other.length]]
  while (stack.length > 0) {
    const [bs, be, os, oe] = stack.pop()!
    if (bs === be || os === oe) continue
    if (sameRange(base, bs, be, other, os, oe)) {
      for (let k = 0; k < be - bs; k++) match[bs + k] = os + k
      continue
    }
    // 앵커로 나눈 하위 범위를 쌓는다.
    const split = (anchors: Array<[number, number]>) => {
      let pb = bs
      let po = os
      for (const [bi, oi] of anchors) {
        match[bi] = oi
        stack.push([pb, bi, po, oi])
        pb = bi + 1
        po = oi + 1
      }
      stack.push([pb, be, po, oe])
    }
    const exact = uniqueAnchors(base, bs, be, other, os, oe)
    if (exact.length > 0) {
      split(exact)
      continue
    }
    // 1:1 틈은 짝지을지(유사도 ≥ MIN_SIMILARITY)만 정하면 된다 — 공통 앞·뒤 길이로 유사도 하한을 재서 넘으면 2-gram 프로필 없이 짝짓는다
    // (결과는 같다). 큰 목록 항목·인용(하위 트리 통째)을 단계마다 프로필로 만드는 비용을 던다(WP-326 성능).
    if (be - bs === 1 && oe - os === 1 && similarityAtLeast(base[bs], other[os], MIN_SIMILARITY)) {
      match[bs] = os
      continue
    }
    const P = base.slice(bs, be).map(profileOf)
    const Q = other.slice(os, oe).map(profileOf)
    if (P.length * Q.length <= MAX_GAP_CELLS) {
      pairSmallGap(P, Q, bs, os, match)
      continue
    }
    const uP = uniqueMask(P)
    const uQ = uniqueMask(Q)
    const anchors = contentChain(P, Q, (i) => uP[i], (j) => uQ[j])
    if (anchors.length > 0) {
      split(anchors.map(([i, j]) => [bs + i, os + j]))
      continue
    }
    for (const [i, j] of contentChain(P, Q, () => true, () => true)) match[bs + i] = os + j
  }
  return match
}

/** 기준 글자 범위 [start,end) 를 text 로 바꾸는 덩어리. */
interface Hunk {
  start: number
  end: number
  text: string
}

/** 기준→AI 글자 diff 를 덩어리로 묶는다(같음 구간이 덩어리를 나눈다). */
function hunksOf(base: string, ai: string): Hunk[] {
  const diffs = dmp.diff_main(base, ai)
  dmp.diff_cleanupSemantic(diffs)
  const out: Hunk[] = []
  let pos = 0
  let open: Hunk | null = null
  for (const d of diffs) {
    const op = d[0]
    const text = d[1]
    if (op === EQUAL) {
      open = null
      pos += text.length
      continue
    }
    if (!open) {
      open = { start: pos, end: pos, text: '' }
      out.push(open)
    }
    if (op === DELETE) {
      open.end += text.length
      pos += text.length
    } else open.text += text
  }
  return out
}

/**
 * 덩어리가 cur 의 어디에 해당하는지 — 앞뒤 문맥을 붙인 기준 글자열이 floor 이후 **정확히 한 곳**에서만 맞아야 한다.
 * 여러 곳이면 문맥을 두 배씩 늘리고, 기준 전체를 써도 여러 곳이거나 한 곳도 없으면 null(퍼지 매칭 금지 — 스펙 §5.1).
 */
function locate(base: string, h: Hunk, cur: string, floor: number): number | null {
  for (let m = MIN_MARGIN; ; m *= 2) {
    const from = Math.max(0, h.start - m)
    const to = Math.min(base.length, h.end + m)
    const needle = base.slice(from, to)
    const lead = h.start - from
    const hits: number[] = []
    for (let i = cur.indexOf(needle); i !== -1 && hits.length < 2; i = cur.indexOf(needle, i + 1)) {
      if (i + lead >= floor) hits.push(i + lead)
    }
    if (hits.length === 0) return null
    if (hits.length === 1) return hits[0]
    if ((from === 0 && to === base.length) || m >= MAX_MARGIN) return null
  }
}

/**
 * 한 블록에서 기준→AI 변경을 현재(사람이 고친) 블록에 적용한다. 덩어리마다 정확 문맥으로 위치를 찾고, 하나라도 못 찾으면 null
 * (그 블록은 AI 쪽 — 호출자 정책). diff-match-patch 의 patch_apply 는 퍼지 매칭으로 엉뚱한 곳을 조용히 덮어(스파이크 확인) 쓰지 않는다.
 */
export function applyExactPatch(base: string, ai: string, cur: string): string | null {
  if (base === ai) return cur
  const edits: Array<{ at: number; len: number; text: string }> = []
  let floor = 0
  for (const h of hunksOf(base, ai)) {
    const at = locate(base, h, cur, floor)
    if (at == null) return null
    edits.push({ at, len: h.end - h.start, text: h.text })
    floor = at + (h.end - h.start)
  }
  let out = ''
  let pos = 0
  for (const e of edits) {
    out += cur.slice(pos, e.at) + e.text
    pos = e.at + e.len
  }
  return out + cur.slice(pos)
}

/** 병합 결과 — conflicts 는 정책상 AI 쪽으로 정한 블록 수(글자 병합 실패·삭제 대 수정). 로그·테스트용. */
export interface MergeResult {
  markdown: string
  conflicts: number
}

/** 3-way 해소 결과 — block null 은 결과에서 빠짐(삭제). conflicts 는 AI 쪽으로 정한 단위 수(표는 행 단위로 셀 수 있다). */
interface Resolved {
  block: string | null
  conflicts: number
}

/** 사람·AI 가 둘 다, 서로 다르게 바꿨는지 — 아니면 한쪽 것을 그대로 쓰면 된다(구조·글자 병합이 필요 없다). */
function bothChanged(base: string, cur: string | null, ai: string | null): boolean {
  return cur != null && ai != null && ai !== base && ai !== cur && cur !== base
}

/**
 * 글자 조각 하나의 3-way — 구조(표·목록 항목·인용)를 보지 않고 한쪽만 바꿨으면 그쪽, 둘 다 바꿨으면 정확 문맥 글자 패치(실패하면 AI 쪽).
 * 표 행·칸·구분 줄이 직접 쓴다 — 칸 ` - x ` 가 목록 항목처럼 보여도 목록으로 풀면 안 된다. resolveBlock 의 마지막 길이기도 하다.
 */
function resolveText(base: string, cur: string | null, ai: string | null): Resolved {
  if (bothChanged(base, cur, ai)) {
    const merged = applyExactPatch(base, ai!, cur!) // 둘 다 바꿈 → 글자 단위
    return merged == null ? { block: ai, conflicts: 1 } : { block: merged, conflicts: 0 }
  }
  if (cur == null && ai == null) return { block: null, conflicts: 0 } // 둘 다 지움
  // 사람이 지웠다 — AI 가 그대로 뒀으면 삭제 유지, AI 가 고쳤으면 AI 쪽.
  if (cur == null) return ai === base ? { block: null, conflicts: 0 } : { block: ai, conflicts: 1 }
  // AI 가 지웠다 — 사람이 고쳤어도 AI 쪽(삭제). 적용 직전 리비전으로 되돌릴 수 있다(스펙 §5.1).
  if (ai == null) return { block: null, conflicts: cur !== base ? 1 : 0 }
  if (ai === base || ai === cur) return { block: cur, conflicts: 0 } // AI 가 안 바꿨거나 똑같이 바꿈 → 사람 버전
  return { block: ai, conflicts: 0 } // 사람이 안 바꿈 → AI
}

/**
 * 기준 블록 하나의 3-way — 둘 다 바꿨으면 표(행·칸 단위) → 목록 항목·인용(자식 단위, WP-326) 순으로 구조 병합을 해 보고,
 * 안 되면 글자 단위(resolveText). prev 는 기준본에서 바로 앞 블록(첫 항목 판단 — mergeHead), ctx 는 컨테이너 병합 문맥.
 */
function resolveBlock(base: string, cur: string | null, ai: string | null, prev: string | null, ctx: MergeCtx): Resolved {
  if (!bothChanged(base, cur, ai)) return resolveText(base, cur, ai)
  return mergeTable(base, cur!, ai!) ?? mergeContainer(base, cur!, ai!, prev, ctx) ?? resolveText(base, cur, ai)
}

/** GFM 표 구분 줄(| --- | :-: |) — 파이프가 있어야 한다(`---` 만 있는 줄은 setext 제목·구분선). */
const TABLE_DELIMITER = /^ {0,3}\|?(?:\s*:?-+:?\s*\|)+\s*(?::?-+:?\s*)?$/

/** 표 블록이면 [머리 줄, 구분 줄, 본문 행…], 아니면 null. 표의 행은 줄 하나다(GFM — 셀 안 줄바꿈은 <br>). */
function tableLines(block: string): string[] | null {
  const lines = block.split('\n')
  return lines.length >= 2 && lines[0].includes('|') && TABLE_DELIMITER.test(lines[1]) ? lines : null
}

/** 셀 경계 파이프(이스케이프된 \| 는 셀 안 글자). */
const CELL_PIPE = /(?<!\\)\|/

/** 행의 셀 수 — 양끝 파이프는 선택. */
function cellCount(row: string): number {
  const t = row.trim()
  return t.replace(/^\|/, '').replace(/(?<!\\)\|$/, '').split(CELL_PIPE).length
}

/**
 * 표 행 하나의 3-way 결과 — 셋 다 있고 둘 다 바꿨으며 칸 수가 같으면 칸마다 따로 합친다(같은 행의 다른 셀 동시 수정 보존).
 * 행 전체 글자 패치는 짧은 셀에서 문맥(앞뒤 8자)이 옆 셀 수정과 겹쳐 실패하기 쉽다. 같은 칸을 둘 다 고쳐 못 합치면 그 칸만 AI 쪽(충돌 1).
 */
function resolveRow(base: string, cur: string | null, ai: string | null): Resolved {
  if (!bothChanged(base, cur, ai)) return resolveText(base, cur, ai)
  const b = base.split(CELL_PIPE)
  const c = cur!.split(CELL_PIPE)
  const a = ai!.split(CELL_PIPE)
  if (c.length !== b.length || a.length !== b.length) return resolveText(base, cur, ai)
  let conflicts = 0
  const cells = b.map((cell, k) => {
    const r = resolveText(cell, c[k], a[k])
    conflicts += r.conflicts
    return r.block!
  })
  return { block: cells.join('|'), conflicts }
}

/**
 * 셋 다 표인 블록의 행 단위 3-way 병합 — 머리 줄·구분 줄은 표에 묶인 채(제자리) 합치고, 본문 행은 목록 항목처럼 하나씩 짝지어
 * 칸 단위로 합친다(resolveRow). 왜: 표 전체를 한 블록으로 보면 사람과 AI 가 다른 셀을 고쳐도 AI 쪽이 이겨 사람 셀 수정이 사라진다
 * (회의록에 표가 많다). 열 수가 셋 중 하나라도 다르면(열 추가·삭제) 표 구조 자체가 충돌한 것이라 표 전체를 AI 쪽으로(충돌 1).
 * 표가 아니면 null.
 */
function mergeTable(base: string, cur: string, ai: string): { block: string; conflicts: number } | null {
  const b = tableLines(base)
  const c = tableLines(cur)
  const a = tableLines(ai)
  if (!b || !c || !a) return null
  const cols = cellCount(b[1])
  if (cellCount(c[1]) !== cols || cellCount(a[1]) !== cols) return { block: ai, conflicts: 1 }
  // 머리 줄·구분 줄은 셋 다 있으므로 결과가 늘 있다(양쪽이 다 있으면 null 을 내지 않는다).
  const head = resolveRow(b[0], c[0], a[0])
  const delimiter = resolveText(b[1], c[1], a[1])
  const rows = mergeSequence(b.slice(2), c.slice(2), a.slice(2), resolveRow)
  const lines = [head.block!, delimiter.block!, ...rows.blocks]
  // 글자 병합이 셀 경계(|)를 건드려 열 수가 어긋나면 표가 깨진다 — 표 전체를 AI 쪽으로.
  if (!tableLines(lines.join('\n')) || lines.some((r) => cellCount(r) !== cols)) return { block: ai, conflicts: 1 }
  return { block: lines.join('\n'), conflicts: head.conflicts + delimiter.conflicts + rows.conflicts }
}

/**
 * 목록 항목 머리 — 0~3칸 들여쓰기 + 글머리 + 공백 1~4칸, 바로 뒤는 공백이 아닌 글자.
 * 머리 길이가 곧 이어지는 줄의 들여쓰기다(직렬화기는 10번 이상 번호 목록에서 ` 1. ` 처럼 앞을 채워 폭을 맞춘다).
 * 첫 줄이 비었거나 공백 5칸 이상(들여쓴 코드)이면 맞지 않는다 — 모호하므로 오늘의 길로 둔다.
 */
const ITEM_HEAD = new RegExp(String.raw`^( {0,3}(?:${MARKER}) {1,4})(?=\S)`)
/** 번호 글머리(1. 1)) — 번호 다시 매기기 판단용(mergeHead). */
const ORDERED_HEAD = /^ {0,3}\d{1,9}[.)] /
/** 코드 울타리 줄인지(어느 깊이든) — 울타리 안 빈 줄·`>` 는 접두를 다시 붙일 때 표기가 달라져 컨테이너 병합에서 뺀다. */
function isFenceLine(line: string): boolean {
  const t = line.trimStart()
  return t.startsWith('```') || t.startsWith('~~~')
}
/**
 * 컨테이너 재귀 병합 깊이 상한 — 넘으면 그 안쪽 컨테이너는 오늘의 글자 패치로 합친다. 단계마다 합친 블록을 다시 파싱해 검증하므로
 * 깊이 × 크기 비용이 든다(병합은 실시간 문서 잠금 안에서 돈다 — 깊이 60 중첩 3000줄에서 수 초가 걸렸다). 실제 노트 중첩은 이보다 얕다.
 */
const MAX_CONTAINER_DEPTH = 8

/**
 * 이미 파싱한 컨테이너 자리 — 토큰 배열, 여는 토큰 인덱스, 블록 0번째 줄의 토큰 map 줄 번호.
 * fenceFree 는 바깥 컨테이너가 이미 울타리 코드 없음을 확인한 자식이라는 뜻(안쪽 줄은 바깥 줄의 부분이라 다시 훑지 않는다).
 */
interface Parsed {
  tokens: Token[]
  open: number
  offset: number
  fenceFree?: boolean
}

/** 컨테이너 종류 → 그 여는 토큰 종류(markdown-it). */
const OPEN_TYPE = { item: 'list_item_open', quote: 'blockquote_open' } as const

/**
 * 병합 한 번(mergeWithSide) 동안의 컨테이너 문맥 — 블록 원문 → 그 블록을 담은 파싱 자리. seed 는 기준본·AI본 최상위(MergeSide 공유,
 * 읽기 전용), cache 는 현재본 최상위 + 컨테이너를 열며 넣은 자식 자리. 같은 원문은 같은 구조로 읽히므로 원문으로 찾아 다시 파싱하지 않는다.
 * depth 는 지금 몇 겹 안쪽 컨테이너를 합치는 중인지(MAX_CONTAINER_DEPTH).
 */
interface MergeCtx {
  seed: ReadonlyMap<string, Parsed>
  cache: Map<string, Parsed>
  depth: number
}

/** 나눈 블록 중 목록 항목·인용의 자리를 map 에 넣는다(돌려주는 것도 그 map). */
function seedOf(split: { blocks: SplitBlock[]; tokens: Token[] }, map: Map<string, Parsed>, fenceFree = false): Map<string, Parsed> {
  const { tokens } = split
  for (const b of split.blocks) {
    const t = b.open >= 0 ? tokens[b.open] : null
    if (t?.map && (t.type === OPEN_TYPE.item || t.type === OPEN_TYPE.quote)) map.set(b.text, { tokens, open: b.open, offset: t.map[0], fenceFree })
  }
  return map
}

/** 열어 본 컨테이너 — 종류, 머리(목록 글머리 또는 `> `), 걷어 낸 안쪽, 안쪽의 직속 자식 블록과 자식 사이 구분(줄바꿈 1·2개). */
interface Opened {
  kind: 'item' | 'quote'
  head: string
  content: string
  kids: string[]
  seps: string[]
}

/** 블록 원문의 줄을 걷어 낸다 — 인용은 모든 줄이 `>`·`> …`, 목록 항목은 이어지는 줄이 빈 줄이거나 머리 폭만큼 들여써야 한다(지연 이어짐 금지). */
function stripContainer(lines: string[]): { kind: Opened['kind']; head: string; inner: string[] } | null {
  if (lines[0].startsWith('>')) {
    const inner: string[] = []
    for (const l of lines) {
      if (l === '>') inner.push('')
      else if (l.startsWith('> ')) inner.push(l.slice(2))
      else return null
    }
    return { kind: 'quote', head: '> ', inner }
  }
  const m = ITEM_HEAD.exec(lines[0])
  if (!m) return null
  const head = m[1]
  const pad = ' '.repeat(head.length)
  const inner = [lines[0].slice(head.length)]
  for (const l of lines.slice(1)) {
    if (l.trim() === '') inner.push('')
    else if (l.startsWith(pad)) inner.push(l.slice(pad.length))
    else return null
  }
  return { kind: 'item', head, inner }
}

/** 여는 토큰과 짝인 닫는 토큰 인덱스. */
function closeOf(tokens: Token[], open: number): number {
  const level = tokens[open].level
  let k = open + 1
  while (k < tokens.length && !(tokens[k].level === level && tokens[k].nesting === -1)) k++
  return k
}

/**
 * 블록을 단독 파싱해 컨테이너 하나(목록 항목 하나 또는 인용 하나)로만 읽히는지 보고 그 자리를 돌려준다. 구분선 `- - -` 같은 닮은꼴,
 * 항목이 둘 이상이거나 뒤에 다른 블록이 붙은 경우는 null.
 */
function parseContainer(block: string, kind: Opened['kind'], lineCount: number): Parsed | null {
  const tokens = md.parse(block, {})
  const top = tokens[0]
  if (!top?.map || top.map[0] !== 0 || top.map[1] < lineCount) return null
  const topClose = closeOf(tokens, 0)
  if (topClose !== tokens.length - 1) return null
  if (kind === 'quote') return top.type === OPEN_TYPE.quote ? { tokens, open: 0, offset: 0 } : null
  if (top.type !== 'bullet_list_open' && top.type !== 'ordered_list_open') return null
  if (tokens[1]?.type !== OPEN_TYPE.item || closeOf(tokens, 1) !== topClose - 1) return null
  return { tokens, open: 1, offset: 0 }
}

/**
 * 목록 항목·인용 블록을 연다(아니거나 모호하면 null). 걷어 낸 안쪽은 원문으로 정확히 되돌릴 수 있어야 하고(stripContainer), 울타리 코드가
 * 있으면 null(울타리 안 빈 줄을 직렬화기는 `> ` 로 쓰고, 다시 붙일 때 `>` 가 된다). 자식은 컨테이너 파싱 토큰에서 바로 나눈다 — 안쪽을
 * 따로 파싱하지 않고, 문맥(ctx)에 이 원문의 자리가 있으면 블록 자체도 파싱하지 않는다. register 면 자식 컨테이너 자리를 문맥에 넣는다
 * (검사용으로만 연 합친 블록은 넣지 않는다). 안쪽이 자식 + 구분(줄바꿈 1·2개)으로 정확히 이어지지 않으면 null.
 */
function openContainer(block: string, ctx: MergeCtx, register: boolean): Opened | null {
  const lines = block.split('\n')
  const stripped = stripContainer(lines)
  if (!stripped) return null
  const { kind, head, inner } = stripped
  const known = ctx.cache.get(block) ?? ctx.seed.get(block)
  const cached = known && known.tokens[known.open].type === OPEN_TYPE[kind] ? known : null
  if (!cached?.fenceFree && inner.some(isFenceLine)) return null
  const at = cached ?? parseContainer(block, kind, lines.length)
  if (!at) return null
  const { tokens, open, offset } = at
  const found = collectBlocks(inner, tokens, open + 1, closeOf(tokens, open), tokens[open].level + 1, offset)
  if (found.length === 0) return null
  if (register) seedOf({ blocks: found, tokens }, ctx.cache, true)
  const content = inner.join('\n')
  const kids = found.map((f) => f.text)
  // 안쪽 = 자식0 + 구분 + 자식1 + … — 구분은 줄바꿈 하나(촘촘) 또는 둘(빈 줄)만.
  if (!content.startsWith(kids[0])) return null
  const seps: string[] = []
  let pos = kids[0].length
  for (const kid of kids.slice(1)) {
    const sep = content.startsWith(`\n\n${kid}`, pos) ? '\n\n' : content.startsWith(`\n${kid}`, pos) ? '\n' : null
    if (sep == null) return null
    seps.push(sep)
    pos += sep.length + kid.length
  }
  return pos === content.length ? { kind, head, content, kids, seps } : null
}

/** 안쪽 마크다운을 컨테이너로 다시 감싼다 — stripContainer 의 역. 빈 줄은 인용 `>`, 목록 항목은 빈 줄 그대로. */
function closeContainer(kind: Opened['kind'], head: string, content: string): string {
  const pad = kind === 'quote' ? '> ' : ' '.repeat(head.length)
  return content
    .split('\n')
    .map((l, i) => {
      if (i === 0) return head + l
      if (l === '') return kind === 'quote' ? '>' : ''
      return pad + l
    })
    .join('\n')
}

/**
 * 목록 글머리 3-way — 한쪽만 바꿨으면 그쪽, 둘 다 다르게 바꿨으면 AI 쪽·충돌 1(기존 정책).
 * 예외: 첫 항목이 아니고 셋 다 같은 구분자(. 또는 ))의 번호면 번호 다시 매기기(항목 넣기·빼기로 밀림)라 AI 쪽으로 두되 충돌로 세지 않는다
 * — 둘째 이후 번호는 표시용(직렬화기가 다시 매긴다). 첫 항목 번호는 목록 시작 번호라 뜻이 있고, 구분자·글머리 문자가 바뀌면 다른 목록이 된다.
 */
function mergeHead(base: string, cur: string, ai: string, first: boolean): { text: string; conflicts: number } {
  if (cur === base || ai === cur) return { text: ai, conflicts: 0 }
  if (ai === base) return { text: cur, conflicts: 0 }
  const delimiter = (h: string) => h.trimEnd().slice(-1)
  const renumbered =
    !first && [base, cur, ai].every((h) => ORDERED_HEAD.test(h)) && delimiter(cur) === delimiter(base) && delimiter(ai) === delimiter(base)
  return { text: ai, conflicts: renumbered ? 0 : 1 }
}

/** 자식 사이 구분 종류 — 같은 종류 목록 항목끼리(하위 목록 안)는 'list', 그 밖(문단 ↔ 하위 목록 등)은 'item'. */
function sepCategory(prev: string, next: string): 'list' | 'item' {
  const k = listKind(prev)
  return k != null && k === listKind(next) ? 'list' : 'item'
}

/**
 * 셋 다 같은 종류 컨테이너(목록 항목 또는 인용)인 블록의 자식 단위 3-way 병합(WP-326). 왜: 컨테이너 전체를 글자 패치하면 한 항목 안
 * 다른 하위 항목·인용 안 다른 문단을 고쳐도 고친 자리가 가까우면(정확 문맥 8자) 패치가 실패해 AI 쪽이 이겨 사람 수정이 사라졌다.
 * 안쪽을 열어(openContainer) 직속 자식으로 나누고 mergeSequence(resolveBlock) 로 합친다 — 자식이 다시 목록 항목·인용·표면 재귀한다
 * (MAX_CONTAINER_DEPTH 까지). 목록 글머리는 따로 3-way(mergeHead) — AI 가 앞에 항목을 넣어 번호가 밀려도(9. → 10. 폭 변화 포함) 사람 수정이 산다.
 * prev 는 기준본에서 바로 앞 블록(첫 항목 판단). 기준본부터 열어 아니면 바로 null(현재본·AI본은 열지 않는다). 모호하면 null(호출자가 오늘의
 * 글자 패치 → AI 쪽으로).
 */
function mergeContainer(base: string, cur: string, ai: string, prev: string | null, ctx: MergeCtx): Resolved | null {
  if (ctx.depth >= MAX_CONTAINER_DEPTH) return null
  const b = openContainer(base, ctx, true)
  if (!b) return null
  const c = openContainer(cur, ctx, true)
  if (!c || c.kind !== b.kind) return null
  const a = openContainer(ai, ctx, true)
  if (!a || a.kind !== b.kind) return null
  // 자식 사이 구분 정책 — 하위 목록 항목 사이(list)와 그 밖(item)을 따로 본다. 그래야 촘촘한 항목 안의 느슨한 하위 목록
  // (`- a\n  - b\n\n  - c`)도 연다. 같은 범주에서 셋 중 하나라도 구분이 다르면(촘촘함 불일치) null.
  const policy = new Map<string, string>()
  for (const o of [b, c, a]) {
    for (let k = 0; k < o.seps.length; k++) {
      const cat = sepCategory(o.kids[k], o.kids[k + 1])
      const known = policy.get(cat)
      if (known != null && known !== o.seps[k]) return null
      policy.set(cat, o.seps[k])
    }
  }
  // 기준본 목록의 첫 항목인지(앞 블록과 목록 종류가 다르면 새 목록의 시작) — 시작 번호 판단용.
  const head = mergeHead(b.head, c.head, a.head, prev == null || listKind(prev) !== listKind(base))
  const inner: MergeCtx = { ...ctx, depth: ctx.depth + 1 }
  const merged = mergeSequence(b.kids, c.kids, a.kids, (x, y, z, before) => resolveBlock(x, y, z, before, inner))
  if (merged.blocks.length === 0) return null
  let content = merged.blocks[0]
  for (let k = 1; k < merged.blocks.length; k++) {
    // 어느 쪽에도 없던 범주의 이웃이 생기면 어떻게 이을지 모른다 — 오늘의 길로.
    const sep = policy.get(sepCategory(merged.blocks[k - 1], merged.blocks[k]))
    if (sep == null) return null
    content += sep + merged.blocks[k]
  }
  const block = closeContainer(b.kind, head.text, content)
  // 합친 자식·머리가 어느 한쪽 그대로면 그쪽 원문을 이미 열어 봤다(같은 구분 정책이라 안쪽도 같다) — 다시 검사하지 않는다.
  const asSide = [b, c, a].some((o) => o.head === head.text && sameRange(o.kids, 0, o.kids.length, merged.blocks, 0, merged.blocks.length))
  if (!asSide) {
    // 한 번 파싱해 검사 — 같은 종류 컨테이너 하나로 읽히고, 같은 머리·안쪽이며, 직속 자식이 합친 자식 그대로여야 한다
    // (자식이 붙어 한 문단이 되거나 목록이 쪼개지면 다르다). 아니면 오늘의 길로.
    const back = openContainer(block, ctx, false)
    if (!back || back.kind !== b.kind || back.head !== head.text || back.content !== content) return null
    if (!sameRange(back.kids, 0, back.kids.length, merged.blocks, 0, merged.blocks.length)) return null
  }
  return { block, conflicts: head.conflicts + merged.conflicts }
}

/** to[j] 가 j 이후 처음으로 짝지어진 other 인덱스(없으면 len) — 새로 넣은 블록을 어느 기준 블록 앞에 둘지 정한다. */
function nextMatched(to: number[], len: number): number[] {
  const next = new Array<number>(to.length + 1)
  next[to.length] = len
  for (let j = to.length - 1; j >= 0; j--) next[j] = to[j] >= 0 ? to[j] : next[j + 1]
  return next
}

/**
 * 같은 자리(다음 기준 블록 앞)에 사람·AI 가 새로 넣은 블록들을 합친다.
 * 양쪽에 **똑같은** 블록이 있으면 한 번만 — 기준본이 그 블록을 모르는 채로 AI 가 그 블록을 담아 보내면(병합된 응답·다른 사람 판에서
 * 이어 쓴 경우) 그대로 두 번 내보내 문단이 중복된다. 비슷하기만 한 블록은 짝짓지 않는다 — 사람과 AI 가 따로 쓴 비슷한 문단을
 * 한쪽으로 합치면 사람 글이 사라진다(근접 중복이 유실보다 낫다). 대부분의 "AI 가 본 뒤 고친" 경우는 closestBase 가 맞는 기준본을 골라
 * 일반 블록 규칙으로 처리된다. AI 만 넣은 블록은 다음 짝 앞에 두어 AI 쪽 순서를 지킨다.
 */
function mergeInserts(curIns: string[], aiIns: string[]): string[] {
  if (aiIns.length === 0) return curIns
  if (curIns.length === 0) return aiIns
  const pairOf = new Map<number, number>(lcsPairs(curIns, 0, curIns.length, aiIns, 0, aiIns.length))
  const blocks: string[] = []
  let m = 0
  curIns.forEach((c, k) => {
    const pair = pairOf.get(k)
    if (pair == null) {
      blocks.push(c)
      return
    }
    for (; m < pair; m++) blocks.push(aiIns[m])
    blocks.push(c)
    m = pair + 1
  })
  for (; m < aiIns.length; m++) blocks.push(aiIns[m])
  return blocks
}

/** 블록 다중집합 대칭 차이 크기 — 두 본문이 블록 몇 개만큼 다른가. */
function blockDistance(a: string[], b: string[]): number {
  const counts = new Map<string, number>()
  for (const x of a) counts.set(x, (counts.get(x) ?? 0) + 1)
  let common = 0
  for (const x of b) {
    const c = counts.get(x) ?? 0
    if (c > 0) {
      counts.set(x, c - 1)
      common++
    }
  }
  return a.length + b.length - 2 * common
}

/**
 * 기준본 후보 중 AI본과 블록 차이가 가장 적은 것(동점이면 앞의 것). 저장 응답 version 은 후보가 둘이다 —
 * 그 판의 실제 본문(병합본)과 쓴 쪽이 제출한 본문. MCP·채팅 비서는 보통 응답 본문에서, 구버전 웹은 자기 본문에서 이어 쓴다.
 * 이어 쓴 쪽을 기준으로 삼아야 그사이 합쳐진 남의 블록이 "삭제"나 "중복 삽입"으로 보이지 않는다.
 */
export function closestBase(candidates: string[], ai: string): string {
  const target = splitBlocks(ai)
  let best = candidates[0]
  let bestDistance = Infinity
  for (const c of candidates) {
    const d = blockDistance(splitBlocks(c), target)
    if (d < bestDistance) {
      best = c
      bestDistance = d
    }
  }
  return best
}

/**
 * 3-way 병합. 기준 블록 순서를 뼈대로, 사람·AI 가 새로 넣은 블록은 다음 기준 블록 앞에 둔다(사람 것 순서를 뼈대로, 같은 블록은 한 번 — mergeInserts).
 * 입력은 정규화본·직렬화기 출력이어야 한다(모듈 머리의 입력 규칙).
 */
export function mergeMarkdown3(base: string, current: string, ai: string): MergeResult {
  if (current === ai) return { markdown: current, conflicts: 0 }
  return mergeWithSide(prepareMergeSide(base, ai), current)
}

/**
 * 3-way 병합에서 현재본과 무관한 기준본·AI본 쪽 계산(블록 나누기·기준↔AI 짝짓기).
 * 동기화 서버는 병합 도중 문서가 바뀌면 같은 기준본·AI본으로 현재본만 바꿔 다시 병합한다 — 이 결과를 재사용해 현재본 쪽만 다시 계산한다.
 */
export interface MergeSide {
  ai: string
  B: string[]
  A: string[]
  toA: number[]
  /** 기준본·AI본 최상위 목록 항목·인용의 파싱 자리 — 컨테이너 병합이 다시 파싱하지 않고 연다(읽기 전용, 재병합 사이 공유). */
  seed: ReadonlyMap<string, Parsed>
}

/**
 * 기준본·AI본 쪽 준비물 만들기 — mergeWithSide 와 짝.
 * 입력은 정규화본·직렬화기 출력이어야 한다(모듈 머리의 입력 규칙).
 */
export function prepareMergeSide(base: string, ai: string): MergeSide {
  const b = splitParsed(base)
  const a = splitParsed(ai)
  const B = b.blocks.map((x) => x.text)
  const A = a.blocks.map((x) => x.text)
  const seed = new Map<string, Parsed>()
  seedOf(b, seed)
  seedOf(a, seed)
  return { ai, B, A, toA: alignBlocks(B, A), seed }
}

/**
 * 미리 만든 기준본·AI본 쪽으로 현재본과 3-way 병합 — mergeMarkdown3 과 같은 결과.
 * 입력은 정규화본·직렬화기 출력이어야 한다(모듈 머리의 입력 규칙).
 */
export function mergeWithSide(side: MergeSide, current: string): MergeResult {
  if (current === side.ai) return { markdown: current, conflicts: 0 }
  const c = splitParsed(current)
  // 병합 한 번 동안 사는 컨테이너 문맥 — 현재본 최상위 컨테이너 자리로 시작한다(기준본·AI본 것은 side.seed).
  const ctx: MergeCtx = { seed: side.seed, cache: seedOf(c, new Map()), depth: 0 }
  const r = mergeSequence(
    side.B,
    c.blocks.map((x) => x.text),
    side.A,
    (b, cur, a, prev) => resolveBlock(b, cur, a, prev, ctx),
    side.toA,
  )
  return { markdown: joinBlocks(r.blocks), conflicts: r.conflicts }
}

/**
 * 블록(또는 표 행) 열 3-way 병합 — 기준 순서를 뼈대로 짝짓고, 새로 넣은 블록은 다음 기준 블록 앞에 둔다.
 * toA 는 미리 계산한 기준↔AI 짝(prepareMergeSide) — 없으면 여기서 계산한다.
 */
function mergeSequence(
  B: string[],
  C: string[],
  A: string[],
  resolve: (base: string, cur: string | null, ai: string | null, prev: string | null) => Resolved,
  toA = alignBlocks(B, A),
): { blocks: string[]; conflicts: number } {
  const toC = alignBlocks(B, C)
  const cTaken = new Array<boolean>(C.length).fill(false)
  const aTaken = new Array<boolean>(A.length).fill(false)
  toC.forEach((i) => i >= 0 && (cTaken[i] = true))
  toA.forEach((i) => i >= 0 && (aTaken[i] = true))
  const nextC = nextMatched(toC, C.length)
  const nextA = nextMatched(toA, A.length)
  const out: string[] = []
  let conflicts = 0
  let ci = 0
  let ak = 0
  for (let j = 0; j <= B.length; j++) {
    const curIns: string[] = []
    const aiIns: string[] = []
    for (; ci < nextC[j]; ci++) if (!cTaken[ci]) curIns.push(C[ci])
    for (; ak < nextA[j]; ak++) if (!aTaken[ak]) aiIns.push(A[ak])
    out.push(...mergeInserts(curIns, aiIns))
    if (j === B.length) break
    if (toC[j] >= 0) ci = toC[j] + 1
    if (toA[j] >= 0) ak = toA[j] + 1
    const r = resolve(B[j], toC[j] >= 0 ? C[toC[j]] : null, toA[j] >= 0 ? A[toA[j]] : null, j > 0 ? B[j - 1] : null)
    conflicts += r.conflicts
    if (r.block != null) out.push(r.block)
  }
  return { blocks: out, conflicts }
}
