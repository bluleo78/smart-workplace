// RichInput 이미지 노드뷰(WP-362) — 입력창 안에서는 작은 썸네일(데스크톱 80px·모바일 56px)로만 보여 준다.
// 등록 후 목록에서는 원래 크기로 그린다(IssueBodyImage). 이슈 이미지 경로는 blob objectURL 로 바꿔 표시한다
// (메모리 Bearer 라 <img> 가 Authorization 헤더를 못 싣는다 — WikiImageNodeView 와 같은 이유).
import { NodeViewWrapper, type ReactNodeViewProps } from '@tiptap/react'
import { ImageOff } from 'lucide-react'

import { useApiBlobUrl } from '../../hooks/queries/useApiBlobUrl'
import { isIssueImageSrc } from './apiImageSegments'

// 썸네일 공통 크기 — 입력창 높이를 덜 차지하도록 높이만 고정하고 너비는 비율대로(최대 폭 제한).
const THUMB = 'block h-14 lg:h-20 max-w-[12rem] rounded-md border border-border'

export function RichImageNodeView({ node, selected }: ReactNodeViewProps) {
  const src = node.attrs.src ? String(node.attrs.src) : ''
  const alt = node.attrs.alt ? String(node.attrs.alt) : ''
  const pending = Boolean(node.attrs.uploadId)
  // 이슈 이미지 경로만 인증 요청으로 받는다 — 글에 적힌 임의 API 경로를 보는 사람의 권한으로 호출하지 않게.
  // 그 밖의 src 는 노드가 만들어지지 않지만(parseHTML·bodyToDoc), 혹시 오면 요청 없이 "불러올 수 없음" 으로 둔다.
  const issueImage = isIssueImageSrc(src)
  const { url, isError: fetchError } = useApiBlobUrl(issueImage ? src : null)
  const isError = fetchError || (!pending && !issueImage)
  const shown = url

  // 인라인 노드라 wrapper 는 span. 선택되면(클릭) 테두리로 표시 — Backspace/Delete 로 지울 수 있다는 단서.
  return (
    <NodeViewWrapper
      as="span"
      className={`my-1 inline-block align-bottom ${selected ? 'rounded-md ring-2 ring-ring' : ''}`}
      data-testid="rich-image"
      data-pending={pending ? 'true' : undefined}
    >
      {pending ? (
        <span className={`${THUMB} w-20 lg:w-32 flex items-center justify-center bg-muted text-xs text-muted-foreground`}>
          업로드 중…
        </span>
      ) : isError ? (
        <span className={`${THUMB} w-20 lg:w-32 flex items-center justify-center gap-1 border-dashed text-xs text-muted-foreground`}>
          <ImageOff className="h-3.5 w-3.5" /> 불러올 수 없음
        </span>
      ) : shown ? (
        <img src={shown} alt={alt} className={`${THUMB} w-auto object-cover`} draggable={false} />
      ) : (
        <span className={`${THUMB} w-20 lg:w-32 animate-pulse bg-muted`} />
      )}
    </NodeViewWrapper>
  )
}
