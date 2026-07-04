// 사용자 개인 API 토큰(PAT) 개인 스코프 엔드포인트 — `/users/me/api-tokens`.
// baseURL `/api/v1` 가 client 에 포함되어 있어 경로는 상대로 작성.

import type { UserApiToken, UserApiTokenIssueResponse } from '../types/userToken';
import { client } from './client';

// 내 토큰 목록 조회 (활성/폐기 모두 포함).
export async function listMyTokens(): Promise<UserApiToken[]> {
  const { data } = await client.get<UserApiToken[]>('/users/me/api-tokens');
  return data;
}

// 토큰 발급 — 응답에 plaintextToken 이 1회만 포함된다. expiresAt null 이면 무기한.
export async function issueMyToken(body: {
  name: string;
  expiresAt: string | null;
}): Promise<UserApiTokenIssueResponse> {
  const { data } = await client.post<UserApiTokenIssueResponse>('/users/me/api-tokens', body);
  return data;
}

// 토큰 폐기 — revoked_at 마킹. 인증 hot path 에서 즉시 차단.
export async function revokeMyToken(tokenId: number): Promise<void> {
  await client.delete<void>(`/users/me/api-tokens/${tokenId}`);
}
