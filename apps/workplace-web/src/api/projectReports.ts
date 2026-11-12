// 프로젝트 리포트(WP-1483) — 개요 카드 리포트 줄 조회와 설정(주기·템플릿).
import type {
  ProjectReportCardResponse,
  ProjectReportSettings,
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

/** 템플릿을 제품 기본으로 되돌린다 — 직전 판은 노트 수정 기록에 남는다. OWNER·ADMIN 만. */
export async function resetProjectReportTemplate(projectKey: string): Promise<ProjectReportSettings> {
  const { data } = await client.post<ProjectReportSettings>(`/projects/${projectKey}/report-settings/template/reset`)
  return data
}
