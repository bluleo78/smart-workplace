// 「AI 현황 › 개요」 화면(WP-1824) — 머리(기간 단추·갱신 표기)와 데이터 묶음(조회 훅·모델 함수)을 한곳에서 맡고,
// 지표·경고·처리량·작은 그래프·종류별 표 블록을 그린다. 로딩은 스켈레톤 자리(함께 감춘 차트 준비로 Recharts
// 첫 실행 비용을 선결 — WP-2079)와, 준비가 끝날 때까지 그 자리를 그대로 두는 것(청크가 응답보다 늦어도 첫 실행
// 비용이 데이터 뒤로 밀리지 않게 — WP-2079 3라운드), 오류는 공용 LoadErrorState —
// 단 이미 받은 데이터(data)가 있으면 재조회 실패에도 그대로 이어 그리고(머리 갱신 표기와 모순되지 않게) 오류 안내는 data 없을 때만 그린다.
// 데이터가 도착해도 한 번에 다 그리면 메인 스레드가 막히므로(WP-2079), 지표 카드는 도착 렌더에서 따로 그리고
// 경고 usage → 처리량 → 작은 그래프 → 종류별 표를 한 틱씩 나눠 그린다. 차트 impl(Recharts) 청크는 마운트 때 미리 받아 둔다 —
// 껍데기는 그대로 lazy 로 남는다.
import type { ReactNode } from 'react'
import { useCallback, useEffect, useState } from 'react'

import type { AiStatusPeriod } from '@/api/aiStatus'
import { AI_STATUS_PERIODS } from '@/api/aiStatus'
import { SettingsPage } from '@/components/layout/SettingsPage'
import { LoadErrorState } from '@/components/LoadErrorState'
import { PeriodToggle } from '@/components/metrics/PeriodToggle'
import { usePeriodParam } from '@/components/metrics/usePeriodParam'
import { Skeleton } from '@/components/ui/skeleton'
import { useAiStatusOverview } from '@/hooks/queries/useAiStatusOverview'

import { AiStatusAlertUsage } from './AiStatusAlertUsage'
import { AiStatusChartWarmup } from './AiStatusChartWarmup'
import { AiStatusKindsTable } from './AiStatusKindsTable'
import { AiStatusMetricCards } from './AiStatusMetricCards'
import {
  CHART_STAGE_MAX_WAIT_MS,
  isChartStageOpen,
  PERIOD_OPTIONS,
  periodLabel,
  statCards,
  updatedAgoLabel,
} from './aiStatusModel'
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

