// 노트 「상자」(WP-1303) — 모양 영역 노드(wikiHtmlBox, WP-1240)를 사용자가 직접 만들고 다루는 블록으로 꺼낸다.
// HTML 을 들여올 때 생기는 카드도 같은 상자다. 스키마는 그대로 두고(새 노드 없음 — 지문 불변) 편집기 동작만 얹는다:
// - 만들기: 슬래시 「상자」(insertBox), 글을 고르고 「상자로 감싸기」(wrapInBox). 새 상자는 「기본」 모양(BOX_BASIC_STYLE)이다.
// - 고르기: 상자 테두리·안쪽 여백을 누르면 상자 통째 선택(NodeSelection) — 상자 막대(WikiBoxToolbar)가 뜬다.
// - 상자 막대 동작: 꾸미기(writeSelectedBoxStyle — WP-1304 상자 꾸미기 창, 정리·자리 지킴은 여기 한곳)·↑/↓ 줄 추가(addLineBesideBox)·글만 남기기(unwrapBox)·삭제(deleteBox).
// - 통째 선택 키: Enter·↓ 다음 줄, ↑ 앞 줄, Esc 한 단계 바깥, Delete·Backspace 지우기(기본 동작). 글 줄 → 상자 밖 Enter·↓ 는 WP-1288(wikiBlockExit).
import { sanitizeInlineStyle, WIKI_HTML_BOX } from '@smart-workplace/wiki-editor-schema'
import { type Command, type Editor as TiptapEditor, Extension } from '@tiptap/core'
import { Fragment, type Node as PMNode, NodeRange, type ResolvedPos } from '@tiptap/pm/model'
import { type EditorState, NodeSelection, Plugin, PluginKey, Selection, TextSelection, type Transaction } from '@tiptap/pm/state'
import { findWrapping } from '@tiptap/pm/transform'
import type { EditorView } from '@tiptap/pm/view'
import { ySyncPluginKey } from 'y-prosemirror'

import {
  arrowBesideBlock,
  boxAncestor,
  deleteBlockAt,
  insertLineAt,
  isBox,
  isCodeText,
  isWritableLine,
  leaveBlock,
  leaveSelected,
  moveBesideBlock,
  type SelectedBlock,
  selectedNode,
  typingGuardProps,
} from './wikiBlockExit'
import { dispatchAsUndoStep, nodeSelectionRestoreGuard } from './wikiCollabPosition'
import { stripShapeFromFragment } from './wikiPasteShape'

/**
 * 새 상자의 「기본」 모양 — 옅은 테두리·둥근 모서리·안쪽 여백. 꾸미기 묶음(WP-1304 기본·안내·주의·강조)의 「기본」과 같은 글자로 둔다.
 * 노드의 style 속성(sanitizeInlineStyle 통과)에 그대로 저장한다 — 색은 앱 테마 변수(--border)를 쓰고, 변수가 없는 화면(내보낸 HTML)은 옅은 회색.
 */
export const BOX_BASIC_STYLE = 'border: 1px solid var(--border, #e5e7eb); border-radius: 8px; padding: 12px 16px'

/**
 * 상자가 비어 사라지지 않게 하는 자리 지킴 선언(WP-1304) — class 도 style 도 없는 div 는 다시 읽을 때 상자로 잡히지 않는다(htmlNodes BOX_SELECTOR).
 * 꾸미기를 다 지워도 상자는 남아야 하므로 div 기본값과 같은 이 선언을 둔다(모양은 바뀌지 않는다).
 */
export const BOX_EMPTY_STYLE = 'display: block'

/** 선택이 통째 고른 상자(노드 선택) — 아니면 null. 상자 막대·키 동작이 쓴다. */
export function selectedBox(state: EditorState): SelectedBlock | null {
  return selectedNode(state, isBox)
}

/** 자리가 표 안인지 — 표 셀은 한 줄 마크다운이라 상자를 담지 못한다(슬래시 「HTML 블록」이 표 안에서 숨는 것과 같은 이유). */
function inTable($pos: ResolvedPos): boolean {
  for (let d = $pos.depth; d > 0; d--) if ($pos.node(d).type.spec.tableRole) return true
  return false
}

