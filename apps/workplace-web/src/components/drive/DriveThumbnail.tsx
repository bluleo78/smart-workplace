import {
  File as FileIcon,
  FileSpreadsheet,
  FileText,
  FileType,
  Image as ImageIcon,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { useDriveThumbnail } from '../../hooks/queries/useDriveThumbnail'

/**
 * 파일 셀 썸네일. IMAGE 는 썸네일 blob(objectURL)을 표시하고, 썸네일이 없거나(생성실패/webp 등)
 * 비이미지면 카테고리 아이콘으로 폴백.
 * blob 조회는 React Query(useDriveThumbnail)가 캐시 — 404(생성 실패)도 negative-cache 되어
 * 목록 재방문(리스트 재마운트)마다 동일 요청을 반복하지 않는다(#615).
 * objectURL 은 캐시된 blob 이 바뀔 때만 새로 생성하고, 이전 objectURL 은 그때/언마운트 시 revoke.
 *
 * #701: 목록(공간 루트/폴더/검색결과/폴더선택모달)이 windowing 없이 전체 파일을 한 번에 마운트하므로,
 * 뷰포트 밖 항목까지 즉시 썸네일 쿼리를 발사하면 파일 수에 비례해 요청이 폭증(N+1)한다.
 * IntersectionObserver 로 요소가 뷰포트(rootMargin 200px 여유)에 들어올 때만 쿼리를 활성화하고,
 * 최초 진입 후에는 재요청 방지를 위해 즉시 disconnect — 스크롤로 벗어나도 언로드하지 않는다.
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
  const [inView, setInView] = useState(false)
  const elRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const el = elRef.current
    if (!el || inView) return
    // IntersectionObserver 미지원 환경(구형 브라우저)에서는 폴리필 없이 항상 지원된다고 가정 —
    // 현재 타겟 브라우저(Evergreen)에서 100% 지원되므로 폴백 없이 단순화.
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setInView(true)
          observer.disconnect()
        }
      },
      { rootMargin: '200px' },
    )
    observer.observe(el)
    return () => observer.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const { data: blob } = useDriveThumbnail(fileId, inView && available && category === 'IMAGE')
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

  // 관찰 대상 엘리먼트 — 뷰포트 진입 전에도 자리(h-8 w-8)를 유지해 레이아웃 시프트가 없다.
  if (available && category === 'IMAGE' && url) {
    return (
      <div ref={elRef} className="h-8 w-8 shrink-0">
        <img src={url} alt="" className="h-8 w-8 rounded object-cover" />
      </div>
    )
  }

  // #739: 원본 유실 파일 — 실제 콘텐츠를 반영할 수 없으므로 포맷 무관 제네릭 플레이스홀더.
  if (!available) {
    return (
      <div ref={elRef} className="h-8 w-8 shrink-0">
        <FileIcon className="h-8 w-8 p-1 text-muted-foreground opacity-50" aria-hidden />
      </div>
    )
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
  return (
    <div ref={elRef} className="h-8 w-8 shrink-0">
      <Icon className="h-8 w-8 p-1 text-muted-foreground" aria-hidden />
    </div>
  )
}
