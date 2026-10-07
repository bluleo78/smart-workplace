import { Download, X } from 'lucide-react'
import { useEffect, useState } from 'react'

import { blobToText, toVerifiedPdfBlob } from '../../api/blobContent'
import { useDriveFileSummary } from '../../hooks/queries/useDriveFileSummary'
import { useFileBacklinks } from '../../hooks/queries/useFileBacklinks'
import { useAiAvailable } from '../../hooks/useAiAvailable'
import { formatFileSize } from '../../lib/formatters'
import { resolvePreviewKind } from '../../lib/previewKind'
import { cn } from '../../lib/utils'
import type { DriveFile, VirtualAttachment } from '../../types/drive'
import { AiContent } from '../ai/AiContent'
import { MarkdownMessage } from '../ai/MarkdownMessage'
import { useAiPanelAwareDialog } from '../ai/useAiPanelAwareDialog'
import { SandboxedHtmlFrame } from '../SandboxedHtmlFrame'
import { Button } from '../ui/button'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/tooltip'
import { FileTypeIcon } from './FileTypeIcon'
import { CsvTablePreview } from './preview/CsvTablePreview'
import { DocxPreview } from './preview/DocxPreview'
import { SheetPreview } from './preview/SheetPreview'
import { usePreviewBlob } from './usePreviewBlob'

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
 * 이미지/PDF 는 objectURL 을 만들고 닫힐 때 revoke. AI 요약은 기본 접힘.
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
  const textLike = kind === 'MARKDOWN' || kind === 'HTML' || kind === 'TEXT' || kind === 'CSV'
  const parsed = kind === 'XLSX' || kind === 'DOCX'
  // 헤더 보조 줄 — 확장자(대문자) · 크기. 확장자로 보기 어려운 꼬리(공백 포함·5자 초과, 예: "v2.final draft")면 크기만.
  const ext = /\.([A-Za-z0-9]{1,5})$/.exec(name)?.[1].toUpperCase() ?? ''
  const metaLine = [ext, formatFileSize(sizeBytes)].filter(Boolean).join(' · ')
  // 실제 렌더 가능한 종류.
  const renderable = kind === 'IMAGE' || kind === 'PDF' || textLike || parsed

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
  // 원본 blob 받기·10MB 초과 확인은 훅이 맡고, 여기서는 종류별 변환만 한다.
  const source = usePreviewBlob({
    contentPath,
    fileId: fileIdForContent,
    sizeBytes,
    name,
    enabled: renderable,
  })
  const { blob, confirmSize } = source
  const [blobUrl, setBlobUrl] = useState<string | null>(null)
  const [text, setText] = useState<string | null>(null)
  const [buffer, setBuffer] = useState<ArrayBuffer | null>(null)
  const [convertError, setConvertError] = useState(false)
  const error = source.error || convertError
  // #775: 에러도 아니고 콘텐츠(blobUrl/text/buffer)도 아직 없는 렌더 가능 상태 = 비동기 페치 진행 중.
  // 이 조건이 없으면 useEffect 완료 전까지 preview-body 가 완전히 빈 화면으로 보인다.
  const loading =
    !error && renderable && blobUrl == null && text == null && buffer == null && confirmSize == null
  // WP-274: iframe(PDF·HTML·DOCX)은 프레임을 가득 채우고, 그 외(텍스트·표·안내 문구)는 프레임 안쪽 여백을 둔다.
  const fillsFrame =
    !error && ((kind === 'PDF' && blobUrl) || (kind === 'HTML' && text != null) || (kind === 'DOCX' && buffer))

  // 받은 blob → 종류별 표시 형태. blob 이 바뀌면(파일 전환) 이전 결과를 비우고 다시 변환한다.
  useEffect(() => {
    let alive = true
    let created: string | null = null
    setBlobUrl(null)
    setText(null)
    setBuffer(null)
    setConvertError(false)
    if (!blob) return
    const showUrl = (b: Blob) => {
      const u = URL.createObjectURL(b)
      if (alive) {
        created = u
        setBlobUrl(u)
      } else {
        URL.revokeObjectURL(u)
      }
    }
    const convert = async () => {
      if (kind === 'IMAGE') showUrl(blob)
      // PDF 는 시그니처 검증 + application/pdf 재래핑을 통과해야만 뷰어로 넘긴다.
      else if (kind === 'PDF') showUrl(await toVerifiedPdfBlob(blob))
      else if (textLike) {
        const t = await blobToText(blob, { maxBytes: TEXT_DECODE_MAX_BYTES })
        if (alive) setText(t.slice(0, TEXT_PREVIEW_LIMIT))
      } else {
        // 바이너리 파서(XLSX/DOCX)는 arrayBuffer 가 필요.
        const buf = await blob.arrayBuffer()
        if (alive) setBuffer(buf)
      }
    }
    void convert().catch(() => alive && setConvertError(true))
    return () => {
      alive = false
      if (created) URL.revokeObjectURL(created)
    }
  }, [blob, kind, textLike])

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
          base 의 grid→flex-col 로 전환해 본문이 늘어난 높이를 채우게 하고, sm:max-w-lg 도 함께 덮어 초기 폭 확보.
          WP-212: resize 손잡이·최소 폭(24rem=384px)은 데스크톱(lg, 앱 모바일 기준 <1024px 의 반대)에서만 —
          휴대폰엔 드래그할 마우스가 없고, min-w 가 max-w-[95vw] 보다 우선해 360px 폰에서 모달이 화면 밖으로 넘쳤다. */}
      <DialogContent
        // WP-274: 기본 코너 X 는 헤더와 따로 떠 다운로드 버튼과 정렬이 어긋난다 — 헤더 액션 줄에 직접 둔다.
        showCloseButton={false}
        className={cn(
          'flex flex-col overflow-hidden h-[80vh] max-h-[95vh] min-h-[20rem] w-[64rem] max-w-[95vw] sm:max-w-[95vw] lg:resize lg:min-w-[24rem]',
          aiAware.contentClassName,
        )}
        {...aiAware.contentProps}
        // 열릴 때 첫 포커스가 다운로드 아이콘 버튼에 가면 툴팁이 바로 뜨고, 첫 Escape 를 툴팁이 먹어
        // 모달이 닫히지 않는다 — 포커스는 다이얼로그 자체에 둔다(Tab 으로 버튼에 가면 툴팁은 그대로 뜬다).
        // AI 패널 공존 훅의 처리(복원 대상 캡처·모드 전환 시 포커스 유지)를 먼저 돌리고, 그쪽이 막지 않았을 때만 바꾼다.
        onOpenAutoFocus={(e) => {
          aiAware.contentProps.onOpenAutoFocus(e)
          if (e.defaultPrevented) return
          e.preventDefault()
          ;(e.currentTarget as HTMLElement | null)?.focus()
        }}
      >
        {/* WP-274 상단 툴바: 유형 아이콘 + 파일명/형식·크기 | 다운로드 · 닫기.
            다운로드는 보조 동작이라 ghost 아이콘 버튼으로 낮춰 문서보다 튀지 않게 하고, 의미는 툴팁·aria-label 로 전한다. */}
        <DialogHeader className="flex-row items-center gap-3 text-left">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted" aria-hidden>
            <FileTypeIcon mimeType={mimeType} className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <DialogTitle className="truncate text-base leading-snug">{name}</DialogTitle>
            <p className="truncate text-xs text-muted-foreground" data-testid="preview-meta">
              {metaLine}
            </p>
          </div>
          <DialogDescription className="sr-only">{name} 미리보기</DialogDescription>
          <div className="flex shrink-0 items-center gap-1">
            <TooltipProvider delayDuration={300}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={source.download}
                    aria-label="다운로드"
                    data-testid="preview-download"
                  >
                    <Download />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">다운로드</TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <div className="mx-1 h-5 w-px bg-border" aria-hidden />
            <DialogClose asChild>
              <Button variant="ghost" size="icon-sm" aria-label="닫기">
                <X />
              </Button>
            </DialogClose>
          </div>
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
          // WP-274: 얇은 테두리·둥근 모서리 프레임으로 문서 영역을 모달과 구분한다.
          className={cn(
            'min-h-0 flex-1 overflow-auto rounded-md border',
            !fillsFrame && 'p-3',
            kind === 'IMAGE' && 'flex items-center justify-center',
          )}
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
            <iframe src={blobUrl} title={name} className="block h-full min-h-[60vh] w-full border-0" />
          )}
          {!error && kind === 'MARKDOWN' && text != null && <MarkdownMessage>{text}</MarkdownMessage>}
          {/* HTML 은 격리 iframe 으로 렌더 — 스크립트/폼/네비게이션 전면 차단(#486 XSS 패턴, #732). */}
          {!error && kind === 'HTML' && text != null && (
            <SandboxedHtmlFrame
              data-testid="html-document"
              title={name}
              html={text}
              className="block h-full min-h-[60vh] w-full border-0"
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
                <Button onClick={source.confirm}>
                  미리보기
                </Button>
                <Button variant="outline" onClick={source.download}>
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
