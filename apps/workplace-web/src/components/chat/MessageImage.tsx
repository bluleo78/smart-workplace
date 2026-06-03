import { useAttachmentBlob } from '@/hooks/useAttachmentBlob'
import type { MessageAttachment } from '@/types/messaging'

/** 이미지 첨부 인라인 썸네일. blob objectURL 사용(Bearer 인증). 클릭 시 새 탭 원본. */
export function MessageImage({
  channelId,
  attachment,
}: {
  channelId: number
  attachment: MessageAttachment
}) {
  const { url, error } = useAttachmentBlob(channelId, attachment.messageId, attachment.fileId)
  if (error)
    return <span className="text-xs text-muted-foreground">이미지를 불러올 수 없습니다</span>
  if (!url)
    return (
      <div
        className="h-32 w-32 animate-pulse rounded-md bg-muted"
        data-testid={`attachment-image-loading-${attachment.fileId}`}
      />
    )
  return (
    <a href={url} target="_blank" rel="noreferrer">
      <img
        src={url}
        alt={attachment.originalName}
        data-testid={`attachment-image-${attachment.fileId}`}
        className="max-h-64 max-w-xs rounded-md border object-contain"
      />
    </a>
  )
}
