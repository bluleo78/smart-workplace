import { nearestClippingAncestor } from '@/lib/nearestClippingAncestor'

/**
 * 노트 본문 위에 떠 있는 이름표 배치(WP-174 에서 시작, WP-173 에서 일반화) — ✦ AI 표식 태그와 원격 커서 이름표를 한 번에 놓아
 * 서로 가리지 않게 한다. 따로 계산하면 각자는 안 겹쳐도 ✦ 태그와 커서 이름표가 겹친다.
 */

/** 화면 좌표 사각형(getBoundingClientRect 의 필요한 부분). */
export interface Box {
  left: number
  right: number
  top: number
  bottom: number
}

/**
 * 태그 배치 계산의 입력 — 기본 배치(오른쪽으로 펼침·캐럿 위·쌓기 없음)에서 잰 값.
 * clip 은 태그를 잘라 낼 수 있는 경계(에디터 오른쪽 끝과 가장 가까운 overflow 조상 — 표 감싸개·코드 블록 — 의 교집합).
 */
export interface TagMeasure {
  /** 태그 사각형(기본 배치). */
  tag: Box
  /** 표식(폭 0 캐럿 상자) 사각형 — 아래로 펼칠 때 태그가 놓일 자리를 계산한다. */
  marker: Pick<Box, 'top' | 'bottom'>
  clip: Box
}

/**
 * 태그를 어떻게 놓을지.
 * - flip: 캐럿 왼쪽으로 펼친다.
 * - side: 캐럿 위(기본)·아래(위가 잘릴 때)·옆(위아래 다 잘리는 한 행짜리 표 등 — 줄 높이 안에 캐럿 옆으로).
 * - stack: 겹친 태그를 몇 칸 비켜 쌓을지(0 = 그대로, 위는 위로·아래는 아래로).
 */
export interface TagPlacement {
  flip: boolean
  side: 'above' | 'below' | 'inline'
  stack: number
}

/** 쌓을 때 태그 사이 간격(px) — CSS 의 translateY(-100% - 3px) 와 짝. */
export const TAG_STACK_GAP = 3
/** 옆에 놓을 때 캐럿과 태그 사이 간격(px) — CSS 의 left/right: 3px 와 짝. */
const INLINE_GAP = 3
/** 겹침으로 보지 않는 허용 오차(px) — 테두리가 1px 맞닿는 정도는 둘 다 읽힌다. */
const OVERLAP_EPS = 1

const overlaps = (a: Box, b: Box) =>
  a.left < b.right - OVERLAP_EPS &&
  b.left < a.right - OVERLAP_EPS &&
  a.top < b.bottom - OVERLAP_EPS &&
  b.top < a.bottom - OVERLAP_EPS

/**
 * 태그 배치(순수 함수 — 측정과 분리해 단위 테스트한다). 입력 순서대로 놓으며, 앞서 놓인 태그와 겹치면 한 칸씩 비켜 쌓는다.
 * 그래서 호출자는 다시 그려도 같은 순서가 되도록 안정된 키로 정렬해 넘긴다.
 * - flip: 오른쪽 경계를 넘고, 왼쪽으로 펼쳐도 왼쪽 경계를 넘지 않을 때만.
 * - side: 위(쌓은 뒤)가 clip 위를 넘으면(표 첫 행 등) 아래로, 아래도 clip 아래를 넘으면(한 행짜리 표 — 넘친 만큼 감싸개에
 *   스크롤이 생긴다) 캐럿 옆 줄 안으로. 위쪽 칸이 잘리면 아래쪽에서 다시 쌓는다. 옆은 쌓지 않는다(드문 경우의 드문 경우).
 */
