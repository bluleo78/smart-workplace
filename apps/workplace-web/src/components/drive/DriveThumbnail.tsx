import { File as FileIcon, FileText, FileType, Image as ImageIcon } from 'lucide-react'
import { useEffect, useState } from 'react'

import { driveApi } from '../../api/drive'

/**
 * 파일 셀 썸네일. IMAGE 는 썸네일 blob(objectURL)을 표시하고, 썸네일이 없거나(생성실패/webp 등)
 * 비이미지면 카테고리 아이콘으로 폴백. objectURL 은 언마운트 시 revoke.
 */
export function DriveThumbnail({ fileId, category }: { fileId: number; category: string }) {
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    if (category !== 'IMAGE') return
    let alive = true
    let created: string | null = null
    void driveApi.fetchThumbnailUrl(fileId).then((u) => {
      if (!alive) {
        if (u) URL.revokeObjectURL(u)
        return
      }
      created = u
      setUrl(u)
    })
    return () => {
      alive = false
      if (created) URL.revokeObjectURL(created)
    }
  }, [fileId, category])

  if (category === 'IMAGE' && url) {
    return <img src={url} alt="" className="h-8 w-8 shrink-0 rounded object-cover" />
  }

  const Icon =
    category === 'PDF'
      ? FileText
      : category === 'TEXT'
        ? FileType
        : category === 'IMAGE'
          ? ImageIcon
          : FileIcon
  return <Icon className="h-8 w-8 shrink-0 p-1 text-muted-foreground" aria-hidden />
}
