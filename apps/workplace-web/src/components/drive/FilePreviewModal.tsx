import { useEffect, useState } from 'react'

import { driveApi } from '../../api/drive'
import { useDriveFileSummary } from '../../hooks/queries/useDriveFileSummary'
import { useFileBacklinks } from '../../hooks/queries/useFileBacklinks'
import { useAiAvailable } from '../../hooks/useAiAvailable'
import { resolvePreviewKind } from '../../lib/previewKind'
import type { DriveFile, VirtualAttachment } from '../../types/drive'
import { AiContent } from '../ai/AiContent'
import { MarkdownMessage } from '../ai/MarkdownMessage'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog'
import { CsvTablePreview } from './preview/CsvTablePreview'

/** 텍스트 미리보기 최대 길이(과대 파일 보호). */
const TEXT_PREVIEW_LIMIT = 200_000

/**
 * 파일 미리보기 모달. IMAGE→img, PDF→iframe, Markdown→렌더, TEXT→pre, CSV→표, 그 외→미지원 안내.
 * 파일(DriveFile)과 첨부(VirtualAttachment)를 공통 모델로 정규화해 처리한다.
 * 이미지/PDF 는 objectURL 을 만들고 닫힐 때 revoke. 상단 헤더에 다운로드 버튼, AI 요약은 기본 접힘.
 */
export function FilePreviewModal({
  file,
  attachment,
  onClose,
}: {
  file?: DriveFile
  attachment?: VirtualAttachment
  onClose: () => void
}) {
  const isAttachment = attachment != null
  // 미리보기 대상 정규화 — 파일/첨부 공통 모델.
  const name = attachment?.name ?? file!.name
  const mimeType = attachment?.mimeType ?? file!.mimeType
  const fileIdForContent = attachment?.fileId ?? file!.id
  // 첨부는 콘텐츠가 downloadUrl 에 있다(드라이브 엔드포인트 아님). null=드라이브 엔드포인트 사용.
  const contentPath = attachment?.downloadUrl ?? null
  // mimeType 기준으로 렌더 종류를 결정(category 는 입자가 거칠어 CSV/MD 구분 불가).
  const kind = resolvePreviewKind(mimeType)
  // 이 슬라이스에서 실제 렌더 가능한 종류(XLSX/DOCX는 슬라이스 2에서 추가).
  const renderable =
    kind === 'IMAGE' || kind === 'PDF' || kind === 'MARKDOWN' || kind === 'TEXT' || kind === 'CSV'

  // 첨부는 드라이브 전용 패널(요약·백링크)을 쓰지 않으므로 0(비활성)으로 훅 호출.
  const driveFileId = file?.id ?? 0
  const backlinks = useFileBacklinks(driveFileId)
  const aiAvailable = useAiAvailable()
  const summaryQuery = useDriveFileSummary(driveFileId)
  const summary = summaryQuery.data?.summary ?? null
  const status = summaryQuery.data?.status ?? null
  // 진행 중 = 추출/요약 미완(스켈레톤 대상). 터미널·요약없음이면 카드 숨김.
  const summaryInProgress =
    status === 'PENDING' || status === 'EXTRACTING' || status === 'TEXT_READY' || status === 'SUMMARIZING'
  const showSummaryCard = !isAttachment && aiAvailable && (summary != null || summaryInProgress)
  const [blobUrl, setBlobUrl] = useState<string | null>(null)
  const [text, setText] = useState<string | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    let alive = true
    let created: string | null = null
    const onUrl = (u: string) => {
      if (!alive) {
        URL.revokeObjectURL(u)
        return
      }
      created = u
      setBlobUrl(u)
    }
    if (kind === 'IMAGE' || kind === 'PDF') {
      // 첨부는 contentPath(절대경로), 드라이브 파일은 fileId 엔드포인트로 blob 획득.
      const p = contentPath
        ? driveApi.fetchBlobUrlByPath(contentPath)
        : driveApi.fetchContentUrl(fileIdForContent)
      void p.then(onUrl).catch(() => alive && setError(true))
    } else if (kind === 'MARKDOWN' || kind === 'TEXT' || kind === 'CSV') {
      const p = contentPath
        ? driveApi.fetchTextByPath(contentPath)
        : driveApi.fetchTextContent(fileIdForContent)
      void p
        .then((t) => alive && setText(t.slice(0, TEXT_PREVIEW_LIMIT)))
        .catch(() => alive && setError(true))
    }
    return () => {
      alive = false
      if (created) URL.revokeObjectURL(created)
    }
  }, [fileIdForContent, kind, contentPath])

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose()
      }}
    >
      <DialogContent className="max-w-3xl">
        {/* 상단 툴바: 파일명 + 다운로드 액션 */}
        <DialogHeader>
          <div className="flex items-center justify-between gap-2 pr-6">
            <DialogTitle className="truncate">{name}</DialogTitle>
            <button
              type="button"
              onClick={() =>
                contentPath ? driveApi.downloadByPath(contentPath, name) : driveApi.downloadFile(fileIdForContent, name)
              }
              className="shrink-0 rounded bg-primary px-3 py-1 text-sm text-primary-foreground hover:opacity-90"
            >
              다운로드
            </button>
          </div>
          <DialogDescription className="sr-only">{name} 미리보기</DialogDescription>
        </DialogHeader>
        {/* #526: 콘텐츠 요약 — 상단으로 이동, 기본 접힘. previewable 게이트 밖(Office 파일에서도 노출). */}
        {showSummaryCard && (
          <AiContent label="AI 요약" collapsible defaultOpen={false} data-testid="drive-summary-card">
            {summary != null ? (
              summary
            ) : (
              <div className="space-y-1" data-testid="drive-summary-loading">
                <div className="h-3 w-full animate-pulse rounded bg-ai-accent/20" />
                <div className="h-3 w-5/6 animate-pulse rounded bg-ai-accent/20" />
                <div className="h-3 w-2/3 animate-pulse rounded bg-ai-accent/20" />
              </div>
            )}
          </AiContent>
        )}
        {/* 미리보기 본문 */}
        <div className="max-h-[70vh] overflow-auto" data-testid="preview-body">
          {error && <p className="text-sm text-destructive">미리보기를 불러오지 못했습니다.</p>}
          {!error && !renderable && (
            <p className="text-sm text-muted-foreground">미리보기를 지원하지 않는 형식입니다.</p>
          )}
          {!error && kind === 'IMAGE' && blobUrl && (
            <img src={blobUrl} alt={name} className="mx-auto max-w-full" />
          )}
          {!error && kind === 'PDF' && blobUrl && (
            <iframe src={blobUrl} title={name} className="h-[70vh] w-full" />
          )}
          {!error && kind === 'MARKDOWN' && text != null && <MarkdownMessage>{text}</MarkdownMessage>}
          {!error && kind === 'TEXT' && text != null && (
            <pre className="whitespace-pre-wrap break-words text-xs">{text}</pre>
          )}
          {!error && kind === 'CSV' && text != null && <CsvTablePreview csv={text} />}
        </div>
        {/* 참조된 곳: 이 파일을 링크한 이슈·메시지 목록. 비어있으면 섹션 자체 숨김. */}
        {!isAttachment && (backlinks.data?.length ?? 0) > 0 && (
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
      </DialogContent>
    </Dialog>
  )
}
