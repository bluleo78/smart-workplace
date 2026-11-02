// 외부 에이전트 접속 상태 헬퍼 — 목록·상세가 같은 문구를 쓴다. 화면과 분리해 vitest 로 검증한다.
// 실행 방식 라벨·잠금 판정은 서버가 판정한 runMode 와 lib/agentRunMode.ts 가 맡는다(WP-1281).

import { formatRelativeTime } from './formatters';

/** 외부 에이전트의 마지막 접속 — 「마지막 접속 5분 전」·「아직 접속 안 함」. */
export function externalKeyStatusText(lastKeyUsedAt: string | null): string {
  return lastKeyUsedAt ? `마지막 접속 ${formatRelativeTime(lastKeyUsedAt)}` : '아직 접속 안 함';
}
