import { useEffect, useState } from 'react'

import { blobToText, toVerifiedPdfBlob } from '../../api/blobContent'
import { formatFileSize } from '../../lib/formatters'
import { resolvePreviewKind } from '../../lib/previewKind'
import { cn } from '../../lib/utils'
import { MarkdownMessage } from '../ai/MarkdownMessage'
import { FileTypeIcon } from '../drive/FileTypeIcon'
import { CsvTablePreview } from '../drive/preview/CsvTablePreview'
import { DocxPreview } from '../drive/preview/DocxPreview'
import { SheetPreview } from '../drive/preview/SheetPreview'
import { SandboxedHtmlFrame } from '../SandboxedHtmlFrame'
import { Button } from '../ui/button'
import { PdfPages } from './PdfPages'
import type { ViewerItem } from './types'
import { usePreviewBlob } from './usePreviewBlob'

/** 텍스트 미리보기 최대 길이(과대 파일 보호). */
const TEXT_PREVIEW_LIMIT = 200_000

/**
 * 텍스트는 앞부분만 디코딩한다 — 20만 자는 UTF-8 로 최대 80만 바이트라 1MB 면 충분하다.
 * 큰 로그에 동의해도 전체 문자열을 (인코딩 판정 때문에 최대 두 번) 만들지 않아 탭이 멈추지 않는다.
 */
const TEXT_DECODE_MAX_BYTES = 1024 * 1024

/** onPage 미지정 호출부용 빈 콜백(모듈 상수라 PdfPages 이펙트가 다시 돌지 않는다). */
const noopPage = () => {}

