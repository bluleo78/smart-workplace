// 「내 작업 · 개요」(WP-1484) — 호출자 본인 것만 주는 API. 사용자 id 를 보내는 길이 없다(나만 볼 수 있어요).
import type { MeDaySummary, MeOverviewPeriod, MeOverviewResponse, MetricsGranularity } from '../types/meOverview'
import { client } from './client'

/** 개요 한 화면 전체 — 기간·추이 칸 단위. */
export async function fetchMeOverview(period: MeOverviewPeriod, granularity: MetricsGranularity): Promise<MeOverviewResponse> {
  const { data } = await client.get<MeOverviewResponse>('/me/overview', { params: { period, granularity } })
  return data
}

/** 어제/오늘 요약만 — 홈 「내 작업」 위젯 한 줄용(개요 전체를 부르지 않게). */
export async function fetchMeToday(): Promise<MeDaySummary> {
  const { data } = await client.get<MeDaySummary>('/me/overview/today')
  return data
}
