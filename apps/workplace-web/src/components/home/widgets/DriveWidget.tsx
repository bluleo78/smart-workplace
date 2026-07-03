import { File, Folder, HardDrive } from 'lucide-react'
import { Link } from 'react-router-dom'

import { Skeleton } from '@/components/ui/skeleton'
import { useDriveItems } from '@/hooks/queries/useDriveItems'
import { useDriveSpaces } from '@/hooks/queries/useDriveSpaces'
import type { DriveSpace } from '@/types/drive'

import { WidgetError } from './WidgetError'
import { WidgetFrame } from './WidgetFrame'

/**
 * #460: 드라이브 위젯 — show_drive 지시를 받아 스페이스 목록 또는 폴더 내 파일/폴더 목록을 표시한다.
 * params.spaceId 미지정 → 스페이스 목록, 지정 → 해당 스페이스(선택적 folderId) 내 아이템 목록.
 * 클릭 시 /drive 로 딥링크.
 */
export default function DriveWidget({
  params,
  previewData,
}: {
  params?: Record<string, unknown>
  previewData?: DriveSpace[]
}) {
  const spaceId = typeof params?.spaceId === 'number' ? (params.spaceId as number) : undefined
  const folderId = typeof params?.folderId === 'number' ? (params.folderId as number) : undefined

  // 두 훅 항상 호출 — enabled 로 제어(React hooks 규칙 준수).
  const spaces = useDriveSpaces({ enabled: !previewData })
  const items = useDriveItems(spaceId, folderId)

  // spaceId 존재 여부에 따라 사용할 쿼리 결과 선택.
  const isSpaceMode = spaceId === undefined

  if (isSpaceMode) {
    // 스페이스 목록 모드.
    if (!previewData && spaces.isLoading) {
      return (
        <WidgetFrame title="드라이브">
          <Skeleton className="h-24 w-full" />
        </WidgetFrame>
      )
    }
    if (!previewData && spaces.isError) {
      return (
        <WidgetFrame title="드라이브">
          <WidgetError onRetry={() => spaces.refetch()} testId="drive-error" />
        </WidgetFrame>
      )
    }

    const spaceList = previewData ?? spaces.data ?? []
    return (
      <WidgetFrame title="드라이브">
        {spaceList.length > 0 ? (
          <ul className="divide-y" data-testid="drive-items">
            {spaceList.map((space) => (
              <li key={space.id}>
                {/* 드라이브 메인 페이지(/drive)로 딥링크. */}
                <Link
                  to="/drive"
                  aria-label={`드라이브 스페이스: ${space.name}`}
                  className="flex items-center gap-2 py-2 text-sm hover:text-ai-accent"
                >
                  <HardDrive className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="flex-1 truncate font-medium">{space.name}</span>
                  {/* 스페이스 유형 표식 */}
                  <span className="shrink-0 text-xs text-muted-foreground">{space.type}</span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <div
            className="flex flex-col items-center gap-2 px-4 py-8 text-center"
            data-testid="drive-empty"
          >
            <HardDrive className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm font-semibold">드라이브가 없어요</p>
            <p className="max-w-xs text-xs text-muted-foreground">아직 접근 가능한 드라이브 스페이스가 없습니다.</p>
          </div>
        )}
      </WidgetFrame>
    )
  }

  // 아이템 목록 모드(spaceId 지정).
  if (items.isLoading) {
    return (
      <WidgetFrame title="드라이브">
        <Skeleton className="h-24 w-full" />
      </WidgetFrame>
    )
  }
  if (items.isError) {
    return (
      <WidgetFrame title="드라이브">
        <WidgetError onRetry={() => items.refetch()} testId="drive-error" />
      </WidgetFrame>
    )
  }

  const folders = items.data?.folders ?? []
  const files = items.data?.files ?? []
  const totalCount = folders.length + files.length

  return (
    <WidgetFrame title="드라이브">
      {totalCount > 0 ? (
        <ul className="divide-y" data-testid="drive-items">
          {/* 폴더 먼저 */}
          {folders.map((folder) => (
            <li key={`folder-${folder.id}`}>
              <Link
                to="/drive"
                aria-label={`폴더: ${folder.name}`}
                className="flex items-center gap-2 py-2 text-sm hover:text-ai-accent"
              >
                <Folder className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                <span className="flex-1 truncate font-medium">{folder.name}</span>
              </Link>
            </li>
          ))}
          {/* 파일 */}
          {files.map((file) => (
            <li key={`file-${file.id}`}>
              <Link
                to="/drive"
                aria-label={`파일: ${file.name}`}
                className="flex items-center gap-2 py-2 text-sm hover:text-ai-accent"
              >
                <File className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                <span className="flex-1 truncate font-medium">{file.name}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <div
          className="flex flex-col items-center gap-2 px-4 py-8 text-center"
          data-testid="drive-empty"
        >
          <HardDrive className="h-8 w-8 text-muted-foreground" />
          <p className="text-sm font-semibold">파일이 없어요</p>
          <p className="max-w-xs text-xs text-muted-foreground">이 폴더에 표시할 파일이 없습니다.</p>
        </div>
      )}
    </WidgetFrame>
  )
}
