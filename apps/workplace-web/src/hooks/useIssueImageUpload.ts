// 이슈 본문 Textarea 이미지 업로드 훅(WP-199) — 붙여넣기·드롭·버튼 공통.
// 텍스트는 Textarea 그대로(마크다운) 두고, 이미지 파일만 가로채 업로드한 뒤 커서 위치에 마크다운을 넣는다.
import { type RefObject, useRef, useState } from 'react'
import { toast } from 'sonner'

import { uploadIssueImage } from '../api/issueImages'
import { extractApiError } from '../lib/api-error'
import { clipboardHasText, INVALID_IMAGE_MSG, isValidImageFile } from '../lib/imageUpload'
import { hasPendingToken, imageMarkdown, insertAt, placeholderToken, removeToken, replaceToken } from '../lib/markdownImageInsert'

/** 저장을 막아야 하는 사유 — 업로드 진행 중이거나, 진행 중 업로드 없이 자리표시 토큰만 남은 경우(복원된 초안의 잔재). */
export type ImagePendingBlock = 'uploading' | 'stale-token'

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

  // 핸들러는 useCallback 으로 감싸지 않는다 — 호출자가 getValue/setValue 를 매 렌더 인라인으로 넘겨 메모가 무의미하다.

  /** 파일들을 순서대로 커서 위치에 토큰으로 넣고 병렬 업로드한다. 유효하지 않은 파일이 섞이면 한 번만 토스트. */
  const uploadFiles = (files: File[]) => {
    const valid = files.filter(isValidImageFile)
    if (valid.length < files.length) toast.error(INVALID_IMAGE_MSG)
    if (valid.length === 0) return
    const el = textareaRef.current
    let text = getValue()
    // 포커스가 없으면 selectionStart 를 믿을 수 없다(편집 진입 직후 0 등) — 본문 끝에 넣는다.
    const focused = el != null && document.activeElement === el
    let start = focused ? el.selectionStart : text.length
    let end = focused ? el.selectionEnd : text.length
    const tokens = valid.map(() => placeholderToken(++seq.current))
    const leads: boolean[] = []
    for (const token of tokens) {
      const r = insertAt(text, start, end, token)
      leads.push(r.lead)
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
          setValue(removeToken(getValue(), tokens[i], leads[i]))
          toast.error(extractApiError(e, '이미지를 올리지 못했습니다'))
        })
        .finally(() => setPendingCount((n) => n - 1))
    })
  }

  const onPaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    if (!enabled) return
    const files = imageFilesOf(e.clipboardData)
    if (files.length === 0 || clipboardHasText(e.clipboardData)) return
    e.preventDefault()
    uploadFiles(files)
  }

  const onDrop = (e: React.DragEvent<HTMLTextAreaElement>) => {
    if (!enabled) return
    // 파일이 하나라도 실려 있으면 기본 동작(브라우저가 파일을 열어 작성 중인 내용이 사라짐)을 항상 막는다.
    // 비이미지가 섞여 있어도 uploadFiles 로 넘겨 유효성 검사·토스트(한 번)를 거치게 한다.
    const files = Array.from(e.dataTransfer?.files ?? [])
    if (files.length === 0) return
    e.preventDefault()
    uploadFiles(files)
  }

  // 드롭을 받으려면 dragover 기본 동작을 막아야 한다(이미지 파일일 때만).
  const onDragOver = (e: React.DragEvent<HTMLTextAreaElement>) => {
    if (enabled && Array.from(e.dataTransfer.items ?? []).some((i) => i.kind === 'file')) e.preventDefault()
  }

  const isUploading = pendingCount > 0

  /**
   * 저장(제출) 직전 막아야 하는지 판정 — 자리표시 토큰이 서버 본문에 저장되지 않게 한다.
   * 생성 다이얼로그·상세 본문 편집이 같은 판정을 쓰고, 사유별 안내 문구는 각 호출자가 정한다.
   */
  const pendingBlock = (text: string): ImagePendingBlock | null => {
    if (isUploading) return 'uploading'
    if (hasPendingToken(text)) return 'stale-token'
    return null
  }

  return { onPaste, onDrop, onDragOver, uploadFiles, isUploading, pendingBlock }
}
