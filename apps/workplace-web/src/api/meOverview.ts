// 「내 작업 · 개요」(WP-1484) — 호출자 본인 것만 주는 API. 사용자 id 를 보내는 길이 없다(나만 볼 수 있어요).
import type {
  MeDaySummary,
  MeOverviewPeriod,
  MeOverviewResponse,
  MetricsGranularity,
  WorkProfile,
  WorkProfileAnalyzeResponse,
} from '../types/meOverview'
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

/** 업무 프로파일(WP-1485) — 그 기간의 저장된 결과. 처음이면 서버가 분석을 시작하고 PENDING 으로 답한다. */
export async function fetchWorkProfile(period: MeOverviewPeriod): Promise<WorkProfile> {
  const { data } = await client.get<WorkProfile>('/me/work-profile', { params: { period } })
  return data
}

/** 「다시 분석」 — 끝낸 이슈가 그대로면 UNCHANGED, 하루 상한을 넘으면 429(서버 문구 「오늘은 더 분석할 수 없어요」). */
export async function analyzeWorkProfile(period: MeOverviewPeriod): Promise<WorkProfileAnalyzeResponse> {
  const { data } = await client.post<WorkProfileAnalyzeResponse>('/me/work-profile/analyze', null, { params: { period } })
  return data
}
