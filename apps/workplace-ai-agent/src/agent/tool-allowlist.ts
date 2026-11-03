// sdk-runner 도구 정책 — allow-list 모델. built-in 도구(Bash/Edit/Write 등)를 화이트리스트로 차단한다.
// (과거 cli-runner 와 공용이었으나 #462 슬라이스6 에서 cli-runner 제거 → 현재 sdk-runner 전용.)

// 기본 차단 도구 — Read 는 allowFileRead, Agent·Task(SDK 0.3.x 의 Agent 별칭) 는 allowSubagents 시 제외된다.
// SlashCommand 는 --disable-slash-commands(또는 settingSources:[])로 이미 비활성이라 목록에 두지 않는다(#457).
export const BASE_DISALLOWED: string[] = [
  'Bash', 'BashOutput', 'KillShell',
  'Read', 'Write', 'Edit', 'NotebookEdit',
  'Glob', 'Grep',
  'WebFetch', 'WebSearch',
  'Agent',
  'Task', 'TaskCreate', 'TaskGet', 'TaskList', 'TaskOutput', 'TaskStop', 'TaskUpdate',
  'TodoWrite',
  'Skill', 'ToolSearch',
  'AskUserQuestion', 'SendUserFile', 'ScheduleWakeup', 'ShareOnboardingGuide',
  'Monitor', 'LSP',
];

// MCP 도구는 항상 허용(서버가 없으면 매칭 0이라 무해). Read/Agent 는 각 플래그가 켜질 때만 추가.
// allowed 로 푼 도구는 disallowed 에서 제외(둘 다 있으면 disallow 가 이김 → 위임/Read 가 깨짐).
// WP-351: SDK 0.3.x 는 위임 도구를 'Task' 로도 부른다(init 의 tools 에 Task 로 나오고 'Task' 거부 규칙이 Agent 도구를 숨긴다 — 실측).
// 그래서 위임을 열 때는 Task 도 거부 목록에서 뺀다. TaskCreate 등 작업 목록 도구는 별개라 그대로 막는다.
export function computeToolPolicy(opts: {
  allowFileRead?: boolean;
  allowSubagents?: boolean;
}): { allowed: string[]; disallowed: string[] } {
  const extraAllowed: string[] = [];
  if (opts.allowFileRead) extraAllowed.push('Read');
  if (opts.allowSubagents) extraAllowed.push('Agent');
  const allowed = ['mcp__workplace__*', ...extraAllowed];
  const disallowed = BASE_DISALLOWED.filter(
    (t) => !(t === 'Read' && opts.allowFileRead) && !((t === 'Agent' || t === 'Task') && opts.allowSubagents),
  );
  // WP-1320: 위임을 열어도 fork(자기 복제본에게 위임, SDK 0.3.302 부터 기본 켜짐)는 막는다 — 위임은 우리가 정의한 서브에이전트에게만.
  // env 스위치(CLAUDE_CODE_FORK_SUBAGENT=0, sdk-runner)와 함께 이중 차단.
  if (opts.allowSubagents) disallowed.push('Agent(fork)');
  return { allowed, disallowed };
}
