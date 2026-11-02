// 노트 블록 밖으로 나가기(WP-1288) — HTML 블록·모양 영역(wikiHtmlBox)이 노트 끝에 있어도 다음 줄로 나가 바로 쓸 수 있게 하는 편집기 동작.
//
// 노트 끝에 빈 문단을 늘 붙여 두지 않는다 — 문서를 여는 모든 접속자가 저마다 붙이면 동시 편집에서 빈 줄이 겹쳐 늘어난다(Yjs 는 같은 자리
// 삽입을 둘 다 살린다). 대신 사람이 나가려 할 때(Enter·↓·아래 빈자리 클릭) 그 사람 화면에서 한 줄을 만든다.
import { WIKI_HTML_BOX } from '@smart-workplace/wiki-editor-schema'
import { Extension } from '@tiptap/core'
import type { Node as PMNode, ResolvedPos } from '@tiptap/pm/model'
import { type EditorState, NodeSelection, Plugin, PluginKey, Selection, TextSelection, type Transaction } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'

/** 편집기 dispatch — 명령이 받는 모양(없으면 「할 수 있는지」만 본다). */
type Dispatch = ((tr: Transaction) => void) | undefined

/** 통째 선택된 블록과 그 앞 위치. */
export type SelectedBlock = { pos: number; node: PMNode }

/**
 * 코드 글자를 담는 블록인지(spec.code — 코드 블록·HTML 블록 소스) — 그 안 글자는 코드라 그대로 다룬다. 이어 쓸 줄 판정·HTML 들여오기 자리·
 * 앱 링크 칩·슬래시(/)·멘션(@) 메뉴가 함께 쓴다(WP-1300 — 소스의 `</p>` 로 슬래시 메뉴가 떠 Esc·Enter 를 가로챘다).
 */
export function isCodeText(node: PMNode | null | undefined): boolean {
  return !!node?.type.spec.code
}

/**
 * 글을 이어 쓸 줄인지 — 글자 블록(문단·제목)이되 코드 블록·HTML 블록(code)은 뺀다. HTML 블록도 내용이 글자(text*)라 글자 블록이지만
 * 닫혀 있으면 소스가 숨어 있고, 코드 블록은 Enter 가 줄바꿈이라 「다음 줄」로 쓸 수 없다.
 */
export function isWritableLine(node: PMNode | null | undefined): boolean {
  return !!node?.isTextblock && !isCodeText(node)
}

/** 모양 영역(상자, wikiHtmlBox)인지 — 상자(WP-1303)·영역 나가기(WP-1288)가 함께 쓴다. */
export const isBox = (node: PMNode | null | undefined): node is PMNode => node?.type.name === WIKI_HTML_BOX

/** 선택이 pred 를 만족하는 노드를 통째 고른 것(노드 선택)이면 그 노드와 위치 — 아니면 null. HTML 블록·상자의 「통째 선택」 판정이 쓴다. */
export function selectedNode(state: EditorState, pred: (node: PMNode) => boolean): SelectedBlock | null {
  const sel = state.selection
  return sel instanceof NodeSelection && pred(sel.node) ? { pos: sel.from, node: sel.node } : null
}

/**
 * $pos 를 감싼 가장 안쪽 상자의 깊이 — fromDepth(기본 $pos.depth)부터 바깥(깊이 1)으로 올라가며 찾는다. 없으면 null.
 * 더 바깥 상자는 찾은 깊이 - 1 부터 다시 부르면 된다.
 */
export function boxAncestor($pos: ResolvedPos, fromDepth = $pos.depth): number | null {
  for (let d = fromDepth; d > 0; d--) if (isBox($pos.node(d))) return d
  return null
}

/** 글자를 넣는 키인지 — 글자 하나·IME 조합 시작(Process/229). 단축키(Ctrl·Cmd·Alt 조합)는 뺀다. 통째 선택 글자 키 보호(typingGuardProps)가 쓴다. */
export function isTypingKey(event: KeyboardEvent): boolean {
  if (event.ctrlKey || event.metaKey || event.altKey) return false
  return event.key.length === 1 || event.key === 'Process' || event.keyCode === 229
}

/** pos 블록(크기 size)의 뒤(dir 1)·앞(dir -1) 경계와 그 너머 바로 옆 노드(없으면 null — 문서·영역 끝). */
export function neighborAt(doc: PMNode, pos: number, size: number, dir: 1 | -1): { edge: number; $edge: ResolvedPos; node: PMNode | null } {
  const edge = dir > 0 ? pos + size : pos
  const $edge = doc.resolve(edge)
  return { edge, $edge, node: (dir > 0 ? $edge.nodeAfter : $edge.nodeBefore) ?? null }
}

