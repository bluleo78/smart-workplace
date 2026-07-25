import {
  File as FileIcon,
  FileSpreadsheet,
  FileText,
  FileType,
  Image as ImageIcon,
} from 'lucide-react'
import { useEffect, useState } from 'react'

import { useDriveThumbnail } from '../../hooks/queries/useDriveThumbnail'

/**
 * 파일 셀 썸네일. IMAGE 는 썸네일 blob(objectURL)을 표시하고, 썸네일이 없거나(생성실패/webp 등)
 * 비이미지면 카테고리 아이콘으로 폴백.
 * blob 조회는 React Query(useDriveThumbnail)가 캐시 — 404(생성 실패)도 negative-cache 되어
 * 목록 재방문(리스트 재마운트)마다 동일 요청을 반복하지 않는다(#615).
 * objectURL 은 캐시된 blob 이 바뀔 때만 새로 생성하고, 이전 objectURL 은 그때/언마운트 시 revoke.
 */
export function DriveThumbnail({
  fileId,
  category,
  available = true,
}: {
  fileId: number
  category: string
  // #739: 원본 blob 이 유실된 파일 — false 면 썸네일 요청 자체를 보내지 않고 플레이스홀더만 표시.
  available?: boolean
}) {
  const { data: blob } = useDriveThumbnail(fileId, available && category === 'IMAGE')
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!blob) {
      setUrl(null)
      return
    }
    const objectUrl = URL.createObjectURL(blob)
    setUrl(objectUrl)
    return () => URL.revokeObjectURL(objectUrl)
  }, [blob])

  if (available && category === 'IMAGE' && url) {
    return <img src={url} alt="" className="h-8 w-8 shrink-0 rounded object-cover" />
  }

  // #739: 원본 유실 파일 — 실제 콘텐츠를 반영할 수 없으므로 포맷 무관 제네릭 플레이스홀더.
  if (!available) {
    return <FileIcon className="h-8 w-8 shrink-0 p-1 text-muted-foreground opacity-50" aria-hidden />
  }

  // 알려진 포맷은 포맷별 아이콘으로: 문서(PDF/DOCX)→문서, 표(CSV/XLSX)→스프레드시트,
  // 텍스트→텍스트, 이미지→이미지. 미지(UNKNOWN 등)만 제네릭 파일 아이콘.
  const Icon =
    category === 'PDF' || category === 'DOCUMENT'
      ? FileText
      : category === 'DATA'
        ? FileSpreadsheet
        : category === 'TEXT'
          ? FileType
          : category === 'IMAGE'
            ? ImageIcon
            : FileIcon
  return <Icon className="h-8 w-8 shrink-0 p-1 text-muted-foreground" aria-hidden />
}
