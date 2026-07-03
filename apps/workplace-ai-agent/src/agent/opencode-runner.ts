// Task9: opencode SDK 러너 — AgentRunner 계약을 @opencode-ai/sdk(별도 프로세스로 opencode CLI 를
// 스폰) 로 구현한다. Claude SDK 경로(claude-sdk-runner.ts)와 달리 opencode 는 자식 프로세스이므로
// 도구는 stdio MCP(mcp/stdio-entry.ts)로만 도달하고, 진행 상황은 event.subscribe() SSE 스트림을
// 직접 순회해 RunnerEvent 로 매핑한다. 타입은 node_modules/@opencode-ai/sdk/dist/gen/types.gen.d.ts
// 실물 기준(Session/Event/Part/AssistantMessage) — 브리핑의 예시 스니펫과 필드명이 다를 수 있음.
import { randomUUID } from 'node:crypto';
import { createOpencode } from '@opencode-ai/sdk';

import { log } from '../logger.js';
import type { AgentRunner, RunnerInput, RunnerStreamHandle } from './agent-runner.js';
import { registerBridge, releaseBridge } from './bridge-registry.js';
import { buildOpencodeConfig, resolveStdioEntryCmd, splitOpencodeModel } from './opencode-config.js';
import type { RunnerEvent, RunnerUsage } from './runner-events.js';

// credential 이 opencode 가 아니면 이 러너를 쓸 수 없음(팩토리가 보장하지만 방어적으로 재확인).
function requireOpencodeCredential(i: RunnerInput): void {
  if (i.credential.provider !== 'opencode') {
    throw new Error('OpencodeRunner 는 opencode credential 만 지원합니다');
  }
}

