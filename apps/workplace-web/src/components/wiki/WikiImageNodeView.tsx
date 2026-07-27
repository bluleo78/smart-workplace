// #750: 노트 본문 이미지 노드뷰. /api/v1 경로는 blob objectURL 로 치환해 표시하고,
// 외부 URL 은 브라우저에 그대로 맡긴다. 마크다운 본문에는 항상 원본 src 가 남는다
// (objectURL 을 본문에 쓰면 새로고침 시 깨진다).
import { NodeViewWrapper, type ReactNodeViewProps } from '@tiptap/react'

import { useApiBlobUrl } from '../../hooks/queries/useApiBlobUrl'

/** src 가 이 API 의 인증 필요 경로인지 — 그렇지 않으면 blob 변환 없이 그대로 렌더한다. */
function isApiPath(src: string): boolean {
  return src.startsWith('/api/v1/')
}

export function WikiImageNodeView({ node, selected }: ReactNodeViewProps) {
  const src = String(node.attrs.src ?? '')
  const alt = node.attrs.alt ? String(node.attrs.alt) : ''
  const title = node.attrs.title ? String(node.attrs.title) : undefined
  const needsBlob = isApiPath(src)
  const { url, isError } = useApiBlobUrl(needsBlob ? src : null)

  // 인라인 노드라 wrapper 도 span 이어야 한다(기본 div 는 문단 안에서 레이아웃이 깨진다).
  const wrapperClass = selected ? 'inline-block ring-2 ring-ring rounded-sm' : 'inline-block'

  if (!needsBlob) {
    return (
      <NodeViewWrapper as="span" className={wrapperClass}>
        <img
          data-testid="wiki-image"
          src={src}
          alt={alt}
          title={title}
          className="max-w-full rounded-sm"
        />
      </NodeViewWrapper>
    )
  }

  // 깨진 이미지 아이콘 대신 사유가 읽히는 플레이스홀더 — 권한 없음/삭제됨을 구분 못 하므로
  // 문구는 중립적으로 두고, retry:false 캐시가 재요청을 막는다.
  if (isError) {
    return (
      <NodeViewWrapper as="span" className={wrapperClass}>
        <span
          data-testid="wiki-image-error"
          className="inline-block rounded-sm border border-dashed border-border px-3 py-2 align-middle text-sm text-muted-foreground"
        >
          이미지를 불러올 수 없습니다{alt ? ` (${alt})` : ''}
        </span>
      </NodeViewWrapper>
    )
  }

  // isError 가 아니면서 url 이 아직 없는 상태 — 쿼리는 resolve 됐지만 objectURL 생성
  // effect 가 아직 안 돌았거나(한 프레임), 쿼리가 여전히 pending 인 경우. isPending 만으로
  // 분기하면 그 사이 프레임에 url 이 null 이라 에러 플레이스홀더가 잠깐 번쩍인다.
  if (!url) {
    return (
      <NodeViewWrapper as="span" className={wrapperClass}>
        <span
          data-testid="wiki-image-loading"
          className="inline-block h-24 w-40 animate-pulse rounded-sm bg-muted align-middle"
        />
      </NodeViewWrapper>
    )
  }

  return (
    <NodeViewWrapper as="span" className={wrapperClass}>
      <img
        data-testid="wiki-image"
        src={url}
        alt={alt}
        title={title}
        className="max-w-full rounded-sm"
      />
    </NodeViewWrapper>
  )
}
