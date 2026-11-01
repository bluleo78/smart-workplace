// AI 실행(WP-1245) — 백엔드 agentruntime DTO 와 1:1 매칭되는 타입.
// 실행 템플릿(코드 YAML)·AI 실행 설정(원하는 상태 + runner 가 본 상태)·실행 위치(runner 를 설치한 클러스터 네임스페이스).

/** 템플릿 종류 — SERVER=서버가 이슈·멘션에 바로 답하는 지금 방식(「기본」), WORKSPACE=Works 가 작업 공간을 띄워 돌린다. */
export type AgentTemplateKind = 'SERVER' | 'WORKSPACE';

export interface AgentTemplateOption {
  value: string;
  label: string;
}

/** 템플릿이 선언한 설정 칸 — 화면은 이 정의대로 칸을 그린다(템플릿 이름을 모른다). */
export interface AgentTemplateConfigField {
  key: string;
  label: string;
  type: 'select' | 'text';
  options: AgentTemplateOption[];
  default: string | null;
  required: boolean;
}

export interface AgentTemplate {
  name: string;
  version: string;
  kind: AgentTemplateKind;
  card: { title: string; description: string; skills: string[] };
  image: string | null;
  /** 필요한 연결 — claude(이 AI 의 AI 연결)·github(실행 위치에 둔 토큰). */
  requires: string[];
  config: AgentTemplateConfigField[];
  resources: {
    cpuRequest: string | null;
    memoryRequest: string | null;
    cpuLimit: string | null;
    memoryLimit: string | null;
    workDisk: string | null;
  } | null;
}

/** 실행 위치 연결 — PENDING=설치 대기(한 번도 안 붙음), CONNECTED=연결됨, DISCONNECTED=끊김. */
export type LocationConnection = 'PENDING' | 'CONNECTED' | 'DISCONNECTED';

export interface AgentLocation {
  id: number;
  name: string;
  description: string | null;
  isDefault: boolean;
  /** 이 위치에서 동시에 켤 수 있는 AI 수(자리). */
  capacity: number;
  /** 지금 이 위치를 쓰는(켜 둔) AI 수. */
  used: number;
  connection: LocationConnection;
  lastSeenAt: string | null;
  /** 토큰 앞부분(rt_xxxx) — 어느 토큰이 설치됐는지 맞춰 보는 용도. */
  tokenPrefix: string | null;
}

/** 위치 생성·토큰 재발급 응답 — plaintextToken 은 이때 한 번만 온다. */
export interface AgentLocationTokenResponse {
  location: AgentLocation;
  plaintextToken: string;
}

export type AgentDesired = 'RUN' | 'STOP';
export type AgentApplyMode = 'IDLE' | 'NOW';

/** 화면 상태(서버가 원하는 상태 + 본 상태로 계산) — APPLY_PENDING=새 설정이 쉴 때 반영되길 기다림. */
export type AgentRuntimeStatus = 'OFF' | 'STARTING' | 'RUNNING' | 'APPLY_PENDING' | 'STOPPING' | 'FAILED';

/** runner 가 본 상태 + AI 가 스스로 보고한 일 상태. */
export interface AgentObservedState {
  observedGeneration: number | null;
  phase: string | null;
  message: string | null;
  cpuMillicores: number | null;
  memoryBytes: number | null;
  startedAt: string | null;
  observedAt: string | null;
  /** IDLE=대기 · WORKING=작업 중 · BLOCKED=막힘(AI 보고). */
  agentState: 'IDLE' | 'WORKING' | 'BLOCKED' | null;
  agentIssueKey: string | null;
  agentNextCheckAt: string | null;
}

export interface AgentRuntimeSetting {
  agentUserId: number;
  templateName: string;
  templateVersion: string;
  templateMissing: boolean;
  updateAvailable: boolean;
  /** 고른 위치 — null 이면 워크스페이스 기본 위치. */
  locationId: number | null;
  effectiveLocation: AgentLocation | null;
  config: Record<string, string>;
  desired: AgentDesired;
  applyMode: AgentApplyMode;
  generation: number;
  status: AgentRuntimeStatus;
  observed: AgentObservedState | null;
}

export interface PutAgentRuntimeSettingRequest {
  templateName: string;
  locationId: number | null;
  config: Record<string, string>;
  applyMode?: AgentApplyMode;
}

/** 목록 「실행」 열 한 줄 — 설정이 있는 AI 만 온다. */
export interface AgentRuntimeSummary {
  agentUserId: number;
  templateName: string;
  /** 템플릿 카드 제목 — 템플릿이 릴리스에서 빠졌으면 null. */
  templateTitle: string | null;
  status: AgentRuntimeStatus;
  agentState: AgentObservedState['agentState'];
  agentIssueKey: string | null;
  agentNextCheckAt: string | null;
  /** 기본 위치가 아니면 그 위치 이름, 기본이면 null. */
  locationName: string | null;
  message: string | null;
}

/** 이 AI 가 맡는 프로젝트 — 멤버이고 저장소가 연결된 곳(읽기 전용). */
export interface AgentRuntimeProject {
  projectKey: string;
  name: string;
  repositoryUrl: string | null;
  repositoryBranch: string | null;
}