/**
 * tr 문서에서 pos 블록(크기 size) 바로 뒤(dir 1)·앞(dir -1) 줄로 커서를 옮긴다 — 바로 옆이 글을 쓸 줄(문단·제목)이면 그 처음·끝으로,
 * 아니면(문서·영역 끝, 다른 블록·코드·HTML 블록) 빈 문단을 만들어 넣는다. 문단 종류가 스키마에 있는지는 부르는 쪽(moveBesideBlock)이 본다.
 */
function placeBeside(tr: Transaction, pos: number, size: number, dir: 1 | -1): void {
  const { edge, node } = neighborAt(tr.doc, pos, size, dir)
  // 뒤 줄은 처음, 앞 줄은 끝으로 — 화살표로 넘어갈 때와 같은 자리.
  if (isWritableLine(node)) tr.setSelection(TextSelection.create(tr.doc, dir > 0 ? edge + 1 : edge - 1))
  else insertLineAt(tr, edge)
}

/** tr 문서의 at 자리에 빈 문단을 넣고 커서를 그 안에 둔다. 문단 종류가 스키마에 있는지는 부르는 쪽이 본다(상자 「줄 추가」도 쓴다). */
export function insertLineAt(tr: Transaction, at: number): void {
  tr.insert(at, tr.doc.type.schema.nodes.paragraph!.create())
  tr.setSelection(TextSelection.create(tr.doc, at + 1))
}

/**
 * 블록 옆 줄로 나가는 명령 — 닫힌 HTML 블록(노드 선택)의 Enter, 옆이 비었을 때의 화살표, 노트 아래 빈자리 클릭이 함께 쓴다.
 * 끝 빈 줄을 늘 두지 않고 이렇게 그때 만든다(파일 머리 주석).
 */
export function moveBesideBlock(state: EditorState, dispatch: ((tr: Transaction) => void) | undefined, pos: number, size: number, dir: 1 | -1): boolean {
  if (!state.schema.nodes.paragraph) return false
  if (!dispatch) return true
  const tr = state.tr
  placeBeside(tr, pos, size, dir)
  dispatch(tr.scrollIntoView())
  return true
}

/**
 * 블록 옆으로 화살표(↓ dir 1·↑ dir -1) — 옆이 글을 쓸 줄이면 그리로, 다른 블록(HTML 블록·표·모양 영역 등)이면 그 안 가장 가까운 자리로 간다
 * (닫힌 HTML 블록 안이면 선택 다듬기가 통째 선택으로 바꾼다). 옆에 아무것도 없을 때(문서·영역 끝)만 새 줄을 만든다 —
 * 화살표로 블록 사이를 오가기만 해도 빈 줄이 생겨 동료 문서까지 늘어나지 않게.
 */
export function arrowBesideBlock(state: EditorState, dispatch: ((tr: Transaction) => void) | undefined, pos: number, size: number, dir: 1 | -1): boolean {
  const { $edge, node } = neighborAt(state.doc, pos, size, dir)
  const into = node && !isWritableLine(node) ? Selection.findFrom($edge, dir, true) : null
  if (!into) return moveBesideBlock(state, dispatch, pos, size, dir)
  dispatch?.(state.tr.setSelection(into).scrollIntoView())
  return true
}

/**
 * 통째 선택된 블록에서 한 단계 바깥 옆 글 줄로 나간다(Esc — WP-1300 HTML 블록, WP-1303 상자가 함께 쓴다).
 * 뒤 글 줄 처음, 없으면 앞 글 줄 끝으로 간다. 옆에 글 줄이 없으면(노트 끝 등) Enter 처럼 뒤에 새 줄을 만들어 나간다.
 */
export function leaveBlock(state: EditorState, dispatch: ((tr: Transaction) => void) | undefined, pos: number, size: number): boolean {
  for (const dir of [1, -1] as const) {
    const { edge, node } = neighborAt(state.doc, pos, size, dir)
    if (!isWritableLine(node)) continue
    dispatch?.(state.tr.setSelection(TextSelection.create(state.doc, dir > 0 ? edge + 1 : edge - 1)).scrollIntoView())
    return true
  }
  return moveBesideBlock(state, dispatch, pos, size, 1)
}

