// 실행 상태 근거 builder(WP-1511) — 라벨은 화면 알약과 같고, 받지 못한 값은 싣지 않는다.
import { describe, expect, it } from 'vitest';

import type { AgentObservedState } from '@/types/agentRuntime';
import type { AgentWorkView } from '@/types/issue';

import { agentRunEvidence, agentWorkEvidence } from './agentRun';

const OBS: AgentObservedState = {
  observedGeneration: 1, phase: null, message: null, cpuMillicores: null, memoryBytes: null, startedAt: null, observedAt: null,
  agentState: null, agentIssueKey: null, agentIssueKeys: [], agentNextCheckAt: null,
};

const work = (state: AgentWorkView['state'], name: string, note: string | null) =>
  ({ worker: { id: 1, username: 'u', name, kind: 'AGENT' }, state, note }) as unknown as AgentWorkView;

describe('agentRunEvidence', () => {
  it('FAILED 면 실행 상태·실패 사유를 싣는다', () => {
    expect(agentRunEvidence({ status: 'FAILED', observed: { ...OBS, message: 'ImagePullBackOff' }, blockReason: null })).toEqual([
      ['실행 상태', '오류'],
      ['실패 사유', 'ImagePullBackOff'],
    ]);
  });

  it('꺼져 있고 막혔으면 실행 전 확인 이유', () => {
    expect(agentRunEvidence({ status: 'OFF', observed: null, blockReason: '저장소를 먼저 연결해 주세요' })).toEqual([
      ['실행 상태', '종료됨'],
      ['실행 전 확인', '저장소를 먼저 연결해 주세요'],
    ]);
  });

  it('실행 중이면 막힌 이유는 싣지 않고, 알약이 이미 차단됨이면 AI 상태를 되풀이하지 않는다', () => {
    expect(agentRunEvidence({ status: 'RUNNING', observed: { ...OBS, agentState: 'BLOCKED' }, blockReason: '무시' })).toEqual([
      ['실행 상태', '차단됨'],
    ]);
  });

  it('실행 중이 아니면 AI 상태(차단)는 싣지 않는다 — 화면도 실행 중일 때만 보인다', () => {
    expect(agentRunEvidence({ status: 'OFF', observed: { ...OBS, agentState: 'BLOCKED' }, blockReason: null })).toEqual([['실행 상태', '종료됨']]);
  });

  it('오류인데 원하는 상태가 중지면 화면의 off 와 같아 실행 전 확인을 싣고, 실행이면 싣지 않는다', () => {
    expect(agentRunEvidence({ status: 'FAILED', desired: 'STOP', observed: OBS, blockReason: '저장소 필요' })).toEqual([
      ['실행 상태', '오류'],
      ['실행 전 확인', '저장소 필요'],
    ]);
    expect(agentRunEvidence({ status: 'FAILED', desired: 'RUN', observed: OBS, blockReason: '저장소 필요' })).toEqual([['실행 상태', '오류']]);
  });

  it('종료 중에는 실행 전 확인을 싣지 않는다', () => {
    expect(agentRunEvidence({ status: 'STOPPING', observed: null, blockReason: '저장소 필요' })).toEqual([['실행 상태', '종료 중']]);
  });

  it('FAILED 라도 메시지가 없으면 실패 사유는 없다', () => {
    expect(agentRunEvidence({ status: 'FAILED', observed: OBS, blockReason: null })).toEqual([['실행 상태', '오류']]);
  });
});

describe('agentWorkEvidence', () => {
  it('인증·답변 필요·차단 세 상태만, 완료·작업 중은 뺀다', () => {
    expect(
      agentWorkEvidence([
        work('AUTH_REQUIRED', '봇A', '토큰 만료'),
        work('WORKING', '봇B', '진행'),
        work('INPUT_REQUIRED', '봇C', null),
        work('COMPLETED', '봇D', 'x'),
        work('BLOCKED', '봇E', '선행 이슈'),
      ]),
    ).toEqual([['AI 작업 상태', '봇A 인증 필요: 토큰 만료 · 봇C 답변 필요 · 봇E 차단됨: 선행 이슈']]);
  });

  it('해당 행이 없거나 목록이 없으면 빈 배열', () => {
    expect(agentWorkEvidence([work('WORKING', '봇', null)])).toEqual([]);
    expect(agentWorkEvidence(undefined)).toEqual([]);
  });
});
