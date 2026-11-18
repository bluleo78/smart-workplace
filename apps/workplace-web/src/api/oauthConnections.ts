// 내 OAuth 앱 연결(Claude 커넥터 등) 개인 스코프 엔드포인트 — `/users/me/oauth-connections`(WP-1685).
// baseURL `/api/v1` 가 client 에 포함되어 있어 경로는 상대로 작성.

import type { OAuthConnection } from '../types/oauth';
import { client } from './client';

// 내 앱 연결 목록 조회 — 살아 있는 연결만(끊은 것은 오지 않는다).
export async function listMyOAuthConnections(): Promise<OAuthConnection[]> {
  const { data } = await client.get<OAuthConnection[]>('/users/me/oauth-connections');
  return data;
}

// 앱 연결 끊기 — 그 앱의 토큰이 즉시 막힌다. 이미 끊긴 연결이면 404.
export async function revokeMyOAuthConnection(id: number): Promise<void> {
  await client.delete<void>(`/users/me/oauth-connections/${id}`);
}
