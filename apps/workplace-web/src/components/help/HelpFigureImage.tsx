// 매뉴얼 그림 한 장 그리기 — 도움말 패널 본문(panel, 폭 100%)과 AI 답(small, 작은 그림 한 장)이 함께 쓴다(WP-1511).
// 누르면 큰 그림 대화상자가 열리고, 파일을 못 받으면 alt 글로 바뀐다. AI 는 그림을 만들지 않고 매뉴얼의 그림 id 만 고른다.
import { useState } from 'react'

import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

import { HELP_BASE, type HelpFigure } from './helpBundle'

/** 그림 크기 — panel 은 패널 폭 가득, small 은 AI 말풍선용 작은 그림(최대 240px). */
export type HelpFigureSize = 'panel' | 'small'

/** 그림 — 누르면 큰 그림 대화상자. 파일을 못 받으면 alt 글로 바꾼다. */
export function HelpFigureImage({ figure, size = 'panel' }: { figure: HelpFigure; size?: HelpFigureSize }) {
  const [failed, setFailed] = useState(false)
  const [zoom, setZoom] = useState(false)
  const src = `${HELP_BASE}/${figure.src}`
  if (failed) return <HelpFigureFallback alt={figure.alt} />
  return (
    <>
      <button
        type="button"
        aria-label={`${figure.alt} 크게 보기`}
        onClick={() => setZoom(true)}
        className={cn('block w-full cursor-zoom-in overflow-hidden rounded border', size === 'small' && 'max-w-[240px]')}
      >
        <img src={src} alt={figure.alt} onError={() => setFailed(true)} className="block w-full" />
      </button>
      {/* 공용 Dialog 에 큰 그림 하나 — 첨부 뷰어는 인증 API 경로용이라 공개 정적 파일인 도움말 그림과 맞지 않는다(계획 10). */}
      <Dialog open={zoom} onOpenChange={setZoom}>
        {/* 설명 글이 없는 그림 대화상자 — 제목(alt)만으로 충분해 aria-describedby 를 비운다(Radix 의 Description 누락 경고 방지). */}
        {/* data-help-panel — 포털이라 패널 밖에 그려지지만 패널의 일부(문맥 신호에서 화면 상호작용·열린 대화상자로 보지 않게, WP-1506). */}
        <DialogContent data-help-panel data-testid="help-figure-dialog" aria-describedby={undefined} className="max-w-[calc(100%-2rem)] p-3 sm:max-w-[min(1200px,calc(100%-2rem))]">
          <DialogTitle className="sr-only">{figure.alt}</DialogTitle>
          <img src={src} alt={figure.alt} className="block h-auto w-full" />
        </DialogContent>
      </Dialog>
    </>
  )
}

/** 그림 대신 보이는 alt 글 — 묶음에 없는 그림 id·로드 실패. */
export function HelpFigureFallback({ alt }: { alt: string }) {
  return <span className="block text-muted-foreground">{alt}</span>
}
