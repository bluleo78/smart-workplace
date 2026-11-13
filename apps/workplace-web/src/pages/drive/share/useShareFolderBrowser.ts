// 공유 폴더 열람 상태 훅 — 현재 폴더(?folder=)·하위 목록 조회·뷰어 묶음·내려받기를 한곳에 둔다.
// `/s/:token`(FolderShareView, WP-1538)과 드라이브 안 읽기 전용 화면(WP-1540)이 같은 열람 로직을 쓰도록 꺼냈다.

import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { downloadShare, fetchShareChildren, shareFilePaths, type ShareFolderListing } from '@/api/drivePublicShare'
import type { ViewerItem } from '@/components/viewer/types'
import { useAuth } from '@/hooks/useAuth'

import { downloadErrorMessage, parseFolderParam, shareViewerSource, statusOf } from './shareSupport'

export interface ShareFolderBrowser {
  /** 현재 폴더 id — null 이면 공유 폴더. */
  folder: number | null
  /** 폴더 이동(push). */
  goTo: (id: number | null) => void
  listing: UseQueryResult<ShareFolderListing>
  /** 뷰어 묶음 — 현재 폴더 파일 전체. */
  items: ViewerItem[]
  viewerIndex: number | null
  setViewerIndex: (index: number | null) => void
  downloadingId: number | null
  downloadError: string | null
  download: (file: ShareFolderListing['files'][number]) => Promise<void>
}

/**
 * 공유 폴더 열람 훅. 목록·뷰어·내려받기가 401 이면 onUnauthorized 로 알린다 — 만료된 Bearer 는 공개 fetch(drivePublicShare)가
 * 이미 한 번 갱신해 다시 물었으므로, 여기 오는 401 은 열람 토큰 만료·로그인 풀림이다.
 */
export function useShareFolderBrowser(opts: { token: string; viewToken: string | null; onUnauthorized: () => void }): ShareFolderBrowser {
  const { token, viewToken, onUnauthorized } = opts
  const [searchParams, setSearchParams] = useSearchParams()
  const folder = parseFolderParam(searchParams.get('folder'))
  const { isAuthenticated } = useAuth()
  // 뷰어는 연 폴더와 함께 기억한다 — 뒤로/앞으로 가기로 폴더가 바뀌면 새 목록의 같은 위치 파일로 다시 열리지 않게 닫는다(WP-1538).
  const [viewer, setViewer] = useState<{ folder: number | null; index: number } | null>(null)
  if (viewer && viewer.folder !== folder) setViewer(null)
  const viewerIndex = viewer && viewer.folder === folder ? viewer.index : null
  const setViewerIndex = (index: number | null) => setViewer(index == null ? null : { folder, index })
  const [downloadingId, setDownloadingId] = useState<number | null>(null)
  const [downloadError, setDownloadError] = useState<string | null>(null)

  // 하위 목록 — 로그인 상태·열람 토큰이 바뀌면 다시 묻는다. 401 은 부모에 알리고(잠금 카드 등) 실패는 그대로 둔다.
  const listing = useQuery({
    queryKey: ['drive-public-share-children', token, folder, viewToken, isAuthenticated],
    queryFn: async () => {
      try {
        return await fetchShareChildren(token, folder, viewToken)
      } catch (e) {
        if (statusOf(e) === 401) onUnauthorized()
        throw e
      }
    },
    retry: false,
    staleTime: 0,
    gcTime: 0,
    refetchOnWindowFocus: false,
  })
  const data = listing.data

  /** 폴더 이동 — push(뒤로 가기 = 이전 폴더). 공유 폴더로 갈 땐 folder 를 지우고, 다른 쿼리는 남긴다. */
  function goTo(id: number | null) {
    const next = new URLSearchParams(searchParams)
    if (id == null) next.delete('folder')
    else next.set('folder', String(id))
    setViewerIndex(null)
    setDownloadError(null)
    setSearchParams(next)
  }

  // 뷰어 묶음 — 현재 폴더 파일 전체. 원본·변환 PDF·다운로드는 파일별 공개 경로를 열람 토큰 출처로 받는다.
  const items = useMemo<ViewerItem[]>(() => {
    if (!data) return []
    const source = shareViewerSource(viewToken, onUnauthorized)
    return data.files.map((f) => ({
      key: `share:${token}:${f.id}`,
      name: f.name,
      mimeType: f.mimeType,
      sizeBytes: f.sizeBytes,
      ...shareFilePaths(token, f.id),
      source,
    }))
  }, [data, token, viewToken, onUnauthorized])

  /** 파일 내려받기 — 한 번에 하나. 401 은 부모에 알리고, 그 밖은 오류 문구로 보인다. */
  async function download(file: ShareFolderListing['files'][number]) {
    if (downloadingId != null) return
    setDownloadingId(file.id)
    setDownloadError(null)
    try {
      await downloadShare(shareFilePaths(token, file.id).downloadPath, viewToken, file.name)
    } catch (e) {
      const status = statusOf(e)
      if (status === 401) onUnauthorized()
      else setDownloadError(downloadErrorMessage(status))
    } finally {
      setDownloadingId(null)
    }
  }

  return { folder, goTo, listing, items, viewerIndex, setViewerIndex, downloadingId, downloadError, download }
}
