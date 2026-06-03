import { FileText } from 'lucide-react'

import { messagingApi } from '@/api/messaging'
import type { MessageAttachment } from '@/types/messaging'

import { MessageImage } from './MessageImage'

/** 바이트 → 사람이 읽기 쉬운 크기 문자열. */
function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** 메시지 본문 아래 첨부 목록. 이미지는 인라인 썸네일, 그 외는 다운로드 카드. */
export function MessageAttachmentList({
  channelId,
  attachments,
}: {
  channelId: number
  attachments: MessageAttachment[]
}) {
  if (!attachments || attachments.length === 0) return null
  return (
    <div className="mt-1 flex flex-col gap-1" data-testid="message-attachments">
      {attachments.map((a) =>
        a.mimeType.startsWith('image/') ? (
          <MessageImage key={a.fileId} channelId={channelId} attachment={a} />
        ) : (
          <button
            key={a.fileId}
            type="button"
            data-testid={`attachment-card-${a.fileId}`}
            onClick={() =>
              messagingApi.downloadAttachment(channelId, a.messageId, a.fileId, a.originalName)
            }
            className="flex items-center gap-2 rounded-md border bg-card px-2 py-1 text-left text-sm hover:bg-accent/40"
          >
            <FileText className="h-4 w-4 shrink-0" />
            <span className="truncate">{a.originalName}</span>
            <span className="text-xs text-muted-foreground">{humanSize(a.sizeBytes)}</span>
          </button>
        ),
      )}
    </div>
  )
}
