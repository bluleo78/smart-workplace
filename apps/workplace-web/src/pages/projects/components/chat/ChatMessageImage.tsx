import { useChatAttachmentBlob } from '@/hooks/useChatAttachmentBlob'
import type { MessageAttachment } from '@/types/messaging'

/** 이슈 채팅 이미지 첨부 인라인 썸네일. blob objectURL(Bearer 인증) 사용. 클릭 시 새 탭 원본. (#358) */
export function ChatMessageImage({
  threadId,
  attachment,
}: {
  threadId: number
  attachment: MessageAttachment
}) {
  const { url, error } = useChatAttachmentBlob(threadId, attachment.messageId, attachment.fileId)
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
