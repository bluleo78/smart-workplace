import { useEffect, useState } from 'react'

import { blobToText, toVerifiedPdfBlob } from '../../api/blobContent'
import { formatFileSize } from '../../lib/formatters'
import { resolvePreviewKind } from '../../lib/previewKind'
import { SCROLL_REGION_RING_INSET, scrollRegionProps } from '../../lib/scrollRegion'
import { cn } from '../../lib/utils'
import { MarkdownMessage } from '../ai/MarkdownMessage'
import { FileTypeIcon } from '../drive/FileTypeIcon'
import { CsvTablePreview } from '../drive/preview/CsvTablePreview'
import { DocxPreview } from '../drive/preview/DocxPreview'
import { SheetPreview } from '../drive/preview/SheetPreview'
import { SandboxedHtmlFrame } from '../SandboxedHtmlFrame'
import { Button } from '../ui/button'
import { fitImageWidth } from './imageFit'
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

/**
 * blob 을 종류별로 변환한 표시 내용 — 한 번에 하나만 있으므로 상태 하나(판별 유니언)로 든다.
 * url = 이미지 object URL, pdf = WP-203 검증을 통과한 PDF blob, text = 텍스트류(앞부분만), buffer = XLSX/DOCX 파서 입력.
 */
type BodyContent =
  | { k: 'url'; url: string }
  | { k: 'pdf'; blob: Blob }
  | { k: 'text'; text: string }
  | { k: 'buffer'; buffer: ArrayBuffer }

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
  zoom,
  onPage,
}: {
  item: ViewerItem
  /** 이미지·PDF 확대 배율(1 = 폭 맞춤). */
  zoom: number
  /** PDF 현재 페이지 보고 — 호출부가 useCallback 으로 고정해 넘긴다(PdfPages 이펙트 의존성). */
  onPage: (current: number, total: number) => void
}) {
  const kind = resolvePreviewKind(item.mimeType)
  const textLike = kind === 'MARKDOWN' || kind === 'HTML' || kind === 'TEXT' || kind === 'CSV'
  const parsed = kind === 'XLSX' || kind === 'DOCX'
  const renderable = kind === 'IMAGE' || kind === 'PDF' || textLike || parsed
  // 원본 blob 받기·10MB 초과 확인은 훅이 맡고, 여기서는 종류별 변환만 한다.
  const source = usePreviewBlob(item, renderable)
  const { blob, confirmSize } = source
  // 변환 결과(없으면 아직 변환 전). WP-203: pdf 는 toVerifiedPdfBlob 을 통과한 blob 만 담아 pdf.js 로 넘긴다.
  const [content, setContent] = useState<BodyContent | null>(null)
  const [convertError, setConvertError] = useState(false)
  // 이미지 확대 계산용 — 본문 내용 영역 크기(패딩 제외)와 이미지 원본 크기.
  const [bodyEl, setBodyEl] = useState<HTMLDivElement | null>(null)
  const [box, setBox] = useState<{ w: number; h: number } | null>(null)
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null)
  useEffect(() => {
    if (!bodyEl || kind !== 'IMAGE') return
    const ro = new ResizeObserver(([e]) => setBox({ w: e.contentRect.width, h: e.contentRect.height }))
    ro.observe(bodyEl)
    return () => ro.disconnect()
  }, [bodyEl, kind])
  const fitWidth = natural && box ? fitImageWidth(natural.w, natural.h, box.w, box.h) : null
  const error = source.error || convertError
  // #775: 에러도 아니고 콘텐츠도 아직 없는 렌더 가능 상태 = 비동기 페치 진행 중 — 빈 화면 대신 스켈레톤.
  const loading =
    !item.unavailable &&
    !error &&
    renderable &&
    content == null &&
    confirmSize == null
  // iframe(PDF·HTML·DOCX)은 캔버스를 가득 채우고, 그 외(텍스트·표·안내 문구)는 안쪽 여백을 둔다.
  const fillsFrame =
    !error &&
    ((kind === 'PDF' && content?.k === 'pdf') ||
      (kind === 'HTML' && content?.k === 'text') ||
      (kind === 'DOCX' && content?.k === 'buffer'))

  // 받은 blob → 종류별 표시 형태. blob 이 바뀌면(파일 전환) 이전 결과를 비우고 다시 변환한다.
  useEffect(() => {
    let alive = true
    let created: string | null = null
    setContent(null)
    setConvertError(false)
    if (!blob) return
    const showUrl = (b: Blob) => {
      const u = URL.createObjectURL(b)
      if (alive) {
        created = u
        setContent({ k: 'url', url: u })
      } else {
        URL.revokeObjectURL(u)
      }
    }
    const convert = async () => {
      // 0 바이트: 텍스트류는 빈 문서(오류 아님), 그 외 형식은 그릴 수 없으므로 실패 화면.
      if (blob.size === 0) {
        if (textLike) {
          if (alive) setContent({ k: 'text', text: '' })
          return
        }
        throw new Error('empty blob')
      }
      if (kind === 'IMAGE') showUrl(blob)
      // PDF 는 시그니처 검증 + application/pdf 재래핑을 통과해야만 뷰어로 넘긴다.
      else if (kind === 'PDF') {
        const verified = await toVerifiedPdfBlob(blob)
        if (alive) setContent({ k: 'pdf', blob: verified })
      }
      else if (textLike) {
        const t = await blobToText(blob, { maxBytes: TEXT_DECODE_MAX_BYTES })
        if (alive) setContent({ k: 'text', text: t.slice(0, TEXT_PREVIEW_LIMIT) })
      } else {
        // 바이너리 파서(XLSX/DOCX)는 arrayBuffer 가 필요.
        const buf = await blob.arrayBuffer()
        if (alive) setContent({ k: 'buffer', buffer: buf })
      }
    }
    void convert().catch(() => alive && setConvertError(true))
    return () => {
      alive = false
      if (created) URL.revokeObjectURL(created)
    }
  }, [blob, kind, textLike])

  // 이미지는 확대하면 본문 자체가 가로로 넘친다 — 표와 같은 규칙으로 포커스 가능한 스크롤 영역이 되어,
  // 클릭·Tab 으로 들어온 채 실제로 넘치면 ←/→ 가 파일 넘김 대신 스크롤에 쓰인다.
  // 확대 배율과 무관하게 항상 단다: 확대 중에만 tabIndex 를 달면, 그 안에 포커스가 있는 채로 맞춤(0·−)으로 돌아갈 때
  // 포커스가 body 로 빠져 뷰어 키(←/→·+/−)가 먹히지 않는다. 넘김 양보는 뷰어가 "실제로 가로로 넘칠 때만" 하므로
  // 맞춤 상태에서는 그 안에서도 ←/→ 가 그대로 파일을 넘긴다(PdfPages 도 같은 규칙).
  const zoomScroll = kind === 'IMAGE'
  // 텍스트류 화면이 공유하는 변환 결과(없으면 null).
  const text = content?.k === 'text' ? content.text : null
  return (
    <div
      ref={setBodyEl}
      {...(zoomScroll ? scrollRegionProps('미리보기 스크롤 영역') : {})}
      // 이미지는 flex + 자식 m-auto 로 가운데 둔다 — 넘치면 auto 여백이 0 이 되어(안전한 가운데 정렬) 위·왼쪽까지 스크롤된다.
      // (items-center/justify-center 는 넘친 부분을 위·왼쪽 바깥으로 밀어내 스크롤로 닿을 수 없게 만든다.)
      className={cn('min-h-0 flex-1 overflow-auto', !fillsFrame && 'p-4', kind === 'IMAGE' && 'flex', zoomScroll && SCROLL_REGION_RING_INSET)}
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
        <div className="m-auto w-full max-w-md space-y-2" data-testid="preview-loading">
          <div className="h-3 w-full animate-pulse rounded bg-muted" />
          <div className="h-3 w-5/6 animate-pulse rounded bg-muted" />
          <div className="h-3 w-2/3 animate-pulse rounded bg-muted" />
        </div>
      )}
      {!error && kind === 'IMAGE' && content?.k === 'url' && (
        // 맞춤(확대 1)은 본문 안에 전체가 보이게, 확대는 맞춤 폭 × 배율을 명시 폭으로 준다(레이아웃 크기가 커져 스크롤 영역도 늘어난다).
        // 크기를 재기 전에는 max-w/max-h 로 화면 안에 둔다.
        <img
          src={content.url}
          alt={item.name}
          onLoad={(e) => setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
          className={cn('m-auto shrink-0', fitWidth == null ? 'max-h-full max-w-full object-contain' : 'h-auto max-h-none max-w-none')}
          style={fitWidth == null ? undefined : { width: fitWidth * zoom }}
        />
      )}
      {!error && kind === 'PDF' && content?.k === 'pdf' && (
        <PdfPages blob={content.blob} zoom={zoom} onPage={onPage} onError={() => setConvertError(true)} />
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
      {!error && kind === 'XLSX' && content?.k === 'buffer' && (
        <PaperCard>
          <SheetPreview buffer={content.buffer} />
        </PaperCard>
      )}
      {!error && kind === 'DOCX' && content?.k === 'buffer' && <DocxPreview buffer={content.buffer} />}
    </div>
  )
}
