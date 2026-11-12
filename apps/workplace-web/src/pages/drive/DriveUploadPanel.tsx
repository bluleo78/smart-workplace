/**
 * 드라이브 업로드 패널 (WP-1531).
 *
 * 버튼으로 고른 파일과 끌어다 놓은 파일·폴더를 모두 오른쪽 아래(모바일은 탭바 바로 위) 패널 하나로 보인다.
 * 예전엔 업로드 단추 문구·목록 위 진행 줄·요약 토스트로 흩어져 있어 어느 파일이 어디까지 갔는지, 무엇이 왜 실패했는지 알기 어려웠다.
 * 상태(batch)·동작(취소·다시 시도·닫기)은 useDriveUploadQueue 가 갖고, 이 컴포넌트는 그리기와 펼침/접힘만 맡는다.
 */
import { Check, ChevronDown, ChevronUp, X } from 'lucide-react'
import { memo, type ReactNode, useEffect, useRef, useState } from 'react'

import { formatFileSize } from '@/lib/formatters'
import { cn } from '@/lib/utils'

import type { UploadBatch, UploadItem, UploadSummary } from './uploadQueue'

/** 올리는 중에 행으로 보일 완료 파일 수 — 넘치면 오래된 것부터 「완료 {n}개」 한 줄로 묶는다(긴 폴더 업로드에도 패널 높이를 지킨다). */
const MAX_DONE_ROWS = 5

export interface DriveUploadPanelProps {
  batch: UploadBatch
  summary: UploadSummary
  /** 모바일이면 탭바 위 전체 폭에 접힌 채로 시작한다 — 목록을 가리지 않게. */
  isMobile: boolean
  /**
   * 모바일에서 아래쪽에 더 비켜 줄 높이(CSS 길이) — 선택 막대처럼 화면 맨 아래에 붙는 막대가 떠 있을 때 그 높이를 준다.
   * 없으면 탭바·안전 영역 위 8px 에 뜬다.
   */
  mobileLift?: string
  /**
   * 패널의 실제 높이(px)가 바뀔 때마다 — 펼침/접힘·행 수에 따라 달라진다. 페이지가 목록 아래에 그만큼 공간을 둬
   * 떠 있는 패널이 마지막 행을 가리지 않게 한다. 패널이 사라지면 0 을 알린다.
   */
  onHeightChange?: (height: number) => void
  onCancel: () => void
  onRetry: (id: string) => void
  onClose: () => void
}

