// 사용자 개인 API 토큰(PAT) 관련 타입 — 백엔드 UserApiTokenResponse / UserApiTokenIssueResponse 와 1:1.
// 외부 도구(Claude Code MCP 등)가 사용자 본인 권한으로 API 를 호출할 때 쓰는 개인 토큰이다.
// 평문(plaintextToken) 은 발급 직후 1회만 응답에 포함되며 다시는 표시되지 않는다.

export interface UserApiToken {
  id: number;
  name: string;
  tokenPrefix: string;
  tenantId: number;
  expiresAt: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export interface UserApiTokenIssueResponse {
  id: number;
  name: string;
  // 발급 직후 1회만 노출되는 원본 평문 토큰 — `swp_` prefix.
  plaintextToken: string;
  tokenPrefix: string;
  tenantId: number;
  expiresAt: string | null;
  createdAt: string;
}
