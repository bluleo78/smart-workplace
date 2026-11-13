// 공유 폴더 목록 자리 — `/s/:token`(FolderShareView)과 드라이브 안 읽기 전용 화면(WP-1540)이 함께 쓴다.
// 훅(useShareFolderBrowser)의 listing 을 그대로 받아 불러오는 중·없는 폴더·실패·빈 폴더·표를 그린다.

import { ChevronRight, Download, Eye, Folder } from 'lucide-react'

import type { ShareFolderListing } from '@/api/drivePublicShare'
import { FileTypeIcon } from '@/components/drive/FileTypeIcon'
import { Button } from '@/components/ui/button'
import { formatDateOnly, formatFileSize } from '@/lib/formatters'

import { infoErrorMessage, statusOf } from './shareSupport'

/**
 * 목록 자리 — 불러오는 중 / 없는 폴더(P10) / 그 밖 실패 / 빈 폴더 / 표.
 * notFoundAction 을 주면 없는 폴더(404)의 단추를 그것으로 바꾼다(기본은 「공유 폴더로」 — 공유 폴더로 돌아간다).
 */
export function ShareFolderListArea({
  listing,
  downloadingId,
  onOpenFolder,
  notFoundAction,
  onPreview,
  onDownload,
}: {
  listing: { data?: ShareFolderListing; error: unknown; isPending: boolean; refetch: () => unknown }
  downloadingId: number | null
  onOpenFolder: (id: number | null) => void
  notFoundAction?: { label: string; onSelect: () => void }
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
          <Button variant="outline" size="sm" onClick={notFoundAction?.onSelect ?? (() => onOpenFolder(null))}>
            {notFoundAction?.label ?? '공유 폴더로'}
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
