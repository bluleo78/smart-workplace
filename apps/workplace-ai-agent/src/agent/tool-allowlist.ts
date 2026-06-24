// cli-runner·sdk-runner 공용 도구 정책 — allow-list 모델.
// 두 러너가 같은 화이트리스트/차단목록을 쓰도록 단일 출처로 둔다(drift 방지).
// 위임 도구 화이트리스트(checkSubagentWhitelist)는 tool-policy.ts 의 별개 관심사다.

// 기본 차단 도구 — Read 는 allowFileRead, Agent 는 allowSubagents 시 제외된다.
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
export function computeToolPolicy(opts: {
  allowFileRead?: boolean;
  allowSubagents?: boolean;
}): { allowed: string[]; disallowed: string[] } {
  const extraAllowed: string[] = [];
  if (opts.allowFileRead) extraAllowed.push('Read');
  if (opts.allowSubagents) extraAllowed.push('Agent');
  const allowed = ['mcp__workplace__*', ...extraAllowed];
  const disallowed = BASE_DISALLOWED.filter(
    (t) => !(t === 'Read' && opts.allowFileRead) && !(t === 'Agent' && opts.allowSubagents),
  );
  return { allowed, disallowed };
}
