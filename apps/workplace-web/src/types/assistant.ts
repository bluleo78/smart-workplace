// 비서(Assistant) 관련 타입. 백엔드 DTO 와 1:1.

import type { CredentialProvider } from './providerCredential';

// 추론 깊이 — NONE(끄기) / NORMAL(기본) / DEEP(심층).
export type ThinkingDepth = 'NONE' | 'NORMAL' | 'DEEP';

// 개인 비서(본인) 상태. configured 가 false 면 자격증명 미등록 상태.
export interface AssistantStatus {
  configured: boolean;
  tokenLabel: string | null;
  tokenLastUsedAt: string | null; // ISO 타임스탬프(Instant 직렬화)
  model: string | null;
  thinkingDepth: ThinkingDepth | null;
  name: string | null; // 비서 표시 이름(미설정이면 null)
  // 활성 자격증명의 프로바이더 메타 — 미등록이면 둘 다 null, anthropic 이면 baseUrl=null.
  provider: CredentialProvider | null;
  baseUrl: string | null;
  /** WP-139: 추천 질문 전용 모델(원시값) — null 이면 자동. 구 API 응답·E2E 픽스처 호환을 위해 선택. */
  suggestionModel?: string | null;
  /** WP-139: 자동일 때 실제로 쓸 모델(API 가 정함 — Anthropic 은 설정 기본값, opencode 는 비서 모델). 연결 없음은 null. */
  suggestionModelAuto?: string | null;
  /** WP-250: 지금 모델의 이미지 입력 수동 지정 — true/false, null 이면 자동 감지. 구 API 응답·E2E 픽스처 호환을 위해 선택. */
  vision?: boolean | null;
}

// 공통 비서(admin) 상태. agentUserId 가 null 이면 미지정 상태.
export interface WorkspaceAssistant {
  agentUserId: number | null;
  agentName: string | null;
  hasActiveToken: boolean;
  model: string | null;
  thinkingDepth: ThinkingDepth | null;
  /** WP-139: 추천 질문 전용 모델(원시값) — null 이면 자동. 구 API 응답·E2E 픽스처 호환을 위해 선택. */
  suggestionModel?: string | null;
  /** WP-139: 자동일 때 실제로 쓸 모델(API 가 정함 — Anthropic 은 설정 기본값, opencode 는 비서 모델). 연결 없음은 null. */
  suggestionModelAuto?: string | null;
  /** WP-250: 지금 모델의 이미지 입력 수동 지정 — true/false, null 이면 자동 감지. 구 API 응답·E2E 픽스처 호환을 위해 선택. */
  vision?: boolean | null;
}

// 비서 설정 변경 요청 — 개인/공용 공통. 미지정 필드는 변경 없음.
export interface UpdateAssistantSettings {
  model?: string | null;
  thinkingDepth?: ThinkingDepth | null;
  /** WP-139: 추천 질문 모델 — null 이면 자동으로 되돌린다. 키를 빼면 변경 없음(서버가 보낸 필드만 바꾼다). */
  suggestionModel?: string | null;
  /**
   * WP-250: 이미지 입력 지정 — 같은 요청의 model(없으면 지금 모델)에 건다. true/false, null 이면 자동 감지로 되돌린다.
   * 키를 빼면 변경 없음. OpenAI 호환(opencode) 연결에만 보낸다(Claude 연결에 true/false 를 보내면 서버가 400).
   */
  vision?: boolean | null;
}
