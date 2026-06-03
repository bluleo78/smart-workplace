// 7: messaging.message.posted → respondAsAgentId 로 토큰·대화 준비 → CLI spawn(messaging 프로필).
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { MESSAGING_SYSTEM_PROMPT } from './messaging-system-prompt.js';
import { buildMessagingUserMessage } from './messaging-user-message.js';
import { writeTempMcpConfig, cleanupTempMcpConfig } from './mcp-config.js';
import { buildChildEnv, buildCliArgs, runClaudeCli } from './cli-runner.js';
import type { RunAgentDeps } from './run-agent.js';
import type { MessagingEventEnvelope } from '../types/messaging-events.js';

const DEFAULT_MODEL = 'claude-sonnet-4-6';
const DEFAULT_MAX_TURNS = 30;
const DEFAULT_TIMEOUT_MS = 300_000;
const PREFETCH = 20;

export async function runMessagingAgent(
  envelope: MessagingEventEnvelope,
  deps: RunAgentDeps,
): Promise<void> {
  const p = envelope.payload;
  const agentId = p.respondAsAgentId;

  let token: string;
  try {
    token = (await deps.client.getOAuthToken(agentId)).token;
  } catch (e) {
    console.error('[run-messaging-agent] OAuth 토큰 fetch 실패 — spawn 생략', {
      channelId: p.channelId,
      agentId,
      error: e instanceof Error ? e.message : String(e),
    });
    return;
  }

  // per-run 임시폴더 — CLI cwd. 채팅과 달리 첨부 없음.
  const workDir = mkdtempSync(path.join(tmpdir(), `messaging-agent-${p.channelId}-`));
  const mcpConfigPath = writeTempMcpConfig({
    agentId,
    baseURL: process.env.WORKPLACE_API_BASE_URL ?? '',
    internalToken: process.env.INTERNAL_SERVICE_TOKEN ?? '',
    profile: 'messaging',
  });

  try {
    // 최근 채널 메시지 PREFETCH 개 조회 → 대화 컨텍스트 구성
    const recent = await deps.client.getChannelMessages(agentId, p.channelId, PREFETCH);
    const userMessage = buildMessagingUserMessage(p, recent);

    const model = process.env.WORKPLACE_AI_MODEL ?? DEFAULT_MODEL;
    const maxTurns = Number(process.env.WORKPLACE_AI_MAX_TURNS ?? DEFAULT_MAX_TURNS);
    const timeoutMs = Number(process.env.WORKPLACE_AI_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);

    // messaging 은 첨부 없음 → allowFileRead: false
    const args = buildCliArgs({
      userMessage,
      systemPrompt: MESSAGING_SYSTEM_PROMPT,
      model,
      maxTurns,
      mcpConfigPath,
      allowFileRead: false,
    });
    const childEnv = buildChildEnv(process.env, token, agentId);
    const logTag = `messaging-agent:channel${p.channelId}:${agentId}`;

    await runClaudeCli({ args, env: childEnv, timeoutMs, logTag, cwd: workDir });
  } finally {
    cleanupTempMcpConfig(mcpConfigPath);
    rmSync(workDir, { recursive: true, force: true });
  }
}
