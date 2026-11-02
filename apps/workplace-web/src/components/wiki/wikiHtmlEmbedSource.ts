// 노트 HTML 블록 소스 칸 열림 상태(WP-1288) — 블록 화면(WikiHtmlEmbedView)과 노드 확장(wikiHtmlEmbedNode)이 함께 읽는 편집기 플러그인.
import { WikiHtmlEmbedSchema } from '@smart-workplace/wiki-editor-schema'
import type { Node as PMNode } from '@tiptap/pm/model'
import { type EditorState, NodeSelection, Plugin, PluginKey, type Transaction } from '@tiptap/pm/state'
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view'
import { ySyncPluginKey } from 'y-prosemirror'
import type * as Y from 'yjs'

import { moveBesideBlock } from './wikiBlockExit'
import { resolveRelative, toRelative, ySyncOf,type YSyncState } from './wikiCollabPosition'

/**
 * 「소스 칸을 연 블록」 표시를 쥐는 플러그인(WP-1288) — 열림은 사람마다 다른 화면 상태라 문서(attrs)가 아니라 이 편집기 플러그인 상태에 둔다.
 * 블록마다 빈 노드 데코레이션 하나(spec 표지)로 남겨 내 편집에는 위치가 저절로 따라가고 블록이 지워지면 함께 사라진다.
 * 블록 화면(NodeView)은 받은 decorations 로 열림을 읽고, 선택 다듬기(아래 appendTransaction)도 같은 상태를 본다 — 둘이 어긋나지 않게 한곳에 둔다.
 */
export const htmlEmbedSourceKey = new PluginKey<DecorationSet>('wikiHtmlEmbedSource')

/** 열림 표지 — 노드 데코레이션 spec 에 붙인다. */
const OPEN_SPEC = 'wikiHtmlEmbedSourceOpen'

/** 열림 데코레이션 spec — rel 은 블록 앞 위치의 Yjs 상대 위치(동기화가 없으면 null). */
type OpenSpec = { [OPEN_SPEC]: true; rel: Y.RelativePosition | null }

/** 블록 열기·닫기 메타 — pos 는 블록 앞 위치. */
type SourceMeta = { pos: number; open: boolean }

/** 거래에 「pos 블록의 소스 칸을 열기/닫기」를 싣는다(삽입 명령·소스 편집 단추). */
export function setHtmlEmbedSourceOpen(tr: Transaction, pos: number, open: boolean): Transaction {
  return tr.setMeta(htmlEmbedSourceKey, { pos, open } satisfies SourceMeta)
}

/** 노드 데코레이션 목록에 열림 표지가 있는지 — 블록 화면이 받은 decorations 로 판정한다. */
export function hasHtmlEmbedOpenMark(decorations: readonly Decoration[]): boolean {
  return decorations.some((d) => isOpenSpec(d.spec as Record<string, unknown>))
}

function isOpenSpec(spec: Record<string, unknown>): boolean {
  return spec[OPEN_SPEC] === true
}
const isEmbed = (node: PMNode | null | undefined) => node?.type.name === WikiHtmlEmbedSchema.name

/** pos 의 HTML 블록이 이 편집기에서 소스 칸을 연 채인지. */
export function isHtmlEmbedSourceOpen(state: EditorState, pos: number): boolean {
  const set = htmlEmbedSourceKey.getState(state)
  return !!set && set.find(pos, pos + 1, isOpenSpec).some((d) => d.from === pos)
}

/** 선택이 감싼 HTML 블록(노드 선택) — 아니면 null. 키 동작이 쓴다. */
export function selectedEmbed(state: EditorState): { pos: number; node: PMNode } | null {
  const sel = state.selection
  return sel instanceof NodeSelection && isEmbed(sel.node) ? { pos: sel.from, node: sel.node } : null
}

/** pos 블록 열림 데코레이션 — 지금 상태에서 블록 앞 위치를 Yjs 상대 위치로 함께 적어 둔다(동기화 반영 뒤 되찾기용). */
function openDecoration(state: EditorState, pos: number, node: PMNode): Decoration {
  return Decoration.node(pos, pos + node.nodeSize, {}, { [OPEN_SPEC]: true, rel: toRelative(state, pos) } satisfies OpenSpec)
}

