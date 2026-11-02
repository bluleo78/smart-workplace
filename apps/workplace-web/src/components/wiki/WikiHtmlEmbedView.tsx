// 노트 HTML 블록 NodeView(WP-1242) — 블록 소스를 격리 iframe 에서 원본처럼 실행해 보이고, 편집할 때만 막대·소스 편집 칸을 연다.
// WP-1300: 평소엔 미리보기만(올리면 막대), 선택하면 다시 올리기·크게 보기·삭제와 키 안내, 소스 편집은 코드(줄 번호·색 구분)와 미리보기를 나란히.
// WP-1302: 「✦ AI로 고치기」 — 블록 아래 입력 칸(WikiHtmlEmbedAiPanel)에서 지시하고, 결과를 비교해 「적용」할 때만 소스를 바꾼다.
import { NodeSelection, TextSelection } from '@tiptap/pm/state'
import { NodeViewContent, NodeViewWrapper, type ReactNodeViewProps, useEditorState } from '@tiptap/react'
import { Code2, Crosshair, MoreHorizontal, Sparkles, X } from 'lucide-react'
import { type RefObject, useEffect, useMemo, useRef, useState } from 'react'

import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/overlay/dropdown-menu'
import { useDebounceValue } from '@/hooks/useDebounceValue'
import { type HtmlPicker, useHtmlPicker } from '@/hooks/useHtmlPicker'
import { htmlPickerScript, pickedLabel } from '@/lib/htmlPicker'
import { isMacLike } from '@/lib/platform'

import { SandboxedHtmlFrame } from '../SandboxedHtmlFrame'
import { useEmbedFrame } from './useEmbedFrame'
import { useHtmlSourceScripts } from './wikiHtmlBlockSecurity'
import { useWikiHtmlEmbedAi } from './WikiHtmlEmbedAiContext'
import { WikiHtmlEmbedAiPanel } from './WikiHtmlEmbedAiPanel'
import { WikiHtmlEmbedExpandDialog, WikiHtmlEmbedReuploadDialog } from './WikiHtmlEmbedDialogs'
import { htmlEmbedKeyHint } from './wikiHtmlEmbedHint'
import {
  deleteHtmlEmbed,
  hasHtmlEmbedOpenMark,
  replaceHtmlEmbedSource,
  selectHtmlEmbed,
  setHtmlEmbedSourceOpen,
} from './wikiHtmlEmbedSource'
import { keepFocus, pinBlock, pinFlex, pinInlineFlex } from './wikiPinVisible'

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
 * 이 블록이 노드 선택(블록 통째 선택)인지 — tiptap 의 selected 는 블록을 덮는 글자 범위 선택(전체 선택·드래그)에서도 참이라,
 * 그때 막대 단추·키 안내가 블록마다 뜨지 않게 NodeSelection 이고 그 위치가 이 블록일 때만 참으로 본다.
 * 선택 거래마다 다시 판정한다(useEditorState) — 노드 선택 → 전체 선택처럼 selected 가 그대로인 변화도 따라가게.
 */
function useNodeSelected(editor: ReactNodeViewProps['editor'], getPos: ReactNodeViewProps['getPos']): boolean {
  return (
    useEditorState({
      editor,
      selector: ({ editor: ed }) => {
        const sel = ed?.state.selection
        return sel instanceof NodeSelection && sel.from === getPos()
      },
    }) ?? false
  )
}

/** 노드 글자의 줄 수(줄바꿈 수 + 1) — 끝 줄바꿈 뒤 빈 줄도 한 줄로 센다(편집기가 그 줄에 커서를 둘 수 있다). */
function countLines(source: string): number {
  let count = 1
  for (let i = source.indexOf('\n'); i >= 0; i = source.indexOf('\n', i + 1)) count++
  return count
}

/** 줄 번호 칸 글자 — 1 부터 count 까지 한 줄에 하나. */
function lineNumberText(count: number): string {
  let out = count > 0 ? '1' : ''
  for (let n = 2; n <= count; n++) out += `\n${n}`
  return out
}

/** 블록 선택 안내 — 플랫폼(⌘·Ctrl)은 화면을 여는 동안 바뀌지 않아 모듈을 불러올 때 한 번 정한다. */
const KEY_HINT = htmlEmbedKeyHint(isMacLike())

