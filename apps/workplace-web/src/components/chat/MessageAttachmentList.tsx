import { Cloud, FileText } from 'lucide-react'

import { useOpenChatAttachment } from '@/components/chat/chatAttachmentViewerContext'
import type { ViewerItem } from '@/components/viewer/types'
import { attachmentMime } from '@/components/viewer/viewerItems'
import { isInlineImageType } from '@/lib/imageUpload'
import { cn } from '@/lib/utils'
import type { DriveLink } from '@/types/drive'
import type { MessageAttachment } from '@/types/messaging'

/** 바이트 → 사람이 읽기 쉬운 크기 문자열. */
function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** 파일·링크 카드 공통 모양 — 열 수 없으면(disabled) hover 강조를 끈다. */
const CARD_CLASS =
  'flex max-w-full min-w-0 items-center gap-2 rounded-md border bg-card px-2 py-1 text-left text-sm enabled:hover:bg-accent/40 disabled:cursor-default'

/**
 * 카드 버튼 속성 — 열 수 있으면 "{이름} 미리보기" 버튼, 없으면 비활성(포커스·클릭 불가, 접근 이름은 보이는 글자 그대로).
 * 왜: 동작하지 않는 "미리보기" 버튼이 스크린리더·키보드 사용자에게 노출되지 않게(썸네일 ThumbnailButton 과 같은 규칙).
 */
function cardOpenProps(name: string, onOpen: (() => void) | undefined) {
  return onOpen ? { 'aria-label': `${name} 미리보기`, onClick: onOpen } : { disabled: true }
}

/** 목록이 쓰는 최소 필드 — 팀·이슈 채팅 MessageAttachment 와 메인 AI 채팅 TurnAttachment(WP-234)가 함께 만족한다. */
type AttachmentLike = Pick<MessageAttachment, 'fileId' | 'originalName' | 'mimeType' | 'sizeBytes'>

/** 메시지 본문 아래 첨부 목록. 카드는 max-w-full min-w-0 로 부모 폭에 묶이고, 파일명(truncate)만 줄어든다 —
 * 크기·링크 배지는 shrink-0 whitespace-nowrap 으로 좁은 카드에서도 한 줄을 유지한다. 이미지는 renderImage 로 위임, 그 외는 파일 카드.
 * 도메인(팀/이슈/메인 AI 채팅) 무관 — 뷰어 항목 어댑터·이미지 렌더를 주입받는다. (#80, #358, WP-234)
 * className 은 정렬 등 배치만 덧붙인다(예: 메인 AI 채팅 사용자 말풍선의 오른쪽 정렬). 기본값은 기존 동작.
 * 썸네일(renderImage)은 isInlineImageType 4종만 — SVG·HEIC 등 그 외 image/* 는 파일 카드로 그린다(썸네일로 원본을 미리 받지 않게, WP-260).
 *
 * WP-279: 썸네일·카드를 누르면 새 탭·바로 다운로드 대신 통합 뷰어를 연다(다운로드는 뷰어 ⬇).
 * 묶음 = 이 메시지 한 건의 업로드 첨부 + 드라이브 링크(화면 표시 순서 그대로). 열기는 가장 가까운 ChatAttachmentViewerHost 가 맡는다.
 * bundle 이 없으면(미확정 메시지·세션 전 메인 AI 턴 — 콘텐츠 경로가 아직 없음) 열지 않고, 카드는 비활성으로 그린다.
 * 썸네일·카드 분기는 뷰어와 같은 추론 형식(attachmentMime)으로 한다 — octet-stream 으로 저장된 PNG 도 썸네일로 보이게. */
export function MessageAttachmentList<A extends AttachmentLike>({
  attachments,
  driveLinks = [],
  bundle,
  renderImage,
  className,
}: {
  attachments: A[]
  driveLinks?: DriveLink[]
  /**
   * 이 메시지의 뷰어 묶음(업로드 → 드라이브 링크, 화면 순서)을 만드는 함수 — 누를 때만 부른다(대부분 메시지는 열리지 않는다).
   * 없으면 열 수 없는 상태(미확정 메시지·세션 전 AI 턴).
   */
  bundle?: () => ViewerItem[]
  /** 썸네일 렌더 — onOpen 이 있으면 썸네일을 눌러 뷰어를 연다. */
  renderImage: (a: A, onOpen?: () => void) => React.ReactNode
  className?: string
}) {
  const openViewer = useOpenChatAttachment()
  if ((!attachments || attachments.length === 0) && driveLinks.length === 0) return null
  /** 묶음 i 번째 항목을 여는 핸들러 — 열 수 없으면 undefined. 묶음은 누를 때 만든다. */
  const opener = (i: number) =>
    openViewer && bundle
      ? () => {
          const key = bundle()[i]?.key
          if (key) openViewer(key)
        }
      : undefined
  return (
    <div className={cn('mt-1 flex flex-col gap-1', className)} data-testid="message-attachments">
      {attachments.map((a, i) =>
        isInlineImageType(attachmentMime(a.mimeType, a.originalName)) ? (
          <span key={a.fileId}>{renderImage(a, opener(i))}</span>
        ) : (
          <button
            key={a.fileId}
            type="button"
            data-testid={`attachment-card-${a.fileId}`}
            {...cardOpenProps(a.originalName, opener(i))}
            className={CARD_CLASS}
          >
            <FileText className="h-4 w-4 shrink-0" />
            <span className="min-w-0 truncate">{a.originalName}</span>
            <span className="shrink-0 whitespace-nowrap text-xs text-muted-foreground">{humanSize(a.sizeBytes)}</span>
          </button>
        ),
      )}
      {/* #80: 드라이브 연결 파일 — 업로드 첨부와 같은 행 스타일 + info 배지. 묶음에서 업로드 뒤 순서. */}
      {driveLinks.map((dl, j) => (
        <button
          key={dl.driveFileId}
          type="button"
          data-testid={`message-drive-link-${dl.driveFileId}`}
          {...cardOpenProps(dl.name, opener(attachments.length + j))}
          className={CARD_CLASS}
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
