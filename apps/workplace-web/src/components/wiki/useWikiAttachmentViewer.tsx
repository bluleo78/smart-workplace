import { type MouseEvent, type ReactNode, useCallback, useMemo, useState } from 'react'

import { fetchBlobByPath } from '../../api/blobContent'
import { shareHeaders } from '../../api/wiki'
import { fetchPublicWikiAttachment } from '../../api/wikiPublic'
import { downloadBlob } from '../../lib/download'
import { parseWikiAttachmentUrl, wikiAttachmentMeta } from '../../lib/wikiAttachments'
import { AttachmentViewer } from '../viewer/AttachmentViewer'
import type { ViewerItem, ViewerItemSource } from '../viewer/types'
import { wikiAttachmentItem } from '../viewer/viewerItems'

/** 받기 출처 공통 — 노트 첨부에는 변환 PDF 경로가 없어 변환 요청은 「대상 아님」이다(previewPath 를 두지 않아 실제로 불리지 않는다). */
const notConvertible: ViewerItemSource['fetchConverted'] = async () => ({ status: 404 })

/**
 * 편집 공유 링크(WP-579)로 연 노트 — 앱 로그인 클라이언트로 받되 공유 토큰 헤더를 싣는다(헤더 없이는 멤버가 아니라 404).
 * 다운로드도 같은 헤더로 받아 브라우저에 저장한다.
 */
function shareTokenSource(token: string): ViewerItemSource {
  const headers = shareHeaders(token)
  return {
    fetchBlob: (path, opts) => fetchBlobByPath(path, { ...opts, headers }),
    fetchConverted: notConvertible,
    download: async (item) => downloadBlob(item.name, await fetchBlobByPath(item.downloadPath, { headers })),
  }
}

/** 공개 공유(비로그인) 노트 — 서버가 범위 안 페이지의 첨부만 내준다. */
const publicSource: ViewerItemSource = {
  fetchBlob: (path, opts) => fetchPublicWikiAttachment(path, opts.signal),
  fetchConverted: notConvertible,
  download: async (item) => downloadBlob(item.name, await fetchPublicWikiAttachment(item.downloadPath)),
}

/**
 * 노트 본문 첨부 칩(WP-1545)을 누르면 첨부 뷰어를 여는 훅 — 편집기·판 미리보기·공개 공유 화면이 같이 쓴다.
 *
 * - onClick: 본문 래퍼의 클릭 위임에서 먼저 부른다. 칩([data-wiki-attachment])을 눌렀으면 뷰어를 열고 true.
 * - openLink: 첨부 주소·이름으로 직접 연다 — 모바일 편집에서 칩을 누르면 링크 시트가 뜨는데, 그 시트의 「미리 보기」가 부른다.
 * - viewer: 열린 뷰어 요소(없으면 null) — 화면이 본문 옆에 그린다.
 * 칩 주소가 로그인 경로라 새 탭·직접 이동은 401 이다 — 뷰어가 blob 으로 받아 미리보기(PDF·텍스트 등)·다운로드를 맡는다.
 *
 * @param shareToken 편집 공유 링크 토큰(있으면 그 헤더로 받는다). 공개 공유 경로 주소는 토큰과 상관없이 로그인 없이 받는다.
 */
export function useWikiAttachmentViewer(shareToken?: string | null): {
  onClick: (e: MouseEvent) => boolean
  openLink: (url: string, name: string) => boolean
  viewer: ReactNode
} {
  const [item, setItem] = useState<ViewerItem | null>(null)

  // 주소가 노트 첨부면 뷰어를 연다 — 칩 클릭과 링크 시트 「미리 보기」가 같은 규칙(출처 고르기)을 쓴다. 첨부가 아니면 false.
  const open = useCallback(
    (url: string | undefined, name: string, mimeType?: string, sizeBytes?: number | null): boolean => {
      const link = parseWikiAttachmentUrl(url)
      if (!link) return false
      setItem(
        wikiAttachmentItem({
          pageId: link.pageId,
          fileId: link.fileId,
          url: link.url,
          name,
          mimeType,
          sizeBytes,
          source: link.publicToken != null ? publicSource : shareToken ? shareTokenSource(shareToken) : undefined,
        }),
      )
      return true
    },
    [shareToken],
  )

  const onClick = useCallback(
    (e: MouseEvent) => {
      const chip = (e.target as Element).closest<HTMLElement>('[data-wiki-attachment]')
      if (!chip) return false
      e.preventDefault()
      const size = chip.dataset.sizeBytes
      open(chip.dataset.url, chip.dataset.name ?? '', chip.dataset.mimeType, size != null ? Number(size) : null)
      return true
    },
    [open],
  )

  const openLink = useCallback(
    (url: string, name: string) => {
      const meta = wikiAttachmentMeta(url)
      return open(url, name || meta?.name || '', meta?.mimeType, meta?.sizeBytes ?? null)
    },
    [open],
  )

  const viewer = useMemo(
    () =>
      item ? (
        // 본문 첨부는 묶음 없는 단건 뷰어 — 주소에 열림 상태가 없어 링크 복사도 두지 않는다(이슈 본문 이미지와 같다).
        <AttachmentViewer items={[item]} index={0} onIndexChange={() => {}} onClose={() => setItem(null)} shareable={false} />
      ) : null,
    [item],
  )

  return { onClick, openLink, viewer }
}
