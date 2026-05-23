// 이슈 담당자 집합 교체 API — Phase 3c PUT 엔드포인트.

import { client } from './client';
import type { UserSummary } from '../types/user';

// 담당자 집합을 교체한다. userIds 는 빈 배열이면 모두 제거.
// 응답은 정렬된 새 담당자 목록.
export async function replaceIssueAssignees(
  projectKey: string,
  number: number,
  userIds: number[],
): Promise<UserSummary[]> {
  const { data } = await client.put<UserSummary[]>(
    `/projects/${projectKey}/issues/${number}/assignees`,
    { userIds },
  );
  return data;
}
