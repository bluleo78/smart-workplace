// AGENT OAuth 토큰 메타 — 평문 토큰은 절대 클라이언트에 전달되지 않는다.
// workplace-api 의 OAuthTokenMetaResponse 와 1:1 매칭.
export interface OAuthTokenMeta {
  id: number;
  label: string | null;
  createdAt: string;
  lastUsedAt: string | null;
}

// 등록 요청 — 평문 토큰 + 선택 레이블. 응답에는 토큰 미포함.
export interface OAuthTokenRegisterRequest {
  token: string;
  label?: string;
}
