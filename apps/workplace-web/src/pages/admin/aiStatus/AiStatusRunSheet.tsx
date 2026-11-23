// 처리 상세 시트(WP-1825) — 처리 이력 행을 누르면 열리는 옆(모바일은 아래) 시트.
// 목록 한 줄(item)은 즉시 보이고, 처리(R-)만 상세 API 로 계정·시도·캐시 토큰·오류 원문을 더한다. 위임 작업(W-)은 상세 API 를 부르지 않는다.
import { type ReactNode, useState } from 'react'

import type { AiRunListItem } from '@/api/aiStatus'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { StatusBadge } from '@/components/ui/status-badge'
import { useAiStatusRunDetail } from '@/hooks/queries/useAiStatusRuns'
import { aiRunKindLabel } from '@/lib/aiRunKindLabels'
import { EMPTY_GLYPH, formatDurationMs, formatNumber } from '@/lib/formatters'

import { AiStatusActor } from './AiStatusActor'
import { runDetailId, runStatusBadge, runStatusLabel, runTimeText, tokensText } from './aiStatusHistoryModel'
import { AiStatusRunTarget } from './AiStatusRunTarget'

/** 요약 한 줄 — 이름 · 값. */
function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex gap-3 text-sm">
      <dt className="w-20 shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  )
}

/** 시간 막대 한 줄 — 긴 값을 100% 로 둔 상대 길이. 값이 없으면 빈 값 표기. */
function Bar({ label, ms, max, testId }: { label: string; ms: number | null; max: number; testId: string }) {
  if (ms === null) {
    return (
      <div className="text-sm">
        <span className="text-muted-foreground">{label}</span> {EMPTY_GLYPH}
      </div>
    )
  }
  const pct = max > 0 ? Math.max((ms / max) * 100, 2) : 0
  return (
    <div className="space-y-1 text-sm">
      <div className="flex justify-between">
        <span className="text-muted-foreground">{label}</span>
        <span>{formatDurationMs(ms)}</span>
      </div>
      <div className="h-2 rounded bg-muted">
        <div
          data-testid={testId}
          role="img"
          aria-label={`${label} ${formatDurationMs(ms)}`}
          className="h-2 rounded bg-primary"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}

/** 처리 상세 시트 — item 이 null 이면 닫힘. */
export function AiStatusRunSheet({
  item,
  side,
  onClose,
  onSameKindFailures,
}: {
  item: AiRunListItem | null
  side: 'right' | 'bottom'
  onClose: () => void
  onSameKindFailures: (kind: string) => void
}) {
  // 닫힘 애니메이션 동안 패널이 비지 않게 마지막으로 보인 item 을 유지한다(열림 여부는 item 으로 따로)
  const [lastItem, setLastItem] = useState(item)
  if (item && item !== lastItem) setLastItem(item)
  const shown = item ?? lastItem
  const runId = shown ? runDetailId(shown.id) : null
  const detailQuery = useAiStatusRunDetail(item ? runId : null) // 열려 있을 때만 부른다(닫힘 애니메이션 동안은 shown 으로 내용만 유지)
  // 상세를 기다리는 중 — 열려 있는 처리(R-)만(위임 작업 W- 는 상세가 없다)
  const loadingDetail = item !== null && runId !== null && detailQuery.isPending
  const detail = detailQuery.data
  const errorText = detail?.errorDetail ?? shown?.errorReason ?? null
  const hasCache = detail != null && (detail.cacheReadTokens !== null || detail.cacheWriteTokens !== null)
  const maxMs = Math.max(shown?.waitMs ?? 0, shown?.durationMs ?? 0)

  return (
    <Sheet open={item !== null} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side={side} className={`overflow-y-auto sm:max-w-md ${side === 'bottom' ? 'max-h-[85vh]' : ''}`} data-testid="ai-run-sheet">
        {shown && (
          <>
            <SheetHeader>
              <SheetTitle>{aiRunKindLabel(shown.kind)}</SheetTitle>
              <SheetDescription asChild>
                <div className="flex flex-wrap items-center gap-2">
                  <span>{runTimeText(shown.startedAt)}</span>
                  <span>·</span>
                  <AiStatusActor actor={shown.actor} />
                  <span>·</span>
                  <StatusBadge type={runStatusBadge(shown.status)}>{runStatusLabel(shown.status)}</StatusBadge>
                </div>
              </SheetDescription>
            </SheetHeader>
            <div className="space-y-5 px-4 pb-4">
              <dl className="space-y-2">
                <Row label="대상">
                  <AiStatusRunTarget target={shown.target} />
                </Row>
                <Row label="모델">{shown.model ?? EMPTY_GLYPH}</Row>
                {detail ? (
                  <>
                    <Row label="계정">{detail.credentialLabel ?? EMPTY_GLYPH}</Row>
                    <Row label="시도">{detail.attempt === null ? EMPTY_GLYPH : `${detail.attempt}번째`}</Row>
                  </>
                ) : (
                  loadingDetail && (
                    <>
                      <Row label="계정"><Skeleton className="h-4 w-32" /></Row>
                      <Row label="시도"><Skeleton className="h-4 w-12" /></Row>
                    </>
                  )
                )}
                <Row label="토큰">
                  <div>{tokensText(shown.inputTokens, shown.outputTokens)}</div>
                  {hasCache && (
                    <div className="text-muted-foreground">
                      캐시 읽기 {formatNumber(detail.cacheReadTokens ?? 0)} · 쓰기 {formatNumber(detail.cacheWriteTokens ?? 0)}
                    </div>
                  )}
                </Row>
                {detail ? (
                  <Row label="처리 ID">
                    <span className="font-mono text-xs">{detail.runId}</span>
                  </Row>
                ) : (
                  loadingDetail && (
                    <Row label="처리 ID"><Skeleton className="h-4 w-48" /></Row>
                  )
                )}
              </dl>
              {detailQuery.isError && <p className="text-sm text-muted-foreground">상세를 불러오지 못함</p>}
              <section className="space-y-2" aria-label="시간">
                <Bar label="대기" ms={shown.waitMs} max={maxMs} testId="ai-run-bar-wait" />
                <Bar label="처리 시간" ms={shown.durationMs} max={maxMs} testId="ai-run-bar-duration" />
              </section>
              {errorText && (
                <section className="space-y-1" aria-label="오류">
                  <h3 className="text-sm font-medium">오류</h3>
                  <pre className="whitespace-pre-wrap break-words rounded-md border border-destructive p-2 font-mono text-xs">{errorText}</pre>
                </section>
              )}
              {/* 실패한 처리에만 — 성공·진행 건에서 「실패만 보기」는 맥락이 맞지 않는다 */}
              {shown.status === 'FAILED' && (
                <Button variant="outline" size="sm" onClick={() => onSameKindFailures(shown.kind)}>
                  같은 종류 실패만 보기
                </Button>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}
