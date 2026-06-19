// 7b: 홈 컴포즈 러너 — 비서(assistant) agentId 토큰 fetch → assistant MCP config → CLI(assistant 프로필) 스폰 → 파서.
// #333: Task 7 — per-request workdir + writeSubagentDefinitions + system-prompt-file + allowSubagents
// + 화이트리스트 강제(위반 시 kill+throw) + Agent 위임 시 onProgress 라벨 발행.
// 데이터 조회는 show_* 도구가 하지 않으므로 토큰은 순수 Claude LLM 인증용(데이터 권한과 무관).
// 모델/생각의 깊이/maxTurns/timeoutMs 는 workplace-api 가 비서 설정을 해석해 요청 본문으로 전달한다(#50).
import { mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { HOME_SYSTEM_PROMPT } from './home-system-prompt.js';
import { ASSISTANT_SYSTEM_PROMPT, delegationLabel } from './assistant-system-prompt.js';
import { loadSubagents, writeSubagentDefinitions } from './subagent-loader.js';
import { checkSubagentWhitelist } from './tool-policy.js';
import { writeTempMcpConfig, cleanupTempMcpConfig } from './mcp-config.js';
import { buildChildEnv, buildCliArgs, runClaudeCliCollect, runClaudeCliStream } from './cli-runner.js';
import { parseComposeLines, type ComposeResult } from './compose-parser.js';
import { extractTextDelta } from './wiki-delta-parser.js';
import { thinkingDirective } from './thinking.js';
import type { RunAgentDeps } from './run-agent.js';

export interface ContextMessage {
  role: string; // 'USER' | 'ASSISTANT'
  content: string;
}
export interface ComposeInput {
  query: string;
  recentContext?: ContextMessage[];
  // 비서 설정 — workplace-api 가 요청별로 해석해 전달(env 미사용).
  assistantAgentId: number;
  model: string;
  thinkingDepth: 'NONE' | 'NORMAL' | 'DEEP';
  maxTurns: number;
  timeoutMs: number;
}

// recentContext 를 단발 --print 프롬프트에 임베드(CLI 는 멀티턴 배열을 받지 않음).
function buildComposeUserMessage(input: ComposeInput): string {
  const ctx = input.recentContext ?? [];
  if (ctx.length === 0) return input.query;
  const lines = ctx.map((m) => `${m.role === 'ASSISTANT' ? 'AI' : '사용자'}: ${m.content}`);
  return `이전 대화:\n${lines.join('\n')}\n\n현재 요청: ${input.query}`;
}

// SSE 라우트용 스트리밍 러너 — 토큰이 도착할 때마다 onText 콜백을 호출하고,
// 완료 후 parseComposeLines 로 최종 message + widgets 를 산출해 반환한다.
// #333: assistant 프로파일 + per-request workdir + allowSubagents + 화이트리스트 강제.
// signal abort 시 하위 CLI child 를 kill 해 자원 누수를 막는다(wiki 러너와 동일 패턴).
export async function runAiComposeStream(
  input: ComposeInput,
  deps: RunAgentDeps,
  onText: (t: string) => void,
  signal: AbortSignal,
  onProgress?: (label: string) => void, // #333: Agent 위임 시작 시 호출('이슈 전문가에게 위임 중')
): Promise<{ fullText: string; widgets: unknown; pendingAction: unknown | null }> {
  const agentId = input.assistantAgentId;
  const token = (await deps.client.getOAuthToken(agentId)).token;
  // #333: workDir·mcpConfigPath 를 try 블록 안에서 생성해 writeTempMcpConfig 실패 시
  // finally 누수가 없도록 한다(Finding 2). let 으로 선언해 finally 에서 조건부 정리.
  let workDir: string | null = null;
  let mcpConfigPath: string | null = null;

  try {
    // #333: 요청마다 임시 작업 디렉토리 생성. .claude/agents/*.md 자동발견 경로.
    // finally 에서 rmSync 로 한 번에 정리해 temp 누수 방지.
    workDir = mkdtempSync(path.join(tmpdir(), `assistant-${agentId}-`));
    const pendingActionPath = path.join(workDir, 'pending-action.json');
    mcpConfigPath = writeTempMcpConfig({
      agentId,
      baseURL: process.env.WORKPLACE_API_BASE_URL ?? '',
      internalToken: process.env.INTERNAL_SERVICE_TOKEN ?? '',
      profile: 'assistant', // home 프로파일 → assistant 프로파일로 교체(#333)
      pendingActionPath, // #333 M2: propose 핸들러가 제안을 쓸 사이드카(절대경로)
    });
    // #333: 서브에이전트 정의를 workDir 안 .claude/agents/ 에 기록 + 허용 이름 집합 산출.
    const subagents = loadSubagents();
    writeSubagentDefinitions(workDir, subagents);
    const allowedNames = Object.keys(subagents);

    // 시스템 프롬프트는 파일로 전달(ARG_MAX 회피). workDir 안에 써서 finally 시 함께 정리.
    const systemPrompt = ASSISTANT_SYSTEM_PROMPT + thinkingDirective(input.thinkingDepth);
    const systemPromptPath = path.join(workDir, 'system-prompt.txt');
    writeFileSync(systemPromptPath, systemPrompt, 'utf8');

    const args = buildCliArgs({
      userMessage: buildComposeUserMessage(input),
      systemPrompt, // systemPromptPath 가 있으면 buildCliArgs 가 --system-prompt-file 을 우선 사용.
      systemPromptPath,
      model: input.model,
      maxTurns: input.maxTurns,
      mcpConfigPath,
      allowSubagents: true, // #333: Agent 도구 허용(라우터 위임에 필요)
      includePartialMessages: true, // partial text_delta 수신(스트리밍)
    });
    const env = buildChildEnv(process.env, token, agentId);
    const lines: string[] = [];
    let fullText = '';
    // #333: 화이트리스트 위반 감지 플래그 + 즉시-kill 홀더(Finding 1).
    // killer 홀더를 먼저 선언해 onLine 콜백 안에서 TDZ 없이 참조 가능하도록 한다.
    // 프로덕션(비동기 onLine): handle 할당 후 killer 가 채워지므로 killer?.() 가 즉시 kill.
    // 테스트 동기 모킹: onLine 이 handle 할당 전 동기 실행 → killer 가 null 이라 무해.
    // 두 경우 모두 await handle.done 이후 fallback kill+throw 가 에러를 전파한다.
    let policyDeny: string | null = null;
    let killer: (() => void) | null = null;
    const handle = runClaudeCliStream(
      { args, env, timeoutMs: input.timeoutMs, logTag: `ai-compose:${agentId}`, cwd: workDir! },
      (line) => {
        // 모든 라인을 누적(parseComposeLines 가 위젯/최종메시지 파싱에 사용).
        lines.push(line);
        let obj: unknown;
        try {
          obj = JSON.parse(line);
        } catch {
          return; // 비JSON 라인 무시
        }
        // text_delta 만 추출해 스트리밍. 비JSON·thinking_delta 등은 무시.
        const delta = extractTextDelta(obj);
        if (delta) {
          fullText += delta;
          onText(delta);
        }
        // #333: assistant tool_use 중 Agent 위임을 검사·라벨링한다.
        const o = obj as {
          type?: string;
          message?: { content?: Array<{ type?: string; name?: string; input?: Record<string, unknown> }> };
        };
        if (o.type === 'assistant' && Array.isArray(o.message?.content)) {
          for (const b of o.message!.content!) {
            if (b.type !== 'tool_use' || b.name !== 'Agent') continue;
            const deny = checkSubagentWhitelist('Agent', b.input, allowedNames);
            if (deny) {
              // 화이트리스트 위반 — 즉시 kill(프로덕션 비동기 경로). 동기 테스트 모킹에서는 null.
              policyDeny = deny;
              killer?.(); // Finding 1: handle 할당 후면 즉시 kill, 동기 경로면 무해한 no-op
              return;
            }
            const subType = typeof b.input?.subagent_type === 'string' ? b.input.subagent_type : '';
            const label = delegationLabel(subType);
            if (label && onProgress) onProgress(label);
          }
        }
      },
    );
    // killer 홀더를 채워 이후 onLine 콜백이 즉시 kill 할 수 있도록 한다.
    killer = handle.kill;
    // 상위 연결 종료 시 child 종료(자원 누수 방지). 이미 abort 된 신호면 즉시 kill.
    if (signal.aborted) handle.kill();
    else signal.addEventListener('abort', () => handle.kill(), { once: true });
    await handle.done;
    // #333: 위반 감지 시 fallback kill(프로덕션=이미 killed, 동기 모킹=여기서 kill) + throw.
    if (policyDeny) {
      handle.kill();
      throw new Error(policyDeny);
    }
    // #333 M2: propose 도구가 사이드카에 제안을 썼으면 읽어 pendingAction 으로 싣는다(스트림 파싱 불가 — collapsed Agent tool_result).
    let pendingAction: unknown | null = null;
    if (existsSync(pendingActionPath)) {
      try {
        pendingAction = JSON.parse(readFileSync(pendingActionPath, 'utf8'));
      } catch {
        pendingAction = null; // 파싱 실패는 무시(확인 카드 없이 진행)
      }
    }
    // parseComposeLines 로 최종 message(result 이벤트) + widgets(tool_use 이벤트) 산출.
    const parsed = parseComposeLines(lines);
    return { fullText: parsed.message || fullText, widgets: parsed.widgets.length > 0 ? parsed.widgets : null, pendingAction };
  } finally {
    // Finding 2: null 가드 — writeTempMcpConfig/mkdtempSync 가 throw 하면 미생성 변수는 정리 생략.
    if (mcpConfigPath) cleanupTempMcpConfig(mcpConfigPath);
    if (workDir) rmSync(workDir, { recursive: true, force: true }); // workDir + 내부 system-prompt.txt 정리
  }
}

export async function runAiCompose(
  input: ComposeInput,
  deps: RunAgentDeps,
): Promise<ComposeResult> {
  // 비서 AGENT 의 OAuth 토큰으로 LLM 인증. agentId 는 요청 본문에서 온다.
  const agentId = input.assistantAgentId;
  const token = (await deps.client.getOAuthToken(agentId)).token;
  const mcpConfigPath = writeTempMcpConfig({
    agentId,
    baseURL: process.env.WORKPLACE_API_BASE_URL ?? '',
    internalToken: process.env.INTERNAL_SERVICE_TOKEN ?? '',
    profile: 'home',
  });

  try {
    // 생각의 깊이는 CLI 플래그가 없어 system-prompt 접미 지시문으로 근사한다.
    const systemPrompt = HOME_SYSTEM_PROMPT + thinkingDirective(input.thinkingDepth);
    const args = buildCliArgs({
      userMessage: buildComposeUserMessage(input),
      systemPrompt,
      model: input.model,
      maxTurns: input.maxTurns,
      mcpConfigPath,
      includePartialMessages: false,
    });
    const env = buildChildEnv(process.env, token, agentId);
    const lines = await runClaudeCliCollect({
      args,
      env,
      timeoutMs: input.timeoutMs,
      logTag: `ai-compose:${agentId}`,
    });
    return parseComposeLines(lines);
  } finally {
    cleanupTempMcpConfig(mcpConfigPath);
  }
}
