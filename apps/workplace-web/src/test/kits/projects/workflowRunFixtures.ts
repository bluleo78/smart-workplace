// 테스트 전용 — 워크플로우 실행 화면·순수 함수 테스트가 함께 쓰는 모델 픽스처.
// start → a(AI 작업 「작성」) → b(사람 차례 「검토」, onError → a, 존재하지 않는 노드 ghost 로 가는 outcome 포함) → end 의 네 노드.
// 칠하기·소요 시간·간선 계산·없는 노드 간선 제외를 한 모델로 검사하려고 만들었다. 제품 코드에서 쓰지 않는다.
import type { WorkflowModel } from '@/lib/workflows'
/** 모델 노드 하나 — 두 픽스처가 같은 빈 기본값을 쓴다. */
const n = (key: string, type: string, extra: object = {}) => ({ key, type, use: [], requires: [], outputs: [], outcomes: [], conditions: [], ...extra })

export function mkModel(): WorkflowModel {
  return {
    schema: 'v1', roles: [], shared: [], start: [], layout: [],
    nodes: [
      n('start', 'start', { defaultTo: 'a' }),
      n('a', 'agent_task', { name: '작성', defaultTo: 'b' }),
      n('b', 'human_task', { name: '검토', defaultTo: 'end', onError: { to: 'a' }, outcomes: [{ key: 'ok', to: 'ghost', requireComment: false }] }),
      n('end', 'end'),
    ],
  } as WorkflowModel
}

// 질문 경로 모델 — work(AI 작업) → ask outcome → work_ask(사람 차례, returnTo work) → answered → work.
// work_ask → work 로 가는 간선이 outcome(answered)과 returnTo(돌아가기) 둘이라 같은 출발·도착 간선 합치기(WP-2048)를 검사한다.
export function mkAskModel(): WorkflowModel {
  return {
    schema: 'v1', roles: [], shared: [], start: [], layout: [],
    nodes: [
      n('start', 'start', { defaultTo: 'work' }),
      n('work', 'agent_task', { name: '작업', defaultTo: 'end', outcomes: [{ key: 'ask', to: 'work_ask', requireComment: false }] }),
      n('work_ask', 'human_task', { name: '질문 답변', returnTo: 'work', outcomes: [{ key: 'answered', to: 'work', requireComment: false }] }),
      n('end', 'end'),
    ],
  } as WorkflowModel
}
