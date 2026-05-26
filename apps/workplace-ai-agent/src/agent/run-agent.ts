// envelope → CLI 실행 단일 진입점. event-handler 가 fire-and-forget 으로 호출.
import { SYSTEM_PROMPT } from './system-prompt.js';
import { buildUserMessage } from './user-message.js';
import { MCP_CONFIG_PATH } from './mcp-config.js';
import { buildChildEnv, buildCliArgs, runClaudeCli } from './cli-runner.js';
import type { IssueEventEnvelope } from '../types/issue-events.js';

const DEFAULT_MODEL = 'claude-sonnet-4-6';
const DEFAULT_MAX_TURNS = 10;
const DEFAULT_TIMEOUT_MS = 300_000;

export async function runAgent(env: IssueEventEnvelope): Promise<void> {
  const model = process.env.WORKPLACE_AI_MODEL ?? DEFAULT_MODEL;
  const maxTurns = Number(
    process.env.WORKPLACE_AI_MAX_TURNS ?? DEFAULT_MAX_TURNS,
  );
  const timeoutMs = Number(
    process.env.WORKPLACE_AI_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS,
  );

  const userMessage = buildUserMessage(env);
  const args = buildCliArgs({
    userMessage,
    systemPrompt: SYSTEM_PROMPT,
    model,
    maxTurns,
    mcpConfigPath: MCP_CONFIG_PATH,
  });
  const childEnv = buildChildEnv(process.env);
  const logTag = `agent:${env.type}:${env.payload.issueKey}`;

  await runClaudeCli({ args, env: childEnv, timeoutMs, logTag });
}
