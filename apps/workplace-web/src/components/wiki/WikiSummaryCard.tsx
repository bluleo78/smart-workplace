import { useEffect, useRef } from 'react'

import { AiContent } from '@/components/ai/AiContent'
import { formatMonthDayClock } from '@/lib/formatters'

import { useGenerateWikiSummary, useWikiSummary } from '../../hooks/queries/useWikiSummary'

/**
 * WP-301 노트 상단 AI 요약 카드 — 메일·드라이브와 같은 AiContent 톤.
 *
 * - 요약이 없고(MISSING) 노트가 충분히 길면 노트당 한 번 자동 생성한다. 실패해도 자동 재시도하지 않는다(비용·무한 반복 방지).
 * - 낡음은 서버 status(STALE) 또는 편집기의 liveVersion > summaryVersion 이면 표시한다 — 다른 사람의 저장(서버가 아는 낡음)과
 *   내 저장 직후(서버를 다시 묻기 전)를 모두 반영하기 위함.
 * - TOO_SHORT 인 동안에는 저장(liveVersion 변화)마다 상태를 다시 조회한다 — 짧던 노트가 길어져 MISSING 이 되면 자동 생성이 뜨게.
 * - TOO_SHORT·조회 실패·AI 불가(쿼리 비활성)면 아무것도 그리지 않는다.
 */
export function WikiSummaryCard({ pageId, liveVersion }: { pageId: number; liveVersion: number }) {
  const { data, refetch } = useWikiSummary(pageId)
  const generate = useGenerateWikiSummary()
  // 노트별 자동 생성 1회 가드 — 같은 노트로 다시 렌더돼도 재요청하지 않는다.
  const autoTried = useRef<number | null>(null)

  useEffect(() => {
    if (data?.status === 'MISSING' && autoTried.current !== pageId) {
      autoTried.current = pageId
      generate.mutate(pageId)
    }
    // generate 는 매 렌더 새 객체라 의존성에서 뺀다(mutate 는 안정적).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.status, pageId])

  // 짧은 노트가 저장으로 길어졌는지 확인 — TOO_SHORT 일 때만 저장마다 재조회하고, 다른 상태에선 저장마다 GET 하지 않는다.
  // 첫 렌더·노트 전환(liveVersion 이 처음 보는 값)에는 쿼리가 스스로 불러오므로 이전 값과 달라졌을 때만 재조회한다.
  const seenVersion = useRef({ pageId, liveVersion })
  useEffect(() => {
    const prev = seenVersion.current
    seenVersion.current = { pageId, liveVersion }
    if (prev.pageId === pageId && prev.liveVersion !== liveVersion && data?.status === 'TOO_SHORT') {
      void refetch()
    }
    // data·refetch 변화로는 다시 돌지 않게 liveVersion·pageId 만 본다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveVersion, pageId])

  // 다른 노트의 생성 상태가 이 카드에 새지 않도록 변수로 확인한다.
  const pendingHere = generate.isPending && generate.variables === pageId
  const failedHere = generate.isError && generate.variables === pageId

  if (!data) return null
  if (!data.summary && !pendingHere && !failedHere) return null // TOO_SHORT 또는 생성 전

  const stale =
    data.summary != null &&
    (data.status === 'STALE' || (data.summaryVersion != null && data.summaryVersion < liveVersion))

  return (
    <AiContent label="AI 요약" collapsible defaultOpen className="mb-4" data-testid="wiki-ai-summary">
      {pendingHere ? (
        <div data-testid="wiki-ai-summary-loading" className="mt-2 flex flex-col gap-1.5">
          <div className="h-2 w-full animate-pulse rounded bg-ai-accent/20" />
          <div className="h-2 w-3/4 animate-pulse rounded bg-ai-accent/20" />
          <div className="h-2 w-1/2 animate-pulse rounded bg-ai-accent/20" />
        </div>
      ) : (
        <>
          {/* 낡은 요약은 흐리게 — 내용은 남겨 두되 최신이 아님을 시각적으로 알린다. */}
          {data.summary && <span className={stale ? 'opacity-60' : undefined}>{data.summary}</span>}
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
            {failedHere ? (
              <>
                <span>요약하지 못했어요</span>
                <button
                  type="button"
                  data-testid="wiki-ai-summary-retry"
                  className="text-ai-accent underline"
                  onClick={() => generate.mutate(pageId)}
                >
                  다시 시도
                </button>
              </>
            ) : stale ? (
              <>
                <span data-testid="wiki-ai-summary-stale" className="text-warning">
                  ⚠ 요약 이후 노트가 바뀌었어요
                </span>
                <span aria-hidden="true">·</span>
                <button
                  type="button"
                  data-testid="wiki-ai-summary-refresh"
                  className="text-ai-accent underline"
                  onClick={() => generate.mutate(pageId)}
                >
                  다시 요약
                </button>
              </>
            ) : (
              data.summarizedAt && <span>{`${formatMonthDayClock(data.summarizedAt)} 요약`}</span>
            )}
          </div>
        </>
      )}
    </AiContent>
  )
}
