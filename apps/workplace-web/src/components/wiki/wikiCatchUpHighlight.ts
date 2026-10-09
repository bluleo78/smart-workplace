import { Extension } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view'

import { CATCHUP_HIGHLIGHT_MS } from '@/lib/collab/collabResume'

/**
 * 돌아와 따라잡은 변경을 잠깐 표시한다(WP-293, 시안 mobile-ux ③ "밀린 변경 반영(잠깐 하이라이트)").
 * 숨길 때의 문서와 지금 문서를 최상위 블록 단위로 비교해 새로 생겼거나 바뀐 블록만 내 화면에서 CATCHUP_HIGHLIGHT_MS 동안 칠한다.
 * 공유 문서가 아니라 로컬 데코레이션이다. 그사이 또 원격 반영(문서 전체 교체)이 오면 매핑으로 사라질 수 있다 — 잠깐 표시라 수용.
 */

/** 숨길 때 없던(또는 바뀐) 최상위 블록 범위 — 같은 블록은 개수까지 맞춰(다중집합) 하나씩 지운다. */
export function changedBlockRanges(before: PMNode, after: PMNode): Array<{ from: number; to: number }> {
  // 바뀌지 않은 블록은 대개 같은 노드 객체(동기화 바인딩이 재사용)라 직렬화를 한 번만 한다 — 비교 규칙(내용 키)은 그대로.
  const keys = new WeakMap<PMNode, string>()
  const keyOf = (node: PMNode) => {
    let key = keys.get(node)
    if (key === undefined) {
      key = JSON.stringify(node.toJSON())
      keys.set(node, key)
    }
    return key
  }
  const pool = new Map<string, number>()
  before.forEach((node) => {
    const key = keyOf(node)
    pool.set(key, (pool.get(key) ?? 0) + 1)
  })
  const out: Array<{ from: number; to: number }> = []
  after.forEach((node, offset) => {
    const key = keyOf(node)
    const left = pool.get(key) ?? 0
    if (left > 0) pool.set(key, left - 1)
    else out.push({ from: offset, to: offset + node.nodeSize })
  })
  return out
}

export const wikiCatchUpHighlightKey = new PluginKey<DecorationSet>('wikiCatchUpHighlight')

type Meta = { ranges: Array<{ from: number; to: number }> } | 'clear'

export const WikiCatchUpHighlight = Extension.create({
  name: 'wikiCatchUpHighlight',
  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key: wikiCatchUpHighlightKey,
        state: {
          init: () => DecorationSet.empty,
          apply: (tr, old) => {
            const meta = tr.getMeta(wikiCatchUpHighlightKey) as Meta | undefined
            if (meta === 'clear') return DecorationSet.empty
            if (meta) {
              return DecorationSet.create(
                tr.doc,
                meta.ranges.map((r) => Decoration.node(r.from, r.to, { class: 'wiki-catchup-highlight' })),
              )
            }
            return old.map(tr.mapping, tr.doc)
          },
        },
        props: { decorations: (state) => wikiCatchUpHighlightKey.getState(state) },
      }),
    ]
  },
})

/**
 * 숨길 때 문서(before)와 비교해 바뀐 블록을 잠깐 칠한다. 반환 함수(언마운트·다음 복귀로 effect 가 다시 돌 때)는 지우기 타이머를
 * 취소하고 아직 남은 하이라이트도 지운다 — 타이머만 끄면 지울 주체가 없어 하이라이트가 영영 남는다.
 */
export function highlightCatchUp(view: EditorView, before: PMNode): () => void {
  if (view.isDestroyed) return () => {}
  const ranges = changedBlockRanges(before, view.state.doc)
  if (ranges.length === 0) return () => {}
  view.dispatch(view.state.tr.setMeta(wikiCatchUpHighlightKey, { ranges } satisfies Meta))
  let cleared = false
  const clear = () => {
    if (cleared) return
    cleared = true
    if (!view.isDestroyed) view.dispatch(view.state.tr.setMeta(wikiCatchUpHighlightKey, 'clear' satisfies Meta))
  }
  const timer = setTimeout(clear, CATCHUP_HIGHLIGHT_MS)
  return () => {
    clearTimeout(timer)
    clear()
  }
}

/**
 * 숨길 때의 본문을 적어 둔다 — 돌아와 따라잡은 변경을 칠할 비교 기준(highlightCatchUp 의 before).
 * 세션이 자리 비움 기준(state vector)을 잡을 때만 만들어야 한다 — 호출자(WikiEditor)가 본문 ready 뒤에만 만든다(그 주석).
 * 이미 있으면 덮지 않는다 — 돌아와 따라잡기 전에 다시 숨겨지면 세션도 앞의 기준을 이어 쓴다(carry).
 * take() 로 한 번 쓰면 비우고, dispose() 는 리스너를 떼고 비운다(에디터 교체·언마운트).
 */
export function watchHiddenDoc(getDoc: () => PMNode): { take: () => PMNode | null; dispose: () => void } {
  let snapshot: PMNode | null = null
  const onVisibility = () => {
    if (document.visibilityState === 'hidden') snapshot ??= getDoc()
  }
  document.addEventListener('visibilitychange', onVisibility)
  return {
    take: () => {
      const taken = snapshot
      snapshot = null
      return taken
    },
    dispose: () => {
      document.removeEventListener('visibilitychange', onVisibility)
      snapshot = null
    },
  }
}