/**
 * 통째 선택된 블록(select 가 고른 것)에서 옆으로 — move 가 moveBesideBlock 이면 Enter(다음 줄, 없으면 만든다),
 * arrowBesideBlock 이면 화살표(옆 블록, 끝이면 새 줄). 그 블록이 선택돼 있지 않으면 false(다른 키 동작에 넘긴다).
 * HTML 블록(WP-1288)·상자(WP-1303)의 Enter·↓·↑ 가 함께 쓴다.
 */
export function leaveSelected(
  state: EditorState,
  dispatch: Dispatch,
  select: (state: EditorState) => SelectedBlock | null,
  dir: 1 | -1,
  move: typeof moveBesideBlock = moveBesideBlock,
): boolean {
  const hit = select(state)
  return !!hit && move(state, dispatch, hit.pos, hit.node.nodeSize, dir)
}

/**
 * 통째 선택된 블록 글자 키 보호(플러그인 props 로 펼친다) — 통째 선택된 블록에 글자를 치면 블록이 그 글자로 바뀌어 사라진다.
 * 글자 키·IME 조합 시작 키는 블록 다음 줄로 옮기기만 하고 false — 키의 기본 동작(글자·조합)이 옮긴 자리에서 이어진다
 * (조합 입력은 handleTextInput 을 거치지 않아 키 단계에서 옮긴다). 그래도 글자가 오면 버린다. 지우기는 Backspace·Delete 로 그대로 된다.
 * HTML 블록(WP-1288)·상자(WP-1303)가 select 로 「어느 블록이 선택됐는지」를 넘겨 함께 쓴다.
 */
export function typingGuardProps(select: (state: EditorState) => SelectedBlock | null): {
  handleKeyDown: (view: EditorView, event: KeyboardEvent) => boolean
  handleTextInput: (view: EditorView) => boolean
} {
  return {
    handleKeyDown(view, event) {
      const hit = isTypingKey(event) ? select(view.state) : null
      if (hit) moveBesideBlock(view.state, view.dispatch, hit.pos, hit.node.nodeSize, 1)
      return false
    },
    handleTextInput(view) {
      return select(view.state) !== null
    },
  }
}

/**
 * pos 의 블록(pred 를 만족할 때)을 지운다 — 통째 선택 후 deleteSelection 이라 Delete 키와 같다(문서에 블록이 이것뿐이면 빈 문단이 남는다).
 * 그 자리에 맞는 블록이 없으면(동료가 지움) false. HTML 블록·상자의 「삭제」 단추가 함께 쓴다.
 */
export function deleteBlockAt(state: EditorState, dispatch: Dispatch, pos: number, pred: (node: PMNode | null) => boolean): boolean {
  if (!pred(state.doc.nodeAt(pos))) return false
  dispatch?.(state.tr.setSelection(NodeSelection.create(state.doc, pos)).deleteSelection().scrollIntoView())
  return true
}

/**
 * 커서 줄이 모양 영역의 마지막 직계 문단일 때 그 영역의 깊이 — 아니면 null. Enter 로 나가기가 쓴다.
 * 영역 안 목록·인용 속 문단은 그 목록·인용의 Enter 동작을 따르게 직계 문단만 본다.
 */
function boxOfLastParagraph($from: ResolvedPos): number | null {
  const d = $from.depth - 1
  if (d < 0 || $from.parent.type.name !== 'paragraph') return null
  const box = $from.node(d)
  return isBox(box) && $from.index(d) === box.childCount - 1 ? d : null
}

/**
 * 모양 영역 맨 끝 빈 문단에서 Enter — 그 빈 문단을 빼고 영역 밖 다음 줄로 나간다(목록·인용의 빈 줄 Enter 와 같은 감각).
 * 영역에 그 빈 문단 하나뿐이면 빼지 않는다(영역은 블록이 하나 이상 있어야 한다) — 그대로 두고 밖으로만 나간다.
 */
export function exitBoxOnEnter(state: EditorState, dispatch?: (tr: Transaction) => void): boolean {
  const { $from, empty } = state.selection
  if (!empty || $from.parent.content.size > 0) return false
  const d = boxOfLastParagraph($from)
  if (d === null) return false
  const box = $from.node(d)
  if (box.childCount === 1) return moveBesideBlock(state, dispatch, $from.before(d), box.nodeSize, 1)
  if (!dispatch) return true
  // 빈 문단을 빼고 나간다 — 빼는 것과 나가는 것을 한 거래로(실행 취소 한 번에 함께 되돌아간다).
  const tr = state.tr.delete($from.before(), $from.after())
  placeBeside(tr, $from.before(d), box.nodeSize - $from.parent.nodeSize, 1)
  dispatch(tr.scrollIntoView())
  return true
}

