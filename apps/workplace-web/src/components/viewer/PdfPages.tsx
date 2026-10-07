import type { PDFDocumentLoadingTask, PDFDocumentProxy, PDFPageProxy, RenderTask } from 'pdfjs-dist'
import { useEffect, useRef, useState } from 'react'

import { SCROLL_REGION_RING_INSET, scrollRegionProps } from '../../lib/scrollRegion'
import { cn } from '../../lib/utils'
import { capRenderScale } from './pdfScale'

/** 페이지 크기를 알기 전 자리표시 비율(US Letter). */
const DEFAULT_RATIO = 792 / 612

/**
 * PDF 전 페이지를 세로로 이어 그린다(WP-277) — iframe 내장 뷰어는 iOS 에서 첫 페이지만 보일 수 있어 pdf.js 로 직접 렌더.
 * pdf.js 는 동적 import 라 PDF 를 열 때만 내려받는다(초기 번들 무영향).
 * 페이지는 화면 근처에 들어올 때(IntersectionObserver)만 그려 큰 문서도 첫 화면이 빨리 뜬다.
 * 호출부는 toVerifiedPdfBlob 을 통과한 blob 만 넘긴다(위장 HTML 차단, WP-203).
 */
export function PdfPages({
  blob,
  zoom,
  onPage,
  onError,
}: {
  blob: Blob
  /** 확대 배율(1 = 폭 맞춤) — 맞춤 폭에 곱해 페이지 CSS 폭을 정한다. */
  zoom: number
  /** 현재 페이지(화면에 가장 많이 걸친 쪽)와 전체 쪽수 — 호출부는 useCallback 으로 고정해 넘긴다. */
  onPage: (current: number, total: number) => void
  /** 문서를 열지 못했을 때(손상 PDF 등) — 호출부가 오류 화면으로 바꾼다. */
  onError: () => void
}) {
  // 스크롤 요소 — 크기 관찰·현재 쪽 관찰·페이지별 지연 렌더 관찰의 root 로 쓴다.
  // 렌더 중 ref 를 읽지 않고 페이지에 prop 으로 넘기도록 콜백 ref 로 state 에 담는다.
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null)
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null)
  const [width, setWidth] = useState(0)
  // onError 는 이펙트 의존성에서 빼기 위해 ref 로 최신값만 든다.
  const onErrorRef = useRef(onError)
  useEffect(() => {
    onErrorRef.current = onError
  })

  // 문서 열기 — blob 이 바뀌면 이전 문서를 닫는다.
  useEffect(() => {
    let alive = true
    // 문서 정리는 loadingTask.destroy() 로 한다(v6 의 PDFDocumentProxy 에는 destroy 가 없다).
    let task: PDFDocumentLoadingTask | null = null
    // 이전 문서는 곧 destroy 되므로 페이지들이 닫힌 문서에 getPage 하지 않게 먼저 비운다.
    setDoc(null)
    void (async () => {
      // legacy 빌드 — 기본 빌드는 최신 API(Map.getOrInsertComputed·Math.sumPrecise 등)를 폴리필 없이 써서
      // iOS Safari 등 구형 브라우저에서 문서를 열지 못한다. 워커도 같은 legacy 빌드와 짝을 맞춘다.
      // 라이브러리·워커 URL·문서 바이트는 서로 독립이라 함께 받는다(동적 import 라 지연 청크 분할은 그대로).
      const [pdfjs, worker, buf] = await Promise.all([
        import('pdfjs-dist/legacy/build/pdf.mjs'),
        import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'),
        blob.arrayBuffer(),
      ])
      if (!alive) return
      pdfjs.GlobalWorkerOptions.workerSrc = worker.default
      task = pdfjs.getDocument({ data: new Uint8Array(buf) })
      const d = await task.promise
      if (alive) setDoc(d)
    })().catch(() => alive && onErrorRef.current())
    return () => {
      alive = false
      void task?.destroy()
    }
  }, [blob])

  // 폭 맞춤 기준 폭 — 컨테이너 크기 변화(AI 패널 열림·창 크기)에 반응.
  useEffect(() => {
    if (!scroller) return
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(0, Math.min(e.contentRect.width - 32, 1000))))
    ro.observe(scroller)
    return () => ro.disconnect()
  }, [scroller])

  // 현재 페이지 보고 — 페이지별 노출 비율을 모아 가장 많이 보이는 쪽을 알린다(변경분만 오는 entries 로는 비교 불가).
  // 문서가 바뀔 때만 1쪽·전체 쪽수를 알린다.
  useEffect(() => {
    if (doc) onPage(1, doc.numPages)
  }, [doc, onPage])
  const ready = doc != null && width > 0
  useEffect(() => {
    const root = scroller
    if (!root || !doc || !ready) return
    const total = doc.numPages
    const ratios = new Map<number, number>()
    let last = 0
    const report = () => {
      let best = 1
      let bestRatio = -1
      for (const [n, r] of ratios) {
        if (r > bestRatio || (r === bestRatio && n < best)) {
          best = n
          bestRatio = r
        }
      }
      if (best !== last) {
        last = best
        onPage(best, total)
      }
    }
    // 시작값 0 — 관찰 첫 콜백이 실제 현재 쪽을 알린다(리사이즈로 이펙트가 다시 돌아도 1쪽으로 튀지 않음).
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) ratios.set(Number((e.target as HTMLElement).dataset.page), e.intersectionRatio)
        report()
      },
      { root, threshold: [0, 0.25, 0.5, 0.75, 1] },
    )
    root.querySelectorAll('[data-page]').forEach((n) => io.observe(n))
    return () => io.disconnect()
  }, [doc, ready, onPage, scroller])

  return (
    // 이미지와 같은 규칙의 포커스 가능한 스크롤 영역 — 확대해 가로로 넘치면 ←/→ 를 넘김 대신 스크롤에 양보한다.
    // 배율과 무관하게 항상 단다(맞춤으로 돌아갈 때 포커스가 빠지지 않게 — ViewerBody 주석 참조).
    <div
      ref={setScroller}
      {...scrollRegionProps('미리보기 스크롤 영역')}
      className={cn('flex h-full min-h-0 flex-col gap-4 overflow-auto py-4', SCROLL_REGION_RING_INSET)}
      data-testid="pdf-document"
    >
      {doc &&
        width > 0 &&
        Array.from({ length: doc.numPages }, (_, i) => (
          <PdfPage key={i + 1} doc={doc} pageNumber={i + 1} cssWidth={width * zoom} root={scroller} />
        ))}
    </div>
  )
}

