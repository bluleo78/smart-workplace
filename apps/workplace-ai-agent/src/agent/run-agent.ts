// envelope → token fetch → CLI 실행. event-handler 가 client 주입.
import { SYSTEM_PROMPT } from './system-prompt.js';
import { buildUserMessage } from './user-message.js';
import { MCP_CONFIG_PATH } from './mcp-config.js';
import { buildChildEnv, buildCliArgs, runClaudeCli } from './cli-runner.js';
import type { IssueEventEnvelope } from '../types/issue-events.js';
import type { WorkplaceApiClient } from '../clients/workplace-api.js';

const DEFAULT_MODEL = 'claude-sonnet-4-6';
const DEFAULT_MAX_TURNS = 10;
const DEFAULT_TIMEOUT_MS = 300_000;

export interface RunAgentDeps {
  client: WorkplaceApiClient;
}

export async function runAgent(
  envelope: IssueEventEnvelope,
  deps: RunAgentDeps,
): Promise<void> {
  let token: string;
  try {
    const credential = await deps.client.getMyOAuthToken();
    token = credential.token;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[run-agent] OAuth 토큰 fetch 실패 — spawn 생략', {
      type: envelope.type,
      issueKey: envelope.payload.issueKey,
      error: msg,
    });
    return;
  }

  const model = process.env.WORKPLACE_AI_MODEL ?? DEFAULT_MODEL;
  const maxTurns = Number(
    process.env.WORKPLACE_AI_MAX_TURNS ?? DEFAULT_MAX_TURNS,
  );
  const timeoutMs = Number(
    process.env.WORKPLACE_AI_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS,
  );

  const userMessage = buildUserMessage(envelope);
  const args = buildCliArgs({
    userMessage,
    systemPrompt: SYSTEM_PROMPT,
    model,
    maxTurns,
    mcpConfigPath: MCP_CONFIG_PATH,
  });
  const childEnv = buildChildEnv(process.env, token);
  const logTag = `agent:${envelope.type}:${envelope.payload.issueKey}`;

  await runClaudeCli({ args, env: childEnv, timeoutMs, logTag });
}
