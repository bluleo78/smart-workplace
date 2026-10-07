import { Extension } from '@tiptap/core'
import { type EditorState, Plugin, PluginKey, type Transaction } from '@tiptap/pm/state'
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view'
import { ySyncPluginKey } from 'y-prosemirror'
import * as Y from 'yjs'

import { resolveRelative, toRelative, ySyncOf } from './wikiCollabPosition'

/**
 * 노트 이미지 업로드 자리표시자(WP-295) — 공유 문서(Yjs)가 아니라 내 화면에만 그리는 ProseMirror 위젯 데코레이션.
 *
 * 왜: 예전엔 "⏳ 이미지 업로드 중… #n" 텍스트를 문서에 넣었다. 동시 편집에선 그 텍스트가 공유 문서에 들어가
 * ① 탭마다 0 부터 세는 번호가 겹쳐 두 사람이 동시에 붙여 넣으면 서로의 자리표시자를 찾아 이미지가 뒤바뀌거나 사라지고,
 * ② 2초 파생 저장이 그 텍스트를 노트 본문(wiki_page.body)에 저장해 검색 색인·version·요약 낡음 표시를 건드리고 남에게도 보이며,
 * 업로드 중 탭을 닫으면 영영 남았다. 데코레이션은 문서를 바꾸지 않으므로 저장·동기화되지 않는다.
 *
 * 위치: 동시 편집의 원격 변경은 y-prosemirror 가 문서 전체를 한 번에 바꾸는 트랜잭션으로 반영하므로 매핑(tr.mapping)으로
 * 따라가면 위치가 문서 처음/끝으로 무너진다. 그래서 업로드마다 Yjs 상대 위치를 잡아 두고 원격 변경 때 그걸로 다시 계산한다.
 * 내 편집(로컬 트랜잭션)은 아직 Yjs 에 반영되기 전이라 상대 위치로 풀 수 없어 tr.mapping 으로 따라간다.
 * 두 방식이 같은 자리를 가리키도록 둘 다 왼쪽에 붙인다(assoc -1) — 업로드 중 그 자리에 친 글자는 이미지 뒤로 간다
 * (예전 텍스트 자리표시자 뒤에 커서가 놓이던 것과 같은 결과).
 */

/** 화면에 보이는 자리표시자 문구. */
export const UPLOAD_PLACEHOLDER_TEXT = '⏳ 이미지 업로드 중…'

/** 업로드 하나의 자리 — 숫자 위치(로컬 매핑용)와 Yjs 상대 위치(원격 변경·재마운트용). */
interface UploadSpot {
  id: string
  pos: number
  rel: Y.RelativePosition | null
}

type Meta = { add: UploadSpot } | { remove: string }

const key = new PluginKey<UploadSpot[]>('wikiUploadPlaceholder')

const clamp = (pos: number, state: EditorState) => Math.max(0, Math.min(pos, state.doc.content.size))

/** 상대 위치 → 이 상태의 절대 위치. 동기화 플러그인이 없거나 풀 수 없으면 null. */
function resolveRel(state: EditorState, rel: Y.RelativePosition | null): number | null {
  const abs = rel == null ? null : resolveRelative(state, rel)
  return abs == null ? null : clamp(abs, state)
}

/** 트랜잭션마다 자리를 옮긴다 — 원격 변경(동기화 플러그인 출처)은 상대 위치로, 내 편집은 매핑으로. */
function applySpots(tr: Transaction, spots: UploadSpot[], newState: EditorState): UploadSpot[] {
  let next = spots
  if (tr.docChanged && spots.length > 0) {
    const remote = (tr.getMeta(ySyncPluginKey) as { isChangeOrigin?: boolean } | undefined)?.isChangeOrigin === true
    next = spots.map((s) => {
      const fromRel = remote ? resolveRel(newState, s.rel) : null
      return { ...s, pos: fromRel ?? clamp(tr.mapping.map(s.pos, -1), newState) }
    })
  }
  const meta = tr.getMeta(key) as Meta | undefined
  if (meta && 'add' in meta) next = [...next, meta.add]
  if (meta && 'remove' in meta) next = next.filter((s) => s.id !== meta.remove)
  return next
}

