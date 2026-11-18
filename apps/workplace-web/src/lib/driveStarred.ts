// 「별표」(WP-1698) 화면의 순수 판정 — 화면과 떼어 vitest 로 지킨다.
import { driveFilePath } from '@/components/viewer/driveOpen'
import type { DriveFile, DriveStarredItem } from '@/types/drive'

import { driveFolderPath } from './appUrl'
import { isDriveOriginalMissing } from './driveRowActions'
import { formatFileSize } from './formatters'

/**
 * 목록 행 둘째 줄 — 경로(최상위면 생략) 뒤에 파일은 크기, 폴더는 「폴더 n개 · 파일 n개」를 「 · 」로 잇는다.
 * 공간 이름은 따로 칸이 있어(좁은 폭은 셋째 줄) 여기 넣지 않는다.
 */
export function starredMetaLine(item: DriveStarredItem): string {
  const size =
    item.kind === 'FOLDER'
      ? `폴더 ${item.folderCount ?? 0}개 · 파일 ${item.fileCount ?? 0}개`
      : formatFileSize(item.sizeBytes ?? 0)
  return [item.path, size].filter(Boolean).join(' · ')
}

/** 「파일 위치 열기」 주소 — 파일은 그 폴더에서 보기 창(?preview)까지 연 주소, 폴더는 그 폴더가 들어 있는 상위 폴더. */
export function starredLocationPath(item: DriveStarredItem): string {
  return item.kind === 'FILE'
    ? driveFilePath(item.spaceId, item.parentFolderId, item.id)
    : driveFolderPath(item.spaceId, item.parentFolderId)
}

/** 원본 유실 파일 행인가 — 공간 화면과 같은 기준(isDriveOriginalMissing)을 파일 행에만 댄다. */
export function isStarredMissing(item: DriveStarredItem): boolean {
  return item.kind === 'FILE' && isDriveOriginalMissing(item)
}

/**
 * 파일 행 → 보기 창 항목을 만들 드라이브 파일 모양(driveFileItem 입력). 버전 수·원본 유무는 서버 값을 그대로 옮기고(공간 화면과 같은 판정),
 * 값이 없는 옛 응답이면 버전 1·원본 있음으로 둔다. 폴더 행이면 null.
 */
export function starredViewerFile(item: DriveStarredItem): DriveFile | null {
  if (item.kind !== 'FILE' || item.fileId == null) return null
  return {
    id: item.id,
    folderId: item.parentFolderId,
    fileId: item.fileId,
    name: item.name,
    mimeType: item.mimeType ?? '',
    sizeBytes: item.sizeBytes ?? 0,
    category: item.category ?? '',
    createdAt: item.updatedAt,
    updatedAt: item.updatedAt,
    versionCount: item.versionCount ?? 1,
    available: item.available ?? true,
    starred: true,
  }
}
