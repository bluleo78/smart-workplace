// genia-works 의 Codex 구동기(gw-codex-loop)·키 보호 hook 이 쓰는 순수 함수(WP-1295) — node --test 로 따로 검증한다.
// Codex 에는 genia 같은 세션 안 확장 API 가 없어, 바깥 구동기가 `codex exec`(처음)·`codex exec resume <대화>`(그 뒤)로 work-loop 를 한 번씩 부른다.
// 11-03 시험: resume 하면 맥락이 이어지고(캐시도 쓰인다), -o 로 마지막 답을, --json 의 thread.started 로 대화 id 를 받는다. 한 번에 하나만
// 부르는 것은 구동기가 차례로 부르므로 저절로 지켜진다 — 대화 화면 + `codex queue` 는 공유 데몬·끝남 알림(hook)이 더 필요해 고르지 않았다.
import { tenantHeader, toolBlockReason } from '../genia/loop.js'

// MCP 토큰을 넘기는 환경 변수 — codex 프로세스에만 넣고, 셸 도구에는 물려주지 않는다(shell_environment_policy.exclude).
export const TOKEN_ENV = 'GENIA_WORKS_MCP_TOKEN'
const SERVER = 'genia-works'

/** TOML 기본 문자열(큰따옴표) — -c 값으로 넘긴다. */
export function tomlString(s) {
  return '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"'
}

/**
 * work-loop 를 부르는 프롬프트 — 플러그인 설치와 무관하게 스킬 파일을 직접 가리킨다(스킬은 Claude 플러그인과 한 벌).
 * 「이 스킬 폴더」를 알려 스킬 안의 `<이 스킬 폴더>/../../scripts/…` 경로가 풀리게 한다.
 */
export function workLoopPrompt({ skillsDir, args }) {
  const dir = skillsDir + '/work-loop'
  return [
    `genia-works work-loop 스킬을 한 번 실행한다. 스킬 파일 ${dir}/SKILL.md 를 읽고 그대로 따른다(같은 폴더의 다른 .md 도 스킬이 가리키면 읽는다).`,
    `이 스킬 폴더는 ${dir} 이다. 인자: ${args}`,
  ].join('\n')
}

/**
 * codex exec 인자 — 대화 id 가 있으면 resume. MCP(이 칸 신원의 키는 환경 변수로)·키 보호 hook·무승인 실행을 -c 로 넘겨 사용자 설정 파일을 고치지 않는다.
 * 워크스페이스는 숫자일 때만 헤더로 붙인다. 11-03 실측: 셸 도구에는 토큰 변수가 보이지 않고(exclude), MCP 요청엔 Bearer·워크스페이스가 실린다.
 */
export function codexArgs({ thread, outFile, mcpUrl, tenant, guardCommand, prompt, version }) {
  const c = (kv) => ['-c', kv]
  // User-Agent 를 codex 로 — 서버 작업 기록의 도구 이름이 codex-mcp-client 대신 codex 로 남는다(11-03 실측: http_headers 가 덮어쓴다).
  const pairs = [`"User-Agent" = ${tomlString('codex/genia-works-' + (version || '0'))}`]
  // 워크스페이스 헤더는 genia 와 같은 규칙(숫자일 때만) — User-Agent 뒤에 붙인다.
  for (const [k, v] of Object.entries(tenantHeader(tenant))) pairs.push(`${tomlString(k)} = ${tomlString(v)}`)
  const headers = `{ ${pairs.join(', ')} }`
  const args = [
    'exec',
    ...(thread ? ['resume'] : []),
    '--json',
    '-o',
    outFile,
    '--skip-git-repo-check',
    '--dangerously-bypass-approvals-and-sandbox',
    // -c 로 건 hook 은 신뢰 표시가 없어 이 플래그가 있어야 돈다(11-03 실측).
    '--dangerously-bypass-hook-trust',
    ...c(`mcp_servers.${SERVER}.url=${tomlString(mcpUrl)}`),
    ...c(`mcp_servers.${SERVER}.bearer_token_env_var=${tomlString(TOKEN_ENV)}`),
    ...c(`mcp_servers.${SERVER}.http_headers=${headers}`),
    ...c(`shell_environment_policy.exclude=[${tomlString(TOKEN_ENV)}, "GENIA_WORKS_TOKEN"]`),
    ...c(`hooks.PreToolUse=[{ matcher = "*", hooks = [{ type = "command", command = ${tomlString(guardCommand)} }] }]`),
  ]
  if (thread) args.push(thread)
  args.push(prompt)
  return args
}

/** codex exec --json 출력에서 대화 id(thread.started 의 thread_id). 없으면 undefined. */
export function threadIdFrom(jsonl) {
  for (const line of String(jsonl).split('\n')) {
    try {
      const e = JSON.parse(line)
      if (e?.type === 'thread.started' && typeof e.thread_id === 'string') return e.thread_id
    } catch {
      // JSON 이 아닌 줄(경고 등)은 건너뛴다.
    }
  }
  return undefined
}

/**
 * 키 보호 hook 판정 — Codex PreToolUse 입력({ tool_name, tool_input })을 받아 막을 이유 또는 undefined.
 * 판정 규칙은 genia 확장과 같다(키 저장소 경로·헤더 스크립트 실행). Codex 의 셸 도구 이름은 Bash 다(11-03 실측).
 */
export function guardDecision(hookInput) {
  const name = String(hookInput?.tool_name ?? '').toLowerCase()
  return toolBlockReason(name, hookInput?.tool_input)
}
