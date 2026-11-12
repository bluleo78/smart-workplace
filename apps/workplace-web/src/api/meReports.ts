// 개인 보고(WP-1486) — 호출자 본인 것만 다루는 API. 사용자 id 를 보내는 길이 없다(대상은 언제나 로그인한 나).
import axios from 'axios'

import type {
  CreateMeReportRequest,
  MeReportConflict,
  MeReportCreated,
  MeReportKind,
  MeReportLookup,
  MeReportSettings,
  MeReportStatus,
  UpdateMeReportSettingsRequest,
} from '../types/meReport'
import { client } from './client'

/** 보고서 설정 — 행이 없으면 서버 기본값(꺼짐·09:00·건너뜀 켬). */
export async function fetchMeReportSettings(): Promise<MeReportSettings> {
  const { data } = await client.get<MeReportSettings>('/me/report-settings')
  return data
}

/** 설정 저장 — 켤 때 「보고」·두 템플릿이 없으면 서버가 내 노트에 복사한다. 응답은 GET 과 같은 모양. */
export async function updateMeReportSettings(body: UpdateMeReportSettingsRequest): Promise<MeReportSettings> {
  const { data } = await client.put<MeReportSettings>('/me/report-settings', body)
  return data
}

/** 그 회차의 가장 최근 보고 노트 — 없으면 서버가 204 로 답해 null. */
export async function lookupMeReport(kind: MeReportKind, date: string): Promise<MeReportLookup | null> {
  const res = await client.get<MeReportLookup | ''>('/me/reports', { params: { kind, date } })
  return res.status === 204 || !res.data ? null : res.data
}

/** 보고 만들기 — 202 와 회차 id. 409(이미 있음·만드는 중·비서 없음)는 meReportConflict 로 읽고, 하루 상한은 429. */
export async function createMeReport(body: CreateMeReportRequest): Promise<MeReportCreated> {
  const { data } = await client.post<MeReportCreated>('/me/reports', body)
  return data
}

/** 회차 상태(3초 폴링) — 남의 id 는 404. */
export async function fetchMeReport(id: number): Promise<MeReportStatus> {
  const { data } = await client.get<MeReportStatus>(`/me/reports/${id}`)
  return data
}

/** 만들기 오류가 409 충돌이면 그 본문, 아니면 null — 화면이 code 로 「이미 있음」·「만드는 중」·「비서 없음」을 가른다. */
export function meReportConflict(error: unknown): MeReportConflict | null {
  if (!axios.isAxiosError(error) || error.response?.status !== 409) return null
  const data = error.response.data as Partial<MeReportConflict> | undefined
  return data && typeof data.code === 'string' ? (data as MeReportConflict) : null
}