/** 「기본」 모양 빈 상자 — 빈 문단 하나를 담는다. 스키마에 상자·문단이 없으면 null. */
function emptyBox(state: EditorState): PMNode | null {
  const box = state.schema.nodes[WIKI_HTML_BOX]
  const paragraph = state.schema.nodes.paragraph
  return box && paragraph ? box.create({ style: BOX_BASIC_STYLE }, paragraph.create()) : null
}

/**
 * 슬래시 「상자」 — 빈 상자를 넣고 커서를 상자 안 빈 줄에 둔다.
 * 빈 줄(「/상자」만 친 줄)이면 그 줄을 상자로 바꾸고, 글자가 있는 줄이면 그 줄 뒤에 넣는다. 그 자리에 상자가 들 수 없으면
 * (목록 항목 첫 줄 — 항목은 문단으로 시작해야 한다) 줄 뒤에 넣는다. 표 안·코드 글자 안이면 넣지 않는다.
 */
export const insertBox: Command = ({ state, tr, dispatch }) => {
  const box = emptyBox(state)
  const { $from } = tr.selection
  const line = $from.parent
  if (!box || !isWritableLine(line) || $from.depth < 1 || inTable($from)) return false
  const container = $from.node(-1)
  const index = $from.index(-1)
  const replace = line.type.name === 'paragraph' && line.content.size === 0 && container.canReplaceWith(index, index + 1, box.type)
  if (!replace && !container.canReplaceWith(index + 1, index + 1, box.type)) return false
  if (!dispatch) return true
  const at = $from.before()
  if (replace) tr.replaceWith(at, $from.after(), box)
  else tr.insert($from.after(), box)
  // 상자(1) + 문단(1) 안 — 상자 앞 위치에서 2 칸 들어간 자리.
  tr.setSelection(TextSelection.create(tr.doc, (replace ? at : $from.after()) + 2))
  return true
}

/**
 * 감쌀 범위와 감싸는 방법 — 고른 글이 걸친 블록들. 그 자리에 상자가 들 수 없으면(목록 항목 안 문단 — 항목은 문단으로 시작해야 한다)
 * 한 단계씩 바깥 범위(목록 통째)로 넓혀 본다. 빈 선택·노드 선택·표 안이면 null.
 */
function boxWrapTarget(state: EditorState): { range: NodeRange; wrapping: NonNullable<ReturnType<typeof findWrapping>> } | null {
  const type = state.schema.nodes[WIKI_HTML_BOX]
  const sel = state.selection
  if (!type || sel.empty || sel instanceof NodeSelection) return null
  const { $from } = sel
  let { $to } = sel
  if (inTable($from) || inTable($to)) return null
  // 코드 글자(열린 HTML 블록 소스·코드 블록) 안의 선택은 감싸지 않는다 — 슬래시 「상자」와 같은 기준. 소스 몇 글자를 고른 채 누르면 HTML 블록이
  // 통째로 상자에 들어가 버린다.
  if (isCodeText($from.parent) || isCodeText($to.parent)) return null
  // 선택 끝이 다음 줄 맨 앞에 걸쳤으면(낱말 더블클릭·줄 끝까지 끌기) 그 줄은 고르지 않은 것으로 본다 — 앞 글 줄 끝으로 당긴다.
  // 줄 앞 경계(before)로 당기면 그 줄이 목록·인용·상자의 첫 줄일 때 경계가 그 감싸개 안이라 감싸개째 범위에 들어간다 — 앞 글 자리를 찾는다.
  if ($to.parentOffset === 0 && $to.depth > 0 && !$to.sameParent($from)) {
    const prev = Selection.findFrom(state.doc.resolve($to.before()), -1, true)
    if (prev && prev.$head.pos >= $from.pos) $to = prev.$head
  }
  let range = $from.blockRange($to)
  while (range) {
    const wrapping = findWrapping(range, type, { style: BOX_BASIC_STYLE })
    if (wrapping) return { range, wrapping }
    if (range.depth === 0) return null
    range = new NodeRange($from, $to, range.depth - 1)
  }
  return null
}

/** 지금 선택을 상자로 감쌀 수 있는지 — 글 고르기 막대가 「상자로 감싸기」 단추를 보일지 정한다. */
export function canWrapInBox(state: EditorState): boolean {
  return boxWrapTarget(state) !== null
}

/**
 * 「상자로 감싸기」 — 고른 글이 걸친 블록들을 「기본」 모양 상자 하나로 감싸고, 그 상자를 통째 선택한다(상자 막대가 떠 바로 꾸미거나 풀 수 있게).
 */
