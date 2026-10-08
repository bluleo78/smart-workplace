import type { HocuspocusProvider } from '@hocuspocus/provider'
import {
  COLLAB_AI_MARKERS_FIELD,
  type CollabAiMarker,
  parseAiMarkers,
} from '@smart-workplace/wiki-editor-schema/collab-protocol'
import { Extension } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { type EditorState, Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { ySyncPluginKey } from 'y-prosemirror'
import * as Y from 'yjs'

import { nearestClippingAncestor } from '@/lib/nearestClippingAncestor'

import { clampPos, resolveRelative, ySyncOf } from './wikiCollabPosition'

/**
 * 노트 ✦ AI 표식(WP-291, 스펙 §5.1-5·§7.1) — 다른 사람의 AI 가 쓰는(쓴) 자리에 캐럿 + "✦ 이름" 태그를 그린다.
 *
 * 출처는 awareness 의 aiMarkers 필드 하나다: 동기화 서버(MCP·채팅 비서 적용 위치, 3초)와 다른 접속자의 `/ai` 생성(고정).
 * 서버 상태엔 user 가 없지만 표식은 그려야 하므로 user 로 거르지 않는다(접속자 목록·커서만 user 없는 상태를 건너뛴다).
 * 공유 문서가 아니라 내 화면에만 그리는 위젯 데코레이션이라 저장·동기화되지 않는다. 위치는 Yjs 상대 위치라 원격 편집을 따라간다.
 * 색은 AI 마커 토큰(ai-accent) — 사람별 색은 접속자·커서(WP-173)에서 들어온다.
 */

type Awareness = NonNullable<HocuspocusProvider['awareness']>

/** 이름이 비었을 때 보일 이름 — 이름 조회 소스(멘션 라벨)는 React 컨텍스트 안에만 있어 위젯에서 쓸 수 없다. */
const FALLBACK_NAME = 'AI'

/** 다른 접속자(서버 포함)가 올린 표식 — 내 awareness(clientId) 것은 뺀다. 같은 사람의 다른 탭 것은 보인다. */
export function remoteAiMarkers(
  states: Map<number, Record<string, unknown>>,
  selfClientId: number,
): Array<{ clientId: number; marker: CollabAiMarker }> {
  const out: Array<{ clientId: number; marker: CollabAiMarker }> = []
  for (const [clientId, state] of states) {
    if (clientId === selfClientId) continue
    for (const marker of parseAiMarkers(state?.[COLLAB_AI_MARKERS_FIELD])) out.push({ clientId, marker })
  }
  return out
}

/** 표식을 그릴 위치 — 글 안(인라인)이면 그 자리, 블록 경계면 그 블록의 첫 글 상자 맨 앞(서버 표식은 블록 시작을 가리킨다). */
export function markerPos(doc: PMNode, pos: number): number {
  const at = clampPos(pos, doc)
  if (doc.resolve(at).parent.inlineContent) return at
  const node = doc.nodeAt(at)
  if (!node) return at
  if (node.isTextblock) return at + 1
  let inner = at
  node.descendants((child, offset) => {
    if (inner !== at) return false
    if (child.isTextblock) {
      inner = at + 1 + offset + 1
      return false
    }
    return true
  })
  return inner
}

// lucide Sparkles(lucide-react 1.16 의 iconNode 그대로) — 위젯은 React 밖 DOM 이라 컴포넌트를 쓸 수 없다. 모양은 AiLabel 의 Sparkles 와 같다.
const SPARKLES: Array<[string, Record<string, string>]> = [
  [
    'path',
    {
      d: 'M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z',
    },
  ],
  ['path', { d: 'M20 2v4' }],
  ['path', { d: 'M22 4h-4' }],
  ['circle', { cx: '4', cy: '20', r: '2' }],
]

function sparklesIcon(): SVGElement {
  const ns = 'http://www.w3.org/2000/svg'
  const svg = document.createElementNS(ns, 'svg')
  const attrs: Record<string, string> = {
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': '2',
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    'aria-hidden': 'true',
    class: 'wiki-ai-marker__icon',
  }
  for (const [k, v] of Object.entries(attrs)) svg.setAttribute(k, v)
  for (const [tag, a] of SPARKLES) {
    const el = document.createElementNS(ns, tag)
    for (const [k, v] of Object.entries(a)) el.setAttribute(k, v)
    svg.append(el)
  }
  return svg
}

/** 위젯 DOM — 폭 0 의 캐럿 + 위쪽 태그(✦ 이름). 편집·선택 대상이 아니다. 이름이 비면 "AI" 로 보인다. key 는 쌓는 순서(fitTags)용. */
function markerWidget(name: string, key: string): HTMLElement {
  const shown = name || FALLBACK_NAME
  const el = document.createElement('span')
  el.className = 'wiki-ai-marker'
  el.contentEditable = 'false'
  el.dataset.testid = 'wiki-ai-marker'
  el.dataset.markerKey = key
  el.setAttribute('aria-label', name ? `${name} 님의 AI 가 작성 중` : 'AI 가 작성 중')
  const caret = document.createElement('span')
  caret.className = 'wiki-ai-marker__caret'
  const tag = document.createElement('span')
  tag.className = 'wiki-ai-marker__tag'
  const label = document.createElement('span')
  label.className = 'wiki-ai-marker__name'
  label.textContent = shown
  tag.append(sparklesIcon(), label)
  el.append(caret, tag)
  return el
}

/** 플러그인 키 — 테스트가 그려진 데코레이션을 읽는다. */
export const wikiAiMarkersKey = new PluginKey<DecorationSet>('wikiAiMarkers')

/** awareness 상태 → 위젯 데코레이션. 풀 수 없는 위치(아직 동기화 전·삭제된 자리)는 건너뛴다. */
function build(state: EditorState, awareness: Awareness): DecorationSet {
  if (!ySyncOf(state)?.binding) return DecorationSet.empty
  const decos: Decoration[] = []
  const states = awareness.getStates() as Map<number, Record<string, unknown>>
  for (const { clientId, marker } of remoteAiMarkers(states, awareness.clientID)) {
    let abs: number | null
    try {
      abs = resolveRelative(state, Y.createRelativePositionFromJSON(marker.anchor))
    } catch {
      continue
    }
    if (abs == null) continue
    const key = `ai-${clientId}-${marker.id}-${marker.name}`
    decos.push(
      Decoration.widget(markerPos(state.doc, abs), () => markerWidget(marker.name, key), {
        key,
        side: -1,
        ignoreSelection: true,
      }),
    )
  }
  return DecorationSet.create(state.doc, decos)
}

/**
 * 원격 표식 목록의 비교 키(접속자·id·이름·위치) — awareness 는 커서·접속자 정보로 수시로 바뀌므로, 이 키가 같으면 다시 그리지 않는다.
 * 순서는 awareness 순회 순서에 기대지 않게 정렬한다.
 */
export function aiMarkersSignature(states: Map<number, Record<string, unknown>>, selfClientId: number): string {
  return remoteAiMarkers(states, selfClientId)
    .map(({ clientId, marker: m }) => `${clientId}|${m.id}|${m.name}|${JSON.stringify(m.anchor)}`)
    .sort()
    .join('\n')
}

/** 그려진 데코레이션의 비교 키(위치·키) — 같으면 태그 배치(fitTags)를 다시 하지 않는다. */
function decorationsSignature(set: DecorationSet | undefined): string {
  return (set?.find() ?? []).map((d) => `${d.from}|${(d.spec as { key?: string }).key ?? ''}`).join('\n')
}

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

const PLACEMENT_CLASSES = ['wiki-ai-marker--flip', 'wiki-ai-marker--below', 'wiki-ai-marker--inline'] as const

/**
 * 태그가 잘리거나 서로 가리지 않게 놓는다 — 폭·위치는 그려진 뒤에야 알 수 있어 CSS 만으로는 못 한다.
 * - 오른쪽 끝을 넘으면 캐럿 왼쪽으로(--flip), 표 첫 행처럼 overflow 조상 위로 잘리면 캐럿 아래로(--below),
 *   아래도 잘리면 캐럿 옆으로(--inline),
 *   다른 사람 태그와 겹치면 비켜 쌓는다(--wiki-ai-stack).
 * - 레이아웃 반복 계산을 막으려고 쓰기(배치 초기화) → 읽기(전부 측정) → 쓰기(배치 적용) 세 단계로 나눈다.
 * - 위젯 DOM 의 클래스·스타일 변경은 PM 이 무시한다(위젯 변이는 관찰 대상 아님).
 */
function fitTags(root: HTMLElement): void {
  const markers = [...root.querySelectorAll<HTMLElement>('.wiki-ai-marker')]
  if (markers.length === 0) return
  for (const el of markers) {
    el.classList.remove(...PLACEMENT_CLASSES)
    el.style.removeProperty('--wiki-ai-stack')
  }
  const rootBox = root.getBoundingClientRect()
  const cache = new Map<HTMLElement, boolean>()
  const measured: Array<{ el: HTMLElement; key: string; m: TagMeasure }> = []
  for (const el of markers) {
    const tag = el.querySelector('.wiki-ai-marker__tag')
    if (!tag) continue
    // 표식에서 에디터 루트 사이의 가장 가까운 overflow 조상(표 감싸개 overflow:auto·코드 블록 등).
    const clipper = nearestClippingAncestor(el, root, 'both', cache)
    const c = clipper?.getBoundingClientRect()
    const clip: Box = c
      ? {
          left: Math.max(rootBox.left, c.left),
          right: Math.min(rootBox.right, c.right),
          top: c.top,
          bottom: c.bottom,
        }
      : { left: rootBox.left, right: rootBox.right, top: -Infinity, bottom: Infinity }
    measured.push({ el, key: el.dataset.markerKey ?? '', m: { tag: tag.getBoundingClientRect(), marker: el.getBoundingClientRect(), clip } })
  }
  // 같은 자리 위젯의 DOM 순서는 다시 그릴 때마다 바뀔 수 있다 — 안정된 키 순서로 쌓아야 이름이 칸을 오가지 않는다.
  measured.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
  const placements = placeTags(measured.map((x) => x.m))
  measured.forEach(({ el }, i) => {
    const { flip, side, stack } = placements[i]
    if (flip) el.classList.add('wiki-ai-marker--flip')
    if (side !== 'above') el.classList.add(`wiki-ai-marker--${side}`)
    if (stack > 0) el.style.setProperty('--wiki-ai-stack', String(stack))
  })
}

/** ✦ 표식 확장 — awareness 가 없으면(동기화 꺼짐) 아무것도 하지 않는다. */
export const WikiAiMarkers = Extension.create<{ awareness: Awareness | null }>({
  name: 'wikiAiMarkers',
  addOptions() {
    return { awareness: null }
  },
  addProseMirrorPlugins() {
    const awareness = this.options.awareness
    if (!awareness) return []
    return [
      new Plugin<DecorationSet>({
        key: wikiAiMarkersKey,
        state: {
          init: (_config, state) => build(state, awareness),
          // 다시 계산은 awareness 변화(내 메타)·Yjs 쪽 변화(원격 편집·바인딩 초기화 — y-prosemirror 메타)일 때만.
          // 내 로컬 편집은 apply 시점에 아직 Yjs 에 반영되지 않아 상대 위치가 옛 위치로 풀리므로, 매핑으로 옮긴다
          // (y-prosemirror 커서 플러그인과 같은 규칙).
          apply: (tr, old, _prev, state) =>
            tr.getMeta(wikiAiMarkersKey) || tr.getMeta(ySyncPluginKey) !== undefined
              ? build(state, awareness)
              : old.map(tr.mapping, tr.doc),
        },
        props: {
          decorations: (state) => wikiAiMarkersKey.getState(state),
        },
        view: (view) => {
          const statesOf = () => awareness.getStates() as Map<number, Record<string, unknown>>
          /** 지금 표식을 올린 다른 접속자들. */
          const markedClients = () => new Set(remoteAiMarkers(statesOf(), awareness.clientID).map((r) => r.clientId))
          /** 그 접속자(나 제외)가 지금 표식을 올렸는가. */
          const hasMarkers = (id: number) =>
            id !== awareness.clientID && parseAiMarkers(statesOf().get(id)?.[COLLAB_AI_MARKERS_FIELD]).length > 0
          // 마지막으로 그린 표식 목록·데코레이션 키 — 같으면 트랜잭션·배치 계산을 건너뛴다(awareness 는 커서 이동마다 바뀐다).
          let lastMarkers = aiMarkersSignature(statesOf(), awareness.clientID)
          // 마지막으로 표식 목록을 계산했을 때 표식이 있던 접속자 — 바뀐 접속자가 여기에도 없고 지금도 표식이 없으면 표식 목록은 그대로다.
          let marked = markedClients()
          let lastDecos = ''
          // awareness 변경은 웹소켓 메시지 처리에서 오므로 PM dispatch 밖이다 — 표식이 실제로 바뀌었을 때만 메타 트랜잭션으로 다시 그린다.
          const onChange = (changes?: { added: number[]; updated: number[]; removed: number[] }) => {
            if (view.isDestroyed) return
            // 커서·접속자 정보만 바뀐 흔한 경우 — 바뀐 접속자 누구도 표식을 가졌거나 갖지 않았으면 전체 목록을 다시 만들지 않는다.
            if (changes && ![...changes.added, ...changes.updated, ...changes.removed].some((id) => marked.has(id) || hasMarkers(id))) {
              return
            }
            marked = markedClients()
            const sig = aiMarkersSignature(statesOf(), awareness.clientID)
            if (sig === lastMarkers) return
            lastMarkers = sig
            view.dispatch(view.state.tr.setMeta(wikiAiMarkersKey, true))
          }
          awareness.on('change', onChange)
          // 폭이 바뀌면(창 크기·회전) 줄바꿈이 달라지므로 태그 배치를 다시 맞춘다.
          const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => fitTags(view.dom))
          resize?.observe(view.dom)
          return {
            update: (v, prev) => {
              const set = wikiAiMarkersKey.getState(v.state)
              if (set === wikiAiMarkersKey.getState(prev)) return
              // 다시 계산·매핑했어도 표식 위치·키가 그대로면 위젯 DOM 도 그대로(PM 이 키로 재사용) — 배치를 다시 잴 필요가 없다.
              const sig = decorationsSignature(set)
              if (sig === lastDecos) return
              lastDecos = sig
              fitTags(v.dom)
            },
            destroy: () => {
              awareness.off('change', onChange)
              resize?.disconnect()
            },
          }
        },
      }),
    ]
  },
})
