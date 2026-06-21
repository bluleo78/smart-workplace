import { Cloud, FileText } from 'lucide-react'

import { downloadMessageDriveLink } from '@/api/driveLinks'
import { messagingApi } from '@/api/messaging'
import type { DriveLink } from '@/types/drive'
import type { MessageAttachment } from '@/types/messaging'

import { MessageImage } from './MessageImage'

/** 바이트 → 사람이 읽기 쉬운 크기 문자열. */
function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** 메시지 본문 아래 첨부 목록. 이미지는 인라인 썸네일, 그 외는 다운로드 카드.
 * #80: driveLinks(드라이브 연결 파일)도 같은 행 스타일로 렌더. */
export function MessageAttachmentList({
  channelId,
  messageId,
  attachments,
  driveLinks = [],
}: {
  channelId: number
  /** 드라이브 링크 다운로드 엔드포인트에 필요한 메시지 id. */
  messageId: number
  attachments: MessageAttachment[]
  /** 드라이브 연결 파일 목록. (#80) */
  driveLinks?: DriveLink[]
}) {
  if ((!attachments || attachments.length === 0) && driveLinks.length === 0) return null
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
      {/* #80: 드라이브 연결 파일 — 업로드 첨부와 같은 행 스타일 + info 배지. */}
      {driveLinks.map((dl) => (
        <button
          key={dl.driveFileId}
          type="button"
          data-testid={`message-drive-link-${dl.driveFileId}`}
          onClick={() => void downloadMessageDriveLink(channelId, messageId, dl.driveFileId, dl.name)}
          className="flex items-center gap-2 rounded-md border bg-card px-2 py-1 text-left text-sm hover:bg-accent/40"
        >
          <Cloud className="h-4 w-4 shrink-0 text-info" />
          <span className="truncate">{dl.name}</span>
          <span className="rounded px-1 py-0.5 text-xs bg-info-subtle text-info">☁ 링크</span>
          <span className="text-xs text-muted-foreground">{humanSize(dl.sizeBytes)}</span>
        </button>
      ))}
    </div>
  )
}
