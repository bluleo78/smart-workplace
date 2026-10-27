// 이슈 부모 설정/해제 PATCH 호출 (Phase 4a).

import { parentRequestBody, type ParentTargetInput } from '../lib/parentRef';
import type { IssueDetailResponse } from '../types/issue';
import { client } from './client';

// 이슈의 부모를 설정/해제한다.
// parent 가 null 이면 부모를 해제, { number } 면 같은 프로젝트의 그 이슈, { projectKey, number } 면 그 이슈를 부모로 설정한다.
// 일반 이슈는 다른 프로젝트 에픽도 부모로 둘 수 있다(WP-1038) — 그때는 서버가 받는 parentKey(예: PLAN-3)로 보낸다(parentRequestBody).
export async function updateIssueParent(
  projectKey: string,
  issueNumber: number,
  parent: ParentTargetInput | null,
): Promise<IssueDetailResponse> {
  const { data } = await client.patch<IssueDetailResponse>(
    `/projects/${projectKey}/issues/${issueNumber}/parent`,
    parentRequestBody(parent, projectKey),
  );
  return data;
}