/**
 * pos 의 Yjs 상대 위치 — 왼쪽 글자에 붙인다(assoc -1). y-prosemirror 는 오른쪽(assoc 0)으로만 만들어, 그대로 쓰면 그 자리에 친 글자가
 * 원격 변경 때 자리표시자 앞으로 튀어 로컬 매핑(assoc -1)과 어긋난다. 글 상자 밖(문단 경계 등)은 y-prosemirror 결과를 그대로 쓴다.
 */
function leftRelativePosition(state: EditorState, pos: number): Y.RelativePosition | null {
  const ys = ySyncOf(state)
  const right = toRelative(state, pos)
  if (!ys || !right) return null
  const abs = Y.createAbsolutePositionFromRelativePosition(right, ys.doc)
  if (abs?.type instanceof Y.XmlText) return Y.createRelativePositionFromTypeIndex(abs.type, abs.index, -1)
  return right
}

/** 위젯 DOM — 편집 불가 칩. */
function widget(): HTMLElement {
  const el = document.createElement('span')
  el.className = 'wiki-upload-placeholder'
  el.contentEditable = 'false'
  el.dataset.testid = 'wiki-upload-placeholder'
  el.textContent = UPLOAD_PLACEHOLDER_TEXT
  return el
}

/** 에디터 확장 — 업로드 자리표시자 플러그인을 단다. */
export const WikiUploadPlaceholder = Extension.create({
  name: 'wikiUploadPlaceholder',
  addProseMirrorPlugins() {
    return [
      new Plugin<UploadSpot[]>({
        key,
        state: {
          init: () => [],
          apply: (tr, spots, _old, newState) => applySpots(tr, spots, newState),
        },
        props: {
          decorations(state) {
            const spots = key.getState(state) ?? []
            if (spots.length === 0) return DecorationSet.empty
            // key 로 같은 업로드의 DOM 을 재사용한다(원격 변경마다 깜빡이지 않게). side -1: 그 자리에 친 글자 앞에 그린다.
            return DecorationSet.create(
              state.doc,
              spots.map((s) => Decoration.widget(clamp(s.pos, state), widget, { key: s.id, side: -1 })),
            )
          },
        },
      }),
    ]
  },
})

/** 업로드 자리 핸들 — 완료 시점의 뷰(재마운트됐을 수 있음)에서 현재 위치를 묻고, 자리표시자를 걷는다. */
export interface UploadPlaceholder {
  /** 이 뷰에서의 현재 위치. 자리를 잃었으면 null. */
  position(view: EditorView): number | null
  /** 자리표시자를 걷는 트랜잭션 메타를 tr 에 싣는다(이미지 삽입과 같은 트랜잭션으로 걷을 때). */
  removeIn(tr: Transaction): Transaction
  /** 자리표시자만 걷는다(실패·삽입 불가). 파괴된 뷰면 아무것도 안 한다. */
  remove(view: EditorView): void
}

/**
 * pos 에 자리표시자를 띄운다. id 는 업로드마다 고유(crypto.randomUUID)라 탭·사람끼리 겹치지 않는다.
 * 플러그인이 없는 뷰(확장 미등록)면 표시 없이 숫자 위치만 따라간다.
 */
export function startUploadPlaceholder(view: EditorView, pos: number): UploadPlaceholder {
  const id = crypto.randomUUID()
  const rel = leftRelativePosition(view.state, pos)
  const startView = view
  view.dispatch(view.state.tr.setMeta(key, { add: { id, pos, rel } } satisfies Meta))
  return {
    position(current) {
      // 시작한 뷰면 플러그인이 따라온 위치, 재마운트된 새 뷰면 Yjs 상대 위치로 푼다(새 뷰엔 이 자리 상태가 없다).
      const spot = current === startView ? key.getState(current.state)?.find((s) => s.id === id) : undefined
      if (spot) return clamp(spot.pos, current.state)
      return resolveRel(current.state, rel)
    },
    removeIn(tr) {
      return tr.setMeta(key, { remove: id } satisfies Meta)
    },
    remove(current) {
      if (current.isDestroyed) return
      if (!key.getState(current.state)?.some((s) => s.id === id)) return
      current.dispatch(current.state.tr.setMeta(key, { remove: id } satisfies Meta))
    },
  }
}
