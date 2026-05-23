// 이슈 watcher (구독) API 클라이언트 + /me/watched-issues.

import type { IssueSearchResponse } from '../types/issue';
import { client } from './client';

// 이슈에 등록된 watcher 목록.
export interface WatcherResponse {
  userId: number;
  username: string;
  name: string;
}

export async function listWatchers(
  projectKey: string,
  number: number,
): Promise<WatcherResponse[]> {
  const { data } = await client.get<WatcherResponse[]>(
    `/projects/${projectKey}/issues/${number}/watchers`,
  );
  return data;
}

// 구독 — 멱등.
export async function watchIssue(projectKey: string, number: number): Promise<void> {
  await client.post<void>(`/projects/${projectKey}/issues/${number}/watch`);
}

// 구독 해제 — 멱등.
export async function unwatchIssue(projectKey: string, number: number): Promise<void> {
  await client.delete<void>(`/projects/${projectKey}/issues/${number}/watch`);
}

// 내가 구독 중인 이슈 — cursor 페이지네이션.
export async function fetchWatchedIssues(
  cursor: string | null,
  size = 30,
): Promise<IssueSearchResponse> {
  const params = new URLSearchParams();
  if (cursor) params.set('cursor', cursor);
  params.set('size', String(size));
  const { data } = await client.get<IssueSearchResponse>(
    `/me/watched-issues?${params.toString()}`,
  );
  return data;
}
