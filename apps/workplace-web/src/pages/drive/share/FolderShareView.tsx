// 폴더 공유 링크 화면(/s/:token, WP-1538) — 공유 폴더와 그 하위 폴더를 오가며 파일을 미리보고 내려받는다.
//
// 흐름:
//   - 현재 폴더는 주소의 ?folder= 로 둔다(정수가 아니면 공유 폴더). 들어가기·경로 누르기는 push 라 뒤로 가기 = 상위로,
//     새로고침해도 같은 폴더가 열린다. 다른 쿼리(from=login 등)는 그대로 둔다.
//   - 목록은 GET /children 으로 매번 묻는다(열람 토큰이 든 응답은 오래 들고 있지 않게 gcTime 0).
//   - 공유 폴더면 머리(이름·개수·공유한 사람), 하위 폴더면 머리 대신 경로. 밖·사라진 폴더(404)는 목록 자리에서만 안내한다(P10).
//   - 미리보기는 현재 폴더 파일 전체를 뷰어 묶음으로 넘겨 ‹ › 로 넘긴다. 다운로드는 파일별 공개 경로 + 열람 토큰.
//   - 401(열람 토큰 만료·사내 링크 세션 풀림)은 부모의 onUnauthorized 로 잠금 카드에 돌려보낸다.

import { Folder } from 'lucide-react'
import { Fragment } from 'react'
import { Link } from 'react-router-dom'

import type { ShareFolderInfo, ShareFolderListing } from '@/api/drivePublicShare'
import { AttachmentViewer } from '@/components/viewer/AttachmentViewer'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { driveFolderPath } from '@/lib/appUrl'
import { SHARE_LINK_TITLE } from '@/lib/documentTitle'

import { ShareFolderListArea } from './ShareFolderListArea'
import { useShareFolderBrowser } from './useShareFolderBrowser'

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
  // 열람 상태(폴더·목록·뷰어·내려받기)는 훅 — 드라이브 안 읽기 전용 화면과 같은 로직을 쓴다(WP-1540).
  const { goTo, listing, items, viewerIndex, setViewerIndex, downloadingId, downloadError, download } = useShareFolderBrowser({
    token,
    viewToken,
    onUnauthorized,
  })
  const data = listing.data

  // 탭 제목 — 현재 폴더 이름(모르면 공유 폴더 이름) · 공유 링크.
  useDocumentTitle([data?.path.at(-1)?.name ?? info.name, SHARE_LINK_TITLE])

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

      <ShareFolderListArea
        listing={listing}
        downloadingId={downloadingId}
        onOpenFolder={goTo}
        onPreview={(i) => setViewerIndex(i)}
        onDownload={(f) => void download(f)}
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
