// 노트 HTML 블록 NodeView(WP-1242) — 블록 소스를 격리 iframe 에서 원본처럼 실행해 보이고, 편집할 때만 소스 편집 칸을 연다.
import { TextSelection } from '@tiptap/pm/state'
import { NodeViewContent, NodeViewWrapper, type ReactNodeViewProps } from '@tiptap/react'
import { Code2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { useDebounceValue } from '@/hooks/useDebounceValue'

import { SandboxedHtmlFrame } from '../SandboxedHtmlFrame'
import { HTML_EMBED_DEFAULT_HEIGHT, htmlEmbedDocument, watchEmbedHeight } from './wikiHtmlEmbedFrame'
import { hasHtmlEmbedOpenMark, selectHtmlEmbed, setHtmlEmbedSourceOpen } from './wikiHtmlEmbedSource'
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
 * - 소스 칸은 기본 닫힘(동료가 넣은 빈 블록 포함). 열림은 이 편집기 플러그인 상태(wikiHtmlEmbedSource 의 htmlEmbedSourceKey)가 쥐고
 *   블록 데코레이션으로 받는다 — 이 화면에서 슬래시로 막 넣은 블록은 삽입 거래가 연 채로 표시한다.
 * - 닫힌 블록에는 커서가 들어가지 않고 블록 통째 선택(선택 테두리)이 된다(WP-1288, 같은 플러그인). 그래서 닫을 때 커서가 안에 있어도
 *   따로 옮기지 않는다 — 닫는 거래 뒤 플러그인이 통째 선택으로 바꾼다.
 * - 열 때는 커서를 소스 끝에 두고 편집기에 포커스를 준다 — 단추를 누르고 바로 이어 쓸 수 있게.
 * - 미리보기는 소스를 늦춰 따라간다 — 소스 칸을 연 채면 PREVIEW_DEBOUNCE_MS, 닫힌 채(동료 편집)면 REMOTE_PREVIEW_DEBOUNCE_MS.
 *   iframe 은 문서 글자가 바뀔 때만 새로 만든다(SandboxedHtmlFrame 이 문자열로 비교) — 기다리는 동안 고쳤다 되돌린 소스는 다시 그리지 않는다.
 * - 높이 보고는 모듈 하나짜리 message 듣기(watchEmbedHeight)에 이 iframe 창을 등록해 받는다.
 */
export function WikiHtmlEmbedView({ node, editor, view, getPos, decorations }: ReactNodeViewProps) {
  const source = node.textContent
  const editable = useViewEditable({ editor, view })
  const sourceOpen = hasHtmlEmbedOpenMark(decorations)
  const showSource = editable && sourceOpen
  const previewSource = useDebounceValue(source, showSource ? PREVIEW_DEBOUNCE_MS : REMOTE_PREVIEW_DEBOUNCE_MS)
  const doc = useMemo(() => htmlEmbedDocument(previewSource), [previewSource])
  const [height, setHeight] = useState(HTML_EMBED_DEFAULT_HEIGHT)

  // 높이 보고 — iframe 이 붙으면 그 창을 등록하고 떨어지면(문서가 바뀌어 새 iframe·블록 사라짐) 해제한다(React 19 콜백 ref 정리 함수).
  const frameEl = useRef<HTMLIFrameElement | null>(null)
  const frameRef = useCallback((el: HTMLIFrameElement | null) => {
    frameEl.current = el
    const win = el?.contentWindow
    return win ? watchEmbedHeight(win, setHeight) : undefined
  }, [])

  // 미리보기(iframe)를 누르면 블록을 통째 선택해 보인다(WP-1288) — iframe 안 클릭은 편집기에 오지 않아, 포커스가 iframe 으로 넘어가며 창이
  // blur 되는 것으로 안다. 포커스는 iframe 에 남긴다 — 블록 안 입력칸·키보드로 다루는 화면이 키를 그대로 받게(편집기로 돌아가려면 블록
  // 아래 빈자리·다른 줄을 누른다). 소스 칸을 연 채면 고르지 않는다 — 소스를 고치다 미리보기를 눌러 보는 경우.
  useEffect(() => {
    if (!editable || sourceOpen) return
    const onBlur = () => {
      // blur 시점엔 activeElement 가 아직 바뀌기 전일 수 있어 한 틱 뒤에 본다.
      setTimeout(() => {
        const pos = getPos()
        if (document.activeElement === frameEl.current && typeof pos === 'number') selectHtmlEmbed(view, pos, false)
      }, 0)
    }
    window.addEventListener('blur', onBlur)
    return () => window.removeEventListener('blur', onBlur)
  }, [editable, sourceOpen, getPos, view])

  /** 소스 칸 열기·닫기 — 이 편집기 플러그인 상태를 바꾼다. 열 때는 커서를 소스 끝에 두고 포커스를 준다. */
  const toggleSource = () => {
    const pos = getPos()
    if (typeof pos !== 'number') return
    const tr = setHtmlEmbedSourceOpen(editor.state.tr, pos, !sourceOpen)
    // 크기는 지금 문서에서 읽는다 — 렌더 때 받은 노드는 동료 편집 뒤 낡았을 수 있다.
    const current = tr.doc.nodeAt(pos)
    if (!sourceOpen && current) tr.setSelection(TextSelection.create(tr.doc, pos + current.nodeSize - 1))
    view.dispatch(tr)
    if (!sourceOpen) view.focus()
  }

  return (
    <NodeViewWrapper
      className="wiki-html-embed"
      data-testid="wiki-html-embed"
      data-source-open={showSource ? '' : undefined}
    >
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
