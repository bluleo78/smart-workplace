// #462 슬라이스4 후속(Task8) — opencode 러너(별도 프로세스)가 stdio MCP child 로부터 받은
// propose/submit/unassign 콜백을 메인 서버 프로세스로 전달하기 위한 인메모리 레지스트리.
// 인-프로세스 Claude SDK 경로는 클로저로 HostBridge 를 직접 주입하지만, opencode 는
// 별도 OS 프로세스이므로 HTTP 콜백(POST /internal/bridge/:runId)이 이 레지스트리에서
// runId → HostBridge 를 찾아 위임한다. run 단위로 등록/해제하는 단순 Map — 영속화 불필요
// (run 이 끝나면 releaseBridge 로 정리, 재시작 시 초기화되어도 무방).
import type { HostBridge } from '../mcp/tools.js';

const registry = new Map<string, HostBridge>();

// run 시작 시 등록 — 이후 해당 runId 로 오는 HTTP 콜백을 이 브리지로 위임한다.
export function registerBridge(runId: string, bridge: HostBridge): void {
  registry.set(runId, bridge);
}

// 조회 전용(제거하지 않음) — 라우트가 매 호출마다 조회.
export function takeBridge(runId: string): HostBridge | undefined {
  return registry.get(runId);
}

// run 종료 시 정리 — 누수 방지.
export function releaseBridge(runId: string): void {
  registry.delete(runId);
}
