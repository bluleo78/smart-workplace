# Phase 6c: ai-agent chat @mention 응답 설계 (#38)

작성일: 2026-05-30
대상 이슈: [#38](https://github.com/bluleo78/smart-workplace/issues/38)
부모 epic: chat (#21)
선행: [6a chat 백엔드 (#36)](2026-05-29-phase6a-chat-backend-design.md), [6b 실시간 SSE (#37)](2026-05-30-phase6b-chat-realtime-sse-design.md), Phase 5c ai-agent LLM 흐름

## 목표

chat 에서 사용자가 `@AI Agent ...` 로 멘션하면, ai-agent 가 **필요한 컨텍스트(쓰레드 흐름·이슈 본문·코멘트·첨부파일)를 읽고** LLM 으로 답을 만들어 **chat 메시지로** 작성한다. 예: "이 첨부파일 요약해줘" → AI 가 첨부(이미지/PDF 포함)를 읽고 요약 답글.

## 비목표 (Out of Scope)

- AI 가 chat 에서 이슈 상태/라벨 변경 (별도 phase, 권한 검토 필요)
- AI 가 멘션 없이 능동 발화
- 멀티 AGENT (한 thread 에 여러 AGENT) — 단일 AGENT 가정, mentions 중 첫 AGENT
- chat 자체 첨부 (첨부는 이슈 스코프 유지 — 6a 와 동일)

## 핵심 설계 결정

1. **Agentic** — 기존 이슈 핸들러와 동일하게, 모델이 MCP 도구를 호출해 응답한다 (`add_chat_message`). 컨텍스트도 모델이 도구로 온디맨드 수집.
2. **쓰레드 컨텍스트 우선** — trigger 메시지 + thread 최근 20개를 프롬프트에 선주입(대화 흐름은 항상 보장), 더 필요하면 도구로.
3. **첨부는 네이티브 Read** — MCP 로 이미지 바이트를 넘기는(미검증) 대신, agent 가 첨부를 per-run 임시폴더에 내려받고 **claude CLI 의 기본 Read 도구로 직접 읽게** 한다. Claude Code 는 이미지·PDF·텍스트를 Read 로 네이티브 처리하므로 멀티모달 리스크가 사라진다.
4. **AGENT 자동 thread 멤버화** — 멘션된 AGENT 를 thread 멤버로 add-only 추가 (AI 가 답을 POST 하려면 멤버여야 함). 6a 의 add-only 철학과 일관.

## 아키텍처 흐름

```
human "@AI 첨부 요약해줘" 작성
  └ workplace-api ChatMessageService.create
       ├ (신규) mentions 의 AGENT 를 chat_thread_member 에 add-only
       └ ChatEventDispatcher → POST /events {type:"chat.message.posted"} (6a, 기존)
  └ ai-agent  /events
       ├ zod 검증 + self-loop 가드 (actor.kind==='AGENT' → skip)
       ├ agentId = mentions 중 첫 AGENT
       ├ thread 최근 20개 fetch (선주입) + 이슈 첨부 임시폴더로 다운로드
       ├ claude CLI 스폰 (cwd=임시폴더, Read 그 폴더 한정 허용,
       │   allowed-tools = mcp__workplace__* + Read)
       │     MCP: get_chat_thread(신규) · get_issue(기존) · add_chat_message(신규)
       │     Read: 첨부 이미지/PDF/텍스트 직접 읽기
       └ 모델이 add_chat_message(threadId, body) 1회 호출 → workplace-api POST
  └ AI 메시지 생성 → ChatMessageCreatedEvent → ChatSseDispatcher(6b) → 멤버에게 실시간
```

완료 기준의 "30초 이내 실시간 노출"은 6b SSE 가 자동 충족.

## ai-agent 컴포넌트 (workplace-ai-agent)

- **`chat-events.ts`** — `chat.message.posted` zod 스키마: `projectKey, issueKey, issueId, threadId, messageId, actor{id,username,name,kind}, body, mentions[]{id,username,name,kind}, occurredAt`. dispatch union 에 추가.
- **self-loop 가드** — `handleEvent` 에서 `actor.kind==='AGENT'` skip (workplace-api 도 거르지만 이중 안전).
- **chat 리졸버** — `mentions` 중 첫 AGENT id. 없으면 skip (정상 흐름에선 항상 있음).
- **workplace-api client 메서드 추가**
  - `getChatMessages(agentId, threadId, limit)` — 선주입용 thread 흐름
  - `addChatMessage(agentId, threadId, body)` — MCP write 도구가 사용
  - `listAttachments(agentId, projectKey, issueNumber)` — 첨부 메타
  - `downloadAttachment(agentId, projectKey, issueNumber, fileId)` — 바이트
- **첨부 준비** — 이슈 첨부를 per-run 임시폴더에 다운로드. 용량 가드(파일당·합계 상한; 초과분은 skip 하고 프롬프트에 표기). 다운로드 목록(파일명·타입·크기·로컬경로) 을 프롬프트에 manifest 로 기재.
- **`buildChatUserMessage`** — trigger 메시지 + thread 최근 20개 + 첨부 manifest + 이슈 좌표(issueKey).
- **MCP 도구** — `get_chat_thread(threadId, cursor?)` (흐름·멤버 더보기), `add_chat_message(threadId, body)` (write). 기존 `get_issue` 공존.
- **runAgent chat 분기** — agentId resolve → thread fetch → 첨부 다운로드 → 프롬프트 → CLI 스폰. CLI 변경: `cwd` 를 per-run 임시폴더로, `--disallowed-tools` 에서 Read 제거하고 `--allowed-tools` 에 `Read` 추가(폴더 한정). Bash/Write/WebFetch/WebSearch 등은 계속 차단.
- **system prompt (chat)** — "thread 흐름·이슈·첨부를 필요한 만큼 읽고, 정확히 한 번 `add_chat_message` 로 답하라."

## workplace-api 변경 (소폭)

- **mention 된 AGENT 자동 thread 멤버화** — `ChatMessageService.create` 에서 mentionUserIds 중 AGENT 를 `chat_thread_member` 에 `insertIgnoreConflict`(add-only). 이래야 AI 의 답 POST 가 `ensureMember` 를 통과.
- **재사용(작업 없음)** — 첨부 list/content 엔드포인트는 이미 `Internal` + `X-On-Behalf-Of` 인증 허용(`project:read`); chat 작성도 동일 인증 경로(이슈 add_comment 와 동일); AGENT 시각 구분은 `authorKind: AGENT`(6a/6d) 로 충족.

## 보안

- Read 는 per-run 임시폴더(cwd) 로 스코프 → 모델이 그 폴더의 첨부만 읽고 호스트 FS 는 못 봄. Bash/Write/네트워크 도구는 계속 차단.
- 임시폴더는 run 종료 후 정리.

## self-loop / 에러 처리

- self-loop: AI 답변은 `actor.kind===AGENT` 라 ChatEventDispatcher 가 미발사 → 이벤트 없음 → 루프 없음. agent 측 가드로 이중.
- fire-and-forget: runAgent 실패는 로그만, throw 안 함(기존 패턴). 첨부 다운로드 실패는 해당 파일만 skip + manifest 에 표기, 답변은 진행.
- "정확히 1개 답": system prompt 로 통제 + (안전망) 동일 trigger messageId 에 대한 중복 응답 가드.

## 테스트

- **ai-agent (vitest)**: 라우트(`chat.message.posted` → 202, runAgent 호출), 핸들러(self-loop skip), 리졸버(mentions 중 AGENT 선택), buildChatUserMessage, MCP 도구(`add_chat_message`/`get_chat_thread` → client 호출), 첨부 준비(다운로드·용량가드·manifest) — client/CLI 는 mock.
- **workplace-api (JUnit)**: create 시 mention 된 AGENT 가 thread 멤버로 add-only 되는지; AGENT 가 `Internal`+`X-On-Behalf-Of` 로 chat 메시지 POST 가능(통합).
- **수동 검증(LLM 경로)**: 이미지/PDF 첨부 있는 이슈에서 `@AI 첨부 요약해줘` → AI 가 첨부 읽고 요약 답글, 6b SSE 로 실시간 노출. (LLM 출력은 비결정적이라 자동 E2E 대신 수동.)

## 완료 기준 (이슈 #38 매핑)

- ✅ chat `@AI ...` → 30초 이내 AI 응답 (6b 실시간 + REST 모두)
- ✅ self-loop 미발생
- ✅ 컨텍스트 수집: 응답이 thread 흐름·이슈 본문·첨부를 참고 (첨부 이미지/PDF 포함)
