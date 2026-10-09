import { FileX } from 'lucide-react'
import { memo, useEffect, useRef, useState } from 'react'

import { blobToText, toVerifiedPdfBlob } from '../../api/blobContent'
import { useObservedBox } from '../../hooks/useObservedBox'
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
import { MediaPlayer, type MediaSession } from './MediaPlayer'
import { PdfPages } from './PdfPages'
import type { ViewerItem } from './types'
import { type PreviewProgress, usePreviewBlob } from './usePreviewBlob'

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

/**
 * 미지원 형식 안내 — 큰 형식 아이콘·이름·크기·문구·다운로드. 재생 불가 코덱(영상·오디오 error 이벤트, WP-281)도 같은 화면을 쓴다.
 */
function UnsupportedNotice({ item, onDownload }: { item: ViewerItem; onDownload: () => void }) {
  return (
    // m-auto·w-full — 이미지·영상·오디오 본문은 flex 라 이것이 없으면 내용 폭만큼 왼쪽 위에 붙는다.
    <div className="m-auto flex w-full flex-col items-center gap-3 px-4 py-12 text-center" data-testid="preview-unsupported">
      <FileTypeIcon mimeType={item.mimeType} className="h-16 w-16" />
      <p className="text-sm font-medium break-all">{item.name}</p>
      {item.sizeBytes != null && <p className="text-xs text-muted-foreground">{formatFileSize(item.sizeBytes)}</p>}
      <p className="text-sm text-muted-foreground">이 형식은 미리 볼 수 없어요</p>
      <Button variant="outline" onClick={onDownload}>
        다운로드
      </Button>
    </div>
  )
}

/**
 * 영상·오디오 받는 중 — 통째로 받아야 재생되므로 스켈레톤 대신 % 진행률(스펙 §4.3·§5.3 #4, 시안 "영상 받는 중… 62%").
 * 분모를 모르면 % 없이 "받는 중"과 받은 크기만, 진행 막대는 맥박 애니메이션.
 */
function MediaProgress({ item, video, progress }: { item: ViewerItem; video: boolean; progress: PreviewProgress | null }) {
  const percent = progress?.percent ?? null
  return (
    <div className="m-auto flex w-full max-w-xs flex-col items-center gap-3 text-center" data-testid="preview-loading">
      <FileTypeIcon mimeType={item.mimeType} className="h-12 w-12" />
      <p className="text-sm" data-testid="media-progress-label">
        {video ? '영상' : '오디오'} 받는 중…{percent != null && ` ${percent}%`}
      </p>
      <div
        role="progressbar"
        aria-label={`${item.name} 받는 중`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent ?? undefined}
        data-testid="media-progress"
        className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
      >
        <div
          className={cn('h-full rounded-full bg-primary transition-[width]', percent == null && 'w-full animate-pulse')}
          style={percent != null ? { width: `${percent}%` } : undefined}
        />
      </div>
      {progress != null && progress.loaded > 0 && (
        <p className="text-xs text-muted-foreground">
          {formatFileSize(progress.loaded)}
          {progress.total != null && ` / ${formatFileSize(progress.total)}`}
        </p>
      )}
    </div>
  )
}

