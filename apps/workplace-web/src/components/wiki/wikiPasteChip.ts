import type { Editor } from '@tiptap/core'
import { type EditorState, Plugin, PluginKey, type Transaction } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'
import { undo as yUndo, ySyncPluginKey } from 'y-prosemirror'
import type * as Y from 'yjs'

import { clampPos, dispatchAsUndoStep, resolveRelative, stopUndoCaptureIn, toRelative, toRelativeEnd } from './wikiCollabPosition'
import { stripShapeFromSlice } from './wikiShapeNormalize'

/**
 * 붙여넣기 칩(WP-1306) — 노트 밖 HTML 을 「모양 유지」로 붙인 뒤 그 자리에 「붙여 넣었습니다 · 모양 유지 | 글만」을 띄우는 상태와 동작.
 *
 * - 범위: 붙여넣기 거래가 바꾼 범위(changedRange)를 잡아 두고 내 거래마다 위치를 옮긴다(mapping). 동료 편집은 y-prosemirror 가 문서를 통째로
 *   갈아 끼우는 거래로 들어와 숫자 위치가 무너지므로, 범위를 잡은 직후 Yjs 상대 위치로도 적어 두고(anchor) 원격 반영 때 그것으로 다시 푼다.
 * - 「글만」: 방금 붙인 범위를 지금의 거르기 결과(stripShapeFromSlice — 상자 풀기·인라인 모양 떼기·정렬 지우기)로 바꾼다.
 *   거래 하나를 실행 취소 한 단계로 따로 내보낸다(dispatchAsUndoStep) — 「글만」도 ⌘Z 한 번으로 돌아온다.
 * - 「모양 유지」(글만을 고른 뒤): 방금 「글만」 단계를 실행 취소한다 — 칩이 떠 있는 동안 내 다른 편집은 없으므로(입력하면 칩이 닫힌다)
 *   실행 취소 맨 위가 늘 그 단계다. 범위는 「글만」 전에 적어 둔 상대 위치로 되찾는다(Yjs 는 되살린 항목으로 상대 위치를 따라간다).
 * - 닫힘: 내가 글을 고치거나(입력·지우기) 선택을 옮기거나(다른 곳 누르기·화살표), 편집기 밖을 누르거나, Esc, 내 실행 취소(⌘Z — 붙여넣기를
 *   되돌림). 동료 편집·원격 반영에는 닫히지 않는다.
 */

/** 칩이 보여 줄 지금 선택 — 모양 유지(붙여넣은 그대로)·글만(거른 결과). */
export type PasteChoice = 'shape' | 'plain'

/** 칩 상태 — 방금 붙인 범위와 지금 선택. 칩이 없으면 null. */
export interface PasteChipState {
  from: number
  to: number
  choice: PasteChoice
}

/** 범위의 Yjs 상대 위치 — 동기화가 없으면 null. */
interface RelRange {
  from: Y.RelativePosition
  to: Y.RelativePosition
}

/**
 * 플러그인 인스턴스별 가변 기록 — 거래로 실어 나를 수 없는 것(붙여넣기 직전 판정·상대 위치)만 둔다.
 * 붙여넣기 거르기(transformPasted)가 offer 를 적고, 같은 틱의 붙여넣기 거래가 그것을 읽는다.
 */
export interface PasteChipMemory {
  /** 다음 붙여넣기 거래에 칩을 띄울지 — 「글만」이 다른 결과일 때만 거르기가 켠다. */
  offer: boolean
  /** 지금 범위의 상대 위치. */
  anchor: RelRange | null
  /** 「글만」 직전 범위의 상대 위치 — 「모양 유지」로 되돌릴 때 범위를 되찾는다. */
  shapeAnchor: RelRange | null
  /** 「모양 유지」가 부른 실행 취소 중인지 — 그 거래는 칩을 닫지 않고 범위를 되찾는다. */
  restoring: boolean
  /** 다음 뷰 갱신 뒤 상대 위치를 다시 적을지(새 범위가 Yjs 에 반영된 뒤라야 적을 수 있다). */
  capture: boolean
}

type ChipMeta = { type: 'hide' } | { type: 'plain' }

export const pasteChipKey = new PluginKey<PasteChipState | null>('wikiPasteChip')

/** 칩 상태 — 플러그인이 없거나 칩이 없으면 null. */
export function pasteChipState(state: EditorState): PasteChipState | null {
  return pasteChipKey.getState(state) ?? null
}

function memoryOf(state: EditorState): PasteChipMemory | null {
  return (pasteChipKey.get(state)?.spec as { memory?: PasteChipMemory } | undefined)?.memory ?? null
}

