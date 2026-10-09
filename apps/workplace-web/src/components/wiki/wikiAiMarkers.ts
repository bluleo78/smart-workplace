import {
  COLLAB_AI_MARKERS_FIELD,
  type CollabAiMarker,
  parseAiMarkers,
} from '@smart-workplace/wiki-editor-schema/collab-protocol'
import { Extension } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { type EditorState, Plugin, PluginKey, type Transaction } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { ySyncPluginKey } from 'y-prosemirror'

import type { AwarenessStates } from '@/lib/collab/presence'
import type { AwarenessChanges, PresenceAwareness } from '@/lib/collab/presenceAwareness'

import { clampPos, resolveJson, ySyncOf } from './wikiCollabPosition'
import { cancelFitTags, observeTagRoot, scheduleFitTags } from './wikiTagLayout'

/**
 * 노트 ✦ AI 표식(WP-291, 스펙 §5.1-5·§7.1) — 다른 사람의 AI 가 쓰는(쓴) 자리에 캐럿 + "✦ 이름" 태그를 그린다.
 *
 * 출처는 awareness 의 aiMarkers 필드 하나다: 동기화 서버(MCP·채팅 비서 적용 위치, 3초)와 다른 접속자의 `/ai` 생성(고정).
 * 서버 상태엔 user 가 없지만 표식은 그려야 하므로 user 로 거르지 않는다(접속자 목록·커서만 user 없는 상태를 건너뛴다).
 * 공유 문서가 아니라 내 화면에만 그리는 위젯 데코레이션이라 저장·동기화되지 않는다. 위치는 Yjs 상대 위치라 원격 편집을 따라간다.
 * 색은 늘 AI 마커 토큰(ai-accent)이고 사람 색이 아니다(WP-173 판정 R0 — 디자인시스템 07 §7.2 가 SSOT, 스펙 §7.0 의 "✦ 도 사람 색" 을 덮는다).
 * 사람 색(--presence-N)은 같은 사람의 원격 커서 캐럿·이름표·헤더 아바타에만 쓴다.
 * awareness 는 접속자 덮개(presenceAwarenessOf)다 — 끊긴 동안 마지막 표식을 붙잡아 흐리게 남긴다(판정 R1·11).
 */

/** 이름이 비었을 때 보일 이름 — 이름 조회 소스(멘션 라벨)는 React 컨텍스트 안에만 있어 위젯에서 쓸 수 없다. */
const FALLBACK_NAME = 'AI'

