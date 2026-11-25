/** 노드 서랍이 고치는 칸(노드 이름 제외). ask·onError 는 「사람에게 묻기」「막혔을 때」(WP-2091). */
export type PanelField = 'role' | 'requires' | 'instructions' | 'use' | 'outcomes' | 'outputs' | 'maxVisits' | 'ask' | 'onError'

/**
 * 노드 종류별로 패널에 보일 칸 — 서버 스키마(packages/mcp-tools-shared/src/workflow-schema.json 의 x-nodeTypes)와 맞춘다.
 * 서버가 허용하지 않는 칸을 보이면 쓰는 순간 NODE_FIELD_NOT_ALLOWED 로 게시가 막히므로, 표에 없는 칸은 그리지 않는다.
 * 이름(name)은 모든 종류가 허용해 늘 보이고, 표에 없는 종류는 이름만 보인다.
 * 스키마와의 일치는 nodeFields.test.ts 가 지킨다.
 */
export const NODE_FIELDS: Record<string, ReadonlySet<PanelField>> = {
  start: new Set(),
  end: new Set(),
  // decision 은 conditions·default 를 YAML 에서 쓴다 — 패널은 이름만
  decision: new Set(),
  // ask(질문 경로 줄임 표기)는 agent_task 만 허용한다 — 사람에게 묻는 것은 AI 차례의 일이다
  agent_task: new Set(['role', 'requires', 'instructions', 'use', 'outcomes', 'outputs', 'maxVisits', 'ask', 'onError']),
  // human_task 는 requires 를 허용하지 않는다(사람에게 로컬 저장소 능력은 의미가 없다)
  human_task: new Set(['role', 'instructions', 'use', 'outcomes', 'outputs', 'maxVisits', 'onError']),
}
