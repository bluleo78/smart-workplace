// 노트 링크 넣기·고치기·해제·열기 상태와 명령(WP-312). 데스크톱은 버블+팝오버, 터치 셸은 바텀시트 — 상태와 문서 명령은 여기 한곳.
//
// 동시 편집: 주소를 치는 동안 다른 사람이 글을 넣거나 지울 수 있어 범위를 Yjs 상대 위치(anchorRange)로 붙잡고 적용할 때 다시 푼다.
// 문서 변경은 에디터 명령(setLink·unsetLink·insertContentAt)만 써서 동기화·내 실행 취소에 그대로 들어간다.
import { type Editor, getMarkRange, posToDOMRect } from '@tiptap/core'
import { type EditorState, NodeSelection, Selection } from '@tiptap/pm/state'
import { type RefObject, useCallback, useRef, useState } from 'react'
import { toast } from 'sonner'

import { clampPos, resolveRelative, toRelative, toRelativeEnd } from './wikiCollabPosition'
import { linkAtCaret } from './wikiLinkRange'
import { normalizeLinkInput } from './wikiLinkUrl'

type Range = { from: number; to: number }

/** 붙잡은 범위 — 지금 문서에서 다시 푼 범위. 가리키던 Yjs 노드가 사라져 풀 수 없으면 null. */
interface AnchoredRange {
  resolve: (ed: Editor) => Range | null
}

const GONE_MESSAGE = '링크를 걸 글자가 다른 사람의 편집으로 지워졌어요'

/**
 * 범위를 Yjs 상대 위치로 붙잡는다. 끝은 마지막 글자에 왼쪽 결합(toRelativeEnd) — 선택 바로 뒤에 남이 친 글자가 끌려 들어오지 않게.
 * 풀 수 없으면 null(예전 숫자 위치로 돌아가면 엉뚱한 글자에 링크가 걸린다). 바인딩이 없으면 숫자 위치를 잘라 쓴다.
 * 결과는 에디터 상태별로 기억한다 — 팝오버가 매 프레임 위치를 물어도 Yjs 풀기는 상태가 바뀔 때만.
 */
function anchorRange(ed: Editor, from: number, to: number): AnchoredRange {
  const relFrom = toRelative(ed.state, from)
  const relEnd = to > from ? toRelativeEnd(ed.state, to) : relFrom
  const cache = new WeakMap<EditorState, Range | null>()
  const compute = (state: EditorState): Range | null => {
    if (relFrom == null || relEnd == null) {
      const f = clampPos(from, state.doc)
      return { from: f, to: Math.max(f, clampPos(to, state.doc)) }
    }
    const f = resolveRelative(state, relFrom)
    const e = resolveRelative(state, relEnd)
    if (f == null || e == null) return null
    const cf = clampPos(f, state.doc)
    return { from: cf, to: Math.max(cf, clampPos(e, state.doc)) }
  }
  return {
    resolve: (cur) => {
      const { state } = cur
      if (!cache.has(state)) cache.set(state, compute(state))
      return cache.get(state) ?? null
    },
  }
}

/** 주소 입력 대상 — insert 는 빈 커서에서 연 넣기(친 주소를 글자로 넣음), link 는 글자·기존 링크에 주소를 건다. */
export interface WikiLinkInputTarget extends AnchoredRange {
  mode: 'insert' | 'link'
  /** 고칠 때의 현재 주소(입력칸을 채움). 새로 넣으면 ''. */
  initialHref: string
  /** 열 때마다 바뀌는 번호 — 입력 폼을 새로 시작하는 key. */
  seq: number
}

/** 터치 셸에서 누른 링크(시트 대상). */
export interface WikiLinkSheetTarget extends AnchoredRange {
  href: string
}

/** 현재 선택의 대상 — 커서가 정말로 링크 안이면 그 링크 전체(경계 제외, linkAtCaret), 아니면 선택 범위. */
function currentLinkRange(ed: Editor): Range & { href: string } {
  const inLink = linkAtCaret(ed.state)
  if (inLink) return inLink
  const { from, empty } = ed.state.selection
  let { to } = ed.state.selection
  // 다음 블록 맨 앞에서 끝나는 선택(문단 끝까지 끌어 고름)은 앞 블록 글자 끝으로 당긴다 — 빈 꼬리는 링크할 글자가 없다.
  const $to = ed.state.doc.resolve(to)
  if (!empty && $to.parentOffset === 0 && $to.depth > 0) {
    const prev = Selection.findFrom(ed.state.doc.resolve($to.before()), -1, true)
    if (prev && prev.from > from) to = prev.from
  }
  const href = empty ? '' : ((ed.getAttributes('link').href as string | undefined) ?? '')
  return { from, to, href }
}

/** 살아 있고 편집 가능한 에디터만. */
function editableEditor(ref: RefObject<Editor | null>): Editor | null {
  const ed = ref.current
  return ed && !ed.isDestroyed && ed.isEditable ? ed : null
}