/** 거래가 바꾼 범위(새 문서 좌표) — 단계마다 바뀐 자리를 합친다. 바뀐 게 없으면 null. */
export function changedRange(tr: Transaction): { from: number; to: number } | null {
  let from = -1
  let to = -1
  for (const map of tr.mapping.maps) {
    if (from >= 0) {
      from = map.map(from, -1)
      to = map.map(to, 1)
    }
    map.forEach((_oldStart, _oldEnd, newStart, newEnd) => {
      from = from < 0 ? newStart : Math.min(from, newStart)
      to = Math.max(to, newEnd)
    })
  }
  return from < 0 ? null : { from, to }
}

/**
 * 범위 [from, to) 를 「글만」으로 — 붙여넣기 거르기의 「글만」(stripShapeFromSlice)을 이 범위의 조각에 그대로 써서 바꿔 넣는다(상자 풀기·
 * 인라인 모양 떼기·정렬 지우기). 범위보다 앞에서 시작한 상자·문단(붙여 넣은 자리의 원래 블록)은 조각의 열린 쪽이라 바꿔 넣을 때 문서의
 * 원래 노드가 그대로 남는다. 뗄 것이 없으면 단계를 더하지 않는다(docChanged 로 「글만」이 다른 결과인지 본다). tr 에 단계를 더해 돌려준다.
 */
export function pastedRangeToPlain(tr: Transaction, from: number, to: number): Transaction {
  const slice = tr.doc.slice(from, to)
  const plain = stripShapeFromSlice(slice)
  if (plain !== slice) tr.replace(from, to, plain)
  return tr
}

/** 상대 위치 범위 → 이 상태의 숫자 범위. 풀 수 없으면 null. */
function resolveRange(state: EditorState, rel: RelRange | null): { from: number; to: number } | null {
  if (!rel) return null
  const from = resolveRelative(state, rel.from)
  const to = resolveRelative(state, rel.to)
  if (from == null || to == null) return null
  const a = clampPos(from, state.doc)
  const b = clampPos(to, state.doc)
  return a <= b ? { from: a, to: b } : null
}

/** 숫자 범위 → 상대 위치 범위. 동기화가 없으면 null. */
function captureRange(state: EditorState, range: { from: number; to: number }): RelRange | null {
  const from = toRelative(state, range.from)
  const to = range.to > range.from ? toRelativeEnd(state, range.to) : toRelative(state, range.to)
  return from && to ? { from, to } : null
}

/** 칩을 닫는다(Esc·밖 누르기). */
export function hidePasteChip(view: EditorView): void {
  if (pasteChipState(view.state)) view.dispatch(view.state.tr.setMeta(pasteChipKey, { type: 'hide' } satisfies ChipMeta))
}

/** 「글만」 — 방금 붙인 범위를 거른 결과로 바꾼다(실행 취소 한 단계). 칩이 없거나 이미 글만이면 false. */
export function choosePastePlain(editor: Editor): boolean {
  const st = pasteChipState(editor.state)
  const memory = memoryOf(editor.state)
  if (!st || st.choice === 'plain' || !memory) return false
  const tr = pastedRangeToPlain(editor.state.tr, st.from, st.to)
  // 거를 것이 남지 않았다(동료가 붙인 범위를 지웠거나 모양을 이미 뗐다) — 바꿈이 없어 실행 취소 단계도 생기지 않으므로,
  // 「글만」으로 적어 두면 뒤의 「모양 유지」가 실행 취소 맨 위의 엉뚱한 단계(붙여넣기·그 앞 입력)를 되돌린다. 칩을 닫고 끝낸다.
  if (!tr.docChanged) {
    hidePasteChip(editor.view)
    return false
  }
  memory.shapeAnchor = memory.anchor
  dispatchAsUndoStep(editor, tr.setMeta(pasteChipKey, { type: 'plain' } satisfies ChipMeta))
  return true
}

/** 「모양 유지」(글만을 고른 뒤) — 「글만」 단계를 실행 취소한다. 칩이 없거나 이미 모양 유지면 false. */
export function choosePasteShape(editor: Editor): boolean {
  const st = pasteChipState(editor.state)
  const memory = memoryOf(editor.state)
  if (!st || st.choice === 'shape' || !memory) return false
  memory.restoring = true
  try {
    return yUndo(editor.state)
  } finally {
    memory.restoring = false
  }
}

/** 칩 표면 표지 — 이 안을 누르는 것은 「다른 곳 누르기」가 아니다(WikiPasteChip 의 testId 와 같다). */
export const PASTE_CHIP_SELECTOR = '[data-testid="wiki-paste-chip"]'

/** y-prosemirror 거래 메타 — 원격 반영·실행 취소 판정에 쓴다. */
type YSyncMeta = { isChangeOrigin?: boolean; isUndoRedoOperation?: boolean } | undefined

