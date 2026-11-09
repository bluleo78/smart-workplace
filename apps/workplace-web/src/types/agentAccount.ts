// AI 계정 목록(WP-1448·1449·1451) 타입 — 백엔드 com.workplace.agentaccount.dto 와 1:1.
// AI 마다 따로 넣던 연결 정보를 워크스페이스의 계정 목록 하나로 모으고, AI 는 그중 하나에 묶인다.
// 응답에는 원문·암호문이 절대 실리지 않는다 — 원문(token·providerConfig·loginInfo)은 등록·수정 요청에만 실린다.

import type { CredentialProvider, ProviderConfig } from './providerCredential';

/** 계정 상태 — 정상 · 확인 필요(옛 연결에서 옮겨 와 아직 확인 전인 로그인 계정) · 다시 로그인 필요. */
export type AgentAccountStatus = 'ACTIVE' | 'NEEDS_CHECK' | 'RELOGIN_REQUIRED';

/**
 * 사용량 상태 — 서버(UsageStatusCalculator)가 계정 상태·종류·창 값·조회 기록으로 정한 하나.
 * UNLIMITED = 한도를 조회하지 않는 종류(OpenAI 호환·Gen:iA), UNKNOWN = 아직 한 번도 조회하지 않음.
 */
export type AccountUsageStatus =
  | 'OK'
  | 'NEAR_LIMIT'
  | 'LIMIT_REACHED'
  | 'CHECK_FAILED'
  | 'RELOGIN_REQUIRED'
  | 'UNLIMITED'
  | 'UNKNOWN';

/** 사용량 창 하나(5시간·주간). usedPercent 는 0~100(소수 둘째 자리, 100 을 넘을 수 있다), 시각은 ISO Instant. */
export interface UsageWindow {
  usedPercent: number;
  resetsAt: string | null;
  observedAt: string | null;
}

/** 계정 사용량 블록 — 창 값은 마지막 성공 값이라 조회가 실패해도 남아 있을 수 있다. */
export interface AccountUsage {
  status: AccountUsageStatus;
  fiveHour: UsageWindow | null;
  weekly: UsageWindow | null;
  /** 마지막 조회 시도 시각 — 표의 「갱신」 칸. */
  checkedAt: string | null;
  succeededAt: string | null;
  errorCode: string | null;
  /** 마지막 조회 실패 이유(짧은 한국어 문구). */
  errorMessage: string | null;
  /** 이 계정을 쓰는 AI 가 마지막으로 실행 중이던 시각 — 한도 없는 계정의 「갱신」 칸. */
  lastUsedAt: string | null;
}

/** 이 계정을 쓰는 AI 한 명. */
export interface AgentAccountBoundAgent {
  userId: number;
  username: string;
  name: string;
}

/** 계정 메타 응답 — 원문 미포함. accountEmail 은 로그인 계정(ChatGPT·Gen:iA)일 때만 값이 있다. */
export interface AgentAccountResponse {
  id: number;
  provider: CredentialProvider;
  label: string;
  accountEmail: string | null;
  lastRefreshedAt: string | null;
  status: AgentAccountStatus;
  createdAt: string;
  updatedAt: string;
  agents: AgentAccountBoundAgent[];
  usage: AccountUsage | null;
}

/** 계정 등록 요청 — 종류별로 token(anthropic)·providerConfig(opencode)·loginInfo(genia·chatgpt) 중 하나. label 을 비우면 서버가 「<종류> 계정」. */
export interface AgentAccountCreateRequest {
  provider: CredentialProvider;
  token?: string;
  providerConfig?: ProviderConfig;
  label?: string;
  loginInfo?: string;
}

/** 계정 수정 요청 — label 만 보내면 이름만 바꾸고, 원문을 보내면 교체한다. 종류는 바꿀 수 없다. */
export interface AgentAccountUpdateRequest {
  label?: string;
  token?: string;
  providerConfig?: ProviderConfig;
  loginInfo?: string;
}