/** 문서형(종이 카드 안에 그리는) 형식 — 다크 캔버스 위에서 읽기 편하도록 밝은 카드에 둔다. */
function PaperCard({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto max-w-4xl rounded-md bg-card p-6 text-card-foreground">{children}</div>
}

/**
 * 뷰어 본문 — 종류별 렌더와 상태 화면(로딩·오류·10MB 확인·미지원·사용 불가).
 * 항목이 바뀌면 이전 결과를 비우고 다시 변환한다(넘김 대응 — 호출부가 key={item.key} 도 준다).
 * 기존 드라이브 미리보기 모달의 본문 변환 로직을 이식한 것이며, PDF 는 검증된 blob 을 pdf.js(PdfPages)로 전 페이지 그린다.
 */
export function ViewerBody({
  item,
  zoom = 1,
  onPage,
}: {
  item: ViewerItem
  zoom?: number
  /** PDF 현재 페이지 보고 — 호출부가 useCallback 으로 고정해 넘긴다(PdfPages 이펙트 의존성). */
  onPage?: (current: number, total: number) => void
}) {
  const kind = resolvePreviewKind(item.mimeType)
  const textLike = kind === 'MARKDOWN' || kind === 'HTML' || kind === 'TEXT' || kind === 'CSV'
  const parsed = kind === 'XLSX' || kind === 'DOCX'
  const renderable = kind === 'IMAGE' || kind === 'PDF' || textLike || parsed
  // 원본 blob 받기·10MB 초과 확인은 훅이 맡고, 여기서는 종류별 변환만 한다.
  const source = usePreviewBlob(item, renderable)
  const { blob, confirmSize } = source
  const [blobUrl, setBlobUrl] = useState<string | null>(null)
  // WP-203: toVerifiedPdfBlob 을 통과한 blob 만 pdf.js 로 넘긴다.
  const [pdfBlob, setPdfBlob] = useState<Blob | null>(null)
  const [text, setText] = useState<string | null>(null)
  const [buffer, setBuffer] = useState<ArrayBuffer | null>(null)
  const [convertError, setConvertError] = useState(false)
  const error = source.error || convertError
  // #775: 에러도 아니고 콘텐츠도 아직 없는 렌더 가능 상태 = 비동기 페치 진행 중 — 빈 화면 대신 스켈레톤.
  const loading =
    !item.unavailable &&
    !error &&
    renderable &&
    blobUrl == null &&
    pdfBlob == null &&
    text == null &&
    buffer == null &&
    confirmSize == null
  // iframe(PDF·HTML·DOCX)은 캔버스를 가득 채우고, 그 외(텍스트·표·안내 문구)는 안쪽 여백을 둔다.
  const fillsFrame =
    !error && ((kind === 'PDF' && pdfBlob) || (kind === 'HTML' && text != null) || (kind === 'DOCX' && buffer))

  // 받은 blob → 종류별 표시 형태. blob 이 바뀌면(파일 전환) 이전 결과를 비우고 다시 변환한다.
  useEffect(() => {
    let alive = true
    let created: string | null = null
    setBlobUrl(null)
    setPdfBlob(null)
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
      // 0 바이트: 텍스트류는 빈 문서(오류 아님), 그 외 형식은 그릴 수 없으므로 실패 화면.
      if (blob.size === 0) {
        if (textLike) {
          if (alive) setText('')
          return
        }
        throw new Error('empty blob')
      }
      if (kind === 'IMAGE') showUrl(blob)
      // PDF 는 시그니처 검증 + application/pdf 재래핑을 통과해야만 뷰어로 넘긴다.
      else if (kind === 'PDF') {
        const verified = await toVerifiedPdfBlob(blob)
        if (alive) setPdfBlob(verified)
      }
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
    <div
      className={cn('min-h-0 flex-1 overflow-auto', !fillsFrame && 'p-4', kind === 'IMAGE' && 'flex items-center justify-center')}
      data-testid="preview-body"
    >
      {/* 드라이브 링크 원본이 휴지통·삭제 — 받지 않고 안내만(다운로드 없음). */}
      {item.unavailable && (
        <p className="py-12 text-center text-sm text-muted-foreground" data-testid="preview-unavailable">
          원본 파일을 사용할 수 없습니다.
        </p>
      )}
      {!item.unavailable && error && (
        <div className="flex flex-col items-center gap-3 px-4 py-12 text-center" data-testid="preview-error">
          <p className="text-sm text-destructive">미리보기를 불러오지 못했습니다.</p>
          <div className="flex gap-2">
            <Button variant="outline" onClick={source.retry}>
              다시 시도
            </Button>
            <Button variant="outline" onClick={() => void source.download()}>
              다운로드
            </Button>
          </div>
        </div>
      )}
      {!item.unavailable && !error && !renderable && (
        <div className="flex flex-col items-center gap-3 px-4 py-12 text-center" data-testid="preview-unsupported">
          <FileTypeIcon mimeType={item.mimeType} className="h-16 w-16" />
          <p className="text-sm font-medium break-all">{item.name}</p>
          {item.sizeBytes != null && <p className="text-xs text-muted-foreground">{formatFileSize(item.sizeBytes)}</p>}
          <p className="text-sm text-muted-foreground">미리보기를 지원하지 않는 형식입니다.</p>
          <Button variant="outline" onClick={() => void source.download()}>
            다운로드
          </Button>
        </div>
      )}
      {/* #775: 콘텐츠 페치 중(로딩) — AI 요약 카드와 같은 animate-pulse 스켈레톤 패턴 재사용. */}
      {loading && (
        <div className="w-full max-w-md space-y-2" data-testid="preview-loading">
          <div className="h-3 w-full animate-pulse rounded bg-muted" />
          <div className="h-3 w-5/6 animate-pulse rounded bg-muted" />
          <div className="h-3 w-2/3 animate-pulse rounded bg-muted" />
        </div>
      )}
      {!error && kind === 'IMAGE' && blobUrl && (
        // 확대는 transform 으로(레이아웃 불변) — 컨트롤 연결은 후속.
        <img
          src={blobUrl}
          alt={item.name}
          className="mx-auto max-w-full"
          style={{ transform: `scale(${zoom})`, transformOrigin: 'center' }}
        />
      )}
      {!error && kind === 'PDF' && pdfBlob && (
        <PdfPages blob={pdfBlob} zoom={zoom} onPage={onPage ?? noopPage} onError={() => setConvertError(true)} />
      )}
      {!error && kind === 'MARKDOWN' && text != null && (
        <PaperCard>
          <MarkdownMessage>{text}</MarkdownMessage>
        </PaperCard>
      )}
      {/* HTML 은 격리 iframe 으로 렌더 — 스크립트/폼/네비게이션 전면 차단(#486 XSS 패턴, #732). */}
      {!error && kind === 'HTML' && text != null && (
        <SandboxedHtmlFrame
          data-testid="html-document"
          title={item.name}
          html={text}
          className="block h-full min-h-[60vh] w-full border-0"
        />
      )}
      {!error && kind === 'TEXT' && text != null && (
        <PaperCard>
          <pre className="whitespace-pre-wrap break-words text-xs">{text}</pre>
        </PaperCard>
      )}
      {!error && kind === 'CSV' && text != null && (
        <PaperCard>
          <CsvTablePreview csv={text} />
        </PaperCard>
      )}
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
            <Button onClick={source.confirm}>미리보기</Button>
            <Button variant="outline" onClick={() => void source.download()}>
              다운로드
            </Button>
          </div>
        </div>
      )}
      {!error && kind === 'XLSX' && buffer && (
        <PaperCard>
          <SheetPreview buffer={buffer} />
        </PaperCard>
      )}
      {!error && kind === 'DOCX' && buffer && <DocxPreview buffer={buffer} />}
    </div>
  )
}