export function wrapInBox(state: EditorState, dispatch?: (tr: Transaction) => void): boolean {
  const target = boxWrapTarget(state)
  if (!target) return false
  if (!dispatch) return true
  const tr = state.tr.wrap(target.range, target.wrapping)
  // 감싸기는 범위 앞자리에 바깥 감싸개부터 차례로 연다(감싸개마다 여는 자리 1칸) — 상자는 감싸개 목록에서 제 순번만큼 들어간 자리다(보통 바로 그 자리).
  const pos = target.range.start + target.wrapping.findIndex((w) => w.type.name === WIKI_HTML_BOX)
  if (isBox(tr.doc.nodeAt(pos))) tr.setSelection(NodeSelection.create(tr.doc, pos))
  dispatch(tr.scrollIntoView())
  return true
}

/**
 * 「↑ 줄 추가」(dir -1)·「↓ 줄 추가」(dir 1) — 상자 바로 위·아래(상자 밖)에 빈 문단을 새로 만들고 커서를 둔다.
 * 옆에 글 줄이 이미 있어도 새로 만든다(그 줄로 옮기기만 하는 Enter·화살표와 다르다 — 상자와 글 사이에 줄을 끼우는 단추).
 * pos 에 상자가 없으면(동료가 지움) false.
 */
export function addLineBesideBox(state: EditorState, dispatch: ((tr: Transaction) => void) | undefined, pos: number, dir: 1 | -1): boolean {
  const node = state.doc.nodeAt(pos)
  const paragraph = state.schema.nodes.paragraph
  if (!isBox(node) || !paragraph) return false
  if (!dispatch) return true
  const tr = state.tr
  insertLineAt(tr, dir > 0 ? pos + node.nodeSize : pos)
  dispatch(tr.scrollIntoView())
  return true
}

/**
 * 「글만 남기기」 — 상자 모양을 떼고 안 블록을 보통 블록으로 남긴다. 붙여넣기 모양 거르기의 풀기(stripShapeFromFragment)를 그대로 쓴다 —
 * 상자를 풀고, 안쪽의 겹친 상자·배지 같은 인라인 모양도 떼 「글만」 남긴다. 커서는 풀린 첫 줄 처음에 둔다. 한 거래라 실행 취소 한 번에 돌아온다.
 */
export function unwrapBox(state: EditorState, dispatch: ((tr: Transaction) => void) | undefined, pos: number): boolean {
  const node = state.doc.nodeAt(pos)
  if (!isBox(node)) return false
  if (!dispatch) return true
  let content = stripShapeFromFragment(Fragment.from(node))
  // 붙여넣기 거르기는 페이지 스타일(wikiStyle)을 버리지만, 상자 안에 든 페이지 스타일은 페이지 전체 CSS 다(전체 선택 후 감싸기·<style> 을 품은
  // 가져온 카드) — 「글만 남기기」가 페이지 모양까지 지우지 않게 상자 밖 블록으로 꺼내 남긴다.
  const pageStyles: PMNode[] = []
  node.descendants((child) => {
    if (child.type.name === 'wikiStyle') pageStyles.push(child)
    return child.type.name !== 'wikiStyle'
  })
  if (pageStyles.length) content = content.append(Fragment.fromArray(pageStyles))
  // 안이 비던 상자 — 빈 문단 하나를 남긴다(바깥 상자의 유일한 자식이었어도 내용이 비지 않게). 페이지 스타일만 남았어도 글 줄이 하나는 있게 앞에 둔다.
  if (!content.size || content.childCount === pageStyles.length) {
    content = Fragment.from(state.schema.nodes.paragraph!.create()).append(content)
  }
  const tr = state.tr.replaceWith(pos, pos + node.nodeSize, content)
  dispatch(tr.setSelection(Selection.near(tr.doc.resolve(pos), 1)).scrollIntoView())
  return true
}

/**
 * 「상자 꾸미기」(WP-1304) — pos 의 상자 style 속성만 바꾼다(속성 바꾸기 한 단계라 위치·통째 선택이 그대로 남는다).
 * 실행 취소 한 단계로 따로 내보낸다(dispatchAsUndoStep) — 꾸미기 한 번이 실행 취소 한 번이 되게. 정리는 부르는 쪽(writeSelectedBoxStyle)이 한다.
 * pos 에 상자가 없으면(동료가 지움) false.
 */
