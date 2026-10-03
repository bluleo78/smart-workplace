// 이슈 본문 Textarea 이미지 업로드 훅(WP-199) — 붙여넣기·드롭·버튼 공통.
// 텍스트는 Textarea 그대로(마크다운) 두고, 이미지 파일만 가로채 업로드한 뒤 커서 위치에 마크다운을 넣는다.
import { type RefObject, useCallback, useRef, useState } from 'react'
import { toast } from 'sonner'

import { uploadIssueImage } from '../api/issueImages'
import { extractApiError } from '../lib/api-error'
import { imageMarkdown, insertAt, placeholderToken, replaceToken } from '../lib/markdownImageInsert'

/** 클라이언트 사전 검사 — 최종 판정은 서버 매직바이트. */
const ACCEPTED = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])
const MAX_BYTES = 10 * 1024 * 1024
export const INVALID_IMAGE_MSG = 'PNG·JPEG·GIF·WebP 이미지만 10MB 까지 올릴 수 있습니다.'

/** 클립보드에 붙여넣을 텍스트가 있는지 — 있으면 기본 붙여넣기를 막지 않는다(엑셀 셀 복사는 렌더 이미지+텍스트가 함께 실림). */
function clipboardHasText(data: DataTransfer): boolean {
  return data.getData('text/plain') !== '' || data.getData('Text') !== '' || data.getData('text/uri-list') !== ''
}

function imageFilesOf(data: DataTransfer | null): File[] {
  if (!data) return []
  return Array.from(data.files ?? []).filter((f) => f.type.startsWith('image/'))
}

export function useIssueImageUpload({
  projectKey, textareaRef, getValue, setValue, enabled = true,
}: {
  projectKey: string
  textareaRef: RefObject<HTMLTextAreaElement | null>
  getValue: () => string
  setValue: (next: string) => void
  // 본문 편집 권한이 없으면 가로채지 않는다(기본 동작 유지).
  enabled?: boolean
}) {
  const [pendingCount, setPendingCount] = useState(0)
  const seq = useRef(0)

  /** 파일들을 순서대로 커서 위치에 토큰으로 넣고 병렬 업로드한다. 유효하지 않은 파일이 섞이면 한 번만 토스트. */
  const uploadFiles = useCallback(
    (files: File[]) => {
      const valid = files.filter((f) => ACCEPTED.has(f.type) && f.size <= MAX_BYTES)
      if (valid.length < files.length) toast.error(INVALID_IMAGE_MSG)
      if (valid.length === 0) return
      const el = textareaRef.current
      let text = getValue()
      let start = el?.selectionStart ?? text.length
      let end = el?.selectionEnd ?? text.length
      const tokens = valid.map(() => placeholderToken(++seq.current))
      for (const token of tokens) {
        const r = insertAt(text, start, end, token)
        text = r.text
        start = end = r.caret
      }
      setValue(text)
      // 값 반영 후 캐럿을 토큰 뒤로 — 이어서 타이핑하면 이미지 다음 줄에 쓰인다.
      requestAnimationFrame(() => el?.setSelectionRange(start, start))
      setPendingCount((n) => n + valid.length)
      valid.forEach((file, i) => {
        uploadIssueImage(projectKey, file)
          .then((res) => setValue(replaceToken(getValue(), tokens[i], imageMarkdown(res.name, res.url))))
          .catch((e) => {
            setValue(replaceToken(getValue(), tokens[i], ''))
            toast.error(extractApiError(e, '이미지를 올리지 못했습니다'))
          })
          .finally(() => setPendingCount((n) => n - 1))
      })
    },
    [projectKey, textareaRef, getValue, setValue],
  )

  const onPaste = useCallback(
    (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
      if (!enabled) return
      const files = imageFilesOf(e.clipboardData)
      if (files.length === 0 || clipboardHasText(e.clipboardData)) return
      e.preventDefault()
      uploadFiles(files)
    },
    [enabled, uploadFiles],
  )

  const onDrop = useCallback(
    (e: React.DragEvent<HTMLTextAreaElement>) => {
      if (!enabled) return
      // 파일이 하나라도 실려 있으면 기본 동작(브라우저가 파일을 열어 작성 중인 내용이 사라짐)을 항상 막는다.
      // 비이미지가 섞여 있어도 uploadFiles 로 넘겨 유효성 검사·토스트(한 번)를 거치게 한다.
      const files = Array.from(e.dataTransfer?.files ?? [])
      if (files.length === 0) return
      e.preventDefault()
      uploadFiles(files)
    },
    [enabled, uploadFiles],
  )

  // 드롭을 받으려면 dragover 기본 동작을 막아야 한다(이미지 파일일 때만).
  const onDragOver = useCallback(
    (e: React.DragEvent<HTMLTextAreaElement>) => {
      if (enabled && Array.from(e.dataTransfer.items ?? []).some((i) => i.kind === 'file')) e.preventDefault()
    },
    [enabled],
  )

  return { onPaste, onDrop, onDragOver, uploadFiles, pendingCount }
}
