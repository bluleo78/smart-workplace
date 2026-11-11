// 프로젝트 「개요」 탭(WP-1478) — 위젯 값 전부를 한 번에 받는다(살펴볼 이슈 세 묶음도 함께 와 타일을 바꿔도 다시 부르지 않는다).
import type { ProjectOverviewResponse } from '../types/projectOverview'
import { client } from './client'

/** 프로젝트 개요 한 화면. 못 읽는 프로젝트는 404. */
export async function fetchProjectOverview(projectKey: string): Promise<ProjectOverviewResponse> {
  const { data } = await client.get<ProjectOverviewResponse>(`/projects/${projectKey}/overview`)
  return data
}