export function placeTags(items: TagMeasure[], gap = TAG_STACK_GAP): TagPlacement[] {
  const placed: Box[] = []
  return items.map(({ tag, marker, clip }) => {
    const width = tag.right - tag.left
    const height = tag.bottom - tag.top
    // 캐럿 왼쪽(left:-1px)/오른쪽(right:-1px) 기준 — 펼친 방향을 바꾸면 태그는 캐럿을 사이에 두고 2px 옮겨 간다.
    const flippedLeft = tag.left + 2 - width
    const flip = tag.right > clip.right && flippedLeft >= clip.left
    const left = flip ? flippedLeft : tag.left
    const step = height + gap
    // 캐럿과 태그 사이 간격을 아래쪽에도 똑같이 둔다.
    const belowTop = marker.bottom + (marker.top - tag.bottom)
    const at = (side: 'above' | 'below', stack: number): Box => {
      const top = side === 'below' ? belowTop + stack * step : tag.top - stack * step
      return { left, right: left + width, top, bottom: top + height }
    }
    const fit = (side: 'above' | 'below'): { box: Box; stack: number } => {
      let stack = 0
      while (placed.some((p) => overlaps(p, at(side, stack)))) stack++
      return { box: at(side, stack), stack }
    }
    // 위 → 아래 순으로, clip 안에 들어오는 첫 쪽에 놓는다.
    for (const side of ['above', 'below'] as const) {
      const { box, stack } = fit(side)
      if (side === 'above' ? box.top >= clip.top : box.bottom <= clip.bottom) {
        placed.push(box)
        return { flip, side, stack }
      }
    }
    const caret = tag.left + 1
    const inlineLeft = flip ? caret - INLINE_GAP - width : caret + INLINE_GAP
    const inlineTop = (marker.top + marker.bottom - height) / 2
    placed.push({ left: inlineLeft, right: inlineLeft + width, top: inlineTop, bottom: inlineTop + height })
    return { flip, side: 'inline', stack: 0 }
  })
}

/** 이름표를 가진 위젯 종류 — 클래스 접두어가 곧 BEM 블록 이름(배치 수정 클래스·태그 클래스). */
type HostKind = 'wiki-ai-marker' | 'wiki-presence-cursor'
const MODIFIERS = ['flip', 'below', 'inline'] as const

/**
 * 이름표를 가진 위젯 전부(fitTags 가 한 번 조회한다 — 테스트가 이 선택자로 배치 횟수를 센다).
 * 배치는 이 중 지금 보이는 것만(isShown) 하고, 나머지는 남은 배치 흔적만 지운다.
 */
export const SELECTOR = '.wiki-ai-marker, .wiki-presence-cursor'

function kindOf(el: HTMLElement): HostKind {
  return el.classList.contains('wiki-ai-marker') ? 'wiki-ai-marker' : 'wiki-presence-cursor'
}

/** 이름표가 보이는가 — ✦ 표식은 늘, 사람 커서는 이름표가 켜진(data-label-visible) 것만. */
function isShown(el: HTMLElement): boolean {
  return kindOf(el) === 'wiki-ai-marker' || el.hasAttribute('data-label-visible')
}

/**
 * 이름표가 잘리거나 서로 가리지 않게 놓는다 — 폭·위치는 그려진 뒤에야 알 수 있어 CSS 만으로는 못 한다.
 * - 오른쪽 끝을 넘으면 캐럿 왼쪽으로(--flip), overflow 조상 위로 잘리면 아래로(--below), 아래도 잘리면 옆으로(--inline),
 *   다른 이름표와 겹치면 비켜 쌓는다(--wiki-tag-stack).
 * - 레이아웃 반복 계산을 막으려고 쓰기(초기화) → 읽기(전부 측정) → 쓰기(적용) 세 단계로 나눈다.
 * - 위젯 DOM 의 클래스·스타일 변경은 ProseMirror 가 무시한다(위젯 변이는 관찰 대상 아님).
 */
