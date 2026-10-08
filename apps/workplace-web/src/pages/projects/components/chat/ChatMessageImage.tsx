import { ThumbnailButton } from '@/components/chat/ThumbnailButton'
import { useChatAttachmentBlob } from '@/hooks/useChatAttachmentBlob'
import type { MessageAttachment } from '@/types/messaging'

/** 이슈 채팅 이미지 첨부 인라인 썸네일. blob objectURL(Bearer 인증) 사용. 누르면 통합 뷰어(#358, WP-279 — 예전엔 새 탭 원본). */
export function ChatMessageImage({
  threadId,
  attachment,
  onOpen,
}: {
  threadId: number
  attachment: MessageAttachment
  /** 썸네일을 눌러 뷰어를 연다. 없으면(미확정 메시지 등) 누를 수 없는 그림으로만 둔다. */
  onOpen?: () => void
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
    <ThumbnailButton name={attachment.originalName} fileId={attachment.fileId} onOpen={onOpen}>
      <img
        src={url}
        alt={attachment.originalName}
        data-testid={`attachment-image-${attachment.fileId}`}
        className="max-h-64 max-w-xs rounded-md border object-contain"
      />
    </ThumbnailButton>
  )
}
