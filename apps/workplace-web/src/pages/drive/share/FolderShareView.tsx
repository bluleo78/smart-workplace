// 폴더 공유 링크 화면(/s/:token, WP-1538) — 공유 폴더와 그 하위 폴더를 오가며 파일을 미리보고 내려받는다.
//
// 흐름:
//   - 현재 폴더는 주소의 ?folder= 로 둔다(정수가 아니면 공유 폴더). 들어가기·경로 누르기는 push 라 뒤로 가기 = 상위로,
//     새로고침해도 같은 폴더가 열린다. 다른 쿼리(from=login 등)는 그대로 둔다.
//   - 목록은 GET /children 으로 매번 묻는다(열람 토큰이 든 응답은 오래 들고 있지 않게 gcTime 0).
//   - 공유 폴더면 머리(이름·개수·공유한 사람), 하위 폴더면 머리 대신 경로. 밖·사라진 폴더(404)는 목록 자리에서만 안내한다(P10).
//   - 미리보기는 현재 폴더 파일 전체를 뷰어 묶음으로 넘겨 ‹ › 로 넘긴다. 다운로드는 파일별 공개 경로 + 열람 토큰.
//   - 401(열람 토큰 만료·사내 링크 세션 풀림)은 부모의 onUnauthorized 로 잠금 카드에 돌려보낸다.

