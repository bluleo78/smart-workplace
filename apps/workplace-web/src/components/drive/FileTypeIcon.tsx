// 파일 mime → 유형 아이콘(이미지/표/문서/영상/오디오/압축/기타). 이슈 첨부 칩과 이슈 드라이브 링크 행이 함께 쓴다.
// 왜: 같은 이슈 화면에서 같은 파일 유형이 행마다 다른 아이콘으로 보이지 않게 한 곳에서 정한다(WP-203).

import {
  File as FileIcon,
  FileArchive,
  FileAudio,
  FileSpreadsheet,
  FileText,
  FileVideo,
  Image as ImageIcon,
} from 'lucide-react'

import { resolvePreviewKind } from '../../lib/previewKind'
import { cn } from '../../lib/utils'

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

/** className 으로 기본 크기·색(h-4 · muted)을 덮어쓸 수 있다 — 미리보기 헤더처럼 더 크게 쓰는 곳용(WP-274). */
export function FileTypeIcon({ mimeType, className }: { mimeType: string; className?: string }) {
  const cls = cn('h-4 w-4 shrink-0 text-muted-foreground', className)
  if (ARCHIVE_MIMES.has(mimeType)) return <FileArchive className={cls} aria-hidden />
  switch (resolvePreviewKind(mimeType)) {
    case 'IMAGE':
      return <ImageIcon className={cls} aria-hidden />
    case 'CSV':
    case 'XLSX':
      return <FileSpreadsheet className={cls} aria-hidden />
    // 영상·오디오(WP-281) — 기본(문서 아이콘)으로 떨어지지 않게 따로 둔다.
    case 'VIDEO':
      return <FileVideo className={cls} aria-hidden />
    case 'AUDIO':
      return <FileAudio className={cls} aria-hidden />
    case 'UNSUPPORTED':
      return <FileIcon className={cls} aria-hidden />
    default:
      return <FileText className={cls} aria-hidden />
  }
}
