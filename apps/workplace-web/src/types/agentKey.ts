// AGENT API 키 관련 타입 — 백엔드 AgentApiKeyResponse / AgentApiKeyIssueResponse 와 1:1.
// 평문 키(plaintextKey) 는 발급 직후 1회만 응답에 포함되며 다시는 표시되지 않는다.

export interface AgentApiKey {
  id: number;
  userId: number;
  keyPrefix: string;
  label: string | null;
  // Works 자동 발급 키(managed)는 발급한 사람이 없어 null 이다(WP-1253).
  createdBy: number | null;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  // Works 가 runner 요청으로 자동 발급한 키인지(WP-1253) — 관리자 발급 키는 false.
  managed: boolean;
  // 이 시각이 지나면 인증되지 않는다(자동 발급 키만, 관리자 발급 키는 null = 만료 없음).
  expiresAt: string | null;
}

export interface AgentApiKeyIssueResponse {
  id: number;
  userId: number;
  // 발급 직후 1회만 노출되는 원본 평문 키 — `ak_` prefix.
  plaintextKey: string;
  keyPrefix: string;
  label: string | null;
  createdAt: string;
}