/**
 * 동기화 반영 뒤 열림 되찾기 — y-prosemirror 는 남의 변경·내 실행 취소를 문서 통째 바꾸기(replace(0, 끝))로 반영해, 위치 매핑으로는
 * 모든 열림이 사라진다(소스를 고치던 중 동료가 아무 데나 한 글자 쳐도 칸이 닫혔다). 열 때 적어 둔 Yjs 상대 위치로 블록을 다시 찾는다.
 * 상대 위치를 풀 수 없거나 그 자리에 HTML 블록이 없으면(블록이 지워짐) 버린다.
 */
function restoreAfterSync(prev: DecorationSet, oldState: EditorState, newState: EditorState): DecorationSet {
  if (prev === DecorationSet.empty) return prev
  const found: Decoration[] = []
  for (const d of prev.find(undefined, undefined, isOpenSpec)) {
    const spec = d.spec as OpenSpec
    const pos = spec.rel ? resolveRelative(oldState, spec.rel) : null
    const node = pos == null ? null : newState.doc.nodeAt(pos)
    // spec 은 그대로 다시 쓴다 — 같은 객체여야 NodeView 가 「바뀐 데코레이션」으로 보고 다시 그리지 않는다(동료 타자마다 렌더하지 않게).
    if (pos != null && node && isEmbed(node)) found.push(Decoration.node(pos, pos + node.nodeSize, {}, spec))
  }
  return DecorationSet.create(newState.doc, found)
}

/** pos 의 블록을 통째 선택한다 — 닫힌 블록의 머리 띠·여백·미리보기를 눌렀을 때. focus 면 편집기에 포커스도 준다(키가 편집기로 오게). */
export function selectHtmlEmbed(view: EditorView, pos: number, focus = true): void {
  view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos)))
  if (focus) view.focus()
}

/**
 * 동료가 지운 블록을 내가 통째 선택하고 있어도 동기화가 멈추지 않게 한다.
 * y-prosemirror(1.3.7, 최신)는 원격 반영 뒤 노드 선택을 NodeSelection.create(그 자리)로 되살리는데, 선택했던 블록이 지워져 그 자리에 노드가
 * 없으면(문서 끝) 예외가 나 그 반영이 화면에 들어오지 않는다. 닫힌 HTML 블록은 이제 늘 통째 선택되므로(WP-1288), 그 블록이 선택된 채
 * Yjs 거래가 시작되면 바인딩이 적어 둔 선택 종류를 글자 선택으로 낮춘다 — 그러면 TextSelection.between 으로 가까운 자리를 찾고,
 * 블록이 남아 있으면 선택 다듬기(appendTransaction)가 다시 통째 선택으로 바꾼다. 바인딩의 듣기보다 뒤에 붙어야 해서 첫 갱신 때 붙인다.
 */
function guardNodeSelectionRestore(view: EditorView): { update(): void; destroy(): void } {
  let attached: { doc: Y.Doc; binding: NonNullable<YSyncState['binding']> } | null = null
  const lower = () => {
    const binding = attached?.binding
    const rel = binding?.beforeTransactionSelection
    if (binding && rel?.type === 'node' && selectedEmbed(view.state)) binding.beforeTransactionSelection = { ...rel, type: 'text' }
  }
  return {
    update() {
      const sync = attached ? null : ySyncOf(view.state)
      if (!sync?.binding) return
      attached = { doc: sync.doc, binding: sync.binding }
      sync.doc.on('beforeAllTransactions', lower)
    },
    destroy() {
      attached?.doc.off('beforeAllTransactions', lower)
    },
  }
}

/** 글자를 넣는 키인지 — 글자 하나·IME 조합 시작(Process/229). 단축키(Ctrl·Cmd·Alt 조합)는 뺀다. */
function isTypingKey(event: KeyboardEvent): boolean {
  if (event.ctrlKey || event.metaKey || event.altKey) return false
  return event.key.length === 1 || event.key === 'Process' || event.keyCode === 229
}

