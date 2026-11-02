// HTML 편집 iframe 배선(WP-1309) — 요소 고르기 + 글자 고치기를 한 iframe 에 함께 붙인다.
// HTML 문서 페이지의 보이는 화면 편집(WikiHtmlVisualEditor)과 노트 HTML 블록의 「글자 고치기」(WikiHtmlEmbedView)가 같은 배선을 쓴다:
// 원본 준비(번호·지문) → 고르기·글자 고치기 스크립트 → 창 붙이기(둘 다) → 고르기를 켜는 동안 글자 고치기 멈춤.
import { useCallback, useEffect, useMemo } from 'react'

import { htmlPickerScript } from '@/lib/htmlPicker'
import { htmlTextEditScript } from '@/lib/htmlTextEdit'
import { type HtmlTextEdit, type PreparedHtmlTextEdit, prepareHtmlTextEdit } from '@/lib/htmlTextEditSource'

import { type HtmlPicker, useHtmlPicker } from './useHtmlPicker'
import { type HtmlTextEditor, useHtmlTextEdit } from './useHtmlTextEdit'

export interface HtmlEditFrame {
  picker: HtmlPicker
  textEdit: HtmlTextEditor
  /** 글자 고치기 화면 — 띄울 문서·고칠 수 있는 요소 수·되돌리기(apply). base 가 없으면(글자 고치기 꺼짐) null. */
  prepared: PreparedHtmlTextEdit | null
  /** 문서 끝에 붙일 스크립트 — 고르기는 늘, 글자 고치기는 prepared 가 있을 때만. */
  script: string
  /** iframe 창이 붙으면 부른다 — 고르기와 (켜져 있으면) 글자 고치기에 함께 붙이고, 돌려준 함수로 둘 다 뗀다. */
  attach: (frameWindow: Window) => () => void
}

/**
 * base: 글자 고치기 화면을 띄울 기준 원본(없으면 고르기만). 바뀌지 않는 동안 준비(수 MB 파싱·번호 달기)는 한 번이다 —
 * 부르는 화면은 고친 것이 원본에 들어가도 base 를 바꾸지 않는다(iframe 문서가 그대로여야 커서·편집이 이어진다).
 * onExit 은 고르기 안 Esc(useHtmlPicker), onChange 는 받은 고친 것 전부(useHtmlTextEdit) — 되돌리기는 prepared.apply 로 한다.
 * pageScripts=false 면 노트 스크립트가 멈춘 채 띄우는 편집 화면(WP-1290) — 띄울 문서에서 문서가 스스로 움직일 길을 걷는다(prepareHtmlTextEdit inertPage).
 * 그 문서는 SandboxedHtmlFrame 에 pageScripts=false(우리 스크립트만)로 띄워야 한다.
 */
export function useHtmlEditFrame(
  base: string | null,
  {
    onExit,
    onChange,
    pageScripts = true,
  }: { onExit?: () => void; onChange?: (edits: HtmlTextEdit[]) => void; pageScripts?: boolean } = {},
): HtmlEditFrame {
  const picker = useHtmlPicker({ onExit })
  const textEdit = useHtmlTextEdit({ onChange })
  const { setPaused } = textEdit
  // 고르기를 켜면 글자 고치기를 멈추고(클릭이 고르기로 간다), 끄면 다시 켠다.
  useEffect(() => setPaused(picker.enabled), [picker.enabled, setPaused])

  const prepared = useMemo(() => (base == null ? null : prepareHtmlTextEdit(base, { inertPage: !pageScripts })), [base, pageScripts])
  const textOn = prepared != null
  const script = useMemo(
    () => htmlPickerScript(picker.token) + (textOn ? htmlTextEditScript(textEdit.token) : ''),
    [picker.token, textEdit.token, textOn],
  )
  const attachPicker = picker.attach
  const attachText = textEdit.attach
  const attach = useCallback(
    (win: Window) => {
      // 글자 고치기 문서일 때만 그 메시지를 받는다(평소 문서에는 글자 고치기 스크립트가 없다).
      const detachPicker = attachPicker(win)
      const detachText = textOn ? attachText(win) : undefined
      return () => {
        detachPicker()
        detachText?.()
      }
    },
    [attachPicker, attachText, textOn],
  )
  return { picker, textEdit, prepared, script, attach }
}
