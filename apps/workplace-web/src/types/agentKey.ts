// AGENT API 키 관련 타입 — 백엔드 AgentApiKeyResponse / AgentApiKeyIssueResponse 와 1:1.
// 평문 키(plaintextKey) 는 발급 직후 1회만 응답에 포함되며 다시는 표시되지 않는다.

export interface AgentApiKey {
  id: number;
  userId: number;
  keyPrefix: string;
  label: string | null;
  createdBy: number;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
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
