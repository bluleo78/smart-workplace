// 이슈 반복(실행 일정) API(WP-989) — 이슈 하나에 반복 규칙 하나. GET 204 = 반복 없음.

import type { IssueRecurrence, IssueRecurrenceAgentOption, PutIssueRecurrenceRequest } from '../types/issueRecurrence';
import { client } from './client';

const path = (projectKey: string, number: number) => `/projects/${projectKey}/issues/${number}/recurrence`;

/** 반복 조회 — 없으면(204·빈 본문) null. */
export async function fetchIssueRecurrence(projectKey: string, number: number): Promise<IssueRecurrence | null> {
  const res = await client.get<IssueRecurrence | ''>(path(projectKey, number));
  // 204 는 axios 가 빈 문자열을 data 로 준다 — 반복 없음으로 읽는다.
  if (res.status === 204 || !res.data) return null;
  return res.data;
}

/** 반복 저장(만들기·바꾸기·꺼진 반복 다시 켜기). */
export async function putIssueRecurrence(
  projectKey: string,
  number: number,
  body: PutIssueRecurrenceRequest,
): Promise<IssueRecurrence> {
  const { data } = await client.put<IssueRecurrence>(path(projectKey, number), body);
  return data;
}

/** 반복 끄기(행 삭제) — 서버가 그 AI 의 진행 중 작업도 취소로 끝낸다. */
export async function deleteIssueRecurrence(projectKey: string, number: number): Promise<void> {
  await client.delete(path(projectKey, number));
}

/**
 * 「지금 실행」(WP-1313) — 일정과 관계없이 한 번 실행한다(202). 다음 실행 시각·실패 횟수는 그대로이고 결과는 이슈 챗에 테스트 표시로 남는다.
 * 이미 실행 중이면 409, 남의 개인 비서 일정이면 403.
 */
export async function postIssueRecurrenceTestRun(projectKey: string, number: number): Promise<void> {
  await client.post(`${path(projectKey, number)}/test-runs`);
}

/** 담당 AI 후보(WP-1314) — 이 이슈의 실행 일정을 맡길 수 있는 서버 실행 AI(내 AI 비서가 맨 앞). */
export async function fetchIssueRecurrenceAgents(projectKey: string, number: number): Promise<IssueRecurrenceAgentOption[]> {
  const { data } = await client.get<IssueRecurrenceAgentOption[]>(`${path(projectKey, number)}/agents`);
  return data;
}