/**
 * 소스 칸 열림 상태 + 닫힌 블록 선택 다듬기 플러그인(WP-1288).
 * - 닫힌 블록의 소스 글자는 display:none 이라, 그 안에 글자 선택(커서)이 생기면 보이지 않는 곳에 커서가 숨고 Enter 가 숨은 소스에 줄바꿈을 넣었다.
 *   그래서 닫힌 블록 안 글자 선택은 블록 통째 선택(NodeSelection — 선택 테두리)으로 바꾼다. 클릭·화살표·동료 편집 매핑·소스 칸 닫기 모두 이 한곳에서 잡는다.
 * - 편집할 수 없는 화면(판 미리보기·공개 공유)은 선택을 건드리지 않는다.
 * - 통째 선택된 블록에 글자를 치면 블록이 그 글자로 바뀌어 사라진다 — 글자 키·IME 조합 시작 키는 블록 다음 줄로 옮긴 뒤 그 줄에 들어가게 한다
 *   (조합 입력은 handleTextInput 을 거치지 않아 키 단계에서 옮긴다). 그래도 글자가 오면 버린다. 지우기는 Backspace·Delete 로 그대로 된다.
 */
export function htmlEmbedSourcePlugin(isEditable: () => boolean): Plugin<DecorationSet> {
  return new Plugin<DecorationSet>({
    key: htmlEmbedSourceKey,
    state: {
      init: () => DecorationSet.empty,
      apply(tr, set, oldState, newState) {
        // 원격 반영(isRemoteSync)만이 아니라 내 실행 취소·다시 실행도 y-prosemirror 가 문서 통째 바꾸기로 반영하므로 isChangeOrigin 전체를 본다.
        const sync = tr.getMeta(ySyncPluginKey) as { isChangeOrigin?: boolean } | undefined
        let next = sync?.isChangeOrigin ? restoreAfterSync(set, oldState, newState) : set.map(tr.mapping, tr.doc)
        // 블록이 문단으로 바뀌어도(빈 블록 Backspace) 노드 데코레이션은 남는다 — HTML 블록이 아닌 자리의 열림은 버린다.
        if (tr.docChanged && next !== DecorationSet.empty) {
          const stale = next.find(undefined, undefined, isOpenSpec).filter((d) => !isEmbed(tr.doc.nodeAt(d.from)))
          if (stale.length) next = next.remove(stale)
        }
        const meta = tr.getMeta(htmlEmbedSourceKey) as SourceMeta | undefined
        if (!meta) return next
        next = next.remove(next.find(meta.pos, meta.pos + 1, isOpenSpec).filter((d) => d.from === meta.pos))
        const node = tr.doc.nodeAt(meta.pos)
        if (meta.open && node && isEmbed(node)) next = next.add(tr.doc, [openDecoration(newState, meta.pos, node)])
        return next
      },
    },
    props: {
      decorations(state) {
        return htmlEmbedSourceKey.getState(state)
      },
      handleKeyDown(view, event) {
        const hit = isTypingKey(event) ? selectedEmbed(view.state) : null
        // 다음 줄로 옮기기만 하고 false — 키의 기본 동작(글자·조합)이 옮긴 자리에서 이어진다.
        if (hit) moveBesideBlock(view.state, view.dispatch, hit.pos, hit.node.nodeSize, 1)
        return false
      },
      handleTextInput(view) {
        return selectedEmbed(view.state) !== null
      },
      // 닫힌 블록의 머리 띠·여백을 누르면 통째 선택 — 편집할 수 없는 요소(contentEditable=false)라 브라우저가 커서를 옮기지 않는다.
      handleClickOn(view, _pos, node, nodePos) {
        if (!view.editable || !isEmbed(node) || isHtmlEmbedSourceOpen(view.state, nodePos)) return false
        selectHtmlEmbed(view, nodePos)
        return true
      },
    },
    view: guardNodeSelectionRestore,
    appendTransaction(trs, _old, state) {
      if (!isEditable() || !trs.some((tr) => tr.selectionSet || tr.docChanged || tr.getMeta(htmlEmbedSourceKey))) return null
      const { $from, $to } = state.selection
      if (state.selection instanceof NodeSelection || !isEmbed($from.parent)) return null
      const at = $from.before()
      // 블록 밖까지 걸친 선택(여러 블록 드래그)은 그대로 — 블록 안에서 시작·끝나는 선택만 바꾼다.
      if ($to.parent !== $from.parent || $to.before() !== at || isHtmlEmbedSourceOpen(state, at)) return null
      return state.tr.setSelection(NodeSelection.create(state.doc, at))
    },
  })
}
