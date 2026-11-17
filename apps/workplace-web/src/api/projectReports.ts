// 프로젝트 리포트(WP-1483) — 개요 카드 리포트 줄 조회와 설정(주기·템플릿).
import type {
  ProjectReportCardResponse,
  ProjectReportGenerateResult,
  ProjectReportSettings,
  UpdateProjectReportLocationRequest,
  UpdateProjectReportSettingsRequest,
} from '../types/projectReport'
import { client } from './client'

/** 개요 카드 리포트 줄(최신·지난 목록). 못 읽는 프로젝트는 404, 노트 공간 비멤버는 빈 응답. */
export async function fetchProjectReports(projectKey: string): Promise<ProjectReportCardResponse> {
  const { data } = await client.get<ProjectReportCardResponse>(`/projects/${projectKey}/reports`)
  return data
}

/** 리포트 설정(주기·템플릿). 처음엔 기본값(꺼짐·매주·월요일·09:00). */
export async function fetchProjectReportSettings(projectKey: string): Promise<ProjectReportSettings> {
  const { data } = await client.get<ProjectReportSettings>(`/projects/${projectKey}/report-settings`)
  return data
}

/** 리포트 설정 저장 — 켤 때 템플릿이 없으면 서버가 노트에 복사한다. OWNER·ADMIN 만. */
export async function updateProjectReportSettings(
  projectKey: string,
  body: UpdateProjectReportSettingsRequest,
): Promise<ProjectReportSettings> {
  const { data } = await client.put<ProjectReportSettings>(`/projects/${projectKey}/report-settings`, body)
  return data
}

/**
 * 리포트 저장 위치 바꾸기(WP-1654) — 새 리포트를 고른 페이지 아래 맨 위에 만든다. 이미 만든 리포트는 옮기지 않는다.
 * 공간 밖·「템플릿」 갈래·AI 리포트 페이지는 400. OWNER·ADMIN 만. 응답은 설정 응답(바뀐 위치 경로 포함).
 */
export async function updateProjectReportLocation(projectKey: string, pageId: number): Promise<ProjectReportSettings> {
  const body: UpdateProjectReportLocationRequest = { pageId }
  const { data } = await client.put<ProjectReportSettings>(`/projects/${projectKey}/report-settings/location`, body)
  return data
}

/** 템플릿을 제품 기본으로 되돌린다 — 직전 판은 노트 수정 기록에 남는다. OWNER·ADMIN 만. */
export async function resetProjectReportTemplate(projectKey: string): Promise<ProjectReportSettings> {
  const { data } = await client.post<ProjectReportSettings>(`/projects/${projectKey}/report-settings/template/reset`)
  return data
}

/**
 * 「지금 생성」(WP-1630) — 직전에 끝난 회차 리포트를 바로 만든다. AI 가 다 쓸 때까지 기다리는 요청이다(수십 초~수 분).
 * 만드는 중이면 409, 생성 실패는 502(이유 문구). OWNER·ADMIN 만.
 */
export async function generateProjectReport(projectKey: string): Promise<ProjectReportGenerateResult> {
  const { data } = await client.post<ProjectReportGenerateResult>(`/projects/${projectKey}/reports/generate`)
  return data
}