/**
 * 한 페이지 — 화면 근처에 들어올 때 devicePixelRatio 배율로 그려 확대해도 선명하게 한다.
 * 실제 페이지 비율을 알면 자리표시 높이를 그 비율로 바꿔, 크기가 다른 페이지도 찌그러지지 않게 한다.
 */
function PdfPage({
  doc,
  pageNumber,
  cssWidth,
  root,
}: {
  doc: PDFDocumentProxy
  pageNumber: number
  cssWidth: number
  /** 페이지를 잘라 보이는 스크롤 요소(pdf-document) — 뷰포트 기준이면 rootMargin 이 스크롤러에 잘려 무의미해진다. */
  root: HTMLElement | null
}) {
  const ref = useRef<HTMLCanvasElement>(null)
  const [visible, setVisible] = useState(pageNumber === 1)
  const pageRef = useRef<PDFPageProxy | null>(null)
  const [ratio, setRatio] = useState(DEFAULT_RATIO)
  // 같은 캔버스에 render 가 겹치면 pdf.js 가 거부하므로, 직전 렌더가 끝난(취소된) 뒤에 다음을 시작한다.
  const prevRender = useRef<Promise<unknown>>(Promise.resolve())

  // 스크롤러 기준 근처 600px 안에 들어오면 그리고, 멀어지면 다시 visible=false 로 돌려 비트맵을 풀어 준다(양방향).
  // 관찰자 하나가 들어옴·나감을 모두 알리므로 visible 이 바뀔 때마다 다시 만들지 않는다(root 가 바뀔 때만).
  useEffect(() => {
    const el = ref.current
    if (!el || !root) return
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { root, rootMargin: '600px' })
    io.observe(el)
    return () => io.disconnect()
  }, [root])

  useEffect(() => {
    if (!visible) return
    let cancelled = false
    let task: RenderTask | null = null
    void doc.getPage(pageNumber).then(async (page) => {
      const base = page.getViewport({ scale: 1 })
      if (cancelled) return
      setRatio(base.height / base.width)
      await prevRender.current
      const canvas = ref.current
      if (cancelled || !canvas) return
      pageRef.current = page
      // 해상도만 낮춰 iOS 캔버스 픽셀 한도를 지킨다(CSS 크기는 style 로 고정).
      const pxScale = capRenderScale(cssWidth, cssWidth * (base.height / base.width), window.devicePixelRatio)
      const vp = page.getViewport({ scale: (cssWidth / base.width) * pxScale })
      canvas.width = Math.floor(vp.width)
      canvas.height = Math.floor(vp.height)
      task = page.render({ canvas, viewport: vp })
      prevRender.current = task.promise.catch(() => undefined)
    }).catch(() => undefined)
    return () => {
      cancelled = true
      task?.cancel()
    }
  }, [doc, pageNumber, cssWidth, visible])

  // 화면에서 멀어지거나 사라질 때 캔버스 비트맵(수십 MB)과 pdf.js 페이지 자원을 놓는다.
  // CSS 폭·높이는 style 로 유지되므로 자리(스크롤 위치)는 변하지 않는다.
  useEffect(() => {
    if (!visible) return
    const canvas = ref.current
    return () => {
      if (canvas) {
        canvas.width = 0
        canvas.height = 0
      }
      pageRef.current?.cleanup()
      pageRef.current = null
    }
  }, [visible, doc, pageNumber])

  return (
    <canvas
      ref={ref}
      data-page={pageNumber}
      data-testid={`pdf-page-${pageNumber}`}
      className="mx-auto shrink-0 bg-white shadow-md"
      style={{ width: cssWidth, height: cssWidth * ratio }}
    />
  )
}