export function useWikiLinkUi(editorRef: RefObject<Editor | null>) {
  const [input, setInput] = useState<WikiLinkInputTarget | null>(null)
  const [sheet, setSheet] = useState<WikiLinkSheetTarget | null>(null)
  const seqRef = useRef(0)

  /** 주소 입력을 연다(범위 생략 시 현재 선택). 열었으면 true — false 면 ⌘K 를 전역 AI 토글에 넘긴다. */
  const openInput = useCallback(
    (target?: Range & { href: string }): boolean => {
      const ed = editableEditor(editorRef)
      if (!ed) return false
      // 노드(이미지 등) 선택에는 링크를 걸 글자가 없다.
      if (!target && ed.state.selection instanceof NodeSelection) return false
      const r = target ?? currentLinkRange(ed)
      seqRef.current += 1
      setInput({
        ...anchorRange(ed, r.from, r.to),
        // 빈 커서에서 연 것만 글자를 넣는다 — 범위를 받아 연 경우(시트의 고치기)는 걸기.
        mode: !target && r.from === r.to ? 'insert' : 'link',
        initialHref: r.href,
        seq: seqRef.current,
      })
      return true
    },
    [editorRef],
  )

  /** 주소 입력을 닫는다. refocus 면 에디터로 포커스를 돌린다(바깥 클릭으로 닫힐 땐 그 클릭이 커서를 정한다). */
  const closeInput = useCallback(
    (refocus: boolean) => {
      setInput(null)
      const ed = editorRef.current
      if (refocus && ed && !ed.isDestroyed) ed.commands.focus()
    },
    [editorRef],
  )

  /**
   * 입력한 주소를 적용한다 — 넣을 수 없는 주소면 false(입력은 열어 둔다), 그 밖엔 닫고 true.
   * 편집할 수 없게 됐으면(강등·가려짐) 문서를 그대로 두고, 대상이 지워졌으면 알린 뒤 아무것도 넣지 않는다.
   * 적용 뒤 커서는 링크 바로 뒤(링크 마크는 끝에서 이어지지 않아 이어 치는 글자는 링크가 아니다).
   */
  const applyInput = useCallback(
    (raw: string): boolean => {
      if (!input) return false
      const ed = editableEditor(editorRef)
      if (!ed) {
        setInput(null)
        return true
      }
      const href = normalizeLinkInput(raw)
      if (!href) return false
      const range = input.resolve(ed)
      setInput(null)
      if (!range || (input.mode === 'link' && range.from === range.to)) {
        toast.error(GONE_MESSAGE)
        ed.commands.focus()
        return true
      }
      const { from, to } = range
      if (input.mode === 'insert') {
        const text = raw.trim()
        ed.chain()
          .focus()
          .insertContentAt(from, { type: 'text', text, marks: [{ type: 'link', attrs: { href } }] })
          .setTextSelection(from + text.length)
          .run()
      } else {
        ed.chain().focus().setTextSelection({ from, to }).setLink({ href }).setTextSelection(to).run()
      }
      return true
    },
    [editorRef, input],
  )

  /** 커서가 든 링크 하나만 푼다(맞닿은 다른 주소의 링크는 그대로). 글자는 남긴다. */
  const unlink = useCallback(() => {
    const ed = editableEditor(editorRef)
    const r = ed && linkAtCaret(ed.state)
    if (!ed || !r) return
    ed.chain().focus().setTextSelection(r).unsetLink().setTextSelection(r.to).run()
  }, [editorRef])

  /** 터치 셸에서 누른 링크(<a>)로 시트를 연다 — 키보드가 시트를 가리지 않게 에디터 포커스를 뺀다. */
  const openSheetFromAnchor = useCallback(
    (anchor: Element) => {
      const ed = editorRef.current
      const linkType = ed?.state.schema.marks.link
      if (!ed || ed.isDestroyed || !linkType) return
      const href = anchor.getAttribute('href') ?? ''
      // 같은 주소의 링크만 — 맞닿은 다른 주소 링크까지 넓히지 않는다.
      const range = getMarkRange(ed.state.doc.resolve(ed.view.posAtDOM(anchor, 0)), linkType, { href })
      if (!range) return
      ed.commands.blur()
      setSheet({ href, ...anchorRange(ed, range.from, range.to) })
    },
    [editorRef],
  )

  /** 시트의 링크 고치기 — 지금 문서에서 다시 푼 범위로 주소 입력을 연다. */
  const editFromSheet = useCallback(() => {
    const ed = editorRef.current
    const r = sheet && ed && !ed.isDestroyed ? sheet.resolve(ed) : null
    setSheet(null)
    if (sheet && r) openInput({ ...r, href: sheet.href })
  }, [editorRef, sheet, openInput])

  /** 시트의 링크 해제 — 포커스를 주면 키보드가 올라오므로 주지 않는다. */
  const unlinkFromSheet = useCallback(() => {
    const ed = editableEditor(editorRef)
    const r = sheet && ed ? sheet.resolve(ed) : null
    setSheet(null)
    if (ed && r) ed.chain().setTextSelection(r).unsetLink().setTextSelection(r.to).run()
  }, [editorRef, sheet])

  /** 주소 입력 팝오버의 앵커 좌표(스크롤·원격 편집을 따라가도록 매번 잰다). */
  const inputRect = useCallback((): DOMRect => {
    const ed = editorRef.current
    const r = input && ed && !ed.isDestroyed ? input.resolve(ed) : null
    return ed && r ? posToDOMRect(ed.view, r.from, r.to) : new DOMRect()
  }, [editorRef, input])

  return {
    input,
    sheet,
    openInput,
    closeInput,
    applyInput,
    unlink,
    openSheetFromAnchor,
    closeSheet: useCallback(() => setSheet(null), []),
    editFromSheet,
    unlinkFromSheet,
    inputRect,
  }
}

export type WikiLinkUi = ReturnType<typeof useWikiLinkUi>
