// 이슈 드라이브 링크 1행 — 클라우드 배지 + 드라이브 위치 서브텍스트 (선택 C).
// 무엇을: 업로드 첨부와 한 목록에 렌더하되 드라이브 링크임을 info 배지로 구분.
// 왜: #80 이슈↔드라이브 파일 연결 시각화.

import { Cloud, File as FileIcon, FileText, Image as ImageIcon, X } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

import { Button } from '@/components/ui/button'

import { downloadIssueDriveLink } from '../../../api/driveLinks'
import type { DriveLink } from '../../../types/drive'

// 바이트 → 사람이 읽는 단위 (B/KB/MB).
function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// MIME → 카테고리 아이콘.
function mimeIcon(mime: string) {
  if (mime.startsWith('image/')) return <ImageIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
  if (mime === 'application/pdf') return <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
  return <FileIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
}

export function IssueDriveLinkItem({
  projectKey,
  number,
  link,
  canManage,
  onRemove,
}: {
  projectKey: string
  number: number
  link: DriveLink
  canManage: boolean
  onRemove: (driveFileId: number) => void
}) {
  const navigate = useNavigate()
  const trashed = link.availability === 'TRASHED'

  return (
    <li
      className={`group flex flex-col gap-0.5 rounded px-1 py-1 text-sm hover:bg-accent/50${trashed ? ' opacity-50' : ''}`}
      data-testid={`issue-drive-link-${link.driveFileId}`}
    >
      <div className="flex items-center gap-2">
        {mimeIcon(link.mimeType)}
        {/* 파일명 클릭 → 드라이브 링크 다운로드 (휴지통이면 비활성화) */}
        <button
          type="button"
          disabled={trashed}
          onClick={() => downloadIssueDriveLink(projectKey, number, link.driveFileId, link.name)}
          className="flex-1 truncate text-left font-medium hover:underline disabled:cursor-not-allowed"
          aria-label={`${link.name} 다운로드`}
        >
          {link.name}
        </button>
        {/* 드라이브 링크 구분 배지 */}
        <span
          className="inline-flex items-center gap-1 rounded-full bg-info-subtle px-2 py-0.5 text-[10px] font-semibold text-info"
          data-testid={`issue-drive-link-badge-${link.driveFileId}`}
        >
          <Cloud className="h-3 w-3" /> 링크
        </span>
        <span className="text-xs text-muted-foreground">{humanSize(link.sizeBytes)}</span>
        {canManage && (
          <Button
            variant="ghost"
            size="icon"
            aria-label="링크 제거"
            className="hidden group-hover:inline-flex"
            onClick={() => onRemove(link.driveFileId)}
          >
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>
      {/* 드라이브 위치 — 휴지통이면 텍스트만, 아니면 공간 딥링크 버튼 */}
      {trashed ? (
        <span
          className="ml-6 truncate text-xs text-muted-foreground"
          data-testid={`issue-drive-link-location-${link.driveFileId}`}
        >
          휴지통에 있음
        </span>
      ) : (
        <button
          type="button"
          onClick={() => navigate(`/drive/spaces/${link.spaceId}`)}
          className="ml-6 truncate text-left text-xs text-muted-foreground hover:underline"
          data-testid={`issue-drive-link-location-${link.driveFileId}`}
        >
          📁 {link.spaceName}
        </button>
      )}
    </li>
  )
}
