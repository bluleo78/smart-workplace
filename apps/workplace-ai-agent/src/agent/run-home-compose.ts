// 7b: 홈 컴포즈 러너 — composer agentId 토큰 fetch → home MCP config → CLI(home 프로필) 스폰 → 파서.
// 데이터 조회는 show_* 도구가 하지 않으므로 토큰은 순수 Claude LLM 인증용(데이터 권한과 무관).
import { HOME_SYSTEM_PROMPT } from './home-system-prompt.js';
import { writeTempMcpConfig, cleanupTempMcpConfig } from './mcp-config.js';
import { buildChildEnv, buildCliArgs, runClaudeCliCollect } from './cli-runner.js';
import { parseComposeLines, type ComposeResult } from './compose-parser.js';
import type { RunAgentDeps } from './run-agent.js';

const DEFAULT_MODEL = 'claude-sonnet-4-6';
const DEFAULT_MAX_TURNS = 8;
const DEFAULT_TIMEOUT_MS = 60_000;

// composer agentId 미설정 — /home/compose 라우트가 503 으로 변환.
export class HomeComposerNotConfiguredError extends Error {
  constructor() {
    super('WORKPLACE_HOME_COMPOSER_AGENT_ID 미설정');
    this.name = 'HomeComposerNotConfiguredError';
  }
}

export interface ContextMessage {
  role: string; // 'USER' | 'ASSISTANT'
  content: string;
}
export interface ComposeInput {
  query: string;
  recentContext?: ContextMessage[];
}

// recentContext 를 단발 --print 프롬프트에 임베드(CLI 는 멀티턴 배열을 받지 않음).
function buildComposeUserMessage(input: ComposeInput): string {
  const ctx = input.recentContext ?? [];
  if (ctx.length === 0) return input.query;
  const lines = ctx.map((m) => `${m.role === 'ASSISTANT' ? 'AI' : '사용자'}: ${m.content}`);
  return `이전 대화:\n${lines.join('\n')}\n\n현재 요청: ${input.query}`;
}

export async function runHomeCompose(
  input: ComposeInput,
  deps: RunAgentDeps,
): Promise<ComposeResult> {
  const agentId = Number(process.env.WORKPLACE_HOME_COMPOSER_AGENT_ID);
  if (!Number.isFinite(agentId) || agentId <= 0) {
    throw new HomeComposerNotConfiguredError();
  }

  const token = (await deps.client.getOAuthToken(agentId)).token;
  const mcpConfigPath = writeTempMcpConfig({
    agentId,
    baseURL: process.env.WORKPLACE_API_BASE_URL ?? '',
    internalToken: process.env.INTERNAL_SERVICE_TOKEN ?? '',
    profile: 'home',
  });

  try {
    const model = process.env.WORKPLACE_AI_MODEL ?? DEFAULT_MODEL;
    const maxTurns = Number(process.env.WORKPLACE_AI_MAX_TURNS ?? DEFAULT_MAX_TURNS);
    const timeoutMs = Number(process.env.WORKPLACE_AI_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);

    const args = buildCliArgs({
      userMessage: buildComposeUserMessage(input),
      systemPrompt: HOME_SYSTEM_PROMPT,
      model,
      maxTurns,
      mcpConfigPath,
      includePartialMessages: false,
    });
    const env = buildChildEnv(process.env, token, agentId);
    const lines = await runClaudeCliCollect({ args, env, timeoutMs, logTag: `home-compose:${agentId}` });
    return parseComposeLines(lines);
  } finally {
    cleanupTempMcpConfig(mcpConfigPath);
  }
}
