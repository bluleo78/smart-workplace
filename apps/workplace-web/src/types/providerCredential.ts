// 멀티 프로바이더(#opencode) 자격증명 타입 — 기존 agentOAuthToken.ts 대체.
// 백엔드 OAuthTokenMetaResponse/ProviderCredentialRegisterRequest/ProviderConfig 와 1:1 매칭.
// 평문 토큰/apiKey 는 등록 요청에만 실리고, 메타 응답에는 절대 포함되지 않는다.

import type { ThinkingLevel } from './assistant';

// 자격증명 프로바이더 — anthropic(구독 OAuth) / opencode(OpenAI 호환 엔드포인트).
export type CredentialProvider = 'anthropic' | 'opencode';

// opencode provider config — 등록 요청 시 평문으로 전송, 서버가 암호화 저장.
export interface ProviderConfig {
  providerId: string;
  npm?: string;
  options: { baseURL: string; apiKey: string };
  // 모델의 이미지 입력 지원 수동 지정 — boolean(전체) 또는 모델 id 별 맵. 생략하면 서버가 자동 감지한다.
  vision?: boolean | Record<string, boolean>;
}

// 자격증명 메타 — 평문/암호문 절대 미포함. baseUrl 은 opencode 일 때만 값 존재(anthropic 은 null).
export interface ProviderCredentialMeta {
  id: number;
  provider: CredentialProvider;
  baseUrl: string | null;
  label: string | null;
  createdAt: string; // ISO 타임스탬프(Instant 직렬화)
  lastUsedAt: string | null;
}

// 등록(또는 재발급) 요청 — provider 에 따라 token(anthropic) 또는 providerConfig+model(opencode) 사용.
export interface ProviderCredentialRegisterRequest {
  provider: CredentialProvider;
  token?: string;
  providerConfig?: ProviderConfig;
  model?: string;
  label?: string;
}

// 모델 선택 옵션 — id(저장/전송용), label(표시명).
export interface ModelOption {
  id: string;
  label: string;
  /**
   * WP-1322: 이 모델이 받는 생각의 깊이 단계(낮은 순). null·생략 = 알 수 없음 — Claude 는 LOW·MEDIUM·HIGH, OpenAI 호환은 「설정 안 함」만
   * 보인다(lib/ai/thinkingDepth). 빈 배열 = 단계를 받지 않는 모델.
   */
  efforts?: ThinkingLevel[] | null;
}
