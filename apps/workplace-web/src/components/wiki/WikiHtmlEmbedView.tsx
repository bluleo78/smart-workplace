// 노트 HTML 블록 NodeView(WP-1242) — 블록 소스를 격리 iframe 에서 원본처럼 실행해 보이고, 편집할 때만 소스 편집 칸을 연다.
import { NodeSelection, Selection } from '@tiptap/pm/state'
import { NodeViewContent, NodeViewWrapper, type ReactNodeViewProps } from '@tiptap/react'
import { Code2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { useDebounceValue } from '@/hooks/useDebounceValue'

import { SandboxedHtmlFrame } from '../SandboxedHtmlFrame'
import { HTML_EMBED_DEFAULT_HEIGHT, htmlEmbedDocument, watchEmbedHeight } from './wikiHtmlEmbedFrame'
import { pinVisible } from './wikiPinVisible'

/** 소스 칸을 연 채(이 화면에서 고치는 중) 미리보기를 다시 그리기까지 기다리는 시간(ms) — 글자마다 스크립트를 다시 돌리지 않게. */
export const PREVIEW_DEBOUNCE_MS = 500
/** 소스 칸이 닫힌 채(동료가 고친 글자가 들어옴) 기다리는 시간(ms) — 보는 사람의 차트가 동료 타자마다 깜빡이며 다시 돌지 않게 더 길게. */
export const REMOTE_PREVIEW_DEBOUNCE_MS = 2000

/**
 * 편집 가능 여부를 따라간다 — 편집기 setEditable 은 거래 없이 'update' 이벤트만 내므로 그때 다시 읽는다.
 * view.editable 을 본다: 첫 그리기 때 editor.isEditable 은 view 가 정해지기 전이라 거짓일 수 있다(wikiStyleNode 와 같은 이유).
 */
function useViewEditable({ editor, view }: Pick<ReactNodeViewProps, 'editor' | 'view'>): boolean {
  const [editable, setEditable] = useState(() => view.editable)
  useEffect(() => {
    const sync = () => setEditable(view.editable)
    sync()
    editor.on('update', sync)
    return () => {
      editor.off('update', sync)
    }
  }, [editor, view])
  return editable
}

/**
 * 커서(글자 선택)가 이 블록 글자 안에 있는지 — 노드 선택(블록 통째)은 글자 안이 아니다. 블록 크기는 지금 문서에서 읽는다(렌더 때 받은 노드는 낡을 수 있다).
 * 선택이 바뀔 때마다 모든 블록이 부르므로 싼 판정(위치)부터 하고 빠진다.
 */
function caretInsideEmbed(editor: ReactNodeViewProps['editor'], getPos: ReactNodeViewProps['getPos']): boolean {
  const pos = typeof getPos === 'function' ? getPos() : undefined
  if (typeof pos !== 'number') return false
  const { selection, doc } = editor.state
  if (selection.from <= pos) return false
  const embed = doc.nodeAt(pos)
  if (!embed || selection.from >= pos + embed.nodeSize) return false
  return !(selection instanceof NodeSelection) && selection.to <= pos + embed.nodeSize - 1
}

/** 머리 띠·이름표·소스 편집 단추 고정용 콜백 ref — 노트 CSS 가 숨기지 못하게 붙는 순간 인라인 !important 로 박는다(wikiPinVisible).
 * 모듈 함수라 정체가 바뀌지 않아 붙을 때 한 번만 돈다(띠는 편집할 수 있을 때만 그려져, 다시 그려지면 다시 박는다). */
const pinFlex = (el: HTMLElement | null) => {
  if (el) pinVisible(el, 'flex')
}
const pinInline = (el: HTMLElement | null) => {
  if (el) pinVisible(el, 'inline')
}
const pinInlineFlex = (el: HTMLElement | null) => {
  if (el) pinVisible(el, 'inline-flex')
}

/**
 * HTML 블록 화면.
 * - 미리보기: SandboxedHtmlFrame(allowScripts) — sandbox 에 allow-same-origin 이 없어 불투명 출처로 돈다(앱 쿠키·저장소·화면에 닿지 못함).
 *   CDN 스크립트 로드는 막지 않는다. 문서 끝에 높이 보고 스크립트를 붙이고, 이 iframe 이 보낸 메시지만 받아 범위로 잘라 높이를 맞춘다.
 * - 소스(노드 글자 = Yjs 텍스트)는 NodeViewContent(contentDOM)다 — 늘 DOM 에 두되(ProseMirror 가 글자 자리를 잃지 않게) 「소스 편집」을
 *   켰을 때만 보인다. 보기 전용 화면(판 미리보기·공개 공유)은 미리보기만.
 * - 소스 칸은 기본 닫힘(동료가 넣은 빈 블록 포함). 이 화면에서 슬래시로 막 넣은 블록만 연 채 시작한다(initialOpen — wikiHtmlEmbedNode 의
 *   한 번짜리 표시).
 * - 커서가 닫힌 소스 글자 안으로 들어오면(화살표·동료 편집 뒤 입력) 소스 칸을 연다 — 보이지 않는 곳에 글자가 들어가지 않게.
 *   커서가 안에 있을 때 닫으면 커서를 블록 뒤(없으면 앞) 글자 자리로 옮긴다(둘 다 없으면 편집기 포커스를 놓는다).
 * - 미리보기는 소스를 늦춰 따라간다 — 소스 칸을 연 채면 PREVIEW_DEBOUNCE_MS, 닫힌 채(동료 편집)면 REMOTE_PREVIEW_DEBOUNCE_MS.
 *   iframe 은 문서 글자가 바뀔 때만 새로 만든다(SandboxedHtmlFrame 이 문자열로 비교) — 기다리는 동안 고쳤다 되돌린 소스는 다시 그리지 않는다.
 * - 높이 보고는 모듈 하나짜리 message 듣기(watchEmbedHeight)에 이 iframe 창을 등록해 받는다.
 */
export function WikiHtmlEmbedView({
  node,
  editor,
  view,
  getPos,
  initialOpen = false,
}: ReactNodeViewProps & { /** 이 화면에서 막 넣은 블록이면 true — 소스 칸을 연 채 시작한다. */ initialOpen?: boolean }) {
  const source = node.textContent
  const editable = useViewEditable({ editor, view })
  const [sourceOpen, setSourceOpen] = useState(initialOpen)
  const showSource = editable && sourceOpen
  const previewSource = useDebounceValue(source, showSource ? PREVIEW_DEBOUNCE_MS : REMOTE_PREVIEW_DEBOUNCE_MS)
  const doc = useMemo(() => htmlEmbedDocument(previewSource), [previewSource])
  const [height, setHeight] = useState(HTML_EMBED_DEFAULT_HEIGHT)

  // 높이 보고 — iframe 이 붙으면 그 창을 등록하고 떨어지면(문서가 바뀌어 새 iframe·블록 사라짐) 해제한다(React 19 콜백 ref 정리 함수).
  const frameRef = useCallback((el: HTMLIFrameElement | null) => {
    const win = el?.contentWindow
    return win ? watchEmbedHeight(win, setHeight) : undefined
  }, [])

  // 닫힌 소스 글자 안으로 커서가 들어오거나 그 안에서 글자가 바뀌면 연다 — 보이지 않는 입력을 막는다(편집할 수 있을 때만).
  // 편집기에 포커스가 있을 때만 본다 — 닫으며 포커스를 놓은 뒤 동료 편집으로 커서 위치가 다시 매겨질 때 저절로 열리지 않게.
  useEffect(() => {
    if (!editable || sourceOpen) return
    const check = () => {
      if (view.hasFocus() && caretInsideEmbed(editor, getPos)) setSourceOpen(true)
    }
    check()
    editor.on('selectionUpdate', check)
    editor.on('update', check)
    return () => {
      editor.off('selectionUpdate', check)
      editor.off('update', check)
    }
  }, [editor, view, getPos, editable, sourceOpen])

  /** 소스 칸 열기·닫기 — 닫을 때 커서가 안에 있으면 블록 뒤(없으면 앞) 글자 자리로 옮기고, 없으면 포커스를 놓는다(닫자마자 다시 열리지 않게). */
  const toggleSource = () => {
    if (!sourceOpen) {
      setSourceOpen(true)
      return
    }
    if (caretInsideEmbed(editor, getPos)) {
      const pos = getPos()
      const { doc } = editor.state
      // 블록 뒤 글자 자리, 없으면 앞 글자 자리. 둘 다 없으면(블록뿐인 문서) 포커스를 바로 놓는다 — editor.commands.blur 는 다음 프레임에
      // 놓아서, 그 사이 「커서가 안에 있다」 검사가 칸을 다시 열었다(실제 브라우저 E2E 에서 확인).
      const target =
        typeof pos === 'number'
          ? (Selection.findFrom(doc.resolve(pos + node.nodeSize), 1, true) ?? Selection.findFrom(doc.resolve(pos), -1, true))
          : null
      if (target) editor.view.dispatch(editor.state.tr.setSelection(target))
      else {
        ;(editor.view.dom as HTMLElement).blur()
        window.getSelection()?.removeAllRanges()
      }
    }
    setSourceOpen(false)
  }

  return (
    <NodeViewWrapper className="wiki-html-embed" data-testid="wiki-html-embed" data-source-open={showSource ? '' : undefined}>
      {editable && (
        <div ref={pinFlex} className="wiki-html-embed__bar" contentEditable={false} data-testid="wiki-html-embed-bar">
          <Code2 className="wiki-html-embed__icon" aria-hidden />
          <span ref={pinInline} className="wiki-html-embed__label">HTML 블록</span>
          <button
            ref={pinInlineFlex}
            type="button"
            className="wiki-html-embed__toggle"
            aria-pressed={sourceOpen}
            data-testid="wiki-html-embed-toggle"
            // mousedown 기본 동작을 막아 에디터 선택이 단추로 옮겨 가며 노드 선택이 생기지 않게 한다.
            onMouseDown={(e) => e.preventDefault()}
            onClick={toggleSource}
          >
            소스 편집
          </button>
        </div>
      )}
      {/* 소스 편집 칸 — contentDOM 이라 늘 그려 두고 CSS(data-source-open)로 보이기만 바꾼다. */}
      <NodeViewContent as="pre" className="wiki-html-embed__source" spellCheck={false} data-testid="wiki-html-embed-source" />
      <div className="wiki-html-embed__preview" contentEditable={false}>
        <SandboxedHtmlFrame
          ref={frameRef}
          allowScripts
          html={doc}
          title="HTML 블록"
          className="wiki-html-embed__frame"
          data-testid="wiki-html-embed-frame"
          style={{ height }}
        />
      </div>
    </NodeViewWrapper>
  )
}