/** 로딩 자리 — 지표·경고가 들어갈 자리에 같은 모양의 스켈레톤을 놓는다(내용은 아직 없다). */
function AiStatusSkeleton() {
  return (
    <div data-testid="ai-status-skeleton" className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
      <Skeleton className="h-40" />
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

  // 차트 impl 청크 선로딩(WP-2079) — 첫 차트가 그려질 때 lazy 로드 지연이 겹치지 않게 마운트 때 미리 받아 둔다.
  // 실패(배포 직후 404 등)해도 껍데기(lazyChart)가 각자 「불러오지 못함」으로 처리하므로, 실패해도 준비 완료로 쳐 진행을 막지 않는다.
  // 다만 실패하면 감춘 준비 자리에는 그림이 영영 없어 준비 신호도 없으므로(데드락 방지) 따로 표시해 둔다(WP-2079 3라운드).
  const [chartsReady, setChartsReady] = useState(false)
  const [chartsFailed, setChartsFailed] = useState(false)
  useEffect(() => {
    Promise.all([import('@/components/metrics/StackedBarChart.impl'), import('@/components/metrics/TrendChart.impl')])
      .catch(() => setChartsFailed(true))
      // 실패·성공 어느 쪽이든 「준비는 끝났다」로 친다 — 성공 여부와 무관하게 게이트를 열어야 멈추지 않는다(.finally 가 그 의도를 말해 준다)
      .finally(() => setChartsReady(true))
  }, [])

  // 준비 완료(WP-2079 3라운드) — 감춘 자리의 두 차트가 실제로 그려졌다는 신호. 첫 실행 비용을 치렀다는 뜻이다.
  const [warmed, setWarmed] = useState(false)
  const handleWarmed = useCallback(() => setWarmed(true), [])

  // 단계 노출(WP-2079) — 0 지표 카드, 1 경고 usage, 2 처리량, 3 작은 그래프, 4 종류별 표.
  // 지표 카드는 data 가 오는 렌더에서 바로 그린다 — 스켈레톤이 지표 카드로 넘어가는 그 커밋이 0단계의 태스크라
  // 「데이터는 왔는데 첫 단계가 아직」인 상태가 없고 빈 본문도 생기지 않는다(스켈레톤은 query.isPending 일 때만 — 불변).
  // 이후 단계는 한 틱씩 늘려 데이터 도착 직후 한 번에 몰리지 않게 나눈다(임의의 지연값 없음).
  // 기간 갱신(keepPreviousData)으로 data 가 이어지면 단계는 줄이지 않는다 — 이미 그린 블록이 내려가 화면이 깜빡이지 않게 한다.
  const [visibleBlock, setVisibleBlock] = useState(0)
  // 종류별 표 틱(WP-2079 6라운드) — 표(4단계)에는 Recharts 가 없어 차트 준비 게이트에 묶이지 않는다. 위 체인은
  // 게이트에 걸려 2 에서 멈추는데, 그대로 두면 청크 멈춤 때 표까지 게이트 상한(4초)을 기다린다. 그래서 표만
  // 게이트 밖에서 자기 틱을 세어, 게이트가 닫혀 있는 동안에만 네 틱을 채워 표를 그린다. 게이트가 데이터보다 먼저
  // 열린 평소 경로에서는 이 틱이 세어지지 않아 표는 여전히 맨 마지막 단계에서 나온다. 반대로 데이터가 먼저 와
  // 게이트가 뒤에 열리는 경로에서는 표가 차트보다 먼저 그려지고(아래로 밀리는 시늉), 그 대가로 청크 멈춤 때
  // 4초를 기다리지 않는다 — 표에는 Recharts 가 없어 첫 실행 비용과는 무관하다.
  const [kindsTick, setKindsTick] = useState(0)
  // 준비 대기 상한 경과(WP-2079 5라운드) — 데이터 도착 후 준비 신호를 CHART_STAGE_MAX_WAIT_MS 동안 기다렸다는 표시.
  // 한 번 켜면 끄지 않는다 — 멈춘 청크는 그대로이고, 이미 연 단계를 다시 닫아 본문이 내려가지 않게 한다.
  const [waitTimedOut, setWaitTimedOut] = useState(false)
  // data 가 없어지면(재시도 오류로 받은 데이터까지 잃은 경로) 단계를 0 으로 되돌린다 —
  // 다시 데이터가 오면 단계가 처음부터 진행해 블록이 한 번에 몰리지 않게 한다.
  // data 참조가 이어지는 동안(keepPreviousData 기간 갱신)에는 되돌리지 않아 이미 그린 블록이 내려가지 않고,
  // 도착(undefined → 객체) 때는 !data 가 거짓이라 setState 가 없으므로 재렌더가 생기지 않는다 —
  // 렌더 중 setState 로 추적하던 지난 구조는 도착 렌더를 한 번 더 돌려 본문 계산을 두 번 시켰다(WP-2079 2라운드).
  useEffect(() => {
    if (data) return
    /* eslint-disable react-hooks/set-state-in-effect -- data 소실 전환은 effect 에서만 알 수 있다(keepPreviousData 로 참조가 이어지는 동안에는 부르지 않아 캐스케이드가 없다) */
    setVisibleBlock(0)
    setKindsTick(0)
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [data])

  // 준비 대기 상한(WP-2079 5라운드) — 데이터가 도착해도 준비 신호가 끝내 오지 않으면(impl 청크 선로딩이 멈춰
  // 응답이 안 오면) 차트 단계 뒤의 처리량·작은 그래프·종류별 표가 한 번도 안 나온다. 게이트가 닫혀 있는 동안의
  // 마지막 게이트 입력(data·chartsReady·warmed·chartsFailed)으로부터 CHART_STAGE_MAX_WAIT_MS 가 지나면 신호 없이도
  // 단계를 열어 늦게라도 본문이 나온다 — 창은 매번 새로 잡더라도 닫혀 있는 동안에만 잡으므로 언제나 유한하다.
  // 준비는 보통 데이터보다 먼저 끝나 상한에는 걸리지 않는다. data 가 없어져도 되돌리지 않는다 — 한 번 멈춘 청크는
  // 그 자리에 그대로이고, 이미 연 단계는 그대로 두는 편이다.
  // 차트 단계 게이트 — 닫혀 있으면 처리량 단계부터 진행하지 않는다(WP-2079). 두 효과가 같은 자리에서
  // 같은 값을 묻으니 판정은 한 곳에 두고, 게이트 값이 바뀔 때만 효과가 다시 돈다.
  const chartStageOpen = isChartStageOpen({ chartsReady, warmed, chartsFailed, waitTimedOut })

  // 감춘 준비 자리 — 준비가 끝나면(첫 실행 비용을 치렀으면) 없앤다. 청크가 실패한 자리에는 그림이 영영 없어
  // 준비 신호도 없으므로 함께 없애고, 그 경우 게이트가 저절로 열린다(데드락 방지 — isChartStageOpen).
  // 대기 상한으로 게이트가 열렸어도(warmed 없이) 함께 없앤다(WP-2079 6라운드) — 남아 있으면 늦게 도착한 청크의
  // 준비 차트 2개가 실제 차트와 같은 태스크에 그려져 긴 태스크가 다시 생긴다. 세 조건은 곧 게이트를 여는 세 신호다.
  const warmup = !warmed && !chartsFailed && !waitTimedOut ? <AiStatusChartWarmup onWarmed={handleWarmed} /> : null

  useEffect(() => {
    if (!data || chartStageOpen) return
    const id = window.setTimeout(() => setWaitTimedOut(true), CHART_STAGE_MAX_WAIT_MS)
    return () => window.clearTimeout(id)
  }, [data, chartStageOpen])

  useEffect(() => {
    if (!data || visibleBlock >= 4) return
    // 처리량 단계(2)로 넘어가려면 차트 준비가 끝나 있어야 한다 — 지표·경고는 준비와 무관하게 그린다.
    // 청크 선로딩(다운로드 완료)만 믿으면 준비 자리가 아직 안 그려진 상태에서 단계가 열려 첫 실행 비용이
    // 데이터 뒤로 다시 밀린다(WP-2079 3라운드). 대기 상한이 지났으면 신호 없이도 연다(WP-2079 5라운드).
    const nextBlock = visibleBlock + 1
    if (nextBlock >= 2 && !chartStageOpen) return
    // 다음 블록은 자기 태스크(0ms 타이머)에서 그린다
    const id = window.setTimeout(() => setVisibleBlock((n) => n + 1), 0)
    return () => window.clearTimeout(id)
  }, [data, chartStageOpen, visibleBlock])

  // 종류별 표 틱(WP-2079 6라운드) — 차트 게이트와 따로 한 틱씩 나아간다. 게이트가 열려 있는 동안에는 세지 않아
  // 평소(게이트가 데이터보다 먼저 열린 경로)에는 표가 맨 마지막 단계에서 나오고, 게이트가 닫혀 체인이 2 에 멈춰
  // 있는 동안에만 네 틱을 채워 표를 그린다 — 청크 멈춤 때 표까지 게이트 상한(4초)을 기다리지 않는다.
  useEffect(() => {
    if (!data || kindsTick >= 4 || chartStageOpen) return
    const id = window.setTimeout(() => setKindsTick((n) => n + 1), 0)
    return () => window.clearTimeout(id)
  }, [data, kindsTick, chartStageOpen])

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
        {/* 지표 카드 — 단계 0: 데이터가 오면 첫 렌더에서 바로 그려 다른 블록과 한 태스크에 몰리지 않는다 */}
        <AiStatusMetricCards cards={statCards(data.metrics)} />
        {visibleBlock >= 1 && <AiStatusAlertUsage alerts={data.alerts} period={shownPeriod} />}
        {/* 처리량 + 작은 그래프 — 도움말 절 ai-status.charts 로 잇는다. 두 블록은 단계가 될 때만 그린다(WP-2079) */}
        <div className="space-y-6" data-help="ai-status.charts">
          {visibleBlock >= 2 && (
            <AiStatusThroughput throughput={data.throughput} period={shownPeriod} bucketSeconds={data.bucketSeconds} windowEnd={data.to} />
          )}
          {visibleBlock >= 3 && <AiStatusSmallGraphs series={data.series} bucketSeconds={data.bucketSeconds} />}
        </div>
        {/* 종류별 표 — Recharts 가 없어 차트 준비 게이트와 무관하다(WP-2079 6라운드): 체인(4단계)이거나
            체인이 게이트에 멈춘 동안 따로 세운 표 틱(4)이어도 그린다 */}
        {(visibleBlock >= 4 || kindsTick >= 4) && <AiStatusKindsTable kinds={data.kinds} period={shownPeriod} />}
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
        {/* 감춘 차트 준비 — 골격 때 시작해 준비가 끝날 때까지 이어 그린다. 데이터가 와도 아직 안 그려졌다면
            그대로 남아(본문과 겹치지 않게 화면 밖) 첫 실행 비용을 데이터보다 먼저 치른 뒤에 없어진다(WP-2079 3라운드) */}
        {warmup}
      </div>
    </SettingsPage>
  )
}
