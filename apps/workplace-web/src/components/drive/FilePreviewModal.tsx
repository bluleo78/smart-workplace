import { useEffect, useRef, useState } from 'react'

import { blobToText, toVerifiedPdfBlob } from '../../api/blobContent'
import { driveApi } from '../../api/drive'
import { useDriveFileSummary } from '../../hooks/queries/useDriveFileSummary'
import { useFileBacklinks } from '../../hooks/queries/useFileBacklinks'
import { useAiAvailable } from '../../hooks/useAiAvailable'
import { formatFileSize } from '../../lib/formatters'
import { needsPreviewConfirm } from '../../lib/previewContent'
import { resolvePreviewKind } from '../../lib/previewKind'
import { cn } from '../../lib/utils'
import type { DriveFile, VirtualAttachment } from '../../types/drive'
import { AiContent } from '../ai/AiContent'
import { MarkdownMessage } from '../ai/MarkdownMessage'
import { useAiPanelAwareDialog } from '../ai/useAiPanelAwareDialog'
import { Button } from '../ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog'
import { CsvTablePreview } from './preview/CsvTablePreview'
import { DocxPreview } from './preview/DocxPreview'
import { SheetPreview } from './preview/SheetPreview'

/** 텍스트 미리보기 최대 길이(과대 파일 보호). */
const TEXT_PREVIEW_LIMIT = 200_000

/**
 * 텍스트는 앞부분만 디코딩한다 — 20만 자는 UTF-8 로 최대 80만 바이트라 1MB 면 충분하다.
 * 큰 로그에 동의해도 전체 문자열을 (인코딩 판정 때문에 최대 두 번) 만들지 않아 탭이 멈추지 않는다.
 */
const TEXT_DECODE_MAX_BYTES = 1024 * 1024

/**
 * 미리보기 대상 첨부 — 모달이 실제로 쓰는 필드만 요구한다.
 * 드라이브 가상 첨부(VirtualAttachment)와 이슈 첨부가 같은 모달을 쓰도록 좁힌 타입(WP-203).
 */
type PreviewAttachment = Pick<VirtualAttachment, 'fileId' | 'name' | 'mimeType' | 'sizeBytes' | 'downloadUrl'>

/**
 * 파일 미리보기 모달. IMAGE→img, PDF→iframe, Markdown→렌더, HTML→sandbox iframe, TEXT→pre, CSV→표, 그 외→미지원 안내.
 * 파일(DriveFile)과 첨부(VirtualAttachment)를 공통 모델로 정규화해 처리한다.
 * 이미지/PDF 는 objectURL 을 만들고 닫힐 때 revoke. 상단 헤더에 다운로드 버튼, AI 요약은 기본 접힘.
 */
