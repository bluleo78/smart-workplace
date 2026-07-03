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
}

// 공통 비서(admin) 상태. agentUserId 가 null 이면 미지정 상태.
export interface WorkspaceAssistant {
  agentUserId: number | null;
  agentName: string | null;
  hasActiveToken: boolean;
  model: string | null;
  thinkingDepth: ThinkingDepth | null;
}

// 비서 설정 변경 요청 — 개인/공용 공통. 미지정 필드는 변경 없음.
export interface UpdateAssistantSettings {
  model?: string | null;
  thinkingDepth?: ThinkingDepth | null;
}
