// 비서(Assistant) 엔드포인트 — 개인(본인 JWT) + 공용(admin).
// baseURL `/api/v1` 가 client 에 포함되어 있어 경로는 상대로 작성.

import type {
  AssistantStatus,
  UpdateAssistantSettings,
  WorkspaceAssistant,
} from '../types/assistant';
import { client } from './client';

// 개인 비서(본인) 상태 조회 — 토큰 미등록이면 configured=false.
export async function getMyAssistant(): Promise<AssistantStatus> {
  const { data } = await client.get<AssistantStatus>('/users/me/assistant');
  return data;
}

// 개인 비서 토큰 등록(또는 교체). 평문 토큰은 입력 시점에만 전송.
export async function registerMyAssistantToken(
  token: string,
  label?: string,
): Promise<void> {
  await client.put<void>('/users/me/assistant/token', { token, label });
}

// 개인 비서 설정(모델/추론 깊이) 변경. 미지정 필드는 변경 없음.
export async function updateMyAssistantSettings(
  body: UpdateAssistantSettings,
): Promise<void> {
  await client.put<void>('/users/me/assistant/settings', body);
}

// 개인 비서 표시 이름 변경 — 설정과 분리된 전용 엔드포인트.
export async function updateMyAssistantName(name: string): Promise<void> {
  await client.put<void>('/users/me/assistant/name', { name });
}

// 개인 비서 비활성화 — 토큰/설정 제거.
export async function disableMyAssistant(): Promise<void> {
  await client.delete<void>('/users/me/assistant');
}

// 공통 비서(admin) 상태 조회 — 미지정이면 agentUserId=null.
export async function getWorkspaceAssistant(): Promise<WorkspaceAssistant> {
  const { data } = await client.get<WorkspaceAssistant>('/admin/workspace-assistant');
  return data;
}

// 공통 비서 AGENT 유저 지정.
export async function setWorkspaceAssistant(agentUserId: number): Promise<void> {
  await client.put<void>('/admin/workspace-assistant', { agentUserId });
}

// 공통 비서 설정(모델/추론 깊이) 변경. 미지정 필드는 변경 없음.
export async function updateWorkspaceAssistantSettings(
  body: UpdateAssistantSettings,
): Promise<void> {
  await client.put<void>('/admin/workspace-assistant/settings', body);
}

// 공통 비서 지정 해제.
export async function clearWorkspaceAssistant(): Promise<void> {
  await client.delete<void>('/admin/workspace-assistant');
}
