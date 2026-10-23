// 팀 채팅 링크 미리보기 카드(WP-874) — 본문 URL 의 Open Graph 메타(사이트 이름·제목·설명·썸네일).
// 시안: 데스크톱(lg 이상)은 왼쪽 글·오른쪽 96px 썸네일, 모바일(lg 미만)은 위 이미지(폭 맞춤, 높이 최대 150)·아래 글.
// 썸네일은 서버 프록시 경로를 Bearer 인증 blob 으로 받는다(MessageImage 와 같은 방식). 못 받으면 이미지 자리를 숨긴다.
import { Globe, X } from 'lucide-react'
import { useState } from 'react'

import { messagingApi } from '@/api/messaging'
import { TextLink } from '@/components/LinkedText'
import { useAuthedBlob } from '@/hooks/useAuthedBlob'
import { linkVersion } from '@/lib/textLinks'
import type { LinkPreview } from '@/types/messaging'

/** 사이트 이름이 없으면 링크의 호스트(www. 제외)로 대신한다. */
function siteLabel(p: LinkPreview): string {
  if (p.siteName) return p.siteName
  try {
    return new URL(p.url).hostname.replace(/^www\./, '')
  } catch {
    return p.url
  }
}

/** 썸네일 — 받는 동안은 muted 자리, 실패(요청 오류·디코딩 실패)하면 자리째 숨긴다. */
function PreviewImage({ messageId, preview, version }: { messageId: number; preview: LinkPreview; version: string }) {
  const { url, error } = useAuthedBlob(
    preview.hasImage && messageId > 0 ? `lp/${messageId}/${preview.position}/${version}` : null,
    () => messagingApi.fetchLinkPreviewImage(messageId, preview.position, version),
  )
  // blob 은 받았지만 이미지로 읽히지 않는 경우(img onError). 링크가 바뀌면 호출처가 key(version)로 새로 마운트해 초기화된다.
  const [broken, setBroken] = useState(false)
  if (!preview.hasImage || error || broken) return null
  return (
    <div
      className="relative shrink-0 overflow-hidden bg-muted max-lg:aspect-[1.91/1] max-lg:max-h-[150px] max-lg:w-full lg:min-h-20 lg:w-24 lg:self-stretch"
      data-testid={`link-preview-image-${messageId}-${preview.position}`}
    >
      {url && (
        <img
          src={url}
          alt=""
          onError={() => setBroken(true)}
          className="absolute inset-0 h-full w-full object-cover"
        />
      )}
    </div>
  )
}

/** 카드 1장. 제목이 새 탭 링크다. */
function LinkPreviewCard({ messageId, preview }: { messageId: number; preview: LinkPreview }) {
  const version = linkVersion(preview.url)
  return (
    <div
      data-testid={`link-preview-${messageId}-${preview.position}`}
      // 모바일은 이미지가 위 — DOM 은 글→이미지 순서(읽는 순서 유지)로 두고 열 방향만 뒤집는다.
      className="flex w-full min-w-0 overflow-hidden rounded-lg border bg-card text-card-foreground max-lg:flex-col-reverse"
    >
      <div className="min-w-0 flex-1 px-3 py-2">
        <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
          <Globe className="h-3.5 w-3.5 shrink-0" aria-hidden />
          <span className="truncate" data-testid={`link-preview-site-${messageId}-${preview.position}`}>
            {siteLabel(preview)}
          </span>
        </div>
        <TextLink
          href={preview.url}
          testId={`link-preview-title-${messageId}-${preview.position}`}
          // 제목은 밑줄 없이 굵게(hover 때만 밑줄) — 본문 링크와 구분. 긴 제목은 2줄에서 자른다.
          className="mt-0.5 line-clamp-2 font-semibold text-primary hover:underline [overflow-wrap:anywhere]"
        >
          {preview.title}
        </TextLink>
        {preview.description && (
          <p
            className="mt-0.5 line-clamp-2 text-xs text-muted-foreground [overflow-wrap:anywhere]"
            data-testid={`link-preview-desc-${messageId}-${preview.position}`}
          >
            {preview.description}
          </p>
        )}
      </div>
      {/* 같은 자리(position)에 수정으로 다른 링크가 오면 다시 받도록 링크로 만든 버전을 key·blob 키·요청 주소에 함께 쓴다. */}
      <PreviewImage key={version} messageId={messageId} preview={preview} version={version} />
    </div>
  )
}

/**
 * 한 메시지의 미리보기 카드 묶음. onDismiss 를 주면(작성자 본인·데스크톱) 첫 카드 오른쪽 위에 ✕ — hover·포커스 때 드러난다.
 * 터치 셸에서는 ✕ 대신 메시지 작업 시트의 「미리보기 지우기」를 쓴다(호출처가 onDismiss 를 넘기지 않는다).
 */
export function LinkPreviewList({
  messageId,
  previews,
  onDismiss,
}: {
  messageId: number
  previews: LinkPreview[]
  onDismiss?: () => void
}) {
  if (previews.length === 0) return null
  return (
    <div
      data-testid={`link-previews-${messageId}`}
      // 말풍선 안에 들어가도 본문의 pre-wrap·wrap-anywhere·이탤릭을 물려받지 않게 되돌린다.
      className="group/card relative mt-1.5 flex w-full max-w-xl flex-col gap-1.5 text-left text-sm whitespace-normal not-italic [overflow-wrap:normal]"
    >
      {previews.map((p) => (
        <LinkPreviewCard key={p.position} messageId={messageId} preview={p} />
      ))}
      {onDismiss && (
        <button
          type="button"
          aria-label="미리보기 지우기"
          title="미리보기 지우기"
          data-testid={`link-preview-dismiss-${messageId}`}
          onClick={(e) => {
            e.stopPropagation()
            onDismiss()
          }}
          // 평소엔 투명, 카드 묶음 hover·포커스 때 드러난다. 호버가 없는 넓은 터치 기기(pointer-coarse)는 늘 보인다.
          className="absolute top-1.5 right-1.5 flex h-6 w-6 items-center justify-center rounded-md border bg-background/90 text-muted-foreground opacity-0 shadow-sm transition-opacity hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none group-hover/card:opacity-100 group-focus-within/card:opacity-100 pointer-coarse:opacity-100"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  )
}