/** 블록 대화상자 종류 — 「다시 올리기」·「크게 보기」. */
type EmbedDialog = 'reupload' | 'expand'

// 막대·단추·안내는 노트 CSS 가 숨기지 못하게 고정 ref(pinBlock·pinFlex·pinInlineFlex)로 박고, 단추 mousedown 은 keepFocus 로
// 편집기 선택이 단추로 옮겨 가지 않게 한다 — 둘 다 「AI로 고치기」 칸과 함께 쓰는 wikiPinVisible 의 모듈 값이다.

/**
 * HTML 블록 화면.
 * - 미리보기: SandboxedHtmlFrame(allowScripts) — sandbox 에 allow-same-origin 이 없어 불투명 출처로 돈다(앱 쿠키·저장소·화면에 닿지 못함).
 *   CDN 스크립트 로드는 막지 않는다. 문서 끝에 높이 보고 스크립트를 붙이고, 이 iframe 이 보낸 메시지만 받아 범위로 잘라 높이를 맞춘다.
 * - 막대(편집할 때만, WP-1300): 「⟨⟩ HTML 블록」 이름표(누르면 블록 통째 선택)·「소스 편집」(열면 「완료」)·오른쪽에 선택 땐
 *   「다시 올리기」「크게 보기」「삭제」, 아니면 「⋯」 메뉴(같은 세 가지). 평소엔 자리만 두고 감춘다 — 올리거나(hover)·선택하거나·소스를 열면
 *   보인다(CSS). 자리를 늘 두는 것은 올릴 때마다 아래 글이 밀려 흔들리지 않게. 순서는 이름표 · 「✦ AI로 고치기」(WP-1302, 시안대로 맨 앞) · 「소스 편집」 · 「◎ 고르기」(WP-1301).
 * - 「✦ AI로 고치기」(WP-1302): AI 를 쓸 수 있는 노트 편집 화면(WikiHtmlEmbedAiContext)에서만 보인다. 누르면 블록 아래 입력 칸이 열리고, 고른 요소 칩도
 *   그 칸 안으로 들어간다(닫혀 있으면 지금처럼 블록 아래). 칸을 닫아도(Esc·단추) 쓴 글은 남는다 — 이 화면 상태라 동료에게는 보이지 않는다.
 * - 블록이 통째 선택되면 아래에 키 안내(Enter 다음 줄 · Esc 바깥으로 · ⌘/Ctrl+Enter 바로 나가기).
 * - 소스(노드 글자 = Yjs 텍스트)는 NodeViewContent(contentDOM)다 — 늘 DOM 에 두되(ProseMirror 가 글자 자리를 잃지 않게) 「소스 편집」을
 *   켰을 때만 보인다. 열면 코드(왼쪽, 줄 번호 + 색 구분 데코레이션)와 미리보기(오른쪽)를 나란히, 좁으면 위아래로 둔다(CSS 컨테이너 쿼리).
 *   줄 번호는 노드 글자 줄 수로 그린 aria-hidden 칸이고, 소스와 한 스크롤 상자에 있어 같이 움직인다. 보기 전용 화면은 미리보기만.
 * - 소스 칸은 기본 닫힘(동료가 넣은 빈 블록 포함). 열림은 이 편집기 플러그인 상태(wikiHtmlEmbedSource 의 htmlEmbedSourceKey)가 쥐고
 *   블록 데코레이션으로 받는다 — 이 화면에서 슬래시로 막 넣은 블록은 삽입 거래가 연 채로 표시한다.
 * - 닫힌 블록에는 커서가 들어가지 않고 블록 통째 선택(선택 테두리)이 된다(WP-1288, 같은 플러그인). 그래서 닫을 때(「완료」·Esc) 커서가
 *   안에 있어도 따로 옮기지 않는다 — 닫는 거래 뒤 플러그인이 통째 선택으로 바꾼다.
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
  const nodeSelected = useNodeSelected(editor, getPos)
  const showSelected = editable && nodeSelected
  const previewSource = useDebounceValue(source, showSource ? PREVIEW_DEBOUNCE_MS : REMOTE_PREVIEW_DEBOUNCE_MS)
  // 블록 화면 요소 — 노트가 문서에서 떨어진(언마운트되지 않고 남은) 블록을 세지 않게 넘긴다(WP-1290).
  const wrapperRef = useRef<HTMLDivElement>(null)
  const script = useBlockScript(previewSource, wrapperRef)
  // 요소 고르기(WP-1301) — iframe 안 Esc 로 고르기가 꺼지면 블록을 통째 선택한다(설계 §1, 고른 것 풀기 단계는 훅이 한다).
  const picker = useHtmlPicker({
    onExit: () => {
      const pos = getPos()
      if (typeof pos === 'number') selectHtmlEmbed(view, pos)
    },
  })
  // 문서·높이 보고·고르기 — iframe 이 붙으면 그 창을 높이 보고와 고르기에 등록하고, 떨어지면(문서가 바뀌어 새 iframe·블록 사라짐) 해제한다.
  // 고르기 스크립트는 편집할 수 있는 화면에만 넣는다 — 보기 전용 화면(판 미리보기·공개 공유)은 고를 일이 없다.
  const { doc, height, frameRef, frameEl } = useEmbedFrame(previewSource, {
    extraScript: editable ? htmlPickerScript(picker.token) : '',
    onAttach: picker.attach,
  })
  // 노트 스크립트가 멈추면(스위치를 끔·블록이 바뀜) 고르기도 끈다 — 멈춘 iframe 에는 고르기 스크립트가 돌지 않는다(WP-1290).
  const pickerEnabled = picker.enabled
  const setPickerEnabled = picker.setEnabled
  useEffect(() => {
    if (!script.running && pickerEnabled) setPickerEnabled(false)
  }, [script.running, pickerEnabled, setPickerEnabled])
  // 「AI로 고치기」(WP-1302) — 쓸 수 있는 화면이면 조건(페이지 id·넣기 길), 칸 열림, 쓴 지시(칸을 닫아도 남긴다).
  const ai = useWikiHtmlEmbedAi()
  const showAi = editable && ai != null
  const [aiOpen, setAiOpen] = useState(false)
  const [aiPrompt, setAiPrompt] = useState('')
  const aiPanelOpen = showAi && aiOpen
  const [menuOpen, setMenuOpen] = useState(false)
  const [dialog, setDialog] = useState<EmbedDialog | null>(null)
  // 줄 번호 — 소스 칸을 열었을 때만 센다(닫힌 블록은 동료 타자마다 다시 세지 않게). 줄 번호 글자는 줄 수가 바뀔 때만 다시 만든다.
  const lineCount = useMemo(() => (showSource ? countLines(source) : 0), [showSource, source])
  const lineNumbers = useMemo(() => lineNumberText(lineCount), [lineCount])

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
  }, [editable, sourceOpen, getPos, view, frameEl])

  /** 지금 블록 앞 위치로 fn 을 부른다 — 동료 편집으로 옮겨졌을 수 있어 늘 다시 묻고, 블록이 사라졌으면 아무것도 하지 않는다(undefined). */
  const withPos =
    <A extends unknown[], R>(fn: (pos: number, ...args: A) => R) =>
    (...args: A): R | undefined => {
      const pos = getPos()
      return typeof pos === 'number' ? fn(pos, ...args) : undefined
    }

  /** 소스 칸 열기·닫기(「소스 편집」·「완료」) — 이 편집기 플러그인 상태를 바꾼다. 열 때는 커서를 소스 끝에 두고 포커스를 준다. */
  const toggleSource = withPos((pos) => {
    const tr = setHtmlEmbedSourceOpen(editor.state.tr, pos, !sourceOpen)
    // 크기는 지금 문서에서 읽는다 — 렌더 때 받은 노드는 동료 편집 뒤 낡았을 수 있다.
    const current = tr.doc.nodeAt(pos)
    if (!sourceOpen && current) tr.setSelection(TextSelection.create(tr.doc, pos + current.nodeSize - 1))
    view.dispatch(tr)
    view.focus()
  })

  /** 이름표 — 블록 통째 선택(설계 §1). 소스 칸을 연 채여도 블록을 고른다(칸은 그대로). */
  const selectBlock = withPos((pos) => selectHtmlEmbed(view, pos))
  const removeBlock = withPos((pos) => deleteHtmlEmbed(view, pos))
  const replaceSource = withPos((pos, next: string) => replaceHtmlEmbedSource(view, pos, next))

  /** 「AI로 고치기」 칸 닫기 — 한 단계 바깥(블록 통째 선택)으로 돌아간다(설계 §1). 쓴 지시는 남는다. */
  const closeAi = () => {
    setAiOpen(false)
    if (!view.isDestroyed) selectBlock()
  }
  /** 「적용」 — 소스를 한 거래로 바꾸고(⌘Z 한 번에 돌아감) 칸을 닫아 블록을 통째 선택한다. 블록·편집기가 사라졌으면 false.
   * 적용은 ack 를 기다린 뒤에 불려 그사이 편집기가 내려갔을 수 있어 먼저 본다. */
  const applyAi = (html: string): boolean => {
    if (view.isDestroyed || !replaceSource(html)) return false
    setAiOpen(false)
    selectBlock()
    return true
  }

  // 고른 요소 칩 줄(WP-1301) — 고르기를 켰거나 고른 것이 있을 때만. 한 번 만들어 「AI로 고치기」 칸 안 또는 블록 아래 한곳에 둔다.
  const picks = editable && (picker.enabled || picker.items.length > 0) ? <HtmlBlockPicks picker={picker} /> : null

  /** 블록 작업 — 선택했을 때는 막대에 단추로, 아니면 「⋯」 메뉴 항목으로 같은 목록을 그린다. */
  const actions: Array<{ key: string; label: string; onSelect: () => void; danger?: boolean }> = [
    { key: 'reupload', label: '다시 올리기', onSelect: () => setDialog('reupload') },
    { key: 'expand', label: '크게 보기', onSelect: () => setDialog('expand') },
    { key: 'delete', label: '삭제', onSelect: removeBlock, danger: true },
  ]

  // 대화상자·메뉴를 닫으면 편집기로 포커스를 돌린다 — 연 단추(편집기 안 편집 불가 요소)로 돌아가면 키가 편집기로 가지 않는다.
  const closeFocus = useMemo(
    () => ({
      onCloseAutoFocus: (e: Event) => {
        e.preventDefault()
        // 닫히는 사이 편집기가 사라졌을 수 있다(노트 이동·화면 정리) — 그때는 포커스를 주지 않는다.
        if (!view.isDestroyed) view.focus()
      },
    }),
    [view],
  )
  /** 대화상자 공통 속성 — 열려 있을 때만 그리므로(아래) open 은 늘 참이고, 닫히면 상태를 비워 대화상자를 내린다. */
  const dialogProps = (kind: EmbedDialog) => ({
    open: dialog === kind,
    onOpenChange: (o: boolean) => setDialog(o ? kind : null),
    closeFocus,
  })

  return (
    <NodeViewWrapper
      ref={wrapperRef}
      className="wiki-html-embed"
      data-testid="wiki-html-embed"
      data-editable={editable ? '' : undefined}
      data-selected={showSelected ? '' : undefined}
      data-source-open={showSource ? '' : undefined}
      data-menu-open={menuOpen ? '' : undefined}
      data-picking={picker.enabled ? '' : undefined}
      data-ai-open={aiPanelOpen ? '' : undefined}
    >
      {editable && (
        <div ref={pinFlex} className="wiki-html-embed__bar" contentEditable={false} data-testid="wiki-html-embed-bar">
          <button
            ref={pinInlineFlex}
            type="button"
            className="wiki-html-embed__label"
            data-testid="wiki-html-embed-label"
            title="블록 전체 선택"
            onMouseDown={keepFocus}
            onClick={selectBlock}
          >
            <Code2 className="wiki-html-embed__icon" aria-hidden />
            HTML 블록
          </button>
          {/* AI로 고치기(WP-1302) — 누르면 블록 아래 입력 칸을 열고 닫는다(열린 동안 눌린 모양). */}
          {showAi && (
            <button
              ref={pinInlineFlex}
              type="button"
              className="wiki-html-embed__btn wiki-html-embed__btn--ai"
              aria-pressed={aiOpen}
              data-testid="wiki-html-embed-ai-toggle"
              onMouseDown={keepFocus}
              onClick={() => (aiOpen ? closeAi() : setAiOpen(true))}
            >
              <Sparkles className="wiki-html-embed__icon" aria-hidden />
              AI로 고치기
            </button>
          )}
          <button
            ref={pinInlineFlex}
            type="button"
            className="wiki-html-embed__btn"
            aria-pressed={sourceOpen}
            data-testid="wiki-html-embed-toggle"
            onMouseDown={keepFocus}
            onClick={toggleSource}
          >
            {sourceOpen ? '완료' : '소스 편집'}
          </button>
          {/* 요소 고르기(WP-1301) — 켜면 블록 안을 눌러 고칠 대상을 짚는다(iframe 안 ⌘/Ctrl+클릭으로도 켜진다). */}
          <button
            ref={pinInlineFlex}
            type="button"
            className="wiki-html-embed__btn wiki-html-embed__btn--pick"
            aria-pressed={picker.enabled}
            data-testid="wiki-html-embed-pick"
            // 고르기는 블록 안 스크립트로 돈다 — 노트 스크립트가 멈춘 동안은 쓸 수 없어 까닭을 보인다(WP-1290).
            disabled={!script.running}
            title={script.running ? undefined : '노트 스크립트를 켜면 고를 수 있어요'}
            onMouseDown={keepFocus}
            onClick={() => picker.setEnabled(!picker.enabled)}
          >
            <Crosshair className="wiki-html-embed__icon" aria-hidden />
            {picker.enabled ? '고르기 켜짐' : '고르기'}
          </button>
          <span ref={pinInlineFlex} className="wiki-html-embed__actions">
            {showSelected ? (
              actions.map((action) => (
                <button
                  key={action.key}
                  ref={pinInlineFlex}
                  type="button"
                  className={action.danger ? 'wiki-html-embed__btn wiki-html-embed__btn--danger' : 'wiki-html-embed__btn'}
                  data-testid={`wiki-html-embed-${action.key}`}
                  onMouseDown={keepFocus}
                  onClick={action.onSelect}
                >
                  {action.label}
                </button>
              ))
            ) : (
              // modal 아님 — 항목에서 대화상자를 열 때 메뉴의 포커스 가두기·바깥 막기가 대화상자와 겹치지 않게.
              <DropdownMenu modal={false} open={menuOpen} onOpenChange={setMenuOpen}>
                <DropdownMenuTrigger asChild>
                  <button
                    ref={pinInlineFlex}
                    type="button"
                    className="wiki-html-embed__btn wiki-html-embed__btn--icon"
                    aria-label="HTML 블록 메뉴"
                    data-testid="wiki-html-embed-more"
                    onMouseDown={keepFocus}
                  >
                    <MoreHorizontal className="wiki-html-embed__icon" aria-hidden />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="end"
                  // 메뉴를 닫을 때 포커스를 편집기로(대화상자와 같은 closeFocus) — 대화상자를 연 항목이면 이어 열리는 대화상자가 포커스를 가져간다.
                  onCloseAutoFocus={closeFocus.onCloseAutoFocus}
                >
                  {actions.map((action) => (
                    <DropdownMenuItem key={action.key} variant={action.danger ? 'destructive' : 'default'} onSelect={action.onSelect}>
                      {action.label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </span>
        </div>
      )}
      <div className="wiki-html-embed__body">
        {/* 소스 편집 칸 — 줄 번호와 소스(contentDOM)가 한 스크롤 상자에 있다. contentDOM 이라 늘 그려 두고 CSS(data-source-open)로 보이기만 바꾼다. */}
        <div className="wiki-html-embed__code" data-testid="wiki-html-embed-code">
          <div className="wiki-html-embed__gutter" contentEditable={false} aria-hidden>
            {lineNumbers}
          </div>
          {/* 줄을 접지 않는다(줄 번호와 맞게) — 긴 줄은 가로 스크롤. NodeViewContent 의 기본 pre-wrap 을 덮는다. */}
          <NodeViewContent
            as="pre"
            className="wiki-html-embed__source"
            spellCheck={false}
            style={{ whiteSpace: 'pre' }}
            data-testid="wiki-html-embed-source"
          />
        </div>
        <div className="wiki-html-embed__preview" contentEditable={false} data-testid="wiki-html-embed-preview">
          {script.badge}
          <SandboxedHtmlFrame
            ref={frameRef}
            allowScripts={script.running}
            html={doc}
            title="HTML 블록"
            className="wiki-html-embed__frame"
            data-testid="wiki-html-embed-frame"
            style={{ height }}
          />
        </div>
      </div>
      {showSelected && (
        <div ref={pinBlock} className="wiki-html-embed__hint" contentEditable={false} data-testid="wiki-html-embed-hint">
          {KEY_HINT}
        </div>
      )}
      {/* 대화상자는 열려 있을 때만 그린다 — 닫으면 내려가 칸·불러온 파일이 함께 비워진다(늦게 끝난 파일 읽기도 내려간 대화상자에 남는다). */}
      {editable && dialog === 'reupload' && <WikiHtmlEmbedReuploadDialog {...dialogProps('reupload')} onReplace={replaceSource} />}
      {editable && dialog === 'expand' && (
        // 늦춘 소스 — 큰 창이 떠 있는 동안 동료·내 타자마다 iframe 을 새로 만들지 않게(블록 미리보기와 같은 박자).
        <WikiHtmlEmbedExpandDialog {...dialogProps('expand')} source={previewSource} />
      )}
      {aiPanelOpen && ai && (
        <WikiHtmlEmbedAiPanel
          ai={ai}
          source={source}
          picked={picker.items}
          picks={picks}
          prompt={aiPrompt}
          onPromptChange={setAiPrompt}
          onClose={closeAi}
          onApply={applyAi}
        />
      )}
      {/* 고른 요소 칩 — 「AI로 고치기」 칸이 열려 있으면 그 칸 안에 그린다(한곳에만). */}
      {!aiPanelOpen && picks}
    </NodeViewWrapper>
  )
}

/**
 * 고르기 안내와 고른 요소 칩(WP-1301) — 블록 바로 아래. 칩은 고른 순서대로 번호 + 짧은 설명이고, 누르면 그 요소를 강조하고 ✕ 로 뺀다.
 * 「AI로 고치기」 칸이 열려 있으면(WP-1302) 이 칩 줄을 그 칸 안에 넣고, 고른 목록(useHtmlPicker 의 items)을 요청에 함께 보낸다.
 */
function HtmlBlockPicks({ picker }: { picker: HtmlPicker }) {
  return (
    <div ref={pinFlex} className="wiki-html-embed__picks" contentEditable={false} data-testid="wiki-html-embed-picks">
      {picker.items.length === 0 ? (
        <span className="wiki-html-embed__picks-hint">누르면 고릅니다 · Shift+클릭 여러 개 · Esc 끄기</span>
      ) : (
        picker.items.map((item, i) => (
          <span key={`${i}-${item.path}`} className="wiki-html-embed__chip" data-testid="wiki-html-embed-chip" title={item.text || item.kind}>
            <button type="button" className="wiki-html-embed__chip-main" onMouseDown={keepFocus} onClick={() => picker.highlight(i)}>
              <span className="wiki-html-embed__chip-num" aria-hidden>
                {i + 1}
              </span>
              {pickedLabel(item)}
            </button>
            <button
              type="button"
              className="wiki-html-embed__chip-remove"
              aria-label={`${i + 1}번 고른 것 빼기`}
              onMouseDown={keepFocus}
              onClick={() => picker.remove(i)}
            >
              <X aria-hidden />
            </button>
          </span>
        ))
      )}
    </div>
  )
}

/** 블록 스크립트 차단·실행(WP-1290) — 실행 여부는 노트 하나로 정한다(본문 위 줄). 멈춘 동안은 오른쪽 위에 「스크립트 멈춤」만 작게 둔다. */
function useBlockScript(source: string, anchor: RefObject<Element | null>) {
  const { running } = useHtmlSourceScripts(source, anchor)
  const badge = !running && (
    <span className="wiki-html-embed__badge" data-testid="wiki-html-block-badge">
      스크립트 멈춤
    </span>
  )
  return { badge, running }
}
