// 개인 API 토큰 상태 판정(WP-702) — 서버는 만료일이 지난 토큰을 401 로 거절하므로, 폐기하지 않았어도 만료됐으면 「활성」이 아니다.
import type { UserApiToken } from '../types/userToken';

export type ApiTokenStatus = 'active' | 'expired' | 'revoked';

/** 폐기 > 만료 > 활성 순으로 판정. expiresAt 이 없으면(무기한) 만료되지 않는다. */
export function apiTokenStatus(
  t: Pick<UserApiToken, 'revokedAt' | 'expiresAt'>,
  now: number = Date.now(),
): ApiTokenStatus {
  if (t.revokedAt != null) return 'revoked';
  if (t.expiresAt != null && Date.parse(t.expiresAt) <= now) return 'expired';
  return 'active';
}

export const API_TOKEN_STATUS_LABEL: Record<ApiTokenStatus, string> = {
  active: '활성',
  expired: '만료됨',
  revoked: '폐기됨',
};