export class OpencodeRunner implements AgentRunner {
  // 실행별로 opencode 서버 프로세스를 새로 스폰한다(세션/프로세스 재사용 없음 — 매 호출 완전 격리).
  stream(i: RunnerInput, onEvent: (e: RunnerEvent) => void): RunnerStreamHandle {
    requireOpencodeCredential(i);

    const runId = randomUUID();
    let killed = false;
    let timedOut = false;
    // kill()/timeout 이 비동기 세션 abort 를 시도할 수 있도록 client/sessionId 를 클로저 밖에서 공유.
    let liveClient: Awaited<ReturnType<typeof createOpencode>>['client'] | undefined;
    let liveSessionId: string | undefined;

    const requestAbort = (): void => {
      if (liveClient && liveSessionId) {
        void liveClient.session.abort({ path: { id: liveSessionId } }).catch(() => {});
      }
    };

    const done = (async () => {
      const hasBridge = Boolean(i.mcp?.hostBridge);
      if (i.mcp?.hostBridge) registerBridge(runId, i.mcp.hostBridge);

      let server: Awaited<ReturnType<typeof createOpencode>>['server'] | undefined;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let errored = false;
      try {
        const stdioEntryCmd = resolveStdioEntryCmd();
        const config = buildOpencodeConfig(i, runId, stdioEntryCmd);
        const opencode = await createOpencode({ config });
        server = opencode.server;
        liveClient = opencode.client;

        timer = setTimeout(() => {
          timedOut = true;
          requestAbort();
        }, i.timeoutMs);

        const created = await opencode.client.session.create({});
        if (!created.data) {
          throw new Error(`opencode session 생성 실패: ${JSON.stringify(created.error)}`);
        }
        const session = created.data;
        liveSessionId = session.id;

        const { providerID, modelID } = splitOpencodeModel(i.model);
        const es = await opencode.client.event.subscribe();

        // prompt_async — 202/204 즉시 반환, 실제 응답은 event.subscribe 스트림으로 온다(fire-and-forget).
        void opencode.client.session
          .promptAsync({
            path: { id: session.id },
            body: {
              agent: 'primary',
              model: { providerID, modelID },
              parts: [{ type: 'text', text: i.userMessage }],
            },
          })
          .catch((e: unknown) => {
            log.error('opencode-runner', 'opencode_prompt_error', {
              requestId: i.requestId,
              error: e instanceof Error ? e.message : String(e),
            });
          });

        // 텍스트 part 는 opencode 가 delta 를 직접 실어 보내는 경우가 대부분(properties.delta)이나,
        // 없으면 누적 text 와 직전 길이의 suffix-diff 로 합성한다(part.id 별 길이 추적).
        const lastPartLen = new Map<string, number>();
        const startedTools = new Set<string>();
        const finishedTools = new Set<string>();
        // part.id → seq. sdk-mcp-server.ts(Claude 경로)와 동일하게 tool_use_start/tool_result 가
        // 같은 seq 를 공유해야 프론트(useChatSession.ts)가 seq 로 매칭해 'running'→'done' 전환한다.
        // 이걸 매 이벤트마다 증가하는 단일 카운터로 쓰면 result 의 seq 가 자신의 start 와 달라져
        // 매칭이 영영 실패 — 실측 버그(도구 카드가 계속 "실행중"에 머묾).
        const toolSeq = new Map<string, number>();
        let fullText = '';
        let lastUsage: RunnerUsage | null = null;
        let seq = 0;

        // opencode 는 primary agent 가 서브에이전트(allowSubagents)에 위임하면 parentID 가 primary
        // 세션 id 인 새 자식 세션을 만들어 그 세션 안에서 진행한다. message.part.updated 는 세션별로
        // sessionID 를 실어 보내므로, primary 세션 id 만으로 필터링하면 자식 세션의 모든 파트(도구
        // 호출·텍스트)가 조용히 드롭된다. session.created/session.updated 이벤트로 parentID 를 추적해
        // "알려진 세션" 집합에 편입시키고, 그 집합 기준으로 필터링한다.
        const knownSessionIds = new Set<string>([session.id]);
        // opencode 는 사용자가 보낸 메시지 자신도 message.part.updated(type:'text') 로 흘려보낸다
        // (message.updated 로 role:'user' 메시지가 먼저 생성된 뒤 그 메시지의 text part 갱신 이벤트가
        // 뒤따름). role 구분 없이 모든 text part 를 델타로 처리하면 사용자 입력 자체가 응답으로
        // 에코된다(실측 버그) — assistant 메시지 id 만 추적해 그 messageID 의 text part 만 델타로 다룬다.
        const assistantMessageIds = new Set<string>();

        for await (const ev of es.stream) {
          if (killed) break;

          if (ev.type === 'session.created' || ev.type === 'session.updated') {
            const info = ev.properties.info;
            if (info.parentID === session.id) {
              knownSessionIds.add(info.id);
            }
            continue;
          }

          if (ev.type === 'message.part.updated') {
            const part = ev.properties.part;
            if (!knownSessionIds.has(part.sessionID)) continue;
            // primary 세션 이벤트는 기존과 동일하게 parentToolUseId: null. 자식(서브에이전트) 세션
            // 이벤트는 run-ai-chat.ts 의 parentToolUseId == null 필터가 라우터 텍스트와 구분할 수
            // 있도록 자식 세션 자신의 id 를 parentToolUseId 로 표시한다(서브에이전트 식별자로도 재사용 가능).
            const isChildSession = part.sessionID !== session.id;
            const parentToolUseId = isChildSession ? part.sessionID : null;

            if (part.type === 'text') {
              if (!assistantMessageIds.has(part.messageID)) continue; // user 메시지 echo 방지
              const delta = typeof ev.properties.delta === 'string' ? ev.properties.delta : part.text.slice(lastPartLen.get(part.id) ?? 0);
              lastPartLen.set(part.id, part.text.length);
              if (delta) {
                fullText += delta;
                onEvent({ type: 'text_delta', text: delta, parentToolUseId });
              }
              continue;
            }

            if (part.type === 'tool') {
              const status = part.state.status;
              // opencode 도구는 MCP(별도 프로세스) 경유지만, opencode 서버 자신이 호출 상태(입력/출력)를
              // Part.state 로 추적해 스트림에 실어주므로 args/result 를 근사가 아니라 실값으로 확보 가능.
              if ((status === 'pending' || status === 'running') && !startedTools.has(part.id)) {
                startedTools.add(part.id);
                seq += 1;
                toolSeq.set(part.id, seq);
                onEvent({ type: 'tool_use', name: part.tool, input: part.state.input, parentToolUseId });
                i.mcp?.onTool?.({ seq, event: 'tool_use_start', toolName: part.tool, args: part.state.input });
              } else if ((status === 'completed' || status === 'error') && !finishedTools.has(part.id)) {
                finishedTools.add(part.id);
                const startSeq = toolSeq.get(part.id) ?? (seq += 1);
                onEvent({ type: 'tool_done' });
                i.mcp?.onTool?.({
                  seq: startSeq,
                  event: 'tool_result',
                  toolName: part.tool,
                  isError: status === 'error',
                  result: status === 'completed' ? part.state.output : part.state.error,
                });
              }
              continue;
            }
            continue;
          }

          if (ev.type === 'message.updated') {
            const info = ev.properties.info;
            if (info.role === 'assistant' && knownSessionIds.has(info.sessionID)) {
              assistantMessageIds.add(info.id);
              if (info.sessionID === session.id) {
                lastUsage = { inputTokens: info.tokens.input, outputTokens: info.tokens.output };
              }
            }
            continue;
          }

          if (ev.type === 'session.idle') {
            if (ev.properties.sessionID === session.id) {
              onEvent({ type: 'result', ok: true, text: fullText, usage: lastUsage });
              break;
            }
            continue;
          }

          if (ev.type === 'session.error') {
            const sid = ev.properties.sessionID;
            if (!sid || sid === session.id) {
              errored = true;
              // session.error 의 실제 원인(ProviderAuthError/ApiError 등)을 남긴다 — 기존엔 이벤트
              // 발생 사실만 기록해 원인 파악이 불가능했다(실측: 원인 불명 session.error 디버깅 난항).
              log.error('opencode-runner', 'opencode_session_error_detail', {
                requestId: i.requestId,
                error: ev.properties.error,
              });
              onEvent({ type: 'result', ok: false, text: fullText || null, usage: lastUsage });
              break;
            }
          }
        }
      } finally {
        if (timer) clearTimeout(timer);
        server?.close();
        if (hasBridge) releaseBridge(runId);
      }

      if (timedOut) {
        log.error('opencode-runner', 'opencode_timeout', { requestId: i.requestId, timeoutMs: i.timeoutMs });
        throw new Error(`${i.logTag} timeout after ${i.timeoutMs}ms`);
      }
      if (killed) {
        log.info('opencode-runner', 'opencode_killed', { requestId: i.requestId });
        return; // 의도적 종료 — cli_killed 와 동일 의미(정상 resolve)
      }
      if (errored) {
        log.error('opencode-runner', 'opencode_session_error', { requestId: i.requestId });
        throw new Error(`${i.logTag} opencode session.error`);
      }
      log.info('opencode-runner', 'opencode_done', { requestId: i.requestId });
    })();

    // 상위 연결 종료 시 — abort 요청 후 정상 resolve(cli_killed 의미 미러).
    const kill = (): void => {
      killed = true;
      requestAbort();
    };

    return { done, kill };
  }

  // collect: stream 을 내부적으로 소비해 RunnerEvent[] 로 버퍼링(브리지/타임아웃/kill 처리를
  // stream() 한 곳에만 두기 위해 위임 — 로직 중복 없음).
  async collect(i: RunnerInput): Promise<RunnerEvent[]> {
    const events: RunnerEvent[] = [];
    const handle = this.stream(i, (e) => events.push(e));
    await handle.done;
    return events;
  }
}
