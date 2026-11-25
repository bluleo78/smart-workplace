// 이슈 담당자 집합 교체 API — Phase 3c PUT 엔드포인트.

import type { UserSummary } from '../types/user';
import { client } from './client';

// 담당자 집합을 교체한다. userIds 는 빈 배열이면 모두 제거.
// 시작 조건에 맞는 담당이면 서버가 같은 요청 안에서 워크플로우를 자동 시작한다(WP-2120) — 웹은 시작 여부를 보내지 않는다.
// 응답은 정렬된 새 담당자 목록.
export async function replaceIssueAssignees(projectKey: string, number: number, userIds: number[]): Promise<UserSummary[]> {
  const { data } = await client.put<UserSummary[]>(`/projects/${projectKey}/issues/${number}/assignees`, { userIds });
  return data;
}
