// 6c: chat.message.posted → AGENT 결정 → 토큰·thread·첨부 준비 → 인-프로세스 MCP(chat) + SDK 실행.
// 슬라이스 3: runSdkStream + buildInProcessWorkplaceMcpServer 로 전환(stdio MCP 서브프로세스 제거).
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import { CHAT_SYSTEM_PROMPT } from './chat-system-prompt.js';
import { buildChatUserMessage } from './chat-user-message.js';
import { prepareAttachments } from './attachment-prep.js';
import { runSdkStream } from './sdk-runner.js';
import { buildInProcessWorkplaceMcpServer } from './sdk-mcp-server.js';
import { parseProgressLine } from './chat-progress-parser.js';
import { ProgressTracker } from './progress-tracker.js';
import { pickMentionedAgentId } from './chat-agent-resolver.js';
import type { RunAgentDeps } from './run-agent.js';
import type { ChatEventEnvelope } from '../types/chat-events.js';

const DEFAULT_MODEL = 'claude-sonnet-4-6';
const DEFAULT_MAX_TURNS = 30;
const DEFAULT_TIMEOUT_MS = 300_000;
const THREAD_PREFETCH = 20;

export async function runChatAgent(
  envelope: ChatEventEnvelope,
  deps: RunAgentDeps,
): Promise<void> {
  const p = envelope.payload;
  const agentId = pickMentionedAgentId(p);
  if (agentId == null) {
    console.warn('[run-chat-agent] mentions 에 AGENT 없음 — spawn 생략', { threadId: p.threadId });
    return;
  }

  let token: string;
  try {
    token = (await deps.client.getOAuthToken(agentId)).token;
  } catch (e) {
    console.error('[run-chat-agent] OAuth 토큰 fetch 실패 — spawn 생략', {
      threadId: p.threadId,
      agentId,
      error: e instanceof Error ? e.message : String(e),
    });
    return;
  }

  // per-run 임시폴더 — 첨부 다운로드 + Read cwd. Read 는 이 폴더 한정.
  const workDir = mkdtempSync(path.join(tmpdir(), `chat-agent-${p.threadId}-`));
  // 인-프로세스 MCP 서버(chat 프로필) — onBehalfOf = 멘션된 agentId(ACTING_USER_ID 없음).
  const workplace = buildInProcessWorkplaceMcpServer({
    client: deps.client,
    onBehalfOfId: agentId,
    profile: 'chat',
  });

  try {
    const recent = await deps.client.getChatMessages(agentId, p.threadId, THREAD_PREFETCH);
    const attachments = await prepareAttachments(deps.client, agentId, p.issueKey, workDir);
    const userMessage = buildChatUserMessage(p, recent, attachments);

    const model = process.env.WORKPLACE_AI_MODEL ?? DEFAULT_MODEL;
    const maxTurns = Number(process.env.WORKPLACE_AI_MAX_TURNS ?? DEFAULT_MAX_TURNS);
    const timeoutMs = Number(process.env.WORKPLACE_AI_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);

    // 스트리밍 진행 발행 — 단일 streamId 로 started→tool→done/error 를 API 에 POST.
    // progress POST 실패는 본 흐름을 막지 않는다(표시용). 에러는 로깅만.
    const streamId = randomUUID();
    const tracker = new ProgressTracker();
    const emit = (phase: 'started' | 'tool' | 'done' | 'error') => {
      const snap = tracker.snapshot(phase);
      deps.client
        .postChatProgress(agentId, p.threadId, { streamId, phase, steps: snap.steps })
        .catch((e: unknown) =>
          console.error('[run-chat-agent] progress 발행 실패', { threadId: p.threadId, error: e }),
        );
    };

    emit('started');
    const logTag = `chat-agent:${p.issueKey}:thread${p.threadId}:${agentId}`;
    const handle = runSdkStream(
      {
        userMessage,
        systemPrompt: CHAT_SYSTEM_PROMPT,
        model,
        maxTurns,
        token,
        agentId,
        timeoutMs,
        logTag,
        cwd: workDir, // 첨부 Read 스코프 — 누락 시 tmpdir 로 새 스코프(첨부 읽기 조용히 실패)
        allowFileRead: true,
        includePartialMessages: false, // CLI 가 partial 미전달이었음 — 파서 입력 계약 동일 유지
        mcpServers: { workplace },
      },
      (line) => {
        const sig = parseProgressLine(line);
        if (tracker.apply(sig)) emit('tool');
      },
    );
    try {
      await handle.done;
      emit('done');
    } catch (e) {
      console.error('[run-chat-agent] SDK 스트림 실패', { threadId: p.threadId, error: e });
      emit('error');
    }
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}
