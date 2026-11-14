// 파일 mime → 유형 아이콘 컴포넌트 판정(WP-203 → WP-1545 에서 따로 꺼냄). React 컴포넌트(FileTypeIcon)와 React 밖 DOM
// (노트 본문 첨부 칩 데코레이션)이 같은 아이콘을 쓰게 한 곳에서 정한다.

import {
  File as FileIcon,
  FileArchive,
  FileAudio,
  FileSpreadsheet,
  FileText,
  FileVideo,
  Image as ImageIcon,
  type LucideIcon,
  Presentation,
} from 'lucide-react'

import { canonicalMime } from '../../lib/mimeFromFilename'
import { CONVERTIBLE_MIMES, isPresentationMime, resolvePreviewKind } from '../../lib/previewKind'

/** 압축 파일 mime — 프리뷰 종류와 별개로 아이콘만 구분한다. */
const ARCHIVE_MIMES = new Set([
  'application/zip',
  'application/x-zip-compressed',
  'application/x-7z-compressed',
  'application/x-rar-compressed',
  'application/vnd.rar',
  'application/gzip',
  'application/x-tar',
])

/**
 * 파일 mime → 유형 아이콘 컴포넌트. React 밖 DOM(노트 본문 첨부 칩 데코레이션, WP-1545)도 같은 아이콘을 쓰게 판정만 따로 둔다.
 */
export function fileTypeIconOf(mimeType: string): LucideIcon {
  if (ARCHIVE_MIMES.has(mimeType)) return FileArchive
  // 변환 미리보기 문서(WP-431) — 발표 자료는 슬라이드 아이콘, 한글·워드는 문서 아이콘(미리보기 종류로는 UNSUPPORTED 라 기타로 떨어지지 않게).
  // 구형 엑셀(XLS)은 XLSX 종류로 판정돼 아래 표 아이콘을 쓴다. 한글 별칭(haansofthwp 등)도 같은 아이콘이 되게 정규형으로 비교한다.
  const canonical = canonicalMime(mimeType)
  if (isPresentationMime(canonical)) return Presentation
  if (CONVERTIBLE_MIMES.has(canonical)) return FileText
  switch (resolvePreviewKind(mimeType)) {
    case 'IMAGE':
      return ImageIcon
    case 'CSV':
    case 'XLSX':
      return FileSpreadsheet
    // 영상·오디오(WP-281) — 기본(문서 아이콘)으로 떨어지지 않게 따로 둔다.
    case 'VIDEO':
      return FileVideo
    case 'AUDIO':
      return FileAudio
    case 'UNSUPPORTED':
      return FileIcon
    default:
      return FileText
  }
}
