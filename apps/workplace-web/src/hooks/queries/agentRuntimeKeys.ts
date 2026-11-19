// AI 실행(WP-1245) 쿼리 키 — api 모듈을 끌어오지 않는 순수 팩토리(resource.changed 무효화 규칙이 가져다 쓴다).
export const agentRuntimeKeys = {
  all: ['agent-runtime'] as const,
  templates: ['agent-runtime', 'templates'] as const,
  setting: (userId: number) => ['agent-runtime', 'setting', userId] as const,
  // 동시 진행 자리(WP-1775) — 'setting' 아래에 두지 않는다(실행 상태 변경 무효화 때마다 다시 읽을 필요는 없다).
  // 실행 세대(generation)마다 따로 둬 다시 시작하면 앞 실행의 수를 보이지 않는다.
  slots: (userId: number, generation: number) => ['agent-runtime', 'slots', userId, generation] as const,
  projects: (userId: number) => ['agent-runtime', 'projects', userId] as const,
  repoCredentials: (userId: number) => ['agent-runtime', 'repo-credentials', userId] as const,
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
