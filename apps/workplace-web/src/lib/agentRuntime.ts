// 외부 에이전트 접속 상태 헬퍼 — 목록·상세가 같은 문구를 쓴다. 화면과 분리해 vitest 로 검증한다.
// 실행 방식 라벨·잠금 판정은 서버가 판정한 runMode 와 lib/agentRunMode.ts 가 맡는다(WP-1281).

import type { AgentResponse } from '../types/agent';
import { formatRelativeTime } from './formatters';

/** 외부 에이전트의 마지막 접속 — 「마지막 접속 5분 전」·「아직 접속 안 함」. */
export function externalKeyStatusText(lastKeyUsedAt: string | null): string {
  return lastKeyUsedAt ? `마지막 접속 ${formatRelativeTime(lastKeyUsedAt)}` : '아직 접속 안 함';
}

/** 점으로 나눈 숫자 버전 모양(예: 0.1.53) — 서버가 받는 X-Genia-Plugin-Version 과 같은 규칙. */
const DOTTED_VERSION = /^\d+(\.\d+)*$/;

/**
 * 점으로 나눈 숫자 버전을 앞에서부터 숫자로 견준다(WP-1707) — a 가 낮으면 음수, 같으면 0, 높으면 양수.
 * 플러그인 스크립트 gw-plugin-version 과 같은 규칙: 문자열이 아니라 숫자라 「0.1.10」 이 「0.1.9」 보다 높고, 빈 자리는 0 으로 본다.
 */
export function compareDottedVersions(a: string, b: string): number {
  const x = a.split('.').map(Number);
  const y = b.split('.').map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** 외부 AI 의 플러그인 버전 표시 — 보고 버전·최신 버전(모르면 null)·업데이트 필요 여부·배지 title. */
export interface PluginUpdateInfo {
  reported: string;
  latest: string | null;
  updateNeeded: boolean;
  /** 「플러그인 0.1.49 → 0.1.51」 — 업데이트가 필요할 때만, 아니면 null. */
  title: string | null;
}

/**
 * 외부 AI 의 플러그인 버전 판정(WP-1707) — 목록 배지·모바일 배지·상세 줄이 모두 이 한 곳만 쓴다.
 * 외부(EXTERNAL)이고 보고 버전이 있을 때만 정보를 낸다(기본·작업 공간 AI·보고 없음 → null).
 * 「업데이트 필요」는 최신 버전을 알고(운영 배포가 넣는다) 보고 버전이 그보다 낮을 때만 — 같거나 더 높거나(태그로 먼저 설치) 최신을 모르면 아니다.
 */
export function pluginUpdateInfo(
  agent: Pick<AgentResponse, 'runMode' | 'pluginVersion' | 'latestPluginVersion'>,
): PluginUpdateInfo | null {
  const reported = agent.pluginVersion;
  if (agent.runMode !== 'EXTERNAL' || !reported || !DOTTED_VERSION.test(reported)) return null;
  const latest = agent.latestPluginVersion && DOTTED_VERSION.test(agent.latestPluginVersion) ? agent.latestPluginVersion : null;
  const updateNeeded = latest != null && compareDottedVersions(reported, latest) < 0;
  return { reported, latest, updateNeeded, title: updateNeeded ? `플러그인 ${reported} → ${latest}` : null };
}
