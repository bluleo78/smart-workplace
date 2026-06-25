// Agent SDK query() 러너 — cli-runner 의 SDK 대체(#462). 파서 계약(onLine(line:string)) 보존을 위해
// 각 SDKMessage 를 JSON.stringify 로 다시 문자열화해 흘린다(CLI stream-json = 직렬화된 SDKMessage).
import os from 'node:os';
import type { AgentDefinition, McpServerConfig, Options } from '@anthropic-ai/claude-agent-sdk';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { log } from '../logger.js';
import { computeToolPolicy } from './tool-allowlist.js';

export interface SdkRunInput {
  userMessage: string;
  systemPrompt: string;
  model: string;
  maxTurns: number;
  token: string; // OAuth 구독 토큰
  agentId: number; // ACTING_AGENT_ID
  userId?: number; // ACTING_USER_ID (드라이브 등 사용자 귀속 리소스)
  timeoutMs: number;
  logTag: string;
  requestId?: string;
  includePartialMessages?: boolean; // 기본 true (cli-runner 동등)
  allowFileRead?: boolean;
  allowSubagents?: boolean;
  cwd?: string; // 기본 os.tmpdir() — CLAUDE.md 자동로드 회피 + 설정 격리
  // 인-프로세스 MCP 서버 주입(슬라이스 3). 미지정 시 미주입 — 슬라이스 1·2(도구 미사용) 동작 불변.
  mcpServers?: Record<string, McpServerConfig>;
  // 코드정의 서브에이전트(슬라이스 4). 지정 시 Options.agents 로 전달 — 라우터 위임 대상.
  agents?: Record<string, AgentDefinition>;
}

// CLI 플래그 → query Options. 스파이크 1급 규칙 4종(allowedTools 화이트리스트/hermetic 3종/토큰 주입)을 고정.
export function buildSdkOptions(i: SdkRunInput): Options {
  const { allowed, disallowed } = computeToolPolicy({
    allowFileRead: i.allowFileRead,
    allowSubagents: i.allowSubagents,
  });
  // 구독 모드 강제: API 키 제거하고 OAuth 토큰만. agentId/userId 는 MCP 서버가 X-On-Behalf-Of 로 쓴다.
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.ANTHROPIC_API_KEY;
  env.CLAUDE_CODE_OAUTH_TOKEN = i.token;
  env.ACTING_AGENT_ID = String(i.agentId);
  if (i.userId !== undefined) env.ACTING_USER_ID = String(i.userId);

  const options: Options = {
    model: i.model,
    maxTurns: i.maxTurns,
    systemPrompt: i.systemPrompt, // string — ARG_MAX 무관(control protocol)
    includePartialMessages: i.includePartialMessages ?? true,
    permissionMode: 'bypassPermissions',
    // hermetic: 호스트 ~/.claude·repo 설정(serena MCP·슬래시 등) 누출 차단
    settingSources: [],
    cwd: i.cwd ?? os.tmpdir(),
    strictMcpConfig: true,
    // built-in 도구(Bash/Edit/Write 등)는 기본 로드되므로 화이트리스트로 차단
    allowedTools: allowed,
    disallowedTools: disallowed,
    env,
  };
  // 인-프로세스 MCP 서버(슬라이스 3) — 지정된 경우에만 주입.
  if (i.mcpServers) options.mcpServers = i.mcpServers;
  // 코드정의 서브에이전트(슬라이스 4) — 지정된 경우에만 주입.
  if (i.agents) options.agents = i.agents;
  return options;
}

// 스트리밍 핸들 — cli-runner 의 StreamHandle 계약 그대로(호출부 변경 최소화).
export interface StreamHandle {
  done: Promise<void>;
  kill: () => void;
}

