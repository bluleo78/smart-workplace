import { useEffect, useState } from 'react'

import { driveApi } from '../../api/drive'
import { useFileBacklinks } from '../../hooks/queries/useFileBacklinks'
import type { DriveFile } from '../../types/drive'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog'

/** 텍스트 미리보기 최대 길이(과대 파일 보호). */
const TEXT_PREVIEW_LIMIT = 200_000

/**
 * 파일 미리보기 모달. IMAGE→img, PDF→iframe, TEXT→pre, 그 외→미지원 안내.
 * 이미지/PDF 는 objectURL 을 만들고 닫힐 때 revoke. 하단에 다운로드 버튼.
 */
export function FilePreviewModal({ file, onClose }: { file: DriveFile; onClose: () => void }) {
  // 이 파일을 참조하는 이슈·메시지 백링크 조회.
  const backlinks = useFileBacklinks(file.id)
  const [blobUrl, setBlobUrl] = useState<string | null>(null)
  const [text, setText] = useState<string | null>(null)
  const [error, setError] = useState(false)
  const previewable = ['IMAGE', 'PDF', 'TEXT'].includes(file.category)

  useEffect(() => {
    let alive = true
    let created: string | null = null
    if (file.category === 'IMAGE' || file.category === 'PDF') {
      void driveApi
        .fetchContentUrl(file.id)
        .then((u) => {
          if (!alive) {
            URL.revokeObjectURL(u)
            return
          }
          created = u
          setBlobUrl(u)
        })
        .catch(() => alive && setError(true))
    } else if (file.category === 'TEXT') {
      void driveApi
        .fetchTextContent(file.id)
        .then((t) => alive && setText(t.slice(0, TEXT_PREVIEW_LIMIT)))
        .catch(() => alive && setError(true))
    }
    return () => {
      alive = false
      if (created) URL.revokeObjectURL(created)
    }
  }, [file.id, file.category])

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose()
      }}
    >
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="truncate">{file.name}</DialogTitle>
          <DialogDescription className="sr-only">{file.name} 미리보기</DialogDescription>
        </DialogHeader>
        <div className="max-h-[70vh] overflow-auto" data-testid="preview-body">
          {error && <p className="text-sm text-destructive">미리보기를 불러오지 못했습니다.</p>}
          {!error && !previewable && (
            <p className="text-sm text-muted-foreground">미리보기를 지원하지 않는 형식입니다.</p>
          )}
          {!error && file.category === 'IMAGE' && blobUrl && (
            <img src={blobUrl} alt={file.name} className="mx-auto max-w-full" />
          )}
          {!error && file.category === 'PDF' && blobUrl && (
            <iframe src={blobUrl} title={file.name} className="h-[70vh] w-full" />
          )}
          {!error && file.category === 'TEXT' && text != null && (
            <pre className="whitespace-pre-wrap break-words text-xs">{text}</pre>
          )}
        </div>
        {/* 참조된 곳: 이 파일을 링크한 이슈·메시지 목록. 비어있으면 섹션 자체 숨김. */}
        {(backlinks.data?.length ?? 0) > 0 && (
          <div className="mt-3 border-t pt-3" data-testid="file-backlinks">
            <p className="mb-1 text-xs font-medium text-muted-foreground">참조된 곳</p>
            <ul className="space-y-1">
              {backlinks.data!.map((b) => (
                <li key={`${b.sourceType}-${b.sourceId}`} data-testid={`file-backlink-${b.sourceType}-${b.sourceId}`}>
                  <a href={b.deepLink} className="text-sm text-primary hover:underline">{b.label}</a>
                </li>
              ))}
            </ul>
          </div>
        )}
        <button
          type="button"
          onClick={() => driveApi.downloadFile(file.id, file.name)}
          className="rounded bg-primary px-3 py-1 text-sm text-primary-foreground hover:opacity-90"
        >
          다운로드
        </button>
      </DialogContent>
    </Dialog>
  )
}