/** 문서형(종이 카드 안에 그리는) 형식 — 다크 캔버스 위에서 읽기 편하도록 밝은 카드에 둔다. */
function PaperCard({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto max-w-4xl rounded-md bg-card p-6 text-card-foreground">{children}</div>
}

/**
 * 뷰어 본문 — 종류별 렌더와 상태 화면(로딩·오류·10MB 확인·미지원·사용 불가).
 * 항목이 바뀌면 이전 결과를 비우고 다시 변환한다(넘김 대응 — 호출부가 key={item.key} 도 준다).
 * 기존 드라이브 미리보기 모달의 본문 변환 로직을 이식한 것이며, PDF 는 검증된 blob 을 pdf.js(PdfPages)로 전 페이지 그린다.
 * memo — 뷰어는 끌기 끝·바 토글·시트·blob 보고마다 다시 그려지는데 본문 props(항목·배율·고정 콜백)는 그대로인 경우가 많다.
 * 콜백 props(onPage·onSource)는 호출부가 항목 key 동안 고정된 참조로 넘긴다.
 */
export const ViewerBody = memo(function ViewerBody({
  item,
  zoom,
  onPage,
  chromeInset,
  barsHidden,
  onSource,
  media: mediaSession,
  sideInset,
}: {
  item: ViewerItem
  /** 이미지·PDF 확대 배율(1 = 폭 맞춤). */
  zoom: number
  /** PDF 현재 페이지 보고 — 호출부가 useCallback 으로 고정해 넘긴다(PdfPages 이펙트 의존성). */
  onPage: (current: number, total: number) => void
  /**
   * 모바일 바가 본문 위에 겹쳐 뜰 때(WP-278) — 문서형(이미지 외)은 첫·끝 줄이 바에 가리지 않게 위·아래 여백을 둔다.
   * 이미지는 사진 앱처럼 화면 전체에 맞추고 반투명 바가 위에 겹친다.
   */
  chromeInset?: boolean
  /** 모바일 바가 숨겨진 상태 — 본문 밖 스크롤러를 가진 형식(PDF·HTML·DOCX)은 여백을 거둬 전체 높이를 쓴다. */
  barsHidden?: boolean
  /**
   * 원본 blob 상태 보고(WP-278) — 모바일 ⤴ 공유는 제스처 직후 동기 호출이 필요해 뷰어가 blob 을 미리 들고 있어야 한다.
   * fetches = 이 항목이 지금 blob 을 받는(받을) 상태인가 — 미지원·사용 불가·10MB 동의 대기·오류면 거짓.
   * 항목 구분은 호출부 몫 — 이 컴포넌트는 key={item.key} 로 항목마다 새로 붙으므로 보고는 늘 지금 항목의 것이다.
   */
  onSource?: (s: { blob: Blob | null; fetches: boolean; unplayable?: boolean }) => void
  /** 영상·오디오 재생 세션(WP-281) — 자동재생 대상·위치 기억·재생 상태 보고. 뷰어가 열린 동안 고정된 객체. */
  media?: MediaSession
  /** 모바일에서 ‹ › 가 있을 때 영상 좌우를 그 폭만큼 비운다(화살표가 영상·컨트롤을 덮지 않게). */
  sideInset?: boolean
}) {
  const kind = resolvePreviewKind(item.mimeType)
  const textLike = kind === 'MARKDOWN' || kind === 'HTML' || kind === 'TEXT' || kind === 'CSV'
  const parsed = kind === 'XLSX' || kind === 'DOCX'
  const isMedia = kind === 'VIDEO' || kind === 'AUDIO'
  const renderable = kind === 'IMAGE' || kind === 'PDF' || textLike || parsed || isMedia
  // 원본 blob 받기·10MB 초과 확인은 훅이 맡고, 여기서는 종류별 변환만 한다. 영상·오디오는 받는 중 % 를 보여 주려고 진행도 든다.
  const source = usePreviewBlob(item, renderable, { trackProgress: isMedia })
  const { blob, confirmSize } = source
  // 변환 결과(없으면 아직 변환 전). WP-203: pdf 는 toVerifiedPdfBlob 을 통과한 blob 만 담아 pdf.js 로 넘긴다.
  const [content, setContent] = useState<BodyContent | null>(null)
  const [convertError, setConvertError] = useState(false)
  // 재생 불가(코덱 미지원 등 플레이어 error 이벤트) — 실패 화면이 아니라 미지원 화면 + 다운로드로 바꾼다(스펙 §5.3).
  const [unplayable, setUnplayable] = useState(false)
  // 이미지 확대 계산용 — 본문 내용 영역 크기(패딩 제외)와 이미지 원본 크기.
  const [bodyEl, setBodyEl] = useState<HTMLDivElement | null>(null)
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null)
  const box = useObservedBox(bodyEl, kind === 'IMAGE')
  const fitWidth = natural && box ? fitImageWidth(natural.w, natural.h, box.w, box.h) : null
  const error = source.error || convertError
  // 부모(뷰어)에 blob 상태를 알린다 — 콜백은 최신값 ref 로 읽어 이펙트가 콜백 정체성에 흔들리지 않게.
  const onSourceRef = useRef(onSource)
  useEffect(() => {
    onSourceRef.current = onSource
  })
  const fetches = renderable && !item.unavailable && confirmSize == null && !error
  // unplayable — 재생 불가로 미지원 화면이 된 영상·오디오. 뷰어가 이 항목을 미디어로 다루지 않게(키·터치 규칙) 함께 알린다.
  useEffect(() => {
    onSourceRef.current?.({ blob, fetches, unplayable })
  }, [item.key, blob, fetches, unplayable])
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
      // 이미지·영상·오디오는 object URL 로 그린다(해제는 아래 정리 — 언마운트 = 닫기·넘김 때).
      if (kind === 'IMAGE' || isMedia) showUrl(blob)
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
  }, [blob, kind, textLike, isMedia])

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
      className={cn(
        'min-h-0 flex-1 overflow-auto',
        !fillsFrame && 'p-4',
        // 영상·오디오도 flex — 플레이어가 내용 영역 높이를 가득 받아(영상 맞춤) 가운데 선다.
        (kind === 'IMAGE' || isMedia) && 'flex',
        zoomScroll && SCROLL_REGION_RING_INSET,
        // 상단 바(3.5rem=min-h-14 + 노치)·하단 겹침 바 높이 + 여유 1rem 만큼 비켜선다.
        // 하단은 AttachmentViewer 가 잰 실제 높이(--viewer-bottom-chrome — "참조된 곳" 띠·홈 인디케이터 포함), 재기 전엔 4칸 바(3.5rem)+안전영역.
        // 단 바를 숨기면(가로 기본·탭) PDF·HTML·DOCX 처럼 본문 밖에 스크롤러를 가진(fillsFrame) 형식은 여백을 거둔다 —
        // 여백이 스크롤 영역 밖 고정 띠가 되어 가로 화면의 4할 가까이를 비우기 때문. 텍스트류는 여백이 내용과 함께 스크롤되므로
        // 그대로 둔다(토글 때 글이 들썩이지 않게).
        chromeInset &&
          kind !== 'IMAGE' &&
          !(fillsFrame && barsHidden) &&
          'pt-[calc(3.5rem+env(safe-area-inset-top))] pb-[calc(var(--viewer-bottom-chrome,calc(3.5rem+env(safe-area-inset-bottom)))+1rem)]',
      )}
      data-testid="preview-body"
    >
      {/* 드라이브 링크 원본이 휴지통·삭제 — 받지 않고 안내만(다운로드 없음).
          미지원 형식 화면과 같은 배치(가운데 큰 아이콘·이름·문구)로 맞춰 상태 화면끼리 생김새가 같게 한다. */}
      {item.unavailable && (
        <div className="m-auto flex w-full flex-col items-center gap-3 px-4 py-12 text-center" data-testid="preview-unavailable">
          <FileX className="h-16 w-16 text-muted-foreground" aria-hidden />
          <p className="text-sm font-medium break-all">{item.name}</p>
          <p className="text-sm text-muted-foreground">원본 파일을 사용할 수 없습니다.</p>
        </div>
      )}
      {!item.unavailable && error && (
        <div className="m-auto flex w-full flex-col items-center gap-3 px-4 py-12 text-center" data-testid="preview-error">
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
      {!item.unavailable && !error && (!renderable || unplayable) && (
        <UnsupportedNotice item={item} onDownload={() => void source.download()} />
      )}
      {/* #775: 콘텐츠 페치 중(로딩) — AI 요약 카드와 같은 animate-pulse 스켈레톤 패턴 재사용. */}
      {/* 영상·오디오 상태 알림 — 받는 중 → 재생 준비(매 % 가 아니라 전환 때만, polite). 재생 불가는 미지원 화면이 그대로 읽힌다. */}
      {isMedia && (
        <p className="sr-only" aria-live="polite" data-testid="media-status-live">
          {loading ? `${item.name} 받는 중` : !error && !unplayable && content?.k === 'url' ? `${item.name} 재생 준비됨` : ''}
        </p>
      )}
      {loading && isMedia && <MediaProgress item={item} video={kind === 'VIDEO'} progress={source.progress} />}
      {loading && !isMedia && (
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
          // 확대 기준 요소 표식 — 핀치·두 번 탭 기준점을 이 요소 안 비율로 잡는다(여백·가운데 정렬 여백은 배율을 따르지 않으므로).
          data-zoom-content=""
          className={cn('m-auto shrink-0', fitWidth == null ? 'max-h-full max-w-full object-contain' : 'h-auto max-h-none max-w-none')}
          style={fitWidth == null ? undefined : { width: fitWidth * zoom }}
        />
      )}
      {!error && isMedia && !unplayable && content?.k === 'url' && (
        <MediaPlayer
          kind={kind}
          url={content.url}
          itemKey={item.key}
          name={item.name}
          session={mediaSession}
          onError={() => setUnplayable(true)}
          sideInset={sideInset}
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
          className="m-auto flex w-full flex-col items-center gap-3 px-4 py-12 text-center break-keep"
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
})