// query() generator 순회 → 각 SDKMessage 를 JSON.stringify 로 onLine 에 흘린다.
// 종료/timeout/kill 의미는 runClaudeCliStream 미러:
//  - 정상 완료(result, !is_error) → resolve(cli_done)
//  - timeout → interrupt() + reject(cli_timeout)
//  - kill()(상위 연결 종료) → interrupt() + 정상 resolve(cli_killed). interrupt 후 throw 는 sentinel 로 흡수.
//  - result.is_error / 그 외 throw → reject(cli_exit / cli_spawn_error)
export function runSdkStream(i: SdkRunInput, onLine: (line: string) => void): StreamHandle {
  const q = query({ prompt: i.userMessage, options: buildSdkOptions(i) });
  let manuallyKilled = false;
  let timedOut = false;
  const startedAt = Date.now();

  const done = (async () => {
    const timer = setTimeout(() => {
      timedOut = true;
      // interrupt 가 이미 끝난 query 에서 reject 해도 무시(unhandled rejection 방지)
      void q.interrupt().catch(() => {});
    }, i.timeoutMs);
    let resultIsError = false;
    try {
      for await (const msg of q) {
        onLine(JSON.stringify(msg));
        const m = msg as { type?: string; subtype?: string };
        // subtype 이 'success' 가 아니면 실패 — is_error 는 falsy 여도 오류일 수 있어 신뢰 안 함
        if (m.type === 'result') resultIsError = m.subtype !== 'success';
      }
    } catch (e) {
      // 자기-개시 interrupt(kill/timeout) 후의 throw 는 흡수, 그 외 spawn/실행 오류만 전파.
      if (!manuallyKilled && !timedOut) {
        log.error('cli-runner', 'cli_spawn_error', {
          requestId: i.requestId,
          error: e instanceof Error ? e.message : String(e),
        });
        throw e;
      }
    } finally {
      clearTimeout(timer);
    }
    const durationMs = Date.now() - startedAt;
    if (manuallyKilled) {
      log.info('cli-runner', 'cli_killed', { requestId: i.requestId, durationMs });
      return; // 의도적 종료 — 정상
    }
    if (timedOut) {
      log.error('cli-runner', 'cli_timeout', { requestId: i.requestId, timeoutMs: i.timeoutMs, durationMs });
      throw new Error(`${i.logTag} timeout after ${i.timeoutMs}ms`);
    }
    if (resultIsError) {
      log.error('cli-runner', 'cli_exit', { requestId: i.requestId, durationMs });
      throw new Error(`${i.logTag} result is_error`);
    }
    log.info('cli-runner', 'cli_done', { requestId: i.requestId, durationMs });
  })();

  // 상위 연결 종료 시 — interrupt 로 query 중단. done 의 manuallyKilled 분기가 정상 마무리.
  const kill = () => {
    manuallyKilled = true;
    // interrupt 가 이미 끝난 query 에서 reject 해도 무시(unhandled rejection 방지)
    void q.interrupt().catch(() => {});
  };

  return { done, kill };
}

// runClaudeCliCollect 미러(동기·비스트리밍) — query() generator 를 순회해 각 SDKMessage 를
// JSON.stringify 로 배열에 수집한 뒤 반환한다. 동기·영속 경로라 실패가 빈 결과로 묻히면 안 되므로
// timeout / result.is_error / spawn-error 시 reject 한다(호출자 → 홈 라우트 502 전파).
export async function runSdkCollect(i: SdkRunInput): Promise<string[]> {
  const q = query({ prompt: i.userMessage, options: buildSdkOptions(i) });
  const lines: string[] = [];
  let timedOut = false;
  const startedAt = Date.now();
  const timer = setTimeout(() => {
    timedOut = true;
    // interrupt 가 이미 끝난 query 에서 reject 해도 무시(unhandled rejection 방지)
    void q.interrupt().catch(() => {});
  }, i.timeoutMs);
  let resultIsError = false;
  try {
    for await (const msg of q) {
      lines.push(JSON.stringify(msg));
      const m = msg as { type?: string; subtype?: string };
      // subtype 이 'success' 가 아니면 실패 — is_error 는 falsy 여도 오류일 수 있어 신뢰 안 함
      if (m.type === 'result') resultIsError = m.subtype !== 'success';
    }
  } catch (e) {
    // 자기-개시 interrupt(timeout) 후의 throw 는 흡수, 그 외 spawn/실행 오류만 전파.
    if (!timedOut) {
      log.error('cli-runner', 'cli_spawn_error', {
        requestId: i.requestId,
        error: e instanceof Error ? e.message : String(e),
      });
      throw e;
    }
  } finally {
    clearTimeout(timer);
  }
  const durationMs = Date.now() - startedAt;
  if (timedOut) {
    log.error('cli-runner', 'cli_timeout', { requestId: i.requestId, timeoutMs: i.timeoutMs, durationMs });
    throw new Error(`${i.logTag} timeout after ${i.timeoutMs}ms`);
  }
  if (resultIsError) {
    log.error('cli-runner', 'cli_exit', { requestId: i.requestId, durationMs });
    throw new Error(`${i.logTag} result is_error`);
  }
  log.info('cli-runner', 'cli_done', { requestId: i.requestId, durationMs, lines: lines.length });
  return lines;
}