/** 진행 막대 — 행(파일)과 접힌 머리(전체)가 같은 모양을 쓴다. 값은 aria-valuenow 로도 읽힌다. */
function ProgressBar({ value, label, className, testId }: { value: number; label: string; className?: string; testId?: string }) {
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value}
      data-testid={testId}
      className={cn('h-1 overflow-hidden rounded-full bg-muted', className)}
    >
      <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${value}%` }} />
    </div>
  )
}

/**
 * 파일 한 행 — 이름(오른쪽에 상태 문구), 하위 폴더 경로, 실패 이유, 올리는 중이면 진행 막대.
 * showRetry 는 패널이 정한다(끝난 배치·취소 아님·다시 시도 가능한 실패일 때만).
 */
// memo — 진행 이벤트마다 패널이 다시 그려져도 바뀌지 않은 행(완료·실패)은 건너뛴다(item 은 리듀서가 바뀐 행만 새로 만든다).
const UploadRow = memo(function UploadRow({
  item,
  showRetry,
  onRetry,
}: {
  item: UploadItem
  showRetry: boolean
  onRetry: (id: string) => void
}) {
  const pathLabel = item.path.length > 0 ? item.path.join(' / ') : null
  return (
    <li data-testid="drive-upload-row" data-status={item.status} className="px-3 py-1.5">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm" title={item.file.name}>
            {item.file.name}
          </p>
          {pathLabel && <p className="truncate text-xs text-muted-foreground">{pathLabel}</p>}
          {item.status === 'failed' && item.error && <p className="text-xs text-destructive">{item.error}</p>}
        </div>
        {item.status === 'done' && <span className="shrink-0 text-xs text-success-text">완료</span>}
        {item.status === 'uploading' && (
          // 진행 중 행의 크기는 파일 전체 크기 — 올린 바이트가 아니라 「얼마짜리를 올리는지」를 보인다.
          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
            {item.percent ?? 0}% · {formatFileSize(item.file.size)}
          </span>
        )}
        {item.status === 'queued' && <span className="shrink-0 text-xs text-muted-foreground">대기</span>}
        {showRetry && (
          <button
            type="button"
            onClick={() => onRetry(item.id)}
            // 실패 행이 여럿이면 「다시 시도」 단추가 여럿이라, 스크린리더가 어느 파일인지 알게 이름에 파일명을 담는다.
            aria-label={`${item.file.name} 다시 시도`}
            data-testid="drive-upload-retry"
            className="shrink-0 rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            다시 시도
          </button>
        )}
      </div>
      {item.status === 'uploading' && <ProgressBar value={item.percent ?? 0} label={`${item.file.name} 진행률`} className="mt-1.5" />}
    </li>
  )
})

/** 묶음 한 줄(「대기 {n}개」·「완료 {n}개」). */
function GroupLine({ children }: { children: string }) {
  return <li className="px-3 py-1.5 text-xs text-muted-foreground">{children}</li>
}

/** 모바일 패널의 bottom 식 — 탭바·안전 영역 중 큰 값 + 8px (+ 비켜 줄 막대 높이). */
function mobileBottom(lift?: string): string {
  const base = 'max(var(--mobile-tabbar-h, 0px), env(safe-area-inset-bottom, 0px)) + 8px'
  return lift ? `calc(${base} + ${lift})` : `calc(${base})`
}

export function DriveUploadPanel({
  batch,
  summary,
  isMobile,
  mobileLift,
  onCancel,
  onRetry,
  onClose,
  onHeightChange,
}: DriveUploadPanelProps) {
  // 높이 재기 — ResizeObserver 로 테두리 포함 높이를 알린다. 콜백은 ref 로 읽어 렌더마다 다시 구독하지 않는다.
  const sectionRef = useRef<HTMLElement>(null)
  const onHeightRef = useRef(onHeightChange)
  useEffect(() => {
    onHeightRef.current = onHeightChange
  })
  useEffect(() => {
    const el = sectionRef.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) => {
      const height = entry?.borderBoxSize?.[0]?.blockSize ?? el.getBoundingClientRect().height
      onHeightRef.current?.(Math.ceil(height))
    })
    observer.observe(el)
    return () => {
      observer.disconnect()
      onHeightRef.current?.(0)
    }
  }, [])
  // 펼침/접힘은 패널 안 상태 — 데스크톱은 펼친 채, 모바일은 목록을 덜 가리게 접힌 채 시작한다.
  const [expanded, setExpanded] = useState(!isMobile)

  const running = batch.running
  const ended = !running
  const allSucceeded = ended && !batch.cancelled && summary.total > 0 && summary.done === summary.total

  // 머리 문구 — 상태(올리는 중·모두 성공·취소함·실패 섞임)마다 하나.
  const title = running
    ? `업로드 ${summary.done}/${summary.total}`
    : allSucceeded
      ? `${summary.done}개 업로드 완료`
      : batch.cancelled
        ? `업로드를 취소했어요 · ${summary.done}개 완료${summary.failed > 0 ? ` · ${summary.failed}개 실패` : ''}`
        : `${summary.done}개 완료 · ${summary.failed}개 실패`

  // 본문 행 — 올리는 중엔 완료(최근 5개)·실패·올리는 중을 순서대로, 대기는 한 줄로.
  // 끝난 뒤엔 실패만 행으로 두고 완료는 「완료 {n}개」 한 줄 — 손볼 것(실패)이 위로 오게.
  const body: ReactNode[] = []
  if (running) {
    // 앞쪽(오래된) 완료 행 hiddenDone 개는 「완료 {n}개」로 묶고 건너뛴다.
    const hiddenDone = Math.max(0, summary.done - MAX_DONE_ROWS)
    if (hiddenDone > 0) body.push(<GroupLine key="done-group">{`완료 ${hiddenDone}개`}</GroupLine>)
    let skipped = 0
    for (const it of batch.items) {
      if (it.status === 'done' && skipped < hiddenDone) {
        skipped++
        continue
      }
      if (it.status === 'done' || it.status === 'failed' || it.status === 'uploading')
        body.push(<UploadRow key={it.id} item={it} showRetry={false} onRetry={onRetry} />)
    }
    if (summary.queued > 0) body.push(<GroupLine key="queued-group">{`대기 ${summary.queued}개`}</GroupLine>)
  } else if (!allSucceeded) {
    for (const it of batch.items) {
      if (it.status !== 'failed') continue
      // 취소한 배치에선 다시 시도를 숨긴다 — 사용자가 멈춘 묶음을 한 파일씩 되살리는 흐름은 두지 않는다.
      body.push(<UploadRow key={it.id} item={it} showRetry={!batch.cancelled && it.retryable === true} onRetry={onRetry} />)
    }
    if (summary.done > 0) body.push(<GroupLine key="done-group">{`완료 ${summary.done}개`}</GroupLine>)
  }
  // 접을 내용이 있을 때만 접기/펼치기 단추를 둔다(모두 성공·빈 취소 배치는 한 줄뿐).
  const collapsible = running || body.length > 0
  const showBody = expanded && body.length > 0

  return (
    <section
      ref={sectionRef}
      aria-label="파일 업로드"
      data-testid="drive-upload-panel"
      // 데스크톱은 오른쪽 아래 320px. 모바일은 좌우를 채우고 탭바(--mobile-tabbar-h, MobileTabBar 가 :root 에 단다) 바로 위 —
      // 탭바가 없는 화면(드라이브 공간 등)은 홈 인디케이터에 걸리지 않게 하단 안전 영역 위로. 둘 중 큰 값에 8px 을 띄운다.
      // 선택 막대처럼 맨 아래 막대가 떠 있으면 그 높이(mobileLift)만큼 더 올려 막대의 단추를 가리지 않는다.
      style={isMobile ? { bottom: mobileBottom(mobileLift) } : undefined}
      className={cn(
        'fixed z-40 overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-lg',
        isMobile ? 'inset-x-2' : 'right-4 bottom-4 w-80',
      )}
    >
      <div className={cn('flex items-center gap-2 px-3 py-2', showBody && 'border-b border-border')}>
        {allSucceeded && <Check className="h-4 w-4 shrink-0 text-success" aria-hidden />}
        <p aria-live="polite" className="min-w-0 flex-1 truncate text-sm font-semibold">
          {title}
        </p>
        {running && !expanded && (
          <ProgressBar value={summary.overallPercent} label="전체 진행률" className="w-16 shrink-0" testId="drive-upload-panel-bar" />
        )}
        {running && (
          <button
            type="button"
            onClick={onCancel}
            data-testid="drive-upload-panel-cancel"
            className="shrink-0 rounded px-1.5 py-0.5 text-xs font-medium text-destructive hover:bg-destructive/10"
          >
            {expanded ? '모두 취소' : '취소'}
          </button>
        )}
        {/* 접기/펼치기 — 시안대로 「취소」 뒤, 닫기(✕) 앞. 접을 내용이 있을 때만(모두 성공·빈 취소 배치는 한 줄뿐). */}
        {collapsible && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            aria-label={expanded ? '업로드 목록 접기' : '업로드 목록 펼치기'}
            data-testid="drive-upload-panel-toggle"
            className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            {expanded ? <ChevronDown className="h-4 w-4" aria-hidden /> : <ChevronUp className="h-4 w-4" aria-hidden />}
          </button>
        )}
        {/* 닫기는 끝난 뒤에만 — 올리는 중에 닫으면 진행과 취소를 볼 곳이 사라진다. */}
        {ended && (
          <button
            type="button"
            onClick={onClose}
            aria-label="업로드 패널 닫기"
            data-testid="drive-upload-panel-close"
            className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
      {showBody && <ul className="max-h-72 overflow-y-auto py-1">{body}</ul>}
    </section>
  )
}