/**
 * 붙여넣기 칩 플러그인 — memory 는 붙여넣기 거르기(WikiPasteShape)와 함께 쓴다.
 */
export function pasteChipPlugin(memory: PasteChipMemory): Plugin<PasteChipState | null> {
  return new Plugin<PasteChipState | null>({
    key: pasteChipKey,
    memory,
    state: {
      init: () => null,
      apply(tr, value, _old, newState) {
        const meta = tr.getMeta(pasteChipKey) as ChipMeta | undefined
        if (meta?.type === 'hide') return null
        // 다른 플러그인이 덧붙인 거래(링크 자동 감지 등)는 원래 거래를 따른다 — 범위만 옮긴다.
        const root = tr.getMeta('appendedTransaction') as Transaction | undefined
        if (root) return value && { ...value, from: tr.mapping.map(value.from, -1), to: tr.mapping.map(value.to, 1) }
        const ui = tr.getMeta('uiEvent')
        if (memory.offer && (ui === 'paste' || ui === 'drop')) {
          memory.offer = false
          const range = tr.docChanged ? changedRange(tr) : null
          memory.anchor = null
          memory.shapeAnchor = null
          memory.capture = !!range
          return range && { ...range, choice: 'shape' }
        }
        // 칩을 켜지 않은 붙여넣기 판정(HTML 문서 붙여넣기가 가져간 경우 등)이 다음 거래로 새지 않게.
        memory.offer = false
        if (!value) return null
        const ym = tr.getMeta(ySyncPluginKey) as YSyncMeta
        if (ym?.isChangeOrigin) {
          if (ym.isUndoRedoOperation) {
            // 「모양 유지」가 부른 실행 취소면 「글만」 전 범위를 되찾는다. 그 밖의 내 ⌘Z·⌘⇧Z 는 붙여넣기를 되돌린 것이라 닫는다.
            if (!memory.restoring) return null
            const range = resolveRange(newState, memory.shapeAnchor)
            memory.anchor = memory.shapeAnchor
            memory.shapeAnchor = null
            return range && { ...range, choice: 'shape' }
          }
          // 동료 편집 — 상대 위치로 다시 푼다(아직 못 적었으면 닫는다). 동료가 붙인 범위를 통째 지워 빈 범위가 되면 고를 것이 없어 닫는다.
          const range = resolveRange(newState, memory.anchor)
          return range && range.from < range.to ? { ...value, ...range } : null
        }
        if (meta?.type === 'plain') {
          memory.capture = true
          return { from: tr.mapping.map(value.from, -1), to: tr.mapping.map(value.to, 1), choice: 'plain' }
        }
        // 내가 글을 고치거나 선택을 옮겼다 — 계속 입력·다른 곳 누르기.
        if (tr.docChanged || tr.selectionSet) return null
        return value
      },
    },
    props: {
      handleKeyDown(view, event) {
        if (event.key !== 'Escape' || !pasteChipState(view.state)) return false
        hidePasteChip(view)
        return true
      },
    },
    view(view) {
      // 편집기 밖(다른 패널·제목 등)을 누르면 닫는다 — 편집기 안 누르기는 선택이 바뀌며 닫힌다. 칩 자신은 뺀다.
      // 문서 전체 듣기는 칩이 떠 있는 동안만 단다 — 칩이 없을 때 모든 누르기마다 불리지 않게.
      const onPointerDown = (event: PointerEvent) => {
        const target = event.target as Element | null
        if (!pasteChipState(view.state) || target?.closest?.(PASTE_CHIP_SELECTOR)) return
        if (view.dom.contains(target)) return
        hidePasteChip(view)
      }
      let listening = false
      const listen = (on: boolean) => {
        if (on === listening) return
        listening = on
        if (on) document.addEventListener('pointerdown', onPointerDown, true)
        else document.removeEventListener('pointerdown', onPointerDown, true)
      }
      return {
        update() {
          listen(!!pasteChipState(view.state))
          if (!memory.capture) return
          memory.capture = false
          // 동기화 플러그인은 이 뷰 갱신 뒤에 Yjs 로 옮긴다 — 그다음(마이크로태스크)에 상대 위치를 적고, 실행 취소 묶음을 끊어
          // 바로 이어 친 글자가 붙여넣기·「글만」과 한 단계로 묶이지 않게 한다.
          queueMicrotask(() => {
            const st = pasteChipState(view.state)
            if (!st || view.isDestroyed) return
            memory.anchor = captureRange(view.state, st)
            stopUndoCaptureIn(view.state)
          })
        },
        destroy() {
          listen(false)
        },
      }
    },
  })
}