export function fitTags(root: HTMLElement): void {
  const all = [...root.querySelectorAll<HTMLElement>(SELECTOR)]
  // 꺼진 커서 이름표도 지운다 — 남겨 두면 다음에 켜질 때 옛 자리(--flip·쌓기 칸)로 잠깐 그려진다.
  for (const el of all) {
    const kind = kindOf(el)
    el.classList.remove(...MODIFIERS.map((m) => `${kind}--${m}`))
    el.style.removeProperty('--wiki-tag-stack')
  }
  const hosts = all.filter(isShown)
  if (hosts.length === 0) return
  const rootBox = root.getBoundingClientRect()
  const cache = new Map<HTMLElement, boolean>()
  const measured: Array<{ el: HTMLElement; key: string; m: TagMeasure }> = []
  for (const el of hosts) {
    const tag = el.querySelector(`.${kindOf(el)}__tag`)
    if (!tag) continue
    // 위젯에서 에디터 루트 사이의 가장 가까운 overflow 조상(표 감싸개 overflow:auto·코드 블록 등).
    const clipper = nearestClippingAncestor(el, root, 'both', cache)
    const c = clipper?.getBoundingClientRect()
    const clip: Box = c
      ? { left: Math.max(rootBox.left, c.left), right: Math.min(rootBox.right, c.right), top: c.top, bottom: c.bottom }
      : { left: rootBox.left, right: rootBox.right, top: -Infinity, bottom: Infinity }
    measured.push({ el, key: el.dataset.tagKey ?? '', m: { tag: tag.getBoundingClientRect(), marker: el.getBoundingClientRect(), clip } })
  }
  // 같은 자리 위젯의 DOM 순서는 다시 그릴 때마다 바뀔 수 있다 — 안정된 키 순서로 쌓아야 이름이 칸을 오가지 않는다.
  measured.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
  const placements = placeTags(measured.map((x) => x.m))
  measured.forEach(({ el }, i) => {
    const kind = kindOf(el)
    const { flip, side, stack } = placements[i]
    if (flip) el.classList.add(`${kind}--flip`)
    if (side !== 'above') el.classList.add(`${kind}--${side}`)
    if (stack > 0) el.style.setProperty('--wiki-tag-stack', String(stack))
  })
}

/** 다음 프레임에 배치할 에디터 루트 → 예약한 rAF id. */
const pending = new WeakMap<HTMLElement, number>()

/**
 * 다음 프레임에 fitTags 를 한 번 — ✦ 표식·원격 커서·크기 변화가 같은 프레임에 몇 번 요청해도 배치는 한 번이다.
 * 한 트랜잭션이 ✦ 와 커서를 함께 바꾸면 두 플러그인이 각각 요청하지만 측정·적용은 한 번만 돈다. 배치는 루트 전체라
 * 커서만 바뀌어도 ✦ 쌓기 칸까지 다시 맞춘다. 동기로 부르면 매 요청마다 강제 레이아웃(측정)이 일어난다.
 */
export function scheduleFitTags(root: HTMLElement): void {
  if (pending.has(root)) return
  pending.set(
    root,
    requestAnimationFrame(() => {
      pending.delete(root)
      fitTags(root)
    }),
  )
}

/** 예약한 배치를 취소한다 — 플러그인 파기 때(파기된 뷰를 다음 프레임에 재지 않게). */
export function cancelFitTags(root: HTMLElement): void {
  const id = pending.get(root)
  if (id === undefined) return
  cancelAnimationFrame(id)
  pending.delete(root)
}

/** 에디터 루트 → 크기 변화 관찰자와 그것을 쓰는 플러그인 수(✦ 표식·원격 커서가 같은 루트를 함께 쓴다). */
const observers = new WeakMap<HTMLElement, { ro: ResizeObserver; users: number }>()

/**
 * 루트 폭이 바뀌면(창 크기·회전) 줄바꿈이 달라지므로 태그 배치를 다시 맞춘다. 배치는 루트 전체라 루트마다 관찰자 하나를 두고,
 * 쓰는 플러그인 수를 센다 — 마지막 플러그인이 놓을 때 끊는다. 반환 함수로 놓는다(여러 번 불러도 한 번만 센다).
 * cancelFitTags 와 따로 둔다 — 그것은 예약한 rAF 취소라 한 플러그인의 파기가 다른 플러그인의 관찰까지 끊으면 안 된다.
 */
export function observeTagRoot(root: HTMLElement): () => void {
  if (typeof ResizeObserver === 'undefined') return () => {}
  let entry = observers.get(root)
  if (!entry) {
    entry = { ro: new ResizeObserver(() => scheduleFitTags(root)), users: 0 }
    entry.ro.observe(root)
    observers.set(root, entry)
  }
  const held = entry
  held.users++
  let released = false
  return () => {
    if (released) return
    released = true
    held.users--
    if (held.users > 0) return
    held.ro.disconnect()
    if (observers.get(root) === held) observers.delete(root)
  }
}