import { useQuery } from '@tanstack/react-query'
import { ChevronRight, Download, Eye, Folder } from 'lucide-react'
import { Fragment, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'

import {
  downloadShare,
  fetchShareChildren,
  shareFilePaths,
  type ShareFolderInfo,
  type ShareFolderListing,
} from '@/api/drivePublicShare'
import { FileTypeIcon } from '@/components/drive/FileTypeIcon'
import { Button } from '@/components/ui/button'
import { AttachmentViewer } from '@/components/viewer/AttachmentViewer'
import type { ViewerItem } from '@/components/viewer/types'
import { useAuth } from '@/hooks/useAuth'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { driveFolderPath } from '@/lib/appUrl'
import { SHARE_LINK_TITLE } from '@/lib/documentTitle'
import { formatDateOnly, formatFileSize } from '@/lib/formatters'

import { downloadErrorMessage, infoErrorMessage, parseFolderParam, shareViewerSource, statusOf } from './shareSupport'

/** 경로를 접기 시작하는 길이(P11) — 넘으면 「공유 폴더 › … › 부모 › 현재」로 640px 카드 한 줄을 지킨다. */
const MAX_CRUMBS = 4

/** 경로 조각 — 접힌 자리는 null(「…」). 길이가 MAX_CRUMBS 이하면 그대로. */
function collapsePath(path: ShareFolderListing['path']): (ShareFolderListing['path'][number] | null)[] {
  if (path.length <= MAX_CRUMBS) return path
  return [path[0], null, path[path.length - 2], path[path.length - 1]]
}

export function FolderShareView({
  token,
  info,
  viewToken,
  onUnauthorized,
}: {
  token: string
  info: ShareFolderInfo
  viewToken: string | null
  onUnauthorized: () => void
}) {
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

  // 하위 목록 — 로그인 상태·열람 토큰이 바뀌면 다시 묻는다. 401 은 잠금 카드로 돌려보내고(부모) 실패는 그대로 둔다.
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

  // 탭 제목 — 현재 폴더 이름(모르면 공유 폴더 이름) · 공유 링크.
  useDocumentTitle([data?.path.at(-1)?.name ?? info.name, SHARE_LINK_TITLE])

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

  async function handleDownload(file: ShareFolderListing['files'][number]) {
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

  // 머리 — 하위 폴더 목록을 받았으면 경로, 그 밖(공유 폴더·불러오는 중·없는 폴더)은 공유 폴더 머리.
  const showPath = data != null && data.path.length > 1
  // 드라이브에서 열기 — 공간 구성원(driveOpen)에게만, 지금 보이는 폴더로. 비로그인용 로그인 링크는 폴더에서 두지 않는다(P12).
  const driveOpenFolderId = data?.folderId ?? info.driveOpen?.folderId ?? null

  return (
    <>
      {showPath ? (
        <nav aria-label="폴더 경로" data-testid="share-folder-breadcrumb" className="flex min-w-0 items-center gap-1 text-sm">
          {collapsePath(data.path).map((crumb, i, all) => (
            <Fragment key={crumb ? crumb.id : 'gap'}>
              {i > 0 && (
                <span aria-hidden className="shrink-0 text-muted-foreground">
                  ›
                </span>
              )}
              {crumb == null ? (
                <span className="shrink-0 text-muted-foreground">…</span>
              ) : i === all.length - 1 ? (
                <h1 className="min-w-0 truncate font-semibold">{crumb.name}</h1>
              ) : (
                <button
                  type="button"
                  onClick={() => goTo(i === 0 ? null : crumb.id)}
                  className="min-w-0 truncate text-muted-foreground hover:text-foreground hover:underline"
                >
                  {crumb.name}
                </button>
              )}
            </Fragment>
          ))}
        </nav>
      ) : (
        <div className="flex items-start gap-3">
          <Folder className="size-10 shrink-0 text-muted-foreground" aria-hidden />
          <div className="min-w-0 flex-1 space-y-0.5">
            <h1 className="break-all text-base font-semibold">{info.name}</h1>
            <p className="text-sm text-muted-foreground" data-testid="share-folder-meta">
              폴더 {info.folderCount}개 · 파일 {info.fileCount}개
            </p>
            {info.sharedBy && (
              <p className="text-sm text-muted-foreground" data-testid="share-folder-shared-by">
                공유한 사람 {info.sharedBy}
              </p>
            )}
          </div>
        </div>
      )}

      <FolderListArea
        listing={listing}
        downloadingId={downloadingId}
        onOpenFolder={goTo}
        onPreview={(i) => setViewerIndex(i)}
        onDownload={(f) => void handleDownload(f)}
      />
      {downloadError && (
        <p className="text-sm text-destructive" role="alert" data-testid="share-download-error">
          {downloadError}
        </p>
      )}

      {info.driveOpen && (
        <Link
          to={driveFolderPath(info.driveOpen.spaceId, driveOpenFolderId)}
          className="inline-block text-sm font-medium text-primary underline-offset-4 hover:underline"
          data-testid="share-drive-open-link"
        >
          드라이브에서 열기 →
        </Link>
      )}

      {viewerIndex != null && items.length > 0 && (
        <AttachmentViewer
          items={items}
          index={viewerIndex}
          onIndexChange={setViewerIndex}
          onClose={() => setViewerIndex(null)}
          shareable={false}
        />
      )}
    </>
  )
}

/** 목록 자리 — 불러오는 중 / 없는 폴더(P10) / 그 밖 실패 / 빈 폴더 / 표. */
function FolderListArea({
  listing,
  downloadingId,
  onOpenFolder,
  onPreview,
  onDownload,
}: {
  listing: { data?: ShareFolderListing; error: unknown; isPending: boolean; refetch: () => unknown }
  downloadingId: number | null
  onOpenFolder: (id: number | null) => void
  onPreview: (index: number) => void
  onDownload: (file: ShareFolderListing['files'][number]) => void
}) {
  if (listing.isPending) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground" role="status">
        불러오는 중…
      </p>
    )
  }
  if (!listing.data) {
    const status = statusOf(listing.error)
    if (status === 404) {
      // 밖·휴지통·사라진 폴더 — 화면 전체 오류가 아니라 목록 자리에서 공유 폴더로 돌아가게 한다(P10).
      return (
        <div className="space-y-3 py-6 text-center" data-testid="share-folder-not-found">
          <p className="text-sm text-muted-foreground">이 폴더를 찾을 수 없습니다</p>
          <Button variant="outline" size="sm" onClick={() => onOpenFolder(null)}>
            공유 폴더로
          </Button>
        </div>
      )
    }
    // 만료·폐기(410)·다른 워크스페이스(403)는 정보와 같은 안내, 나머지는 일시 실패로 다시 시도.
    const known = status === 410 || status === 403
    return (
      <div className="space-y-3 py-6 text-center">
        <p className="text-sm text-destructive" role="alert">
          {known ? infoErrorMessage(status) : '목록을 불러오지 못했습니다. 잠시 후 다시 시도하세요.'}
        </p>
        {!known && (
          <Button variant="outline" size="sm" onClick={() => void listing.refetch()}>
            다시 시도
          </Button>
        )}
      </div>
    )
  }

  const { folders, files, truncated } = listing.data
  if (folders.length === 0 && files.length === 0) {
    return <p className="py-6 text-center text-sm text-muted-foreground">빈 폴더입니다</p>
  }
  return (
    <div className="space-y-2">
      <table className="w-full table-fixed text-sm" data-testid="share-folder-table">
        <thead>
          <tr className="border-b border-border text-left text-xs text-muted-foreground">
            <th className="py-2 font-medium">이름</th>
            {/* 좁은 폭(360px)에서는 「수정」 칸을 숨겨 이름이 자리를 갖게 한다. */}
            <th className="hidden w-24 py-2 font-medium sm:table-cell">수정</th>
            <th className="w-20 py-2 text-right font-medium">크기</th>
            <th className="w-20 py-2">
              <span className="sr-only">작업</span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {folders.map((f) => (
            <tr key={`folder-${f.id}`} data-testid={`share-folder-row-${f.id}`}>
              <td className="py-1.5">
                <button
                  type="button"
                  onClick={() => onOpenFolder(f.id)}
                  aria-label={`${f.name} 폴더 열기`}
                  className="flex w-full min-w-0 items-center gap-2 text-left hover:underline"
                >
                  <Folder className="size-5 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="min-w-0 truncate">{f.name}</span>
                </button>
              </td>
              <td className="hidden py-1.5 text-xs text-muted-foreground sm:table-cell">{formatDateOnly(f.updatedAt)}</td>
              <td className="py-1.5 text-right text-xs text-muted-foreground">—</td>
              <td className="py-1.5 text-right">
                <ChevronRight className="ml-auto size-4 text-muted-foreground" aria-hidden />
              </td>
            </tr>
          ))}
          {files.map((f, i) => (
            <tr key={`file-${f.id}`} data-testid={`share-file-row-${f.id}`}>
              <td className="py-1.5">
                <span className="flex min-w-0 items-center gap-2">
                  <FileTypeIcon mimeType={f.mimeType} className="size-5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 truncate">{f.name}</span>
                </span>
              </td>
              <td className="hidden py-1.5 text-xs text-muted-foreground sm:table-cell">{formatDateOnly(f.updatedAt)}</td>
              <td className="py-1.5 text-right text-xs text-muted-foreground">{formatFileSize(f.sizeBytes)}</td>
              <td className="py-1.5">
                <span className="flex justify-end gap-0.5">
                  <Button variant="ghost" size="icon" className="size-8" aria-label={`${f.name} 미리보기`} onClick={() => onPreview(i)}>
                    <Eye className="size-4" aria-hidden />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8"
                    aria-label={`${f.name} 다운로드`}
                    disabled={downloadingId != null}
                    onClick={() => onDownload(f)}
                  >
                    <Download className="size-4" aria-hidden />
                  </Button>
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {truncated && <p className="text-xs text-muted-foreground">일부만 표시됩니다</p>}
    </div>
  )
}
