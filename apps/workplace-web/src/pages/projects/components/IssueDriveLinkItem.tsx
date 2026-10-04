// 이슈 드라이브 링크 1행 — 클라우드 배지 + 드라이브 위치 서브텍스트 (선택 C).
// 무엇을: 업로드 첨부와 한 목록에 렌더하되 드라이브 링크임을 info 배지로 구분.
// 왜: #80 이슈↔드라이브 파일 연결 시각화.

import { Cloud, X } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

import { Button } from '@/components/ui/button'

import { downloadIssueDriveLink } from '../../../api/driveLinks'
import { FileTypeIcon } from '../../../components/drive/FileTypeIcon'
import { formatFileSize } from '../../../lib/formatters'
import type { DriveLink } from '../../../types/drive'

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
        <FileTypeIcon mimeType={link.mimeType} />
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
        <span className="text-xs text-muted-foreground">{formatFileSize(link.sizeBytes)}</span>
        {canManage && (
          // 마우스는 hover 시에만 노출. WP-237: 터치 기기(pointer: coarse)는 hover 가 없어 상시 노출 +
          // 44px 터치 영역(음수 세로 마진으로 행 높이는 유지).
          // ⋯ 로 감추지 않는 이유: 해제는 확인창을 거치므로 상시 노출해도 오조작이 바로 실행되지 않는다(즉시 실행인 IssueLinkRow 와의 의도적 차이).
          <Button
            variant="ghost"
            size="icon"
            aria-label="링크 제거"
            className="hidden group-hover:inline-flex pointer-coarse:-my-2.5 pointer-coarse:inline-flex pointer-coarse:size-11"
            data-testid={`issue-drive-link-remove-${link.driveFileId}`}
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
