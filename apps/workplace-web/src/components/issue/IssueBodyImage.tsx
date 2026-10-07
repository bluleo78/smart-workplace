// 이슈 본문 마크다운의 이미지 렌더러(WP-199).
// 이 프로젝트의 이슈 이미지 경로만 인증 blob 으로 받아 표시한다(Bearer 토큰이라 <img src> 직접 요청은 401).
// https 외부 이미지는 그대로, 그 밖의 경로·스킴은 요청하지 않고 alt 만 보여 준다 —
// 본문 마크다운이 보는 사람의 인증으로 임의 API 를 호출하게 두지 않기 위함.
import { ImageOff } from 'lucide-react'
import { useState } from 'react'

import { issueImageFileId } from '../../api/issueImages'
import { useApiBlobUrl } from '../../hooks/queries/useApiBlobUrl'
import { AttachmentViewer } from '../viewer/AttachmentViewer'
import { issueBodyImageItem } from '../viewer/viewerItems'

export function IssueBodyImage({ projectKey, src, alt }: { projectKey: string; src?: string; alt?: string }) {
  const fileId = issueImageFileId(projectKey, src)
  if (src && fileId !== null) return <AuthIssueImage src={src} fileId={fileId} alt={alt ?? ''} />
  if (src?.startsWith('https://')) {
    return <img
        src={src}
        alt={alt ?? ''}
        referrerPolicy="no-referrer"
        loading="lazy"
        className="my-2 h-auto max-w-full rounded-md border border-border"
      />
  }
  return <span className="text-muted-foreground">{alt}</span>
}

// 이미지·미리보기 모달 클릭이 "클릭=편집 진입" 으로 번지지 않게 하는 처리는 본문 보기 래퍼(InlineEditableBody)가 맡는다 —
// 여기서 전파를 끊지 않는다.
function AuthIssueImage({ src, fileId, alt }: { src: string; fileId: number; alt: string }) {
  const { url, isError, blob } = useApiBlobUrl(src)
  const [open, setOpen] = useState(false)
  if (isError) {
    return (
      <span className="inline-flex items-center gap-1 rounded-md border border-dashed border-border px-2 py-1 text-xs text-muted-foreground">
        <ImageOff className="h-3.5 w-3.5" /> 이미지를 불러올 수 없음
      </span>
    )
  }
  if (!url) return <span role="img" aria-label={alt} className="inline-block h-32 w-48 animate-pulse rounded-md bg-muted" />
  return (
    <>
      <img
        src={url}
        alt={alt}
        className="my-2 block h-auto max-h-[480px] max-w-full cursor-zoom-in rounded-md border border-border"
        onClick={() => setOpen(true)}
      />
      {open && (
        // 본문 이미지는 묶음 없는 단건 뷰어(‹ › 없음) — 이미 받은 blob 으로 크기·MIME 을 채운다.
        <AttachmentViewer
          items={[issueBodyImageItem({ src, fileId, alt, blob })]}
          index={0}
          onIndexChange={() => {}}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}
