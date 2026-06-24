// 7: messaging.message.posted → respondAsAgentId 로 토큰·대화 준비 → CLI spawn(messaging 프로필).
// A4: runClaudeCliStream 으로 전환 — spawn 즉시 started, 라인마다 파서→tracker→tool, finally에서 done/error 발행.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import { MESSAGING_SYSTEM_PROMPT } from './messaging-system-prompt.js';
import { buildMessagingUserMessage } from './messaging-user-message.js';
import { writeTempMcpConfig, cleanupTempMcpConfig } from './mcp-config.js';
import { buildChildEnv, buildCliArgs, runClaudeCliStream } from './cli-runner.js';
import { parseProgressLine } from './chat-progress-parser.js';
import { ProgressTracker } from './progress-tracker.js';
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
    // mirror: 트리거가 스레드 안(parent 비-null)일 때만 바인딩 — 인라인이면 미전달.
    ...(p.triggerParentMessageId != null
      ? { triggerChannelId: p.channelId, triggerThreadParentId: p.triggerParentMessageId }
      : {}),
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
    // A4: 스트리밍 진행 발행 — 단일 streamId 로 started→tool→done/error 를 API 에 POST.
    // progress POST 실패는 본 흐름을 막지 않는다(표시용). 에러는 로깅만.
    const streamId = randomUUID();
    const tracker = new ProgressTracker();
    const emit = (phase: 'started' | 'tool' | 'done' | 'error') => {
      const snap = tracker.snapshot(phase);
      deps.client
        .postMessagingProgress(agentId, p.channelId, { streamId, phase, steps: snap.steps })
        .catch((e: unknown) =>
          console.error('[run-messaging-agent] progress 발행 실패', { channelId: p.channelId, error: e }),
        );
    };
    emit('started');
    const childEnv = buildChildEnv(process.env, token, agentId);
    const logTag = `messaging-agent:channel${p.channelId}:${agentId}`;
    const handle = runClaudeCliStream({ args, env: childEnv, timeoutMs, logTag, cwd: workDir }, (line) => {
      const sig = parseProgressLine(line);
      if (tracker.apply(sig)) emit('tool');
    });
    try {
      await handle.done;
      emit('done');
    } catch (e) {
      console.error('[run-messaging-agent] CLI 스트림 실패', { channelId: p.channelId, error: e });
      emit('error');
    }
  } finally {
    cleanupTempMcpConfig(mcpConfigPath);
    rmSync(workDir, { recursive: true, force: true });
  }
}