export function FilePreviewModal({
  file,
  attachment,
  onClose,
}: {
  file?: DriveFile
  attachment?: PreviewAttachment
  onClose: () => void
}) {
  // WP-54: AI 사이드 패널과 공존하는 다이얼로그 props(넓은 미리보기 프리셋 — 패널 폭만큼 클램프).
  const aiAware = useAiPanelAwareDialog({ open: true, size: 'wide' })
  const isAttachment = attachment != null
  // 미리보기 대상 정규화 — 파일/첨부 공통 모델.
  const name = attachment?.name ?? file!.name
  const mimeType = attachment?.mimeType ?? file!.mimeType
  const fileIdForContent = attachment?.fileId ?? file!.id
  const sizeBytes = attachment?.sizeBytes ?? file!.sizeBytes
  // 첨부는 콘텐츠가 downloadUrl 에 있다(드라이브 엔드포인트 아님). null=드라이브 엔드포인트 사용.
  const contentPath = attachment?.downloadUrl ?? null
  // mimeType 기준으로 렌더 종류를 결정(category 는 입자가 거칠어 CSV/MD 구분 불가).
  const kind = resolvePreviewKind(mimeType)
  // 실제 렌더 가능한 종류.
  const renderable =
    kind === 'IMAGE' ||
    kind === 'PDF' ||
    kind === 'MARKDOWN' ||
    kind === 'HTML' ||
    kind === 'TEXT' ||
    kind === 'CSV' ||
    kind === 'XLSX' ||
    kind === 'DOCX'

  // 첨부는 드라이브 전용 패널(요약·백링크)을 쓰지 않으므로 0(비활성)으로 훅 호출.
  const driveFileId = file?.id ?? 0
  const backlinks = useFileBacklinks(driveFileId)
  const aiAvailable = useAiAvailable()
  const summaryQuery = useDriveFileSummary(driveFileId)
  const summary = summaryQuery.data?.summary ?? null
  const status = summaryQuery.data?.status ?? null
  const reason = summaryQuery.data?.reason ?? null
  // 진행 중 = 추출/요약 미완(스켈레톤 대상). 터미널·요약없음이면 카드 숨김.
  const summaryInProgress =
    status === 'PENDING' || status === 'EXTRACTING' || status === 'TEXT_READY' || status === 'SUMMARIZING'
  // #735: 요약 불가(SKIPPED/FAILED)도 카드를 유지해 사유를 알린다 — 카드가 사라지면 사용자는
  // 형식 미지원인지·AI 가 꺼진 건지·실패한 건지 구분할 수 없다.
  const summaryUnavailable = status === 'SKIPPED' || status === 'FAILED'
  // #735: 진행 중인데 폴링 상한을 넘김 = 처리기(워커)가 멈춘 정황. 스켈레톤을 영원히 돌리면
  // "처리 중"과 "처리기 죽음"을 구분할 수 없으므로 지연 안내로 전환한다.
  const summaryStalled = summaryInProgress && summaryQuery.pollingExhausted
  const showSummaryCard =
    !isAttachment && aiAvailable && (summary != null || summaryInProgress || summaryUnavailable)
  const [blobUrl, setBlobUrl] = useState<string | null>(null)
  const [text, setText] = useState<string | null>(null)
  const [error, setError] = useState(false)
  const [buffer, setBuffer] = useState<ArrayBuffer | null>(null)
  // 큰 파일(10MB 초과) 확인 — 표시할 크기. null 이면 확인 불필요(WP-203 후속).
  const [confirmSize, setConfirmSize] = useState<number | null>(null)
  // 사용자가 "미리보기"에 동의한 대상 키. 파일이 바뀌면 키가 달라져 자동으로 다시 묻는다.
  const contentKey = contentPath ?? `drive:${fileIdForContent}`
  const [consentedKey, setConsentedKey] = useState<string | null>(null)
  const consented = consentedKey === contentKey
  // 받은 뒤에야 10MB 초과를 안 경우 그 blob 을 보관 — 동의 시 다시 받지 않고 쓴다.
  const pendingBlobRef = useRef<{ key: string; blob: Blob } | null>(null)
  // #775: 에러도 아니고 콘텐츠(blobUrl/text/buffer)도 아직 없는 렌더 가능 상태 = 비동기 페치 진행 중.
  // 이 조건이 없으면 useEffect 완료 전까지 preview-body 가 완전히 빈 화면으로 보인다.
  const loading =
    !error && renderable && blobUrl == null && text == null && buffer == null && confirmSize == null

  // 다운로드 — 헤더 버튼과 큰 파일 확인 화면이 함께 쓴다.
  const handleDownload = () =>
    contentPath ? driveApi.downloadByPath(contentPath, name) : driveApi.downloadFile(fileIdForContent, name)

  useEffect(() => {
    let alive = true
    let created: string | null = null
    // 모달은 파일 전환 시 언마운트되지 않고 props 만 갱신되므로(같은 인스턴스 재사용),
    // 새 페치 전에 이전 파일의 콘텐츠 상태를 초기화한다. 안 하면 이전 error/확인 화면이 남아 오표시.
    setBlobUrl(null)
    setText(null)
    setBuffer(null)
    setConfirmSize(null)
    setError(false)
    const onUrl = (u: string) => {
      if (!alive) {
        URL.revokeObjectURL(u)
        return
      }
      created = u
      setBlobUrl(u)
    }
    const textLike = kind === 'MARKDOWN' || kind === 'HTML' || kind === 'TEXT' || kind === 'CSV'
    const parsed = kind === 'XLSX' || kind === 'DOCX'
    if (!renderable) {
      // 미지원 형식은 콘텐츠를 받지 않는다.
    } else if (needsPreviewConfirm(sizeBytes, consented)) {
      // 메타 크기가 10MB 초과 — 묻기 전에는 콘텐츠 요청 자체를 만들지 않는다.
      setConfirmSize(sizeBytes)
    } else {
      // 첨부는 contentPath(절대경로), 드라이브 파일은 fileId 엔드포인트로 blob 획득 — 이후 종류별 변환만 다르다.
      // 받은 뒤 큰 파일임을 알아 보관해 둔 blob 이 있으면 다시 받지 않는다.
      const pending = pendingBlobRef.current?.key === contentKey ? pendingBlobRef.current.blob : null
      pendingBlobRef.current = null
      const fetched: Promise<Blob> = pending
        ? Promise.resolve(pending)
        : contentPath
          ? driveApi.fetchBlobByPath(contentPath)
          : driveApi.fetchContentBlob(fileIdForContent)
      // 받은 실제 크기로 한 번 더 본다 — 메타 크기가 null 이거나 실제와 다를 수 있다(파일 교체 등).
      // 10MB 를 넘으면 렌더(파싱·디코딩)하지 않고 보관한 뒤 크기를 보여주며 묻는다.
      const blobP = fetched.then((blob) => {
        if (!needsPreviewConfirm(blob.size, consented)) return blob
        if (alive) {
          pendingBlobRef.current = { key: contentKey, blob }
          setConfirmSize(blob.size)
        }
        return null
      })
      const fail = () => alive && setError(true)
      if (kind === 'IMAGE') {
        void blobP.then((blob) => blob && onUrl(URL.createObjectURL(blob))).catch(fail)
      } else if (kind === 'PDF') {
        // PDF 는 시그니처 검증 + application/pdf 재래핑을 통과해야만 뷰어로 넘긴다.
        void blobP
          .then(async (blob) => blob && onUrl(URL.createObjectURL(await toVerifiedPdfBlob(blob))))
          .catch(fail)
      } else if (textLike) {
        void blobP
          .then(async (blob) => {
            if (!blob) return
            const t = await blobToText(blob.slice(0, TEXT_DECODE_MAX_BYTES))
            if (alive) setText(t.slice(0, TEXT_PREVIEW_LIMIT))
          })
          .catch(fail)
      } else if (parsed) {
        // 바이너리 파서(XLSX/DOCX)는 arrayBuffer 가 필요.
        void blobP
          .then(async (blob) => {
            if (!blob) return
            const buf = await blob.arrayBuffer()
            if (alive) setBuffer(buf)
          })
          .catch(fail)
      }
    }
    return () => {
      alive = false
      if (created) URL.revokeObjectURL(created)
    }
  }, [fileIdForContent, kind, contentPath, sizeBytes, renderable, consented, contentKey])

  return (
    // WP-54: AI 사이드 패널이 열려 있으면 non-modal — 미리보기를 연 채 "이 파일 요약해줘" 를 AI 에 물을 수 있다.
    <Dialog
      open
      modal={aiAware.modal}
      onOpenChange={(o) => {
        if (!o) onClose()
      }}
    >
      {aiAware.overlay}
      {/* #731: 사용자가 우하단 코너를 드래그해 크기 조절(CSS 네이티브 resize). 세션 동안만 유지(닫으면 리셋).
          base 의 grid→flex-col 로 전환해 본문이 늘어난 높이를 채우게 하고, sm:max-w-lg 도 함께 덮어 초기 폭 확보. */}
      <DialogContent
        className={cn(
          'flex resize flex-col overflow-hidden h-[80vh] max-h-[95vh] min-h-[20rem] w-[64rem] max-w-[95vw] min-w-[24rem] sm:max-w-[95vw]',
          aiAware.contentClassName,
        )}
        {...aiAware.contentProps}
      >
        {/* 상단 툴바: 파일명 + 다운로드 액션 */}
        <DialogHeader>
          <div className="flex items-center justify-between gap-2 pr-6">
            <DialogTitle className="truncate">{name}</DialogTitle>
            <Button
              variant="default"
              size="sm"
              onClick={handleDownload}
              className="shrink-0"
            >
              다운로드
            </Button>
          </div>
          <DialogDescription className="sr-only">{name} 미리보기</DialogDescription>
        </DialogHeader>
        {/* #526: 콘텐츠 요약 — 상단으로 이동, 기본 접힘. previewable 게이트 밖(Office 파일에서도 노출).
            #735: 단 요약 불가(SKIPPED/FAILED)일 때는 기본 펼침 — 사유는 한 줄이라 접어둘 이유가 없고,
            접어두면 헤더만 보여 "왜 요약이 없는지" 를 여전히 알 수 없다(무음 실패의 축소판). */}
        {showSummaryCard && (
          <AiContent
            label="AI 요약"
            collapsible
            defaultOpen={summaryUnavailable || summaryStalled}
            data-testid="drive-summary-card"
          >
            {summary != null ? (
              // #633: raw summary 문자열 그대로 렌더 시 LLM이 생성한 마크다운(#, ** 등)이
              // 파싱 없이 그대로 노출됨 — DM 채팅과 동일하게 MarkdownMessage 로 감싸 파싱.
              <MarkdownMessage>{summary}</MarkdownMessage>
            ) : summaryUnavailable || summaryStalled ? (
              // #735: 서버 문구는 평문 — 마크다운 렌더 금지(사용자 입력이 아니라 고정 문구지만
              // 원문 그대로 노출한다는 계약이므로 파싱하지 않는다).
              <p className="text-sm text-muted-foreground" data-testid="drive-summary-reason">
                {summaryStalled
                  ? '요약 생성이 지연되고 있습니다. 잠시 후 다시 열어 주세요.'
                  : (reason ?? '요약을 사용할 수 없습니다.')}
              </p>
            ) : (
              <div className="space-y-1" data-testid="drive-summary-loading">
                <div className="h-3 w-full animate-pulse rounded bg-ai-accent/20" />
                <div className="h-3 w-5/6 animate-pulse rounded bg-ai-accent/20" />
                <div className="h-3 w-2/3 animate-pulse rounded bg-ai-accent/20" />
              </div>
            )}
          </AiContent>
        )}
        {/* 미리보기 본문 — #731: flex-1 로 남은 높이를 채워 리사이즈에 반응(min-h-0 없으면 flex 자식이 안 줄어들어 스크롤 불가). */}
        <div
          className={`min-h-0 flex-1 overflow-auto${kind === 'IMAGE' ? ' flex items-center justify-center' : ''}`}
          data-testid="preview-body"
        >
          {error && <p className="text-sm text-destructive">미리보기를 불러오지 못했습니다.</p>}
          {!error && !renderable && (
            <p className="text-sm text-muted-foreground">미리보기를 지원하지 않는 형식입니다.</p>
          )}
          {/* #775: 콘텐츠 페치 중(로딩) — AI 요약 카드(166-192행)와 같은 animate-pulse 스켈레톤 패턴 재사용. */}
          {loading && (
            <div className="w-full max-w-md space-y-2" data-testid="preview-loading">
              <div className="h-3 w-full animate-pulse rounded bg-muted" />
              <div className="h-3 w-5/6 animate-pulse rounded bg-muted" />
              <div className="h-3 w-2/3 animate-pulse rounded bg-muted" />
            </div>
          )}
          {!error && kind === 'IMAGE' && blobUrl && (
            <img src={blobUrl} alt={name} className="mx-auto max-w-full" />
          )}
          {!error && kind === 'PDF' && blobUrl && (
            <iframe src={blobUrl} title={name} className="h-full min-h-[60vh] w-full" />
          )}
          {!error && kind === 'MARKDOWN' && text != null && <MarkdownMessage>{text}</MarkdownMessage>}
          {/* HTML 은 sandbox="" + srcDoc 격리 iframe 으로 렌더 — 스크립트/폼/네비게이션 전면 차단(#486 XSS 패턴, #732). */}
          {!error && kind === 'HTML' && text != null && (
            <iframe
              data-testid="html-document"
              title={name}
              sandbox=""
              srcDoc={text}
              className="h-full min-h-[60vh] w-full border-0"
            />
          )}
          {!error && kind === 'TEXT' && text != null && (
            <pre className="whitespace-pre-wrap break-words text-xs">{text}</pre>
          )}
          {!error && kind === 'CSV' && text != null && <CsvTablePreview csv={text} />}
          {/* WP-203 후속: 10MB 초과 — 크기를 보여주고 미리볼지 묻는다(동의 전엔 받지 않음). */}
          {!error && confirmSize != null && (
            <div
              className="flex flex-col items-center gap-3 px-4 py-12 text-center break-keep"
              data-testid="preview-size-confirm"
            >
              <p className="text-sm">
                이 파일은 <span className="font-semibold">{formatFileSize(confirmSize)}</span> 입니다.
              </p>
              <p className="text-sm text-muted-foreground">
                미리보려면 파일 전체를 내려받아야 해서 시간이 걸릴 수 있습니다.
              </p>
              <div className="flex gap-2">
                <Button onClick={() => setConsentedKey(contentKey)}>
                  미리보기
                </Button>
                <Button variant="outline" onClick={handleDownload}>
                  다운로드
                </Button>
              </div>
            </div>
          )}
          {!error && kind === 'XLSX' && buffer && <SheetPreview buffer={buffer} />}
          {!error && kind === 'DOCX' && buffer && <DocxPreview buffer={buffer} />}
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
