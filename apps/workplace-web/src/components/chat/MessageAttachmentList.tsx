import { Cloud, FileText } from 'lucide-react'

import { cn } from '@/lib/utils'
import type { DriveLink } from '@/types/drive'
import type { MessageAttachment } from '@/types/messaging'

/** 바이트 → 사람이 읽기 쉬운 크기 문자열. */
function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** 목록이 쓰는 최소 필드 — 팀·이슈 채팅 MessageAttachment 와 메인 AI 채팅 TurnAttachment(WP-234)가 함께 만족한다. */
type AttachmentLike = Pick<MessageAttachment, 'fileId' | 'originalName' | 'mimeType' | 'sizeBytes'>

/** 메시지 본문 아래 첨부 목록. 카드는 max-w-full min-w-0 로 부모 폭에 묶이고, 파일명(truncate)만 줄어든다 —
 * 크기·링크 배지는 shrink-0 whitespace-nowrap 으로 좁은 카드에서도 한 줄을 유지한다. 이미지는 renderImage 로 위임, 그 외는 다운로드 카드.
 * 도메인(팀/이슈/메인 AI 채팅) 무관 — 다운로드 핸들러·이미지 렌더를 주입받는다. (#80, #358, WP-234)
 * className 은 정렬 등 배치만 덧붙인다(예: 메인 AI 채팅 사용자 말풍선의 오른쪽 정렬). 기본값은 기존 동작. */
export function MessageAttachmentList<A extends AttachmentLike>({
  attachments,
  driveLinks = [],
  onDownloadAttachment,
  onDownloadDriveLink,
  renderImage,
  className,
}: {
  attachments: A[]
  driveLinks?: DriveLink[]
  onDownloadAttachment: (a: A) => void
  onDownloadDriveLink: (dl: DriveLink) => void
  renderImage: (a: A) => React.ReactNode
  className?: string
}) {
  if ((!attachments || attachments.length === 0) && driveLinks.length === 0) return null
  return (
    <div className={cn('mt-1 flex flex-col gap-1', className)} data-testid="message-attachments">
      {attachments.map((a) =>
        a.mimeType.startsWith('image/') ? (
          <span key={a.fileId}>{renderImage(a)}</span>
        ) : (
          <button
            key={a.fileId}
            type="button"
            data-testid={`attachment-card-${a.fileId}`}
            onClick={() => onDownloadAttachment(a)}
            className="flex max-w-full min-w-0 items-center gap-2 rounded-md border bg-card px-2 py-1 text-left text-sm hover:bg-accent/40"
          >
            <FileText className="h-4 w-4 shrink-0" />
            <span className="min-w-0 truncate">{a.originalName}</span>
            <span className="shrink-0 whitespace-nowrap text-xs text-muted-foreground">{humanSize(a.sizeBytes)}</span>
          </button>
        ),
      )}
      {/* #80: 드라이브 연결 파일 — 업로드 첨부와 같은 행 스타일 + info 배지. */}
      {driveLinks.map((dl) => (
        <button
          key={dl.driveFileId}
          type="button"
          data-testid={`message-drive-link-${dl.driveFileId}`}
          onClick={() => onDownloadDriveLink(dl)}
          className="flex max-w-full min-w-0 items-center gap-2 rounded-md border bg-card px-2 py-1 text-left text-sm hover:bg-accent/40"
        >
          <Cloud className="h-4 w-4 shrink-0 text-info" />
          <span className="min-w-0 truncate">{dl.name}</span>
          <span className="shrink-0 whitespace-nowrap rounded px-1 py-0.5 text-xs bg-info-subtle text-info">☁ 링크</span>
          <span className="shrink-0 whitespace-nowrap text-xs text-muted-foreground">{humanSize(dl.sizeBytes)}</span>
        </button>
      ))}
    </div>
  )
}
