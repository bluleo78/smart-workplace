// 이슈 의존성 API 클라이언트 — Phase 4b.
// POST: 의존성 추가 (direction = blocks | blockedBy 로 두 방향 표현)
// DELETE: 의존성 제거 (otherNumber/direction 쿼리)
// 둘 다 멱등 (서버는 중복 add/없는 row remove 시 200/204).

import type { IssueDetailResponse } from '../types/issue';
import { client } from './client';

export type DependencyDirection = 'blocks' | 'blockedBy';

export async function addIssueDependency(
  projectKey: string,
  number: number,
  otherNumber: number,
  direction: DependencyDirection,
): Promise<IssueDetailResponse> {
  const { data } = await client.post<IssueDetailResponse>(
    `/projects/${projectKey}/issues/${number}/dependencies`,
    { otherNumber, direction },
  );
  return data;
}

export async function removeIssueDependency(
  projectKey: string,
  number: number,
  otherNumber: number,
  direction: DependencyDirection,
): Promise<void> {
  await client.delete<void>(
    `/projects/${projectKey}/issues/${number}/dependencies`,
    { params: { otherNumber, direction } },
  );
}