/**
 * 모양 영역 마지막 줄 끝에서 ↓ — 영역 뒤에 갈 곳이 없으면(노트·바깥 영역의 끝) 영역 밖에 새 줄을 만들어 나간다.
 * 뒤에 갈 곳이 있으면 false — 브라우저 기본 ↓ 가 그리로 간다. 중첩 영역은 안쪽부터 한 겹씩 나간다(↓ 를 더 누르면 바깥으로).
 * atBottom: 커서가 그 줄의 마지막 화면 줄에 있는지(view.endOfTextblock('down')) — 줄바꿈된 긴 줄 중간에서는 나가지 않는다.
 */
export function exitBoxOnArrowDown(state: EditorState, dispatch: ((tr: Transaction) => void) | undefined, atBottom: boolean): boolean {
  const { $from, empty } = state.selection
  if (!empty || !atBottom || !$from.parent.isTextblock || $from.parentOffset !== $from.parent.content.size) return false
  // 커서 줄을 감싼 가장 안쪽 모양 영역 — 그 영역부터 커서 줄까지 「마지막 자식」 사슬이 이어져야 영역 끝 줄이다.
  const d = boxAncestor($from, $from.depth - 1)
  if (d === null) return false
  for (let k = d; k < $from.depth; k++) if ($from.index(k) !== $from.node(k).childCount - 1) return false
  const boxPos = $from.before(d)
  const boxEnd = boxPos + $from.node(d).nodeSize
  if (Selection.findFrom(state.doc.resolve(boxEnd), 1, true)) return false
  return moveBesideBlock(state, dispatch, boxPos, $from.node(d).nodeSize, 1)
}

/**
 * 노트 아래 빈자리 클릭 — 마지막 블록이 글을 쓸 줄이 아니면(HTML 블록·모양 영역·표·코드 블록 등) 그 뒤에 새 줄을 만들어 커서를 둔다.
 * 마지막이 문단·제목이면 브라우저가 그 줄에 커서를 두므로 손대지 않는다. 클릭이 본문 루트 자체(블록 밖 여백)에 떨어졌을 때만 본다.
 */
export function clickBelowLastBlock(view: EditorView, event: MouseEvent): boolean {
  if (!view.editable || event.button !== 0 || event.target !== view.dom) return false
  const last = view.state.doc.lastChild
  if (!last || isWritableLine(last)) return false
  const lastPos = view.state.doc.content.size - last.nodeSize
  const dom = view.nodeDOM(lastPos)
  if (!(dom instanceof HTMLElement) || event.clientY <= dom.getBoundingClientRect().bottom) return false
  event.preventDefault()
  moveBesideBlock(view.state, view.dispatch, lastPos, last.nodeSize, 1)
  view.focus()
  return true
}

/**
 * 노트 편집기 확장 — 위 동작을 키·클릭에 붙인다(편집기 전용, 보기 전용 화면에는 넣지 않는다).
 * 단축키는 확장 목록에서 HTML 블록·기본 키맵보다 먼저 돌고, 조건이 맞지 않으면 false 로 넘겨 기본 동작(문단 나누기·화살표)을 그대로 둔다.
 */
export const WikiBlockExit = Extension.create({
  name: 'wikiBlockExit',

  addKeyboardShortcuts() {
    return {
      Enter: () => exitBoxOnEnter(this.editor.state, this.editor.view.dispatch),
      ArrowDown: () => {
        const { view } = this.editor
        return exitBoxOnArrowDown(view.state, view.dispatch, view.endOfTextblock('down'))
      },
    }
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('wikiBlockExit'),
        props: {
          handleDOMEvents: { mousedown: clickBelowLastBlock },
          // 노트가 글을 쓸 줄이 아닌 블록으로 끝나면 표시한다 — CSS 가 그 아래에 누를 빈자리를 둔다(판정은 클릭과 같은 isWritableLine).
          attributes: (state): Record<string, string> => (isWritableLine(state.doc.lastChild) ? {} : { 'data-ends-with-block': '' }),
        },
      }),
    ]
  },
})