export function setBoxStyle(editor: TiptapEditor, pos: number, style: string): boolean {
  const node = editor.state.doc.nodeAt(pos)
  if (!isBox(node)) return false
  if (node.attrs.style !== style) dispatchAsUndoStep(editor, editor.state.tr.setNodeAttribute(pos, 'style', style))
  return true
}

/**
 * 지금 통째 선택된 상자의 style 을 바꾼다 — 상자 style 을 저장하는 유일한 길이라 정리(sanitizeInlineStyle)와 빈 style 의
 * 자리 지킴 선언(BOX_EMPTY_STYLE)을 여기서만 한다(꾸미기 항목·「CSS 로 직접 고치기」 모두 정리 전 글자를 넘긴다).
 * 거래 하나라 동료에게 바로 가고 실행 취소 한 번에 돌아온다. 저장한 style 을 돌려준다 — 상자가 선택돼 있지 않으면(동료가 지움) null.
 */
export function writeSelectedBoxStyle(editor: TiptapEditor, next: (style: string | null) => string): string | null {
  const hit = selectedBox(editor.state)
  if (!hit) return null
  const style = sanitizeInlineStyle(next(hit.node.attrs.style as string | null)) ?? BOX_EMPTY_STYLE
  return setBoxStyle(editor, hit.pos, style) ? style : null
}

/** 「삭제」 — 상자를 안 내용째 지운다(통째 선택 후 deleteSelection — Delete 키와 같다). pos 에 상자가 없으면 false. */
export function deleteBox(state: EditorState, dispatch: ((tr: Transaction) => void) | undefined, pos: number): boolean {
  return deleteBlockAt(state, dispatch, pos, isBox)
}

/**
 * Esc — 한 단계 바깥으로(설계 §1, HTML 블록의 Esc 와 같은 감각).
 * 1. 상자 안 글 줄에 커서(글자 선택)가 있으면 가장 안쪽 상자를 통째 선택한다 — 키보드로 상자 막대에 닿는 길.
 * 2. 상자가 통째 선택돼 있으면 바깥 상자를 통째 선택하고, 바깥이 상자가 아니면 옆 글 줄로 나간다(없으면 새 줄 — leaveBlock).
 * 코드 블록·HTML 블록 소스 안, 다른 노드 선택(HTML 블록·이미지)은 넘긴다 — 그쪽 Esc 가 처리한다.
 */
export function escapeBox(state: EditorState, dispatch?: (tr: Transaction) => void): boolean {
  const hit = selectedBox(state)
  if (hit) {
    const $pos = state.doc.resolve(hit.pos)
    const outer = boxAncestor($pos)
    if (outer === null) return leaveBlock(state, dispatch, hit.pos, hit.node.nodeSize)
    dispatch?.(state.tr.setSelection(NodeSelection.create(state.doc, $pos.before(outer))))
    return true
  }
  const sel = state.selection
  if (!(sel instanceof TextSelection) || isCodeText(sel.$from.parent)) return false
  const { $from, $to } = sel
  const d = boxAncestor($from, $from.depth - 1)
  // 상자 밖 글 줄이거나, 선택이 상자 밖까지 걸쳤으면(드래그로 여러 블록) 고르지 않는다.
  if (d === null || $to.depth < d || $to.before(d) !== $from.before(d)) return false
  dispatch?.(state.tr.setSelection(NodeSelection.create(state.doc, $from.before(d))))
  return true
}

/**
 * 동기화 반영 뒤 상자 선택 되살리기 — 상자를 통째 고른 채 Yjs 거래가 시작되면 보호(nodeSelectionRestoreGuard)가 선택 종류를 글자로 낮춰
 * y-prosemirror 는 TextSelection.between(상자 앞, 상자 뒤) — 상자 안 글 전체 — 로 되살린다. 그 선택이 어떤 상자의 안 글 전체와 같으면
 * 그 상자를 다시 통째 선택한다(동료 타자마다 상자 막대가 사라지지 않게). 상자가 지워졌으면 맞는 상자가 없어 글자 선택으로 남는다.
 */
