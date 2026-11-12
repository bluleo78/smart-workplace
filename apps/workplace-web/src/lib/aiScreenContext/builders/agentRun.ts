// 실행 상태 근거(WP-1511) — 「왜 에이전트가 안 시작돼요?」 같은 사용 질문에 AI 가 답할 수 있게, 화면이 이미 받은 실행 상태를
// 화면 참고 facts 로 바꾼다. 새로 받는 값은 없다(그 화면을 못 받은 사람에게는 근거도 없다).
// 라벨은 화면(상태 알약·AI 작업 배지)과 같은 공용 맵을 써서 사용자와 AI 가 같은 단어로 말하게 한다.
import { isRunningStatus, statusPill } from '@/lib/agentRuntimeStatus';
import { AGENT_STATE_LABEL } from '@/lib/agentWork';
import type { AgentDesired, AgentObservedState, AgentRuntimeStatus } from '@/types/agentRuntime';
import type { AgentWorkView } from '@/types/issue';

import type { FactValue } from '../common';

/** 사용 질문의 근거가 되는 AI 작업 상태 — 완료·작업 중 같은 평소 상태는 근거가 못 돼 뺀다. */
const EVIDENCE_WORK_STATES: ReadonlySet<AgentWorkView['state']> = new Set(['AUTH_REQUIRED', 'INPUT_REQUIRED', 'BLOCKED']);

/**
 * 에이전트 상세의 실행 근거 — 실행 상태(알약 라벨), 오류면 실패 사유, AI 가 차단을 보고했으면 AI 상태,
 * 꺼져 있고 시작이 막혔으면 실행 전 확인의 이유.
 */
export function agentRunEvidence(i: {
  status: AgentRuntimeStatus;
  /** 저장된 원하는 상태 — 오류인데 원하는 상태가 실행이면 「꺼짐」이 아니라 재시작 대상이라 실행 전 확인을 싣지 않는다. */
  desired?: AgentDesired | null;
  observed: AgentObservedState | null;
  blockReason: string | null;
}): Array<[string, FactValue]> {
  const out: Array<[string, FactValue]> = [['실행 상태', statusPill(i.status, i.observed?.agentState).label]];
  if (i.status === 'FAILED' && i.observed?.message) out.push(['실패 사유', i.observed.message]);
  // 화면(AgentStatusSection)과 같은 조건 — 실행 중일 때만 AI 상태를 보이고, 알약이 이미 「차단됨」이면 같은 말을 되풀이하지 않는다.
  const pillLabel = out[0][1];
  if (isRunningStatus(i.status) && i.observed?.agentState === 'BLOCKED' && pillLabel !== AGENT_STATE_LABEL.BLOCKED) {
    out.push(['AI 상태', AGENT_STATE_LABEL.BLOCKED]);
  }
  // 화면의 `off`(실행 중도 아니고, 원하는 상태가 실행인 오류도 아니고, 종료 중도 아님)와 같은 판정 — 오류 + 원하는 상태 중지도 포함.
  const failedOn = i.status === 'FAILED' && i.desired === 'RUN';
  const off = !isRunningStatus(i.status) && !failedOn && i.status !== 'STOPPING';
  if (off && i.blockReason) out.push(['실행 전 확인', i.blockReason]);
  return out;
}

/**
 * 이슈에 걸린 AI 작업 중 사람이 풀어야 막힌 것(인증 필요·답변 필요·차단됨)만 한 fact 로 — 「이름 상태: 메모」를 ' · ' 로 잇는다.
 * 해당하는 행이 없으면 빈 배열.
 */
export function agentWorkEvidence(rows: AgentWorkView[] | undefined): Array<[string, FactValue]> {
  const items = (rows ?? [])
    .filter((w) => EVIDENCE_WORK_STATES.has(w.state))
    .map((w) => `${w.worker.name} ${AGENT_STATE_LABEL[w.state]}${w.note ? `: ${w.note}` : ''}`);
  return items.length ? [['AI 작업 상태', items.join(' · ')]] : [];
}
