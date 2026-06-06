// 메시지 작성기 — RichInput(@멘션) 기반. Enter 전송·Shift+Enter 줄바꿈은 RichInput 이 처리.
// 파일 첨부: Paperclip 버튼 → 선택 즉시 사전 업로드(pending 칩 표시), 전송 시 fileIds 동봉.
// 본문이 비어도 첨부가 있으면 전송 허용(첨부만 있는 메시지).
// 보관 채널(archived)은 입력기 대신 "보관됨" 안내만, 단순 비활성(disabled)은 입력기를 숨긴다.
import { Paperclip, X } from 'lucide-react'
import { useRef, useState } from 'react'

import { messagingApi } from '@/api/messaging'
import { RichInput } from '@/components/mentions/RichInput'
import type { MentionCandidate } from '@/components/mentions/types'
import { handleApiError } from '@/lib/api-error'

// 사전 업로드 응답 메타(uploadAttachments 반환 항목과 동일).
type PendingFile = { fileId: number; originalName: string; mimeType: string; sizeBytes: number }

export function MessageComposer({
  channelId,
  members,
  onSend,
  disabled = false,
  archived = false,
}: {
  // 첨부 사전 업로드 대상 채널.
  channelId: number
  // @멘션 후보 = 해당 채널/DM 의 구성원.
  members: MentionCandidate[]
  onSend: (body: string, fileIds: number[]) => void
  // 단순 비활성(수신자 미선택·전송중 등) — 입력기를 숨긴다(안내 문구 없음).
  disabled?: boolean
  // 보관된 채널 — "보관됨" 안내만 표시하고 입력기를 띄우지 않는다.
  archived?: boolean
}) {
  // 사전 업로드된(아직 전송 안 된) 첨부.
  const [pending, setPending] = useState<PendingFile[]>([])
  const [uploading, setUploading] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)

  // 보관된 채널은 입력기를 띄우지 않고 안내만 표시(전송 자체를 차단).
  if (archived) {
    return (
      <div className="border-t p-3">
        <p className="text-sm text-muted-foreground">이 채널은 보관되었습니다</p>
      </div>
    )
  }

  // 단순 비활성(수신자 미선택·전송중 등)은 입력기를 숨긴다 — "보관됨" 오표시 방지.
  if (disabled) {
    return null
  }

  // 파일 선택 시 즉시 사전 업로드 → pending 에 메타 누적.
  const onFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    setUploading(true)
    try {
      const { data } = await messagingApi.uploadAttachments(channelId, Array.from(files))
      setPending((prev) => [...prev, ...data])
    } catch (err) {
      // 업로드 실패는 토스트로 알린다(무음 실패 방지).
      handleApiError(err, '첨부 업로드에 실패했어요')
    } finally {
      setUploading(false)
      // 같은 파일 재선택을 위해 input 초기화.
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  // 본문·첨부 둘 다 비면 전송 차단. 전송 후 pending 비움.
  const handleSubmit = (body: string) => {
    const trimmed = body.trim()
    if (!trimmed && pending.length === 0) return
    onSend(trimmed, pending.map((p) => p.fileId))
    setPending([])
  }

  return (
    <div className="border-t p-3" data-testid="message-composer">
      {pending.length > 0 && (
        <ul className="mb-2 flex flex-wrap gap-2" data-testid="composer-attachments">
          {pending.map((p) => (
            <li
              key={p.fileId}
              className="flex items-center gap-1 rounded-md border bg-card px-2 py-1 text-xs"
            >
              <span className="max-w-[10rem] truncate">{p.originalName}</span>
              <button
                type="button"
                aria-label="첨부 제거"
                onClick={() =>
                  setPending((prev) => prev.filter((x) => x.fileId !== p.fileId))
                }
              >
                <X className="h-3 w-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-end gap-2">
        <button
          type="button"
          aria-label="파일 첨부"
          data-testid="composer-attach-button"
          className="rounded-md p-2 hover:bg-accent/40"
          onClick={() => inputRef.current?.click()}
        >
          <Paperclip className="h-4 w-4" />
        </button>
        <input
          ref={inputRef}
          type="file"
          multiple
          className="hidden"
          data-testid="composer-file-input"
          onChange={(e) => onFiles(e.target.files)}
        />
        <div className="flex-1">
          {/* 첨부가 있으면 본문이 비어도 전송 허용(allowEmptySubmit). */}
          <RichInput
            members={members}
            onSubmit={handleSubmit}
            clearOnSubmit
            allowEmptySubmit={pending.length > 0}
            disableWhenEmpty
            placeholder="메시지를 입력하세요"
            submitLabel={uploading ? '업로드 중…' : '보내기'}
            inputTestId="message-composer-input"
            submitTestId="message-composer-submit"
          />
        </div>
      </div>
    </div>
  )
}