function reselectBox(state: EditorState, depth: number | null): Transaction | null {
  const { $from, from, to } = state.selection
  /** 깊이 d 의 상자 안 글 전체가 지금 선택과 같은지. */
  const spans = (d: number) => {
    const span = TextSelection.between(state.doc.resolve($from.before(d)), state.doc.resolve($from.after(d)))
    return span.from === from && span.to === to
  }
  const select = (d: number) => state.tr.setSelection(NodeSelection.create(state.doc, $from.before(d)))
  // 고른 상자의 깊이를 먼저 본다 — 바깥 상자의 유일한 자식이 상자면 두 상자의 안 글 전체가 같아, 가장 안쪽부터 보면 안쪽 상자로 바뀐다.
  if (depth !== null && depth > 0 && depth <= $from.depth && isBox($from.node(depth)) && spans(depth)) return select(depth)
  // 그다음 가장 안쪽 상자부터 바깥으로.
  for (let d = boxAncestor($from); d !== null; d = boxAncestor($from, d - 1)) if (spans(d)) return select(d)
  return null
}

/** 상자 자신을 누른 클릭(가장 안쪽 노드가 상자 — 테두리·안쪽 여백)이면 상자를 통째 선택한다. 보기 전용이면 넘긴다. */
function selectBoxOnClick(view: EditorView, _pos: number, node: PMNode, nodePos: number, event: MouseEvent, direct: boolean): boolean {
  // Shift 누르기는 선택 넓히기라 기본 동작에 맡긴다.
  if (!direct || !view.editable || !isBox(node) || event.shiftKey) return false
  view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, nodePos)))
  return true
}

/**
 * 상자 편집기 확장 — 통째 선택 키·테두리 누르기·글자 키 보호·동시 편집 선택 보호(편집기 전용, 보기 전용 화면에는 넣지 않는다).
 * 키는 조건이 맞지 않으면 false 로 넘겨 기본 동작·다른 블록(HTML 블록·글 줄 나가기)의 키가 그대로 돈다.
 */
export const WikiBox = Extension.create({
  name: 'wikiBox',

  addKeyboardShortcuts() {
    /** 통째 선택된 상자에서 옆으로 — Enter 는 다음 줄(없으면 만든다), 화살표는 옆 블록(끝이면 새 줄)으로. */
    const leave = (dir: 1 | -1, move: typeof moveBesideBlock) => () =>
      leaveSelected(this.editor.state, this.editor.view.dispatch, selectedBox, dir, move)
    return {
      Enter: leave(1, moveBesideBlock),
      ArrowDown: leave(1, arrowBesideBlock),
      ArrowUp: leave(-1, arrowBesideBlock),
      Escape: () => escapeBox(this.editor.state, this.editor.view.dispatch),
    }
  },

  addProseMirrorPlugins() {
    // 보호가 선택을 낮췄을 때 고른 상자의 깊이 — 다음 원격 반영 거래에서 한 번만 되살린다. 내 편집이 먼저 오면 지운다(편집기마다 따로).
    let lowered: number | null = null
    return [
      new Plugin({
        key: new PluginKey('wikiBox'),
        props: {
          // 상자 자신(테두리·안쪽 여백)을 누르면 통째 선택 — 안 글을 누르면 가장 안쪽 노드(direct)가 그 줄이라 보통 글 편집이 된다.
          // 같은 자리를 빨리 두 번 누르면(더블클릭) 브라우저가 근처 낱말을 골라 버린다 — 두 번 누르기도 같은 통째 선택으로 받는다.
          handleClickOn: selectBoxOnClick,
          handleDoubleClickOn: selectBoxOnClick,
          // 통째 선택된 상자에 글자를 치면 상자가 그 글자로 바뀌어 사라진다 — 다음 줄로 옮긴 뒤 키의 기본 동작이 그 줄에서 이어지게(HTML 블록과 같다).
          ...typingGuardProps(selectedBox),
        },
        view: nodeSelectionRestoreGuard((state) => {
          const hit = selectedBox(state)
          if (hit) lowered = state.doc.resolve(hit.pos).depth + 1
          return hit !== null
        }),
        appendTransaction(trs, _old, state) {
          if (lowered === null) return null
          const remote = trs.some((tr) => (tr.getMeta(ySyncPluginKey) as { isChangeOrigin?: boolean } | undefined)?.isChangeOrigin)
          const depth = lowered
          lowered = null
          return remote ? reselectBox(state, depth) : null
        },
      }),
    ]
  },
})
