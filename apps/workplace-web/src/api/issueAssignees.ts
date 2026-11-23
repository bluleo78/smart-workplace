// 이슈 담당자 집합 교체 API — Phase 3c PUT 엔드포인트.

import type { UserSummary } from '../types/user';
import { client } from './client';

// 담당자 집합을 교체한다. userIds 는 빈 배열이면 모두 제거.
// startWorkflowId 가 있으면 서버가 담당 지정 직후 그 워크플로우를 시작한다(WP-1989).
// 응답은 정렬된 새 담당자 목록.
export async function replaceIssueAssignees(
  projectKey: string,
  number: number,
  userIds: number[],
  startWorkflowId?: number,
): Promise<UserSummary[]> {
  // startWorkflowId 가 undefined 면 JSON 직렬화에서 빠져 예전과 같은 본문({ userIds })이 된다.
  const { data } = await client.put<UserSummary[]>(`/projects/${projectKey}/issues/${number}/assignees`, {
    userIds,
    startWorkflowId,
  });
  return data;
}
