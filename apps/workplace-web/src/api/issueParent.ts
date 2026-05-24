// 이슈 부모(SUBTASK) 설정/해제 PATCH 호출 (Phase 4a).

import type { IssueDetailResponse } from '../types/issue';
import { client } from './client';

// SUBTASK 이슈의 부모를 설정/해제한다.
// parentNumber 가 null 이면 부모를 해제, 양의 정수면 해당 number 의 이슈를 부모로 설정.
// 비SUBTASK 이슈에 호출하면 백엔드가 400 (SetParentOnNonSubtask).
export async function updateIssueParent(
  projectKey: string,
  issueNumber: number,
  parentNumber: number | null,
): Promise<IssueDetailResponse> {
  const { data } = await client.patch<IssueDetailResponse>(
    `/projects/${projectKey}/issues/${issueNumber}/parent`,
    { parentNumber },
  );
  return data;
}
