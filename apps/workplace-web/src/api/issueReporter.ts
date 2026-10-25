// 이슈 보고자 바꾸기 API(WP-944) — 담당자처럼 별도 PUT 엔드포인트.

import type { UserSummary } from '../types/user';
import { client } from './client';

/** 보고자를 userId 로 바꾼다. 응답은 새 보고자 요약. */
export async function changeIssueReporter(
  projectKey: string,
  number: number,
  userId: number,
): Promise<UserSummary> {
  const { data } = await client.put<UserSummary>(`/projects/${projectKey}/issues/${number}/reporter`, { userId });
  return data;
}