/** 다른 접속자(서버 포함)가 올린 표식 — 내 awareness(clientId) 것은 뺀다. 같은 사람의 다른 탭 것은 보인다. */
export function remoteAiMarkers(
  states: AwarenessStates,
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

/** 위젯 DOM — 폭 0 의 캐럿 + 위쪽 태그(✦ 이름). 편집·선택 대상이 아니다. 이름이 비면 "AI" 로 보인다. key 는 쌓는 순서(fitTags)용(data-tag-key — wikiTagLayout). */
function markerWidget(name: string, key: string): HTMLElement {
  const shown = name || FALLBACK_NAME
  const el = document.createElement('span')
  el.className = 'wiki-ai-marker'
  el.contentEditable = 'false'
  el.dataset.testid = 'wiki-ai-marker'
  el.dataset.tagKey = key // ✦ 전용이던 정렬 키 속성 이름을 공용으로 바꿨다 — ✦ 태그와 원격 커서 이름표가 같은 키 속성으로 함께 정렬된다(wikiTagLayout fitTags)
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
function build(state: EditorState, awareness: PresenceAwareness): DecorationSet {
  if (!ySyncOf(state)?.binding) return DecorationSet.empty
  const decos: Decoration[] = []
  for (const { clientId, marker } of remoteAiMarkers(awareness.getStates(), awareness.clientID)) {
    const abs = resolveJson(state, marker.anchor)
    if (abs == null) continue
    decos.push(markerDecoration(markerPos(state.doc, abs), `ai-${clientId}-${marker.id}-${marker.name}`, marker.name))
  }
  return DecorationSet.create(state.doc, decos)
}

/** 표식 위젯 하나 — spec 에 이름을 두어 매핑 때 같은 위젯을 다시 만든다(같은 key 라 PM 이 DOM 을 재사용한다). */
function markerDecoration(pos: number, key: string, name: string): Decoration {
  return Decoration.widget(pos, () => markerWidget(name, key), { key, name, side: -1, ignoreSelection: true })
}

/**
 * 내 편집(아직 Yjs 반영 전)을 따라 표식을 옮긴다. PM 기본 매핑(DecorationSet.map)은 삭제 범위 안의 위젯을 버려, 내가 지운 글 안에 있던
 * ✦ 가 사라졌다 — 지운 자리로 옮겨 남긴다(원격 커서와 같은 규칙, wikiPresenceCursors mapCursor).
 */
function mapMarkers(set: DecorationSet, tr: Transaction): DecorationSet {
  if (!tr.docChanged) return set
  const decos = set.find().map((d) => {
    const { key, name } = d.spec as { key: string; name: string }
    return markerDecoration(markerPos(tr.doc, tr.mapping.map(d.from, -1)), key, name)
  })
  return DecorationSet.create(tr.doc, decos)
}

/**
 * 원격 표식 목록의 비교 키(접속자·id·이름·위치) — awareness 는 커서·접속자 정보로 수시로 바뀌므로, 이 키가 같으면 다시 그리지 않는다.
 * 순서는 awareness 순회 순서에 기대지 않게 정렬한다.
 */
export function aiMarkersSignature(states: AwarenessStates, selfClientId: number): string {
  return remoteAiMarkers(states, selfClientId)
    .map(({ clientId, marker: m }) => `${clientId}|${m.id}|${m.name}|${JSON.stringify(m.anchor)}`)
    .sort()
    .join('\n')
}

/** 그려진 데코레이션의 비교 키(위치·키) — 같으면 태그 배치(fitTags)를 다시 하지 않는다. */
function decorationsSignature(set: DecorationSet | undefined): string {
  return (set?.find() ?? []).map((d) => `${d.from}|${(d.spec as { key?: string }).key ?? ''}`).join('\n')
}

/** ✦ 표식 확장 — awareness 가 없으면(동기화 꺼짐) 아무것도 하지 않는다. */
export const WikiAiMarkers = Extension.create<{ awareness: PresenceAwareness | null }>({
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
              : mapMarkers(old, tr),
        },
        props: {
          decorations: (state) => wikiAiMarkersKey.getState(state),
        },
        view: (view) => {
          /** 지금 표식을 올린 다른 접속자들. */
          const markedClients = (states: AwarenessStates) =>
            new Set(remoteAiMarkers(states, awareness.clientID).map((r) => r.clientId))
          /** 그 접속자(나 제외)가 지금 표식을 올렸는가. */
          const hasMarkers = (states: AwarenessStates, id: number) =>
            id !== awareness.clientID && parseAiMarkers(states.get(id)?.[COLLAB_AI_MARKERS_FIELD]).length > 0
          const initial = awareness.getStates()
          // 마지막으로 그린 표식 목록·데코레이션 키 — 같으면 트랜잭션·배치 계산을 건너뛴다(awareness 는 커서 이동마다 바뀐다).
          let lastMarkers = aiMarkersSignature(initial, awareness.clientID)
          // 마지막으로 표식 목록을 계산했을 때 표식이 있던 접속자 — 바뀐 접속자가 여기에도 없고 지금도 표식이 없으면 표식 목록은 그대로다.
          let marked = markedClients(initial)
          let lastDecos = ''
          // awareness 변경은 웹소켓 메시지 처리에서 오므로 PM dispatch 밖이다 — 표식이 실제로 바뀌었을 때만 메타 트랜잭션으로 다시 그린다.
          const onChange = (changes?: AwarenessChanges) => {
            if (view.isDestroyed) return
            // 상태는 한 번만 읽는다 — 덮개(presenceAwarenessOf)는 붙잡은 동안 읽을 때마다 합친 Map 을 새로 만든다.
            const states = awareness.getStates()
            // 커서·접속자 정보만 바뀐 흔한 경우 — 바뀐 접속자 누구도 표식을 가졌거나 갖지 않았으면 전체 목록을 다시 만들지 않는다.
            if (
              changes &&
              ![...changes.added, ...changes.updated, ...changes.removed].some((id) => marked.has(id) || hasMarkers(states, id))
            ) {
              return
            }
            marked = markedClients(states)
            const sig = aiMarkersSignature(states, awareness.clientID)
            if (sig === lastMarkers) return
            lastMarkers = sig
            view.dispatch(view.state.tr.setMeta(wikiAiMarkersKey, true))
          }
          awareness.on('change', onChange)
          // 폭이 바뀌면 태그 배치를 다시 맞춘다 — 관찰자는 루트마다 하나(원격 커서 확장과 함께 쓴다, observeTagRoot).
          const releaseResize = observeTagRoot(view.dom)
          return {
            update: (v, prev) => {
              const set = wikiAiMarkersKey.getState(v.state)
              if (set === wikiAiMarkersKey.getState(prev)) return
              // 다시 계산·매핑했어도 표식 위치·키가 그대로면 위젯 DOM 도 그대로(PM 이 키로 재사용) — 배치를 다시 잴 필요가 없다.
              const sig = decorationsSignature(set)
              if (sig === lastDecos) return
              lastDecos = sig
              scheduleFitTags(v.dom)
            },
            destroy: () => {
              awareness.off('change', onChange)
              releaseResize()
              cancelFitTags(view.dom)
            },
          }
        },
      }),
    ]
  },
})
