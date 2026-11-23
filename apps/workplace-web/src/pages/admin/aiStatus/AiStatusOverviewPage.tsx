// 「AI 현황 › 개요」 화면(WP-1824) — 머리(기간 단추·갱신 표기)와 데이터 묶음(조회 훅·모델 함수)을 한곳에서 맡고,
// 지표·경고·사용률·처리량·작은 그래프·종류별 표 블록을 그린다. 로딩은 스켈레톤 자리, 오류는 공용 LoadErrorState —
// 단 이미 받은 데이터(data)가 있으면 재조회 실패에도 그대로 이어 그리고(머리 갱신 표기와 모순되지 않게) 오류 안내는 data 없을 때만 그린다.
import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'

import type { AiStatusPeriod } from '@/api/aiStatus'
import { AI_STATUS_PERIODS } from '@/api/aiStatus'
import { SettingsPage } from '@/components/layout/SettingsPage'
import { LoadErrorState } from '@/components/LoadErrorState'
import { PeriodToggle } from '@/components/metrics/PeriodToggle'
import { usePeriodParam } from '@/components/metrics/usePeriodParam'
import { Skeleton } from '@/components/ui/skeleton'
import { useAiStatusOverview } from '@/hooks/queries/useAiStatusOverview'

import { AiStatusAlertUsage } from './AiStatusAlertUsage'
import { AiStatusKindsTable } from './AiStatusKindsTable'
import { AiStatusMetricCards } from './AiStatusMetricCards'
import { PERIOD_OPTIONS, periodLabel, statCards, updatedAgoLabel } from './aiStatusModel'
import { AiStatusSmallGraphs } from './AiStatusSmallGraphs'
import { AiStatusTabs } from './AiStatusTabs'
import { AiStatusThroughput } from './AiStatusThroughput'

/**
 * 머리의 「갱신 n초 전」 — 1초마다 다시 계산한다(설계 §5-3 1). 기준 시각은 서버 generatedAt 이고
 * 카운터만 이 컴포넌트가 다시 그려 페이지 본문(카드·차트)은 다시 그리지 않는다.
 */
function UpdatedAgoMeta({ generatedAt }: { generatedAt: string }) {
  const [nowMs, setNowMs] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [])
  return <span data-testid="ai-status-updated-at">{updatedAgoLabel(generatedAt, nowMs)}</span>
}

/** 로딩 자리 — 지표·경고·사용률이 들어갈 자리에 같은 모양의 스켈레톤을 놓는다(내용은 아직 없다). */
function AiStatusSkeleton() {
  return (
    <div data-testid="ai-status-skeleton" className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
      <div className="grid grid-cols-12 gap-4">
        <Skeleton className="col-span-12 h-40 lg:col-span-8" />
        <Skeleton className="col-span-12 h-40 lg:col-span-4" />
      </div>
    </div>
  )
}

/** AI 현황 개요 화면 — 기간은 주소 ?period= 에 두고(기본 24h 는 주소에 없음), 조회 결과를 블록에 나눠 준다. */
export default function AiStatusOverviewPage() {
  const [period, setPeriod] = usePeriodParam('period', AI_STATUS_PERIODS, '24h')
  const query = useAiStatusOverview(period)
  const data = query.data
  // 기간을 바꾸면 새 응답이 올 때까지 keepPreviousData 가 이전 기간 데이터를 두므로,
  // 차트 눈금·제목은 URL 의 새 기간이 아니라 지금 화면의 데이터가 속한 기간(응답 period)으로 그려야 한다(30일 막대에 HH:mm 이 붙는 어긋남 방지).
  // 모르는 코드가 오면 URL 기간으로 되돌린다.
  const shownPeriod: AiStatusPeriod =
    data && AI_STATUS_PERIODS.includes(data.period as AiStatusPeriod) ? (data.period as AiStatusPeriod) : period

  // 기간을 바꾼 뒤 새 기간 응답이 오기 전(재시도 포함)에는 이전 기간 값이 그대로 보이므로, 그 사실을 한 줄로 알린다(WP-1824 리뷰 3).
  // 새 기간 조회가 끝내 실패하면 placeholder 가 빠져 data 가 없어지고 아래 LoadErrorState(다시 시도)로 바뀐다.
  const showingPrevious = query.isPlaceholderData && shownPeriod !== period

  let body: ReactNode
  if (query.isPending) {
    body = <AiStatusSkeleton />
  } else if (!data) {
    // data 가 없는 채 pending 이 아니면 조회 실패다(받아 둔 data 가 있으면 재조회 실패에도 그대로 그린다)
    body = <LoadErrorState title="AI 현황 개요를 불러오지 못함" queries={[query]} testId="ai-status-load-error" />
  } else {
    body = (
      <div className="space-y-6" data-help="ai-status">
        {showingPrevious && (
          <p role="status" data-testid="ai-status-previous-period" className="text-sm text-muted-foreground">
            {periodLabel(period)} 값을 불러오는 중 — 지금은 {periodLabel(shownPeriod)} 값을 보여 줍니다
          </p>
        )}
        <AiStatusMetricCards cards={statCards(data.metrics)} />
        <AiStatusAlertUsage alerts={data.alerts} usage={data.usage} period={shownPeriod} />
        {/* 처리량 + 작은 그래프 — 도움말 절 ai-status.charts 로 잇는다 */}
        <div className="space-y-6" data-help="ai-status.charts">
          <AiStatusThroughput throughput={data.throughput} period={shownPeriod} bucketSeconds={data.bucketSeconds} windowEnd={data.to} />
          <AiStatusSmallGraphs series={data.series} bucketSeconds={data.bucketSeconds} />
        </div>
        <AiStatusKindsTable kinds={data.kinds} period={shownPeriod} />
      </div>
    )
  }

  return (
    <SettingsPage
      title="AI 현황"
      help={{ id: 'ai-status', name: 'AI 현황' }}
      width="full"
      actions={<PeriodToggle options={PERIOD_OPTIONS} value={period} onChange={setPeriod} aria-label="기간" />}
      meta={data ? <UpdatedAgoMeta generatedAt={data.generatedAt} /> : undefined}
    >
      <div className="space-y-4">
        <AiStatusTabs />
        {body}
      </div>
    </SettingsPage>
  )
}