// AI 실행(WP-1245) 쿼리 키 — api 모듈을 끌어오지 않는 순수 팩토리(resource.changed 무효화 규칙이 가져다 쓴다).
export const agentRuntimeKeys = {
  all: ['agent-runtime'] as const,
  templates: ['agent-runtime', 'templates'] as const,
  setting: (userId: number) => ['agent-runtime', 'setting', userId] as const,
  projects: (userId: number) => ['agent-runtime', 'projects', userId] as const,
  summaries: ['agent-runtime', 'summaries'] as const,
  locations: ['agent-runtime', 'locations'] as const,
};

/**
 * 실행 상태가 바뀌면 다시 읽을 키 — 설정·목록 요약·위치(자리 수·연결). 변경 요청 뒤와 resource.changed(agent-runtime)가 같이 쓴다.
 * 템플릿(릴리스 때만 바뀜)과 맡는 프로젝트(프로젝트 멤버·저장소가 바꾼다)는 넣지 않는다.
 */
export const agentRuntimeLiveKeys = [
  [...agentRuntimeKeys.all, 'setting'],
  agentRuntimeKeys.summaries,
  agentRuntimeKeys.locations,
] as const;
