# Global Chat 도구 호출 인라인 표시 (B1: 사이드카 라이브 테일)

## 배경 / 문제

AI 어시스턴트(Global Chat, 홈 챗 도크)는 질문을 보내면 응답 완료 전까지 **점 3개 타이핑 인디케이터만** 보여준다(`AIChatPanel.tsx:255-269`). AI가 내부적으로 어떤 도구를 호출하는지(이슈 조회·상태 변경 등) 사용자에게 전혀 노출되지 않아, "멈춘 것 같다"는 인상을 준다.

비교 기준인 `smart-fire-hub`는 도구 호출을 메시지 버블 안에 **인라인으로 스트리밍**한다(`MessageBubble.tsx`의 `ToolCallDisplay`: 아이콘 + 한국어 라벨 + 파라미터 + `실행 중...` → `✓ 완료`/`✗ 실패`).

목표: Global Chat에도 firehub 수준의 도구 호출 인라인 표시를 추가하고, 도구 호출 내역을 메시지에 **영속**한다.

**범위**: Global Chat(`run-ai-compose` 경로)만. 이슈/팀 채팅(`run-chat-agent`)은 이미 `AiWorkingBubble`로 step을 표시하므로 이번 범위 밖.

## 왜 firehub처럼 단순하지 않은가 (아키텍처 제약)

| | 이슈 채팅 (`run-chat-agent`) | Global Chat (`run-ai-compose`) |
|---|---|---|
| 구조 | 단일 에이전트 + MCP 도구 직접 | 라우터 → 서브에이전트 위임(`allowSubagents:true`) |
| 도구 위치 | 최상위 스트림 → `parseProgressLine`이 다 잡음 | 액션 도구가 **서브에이전트 안**에서 실행 |

이슈 채팅이 step을 보여줄 수 있는 건 서브에이전트를 안 쓰기 때문(= firehub와 동일 구조)이다. Global Chat은 #333 라우터→전문가 위임 구조라, 보여주고 싶은 액션 도구(`update_status` 등)가 `Agent` 도구 안에 접혀(collapsed) **부모 NDJSON 스트림에서 보이지 않는다**.

근거: `run-ai-compose.ts:350` 주석 — `#351: ...스트림 파싱 불가 — collapsed Agent tool_result`. 서브에이전트의 `propose` 결과가 스트림에 안 보여 사이드카 파일로 우회한 기록.

→ 스트림 파싱(firehub 방식) 불가. 대신 **MCP 디스패처 사이드카** 방식(B1)으로 우회한다.

## 핵심 아이디어

하나의 **공유 MCP 서버**가 라우터의 `show_*`와 서브에이전트의 액션 도구를 **모두** 처리한다. 그 단일 디스패처(`workplace-mcp-server.ts`의 `CallToolRequestSchema` 핸들러, 65-81행)를 래핑해 모든 도구 호출의 시작/결과를 사이드카 NDJSON에 기록하고, `run-ai-compose`가 그 파일을 라이브 테일하며 `tool` SSE 이벤트로 발행한다.

**이 방식이 옳은 이유(증명됨)**: 이미 출시된 `#351 propose` 사이드카가 B1의 축소판이다. `propose_*`는 서브에이전트 도구이고, 스트림에서 안 보여서(collapsed) `WORKPLACE_PENDING_ACTION_PATH` env를 mcp-config로 주입 → 서브에이전트의 MCP 핸들러가 `appendFileSync` → 부모가 읽음. 이 패턴이 CLOSED 상태로 동작 중. B1 = 이걸 **전체 도구로 일반화 + at-done이 아닌 라이브 읽기**.

스트림 가시성 문제와 무관하게 동작한다(스트림을 파싱하지 않으므로).

## 설계

### 1. 두 채널 병합

도구 표시는 **두 비동기 채널**의 합이다:
- **위임 라벨** (기존, 스트림 `onProgress`): "이슈 전문가에게 위임 중". `Agent`는 MCP 도구가 아니라 CLI 빌트인(`assistant-system-prompt.ts`: "Agent 도구는 mcp__ 프리픽스가 없으므로") → **사이드카에 안 잡힘**. 기존 스트림 채널 유지.
- **도구 호출** (신규, 사이드카 테일): `update_status`, `get_issue_detail` 등.

**렌더링: 중첩형.** 위임 라벨은 헤더, 이후 도구 호출은 그 아래 들여쓰기.
```
🤖 이슈 전문가에게 위임 중
   ├─ 🔍 이슈 상세 조회  EX-2          ✓
   └─ ✏️ 상태 변경  EX-2 → 진행중       ✓
완료 메시지 텍스트…
```
프론트가 도착 순서대로 `steps` 배열을 쌓는다. 위임 라벨(kind: `delegation`)을 만나면 새 그룹 헤더, 이후 도구(kind: `tool`)는 가장 최근 delegation 아래 들여쓰기. 라우터는 한 번에 한 서브에이전트씩 순차 위임하므로 도착 순서 = 인과 순서.

### 2. 필터링

디스패처는 54개 도구를 모두 본다. 표시 대상:
- **숨김**: `show_*` (위젯으로 렌더됨), `respond_chat`/`submit_response` (내부 응답 배관), `propose_*` (이미 확인 카드로 표시 → 중복 방지)
- **표시**: 그 외 조회·액션 도구 (`list_issues`, `get_issue_detail`, `add_comment`, `update_status`, `unassign_self`, `search_wiki`, `get_wiki_page`, `create_wiki_page`, `update_wiki_page`, `get_chat_thread`, `add_chat_message`, `get_channel_messages`, `add_channel_message`, `list_channels`, `discover_channels`, `list_events`, `get_event`, `list_mail`, `get_mail`, `list_mail_accounts`, `sync_mail`, `list_contacts`, `get_external_contact`, `create_external_contact`, `update_external_contact`, `list_projects`, `get_project`, `list_project_members`, `list_drive_spaces`, `list_drive_items`, `search_drive`, `create_folder`, `rename_folder`, `move_folder`, `move_file`)

필터 위치: 사이드카는 **모든** 도구를 기록(전체 가시성·디버깅 유리), 표시 필터는 프론트에서 적용. (서버는 raw, 클라가 표시 정책 — firehub와 동일하게 라벨/필터를 프론트에 둔다.) 단, **API 영속(tool_calls)은 표시 가능 도구만 저장한다** — `HomeComposeService`가 start 이벤트 누적 시 `isDisplayableTool` 필터를 적용하므로, 영속된 tool_calls = 프론트 표시 집합과 일치한다(`show_*`·`propose_*`·`respond_chat`·`submit_response` 제외).

### 3. 라이브 테일 메커니즘 (유일한 신규 기술)

- `fs.watch` ❌ (빠른 append 누락 위험) → **인터벌 폴링**(150ms)
- 바이트 오프셋 추적: 매 폴링마다 마지막 읽은 오프셋부터 읽어 새 바이트만 처리
- 완성된 줄(`\n`)만 파싱, 미완성 잔여는 버퍼에 보관
- `appendFileSync`는 동기 flush → 부모가 즉시 봄
- `handle.done` 후 **최종 1회 읽기**로 잔여 줄 회수 후 폴링 중단
- 각 도구 호출에 monotonic `seq` 부여(디스패처가 순차 증가) → 프론트가 `tool_use_start`(실행 중) → `tool_result`(✓완료/✗실패) 상태를 `seq`로 매칭해 갱신

**사이드카 라인 스키마** (NDJSON):
```json
{"seq":1,"event":"tool_use_start","toolName":"get_issue_detail","args":{"issueKey":"EX-2"}}
{"seq":1,"event":"tool_result","toolName":"get_issue_detail","isError":false,"result":"{...}"}
```

**`tool` SSE 이벤트** (run-ai-compose → route → API → web):
```json
{"seq":1,"phase":"start","toolName":"get_issue_detail","args":{...}}
{"seq":1,"phase":"result","toolName":"get_issue_detail","isError":false}
```
(result의 raw `result` 문자열은 SSE로 전부 보내지 않고, 표시에 필요한 요약만. 영속용 권위 데이터는 done에서 처리 — 아래 참조.)

### 4. 영속 (widgets 패턴 미러)

- 라이브 `event: tool` = 휘발성 UX
- **권위 데이터**: API가 forward한 `progress`(위임) + `tool` 이벤트를 도착 순서대로 누적 → `done` 시 `home_message.tool_calls` JSONB 컬럼에 병합 리스트로 저장
- 위임 라벨은 사이드카에 없으므로(스트림 전용), 영속 리스트는 **API가 누적한 두 채널 병합본**이 권위. 사이드카 at-done 읽기는 누락 방지 fallback.
- 복원(`GET /home/sessions/{id}/messages`) 시 `tool_calls`를 그대로 재현 → 사용자가 라이브로 본 것과 동일
- 라이브 테일이 불안정해도 영속은 동작(graceful degradation)

영속 데이터 형태 (`tool_calls` JSONB):
```json
[
  {"kind":"delegation","label":"이슈 전문가에게 위임 중"},
  {"kind":"tool","toolName":"get_issue_detail","status":"done","detail":"EX-2"},
  {"kind":"tool","toolName":"update_status","status":"done","detail":"EX-2 → 진행중"}
]
```

## 변경 레이어

| 레이어 | 파일 | 변경 |
|---|---|---|
| ai-agent MCP | `src/mcp/workplace-mcp-server.ts` | 디스패처 핸들러 래핑 → `seq` 부여 + 사이드카 append (env `WORKPLACE_TOOL_USE_LOG_PATH` 없으면 no-op) |
| ai-agent config | `src/agent/mcp-config.ts` | `toolUseLogPath` 옵션 → env 주입 |
| ai-agent compose | `src/agent/run-ai-compose.ts` | 사이드카 경로 생성(workDir) + 라이브 테일러 + `onTool` 콜백 + done에 `toolCalls` 포함 |
| ai-agent route | `src/routes/home.ts` | `event: tool` SSE 발행(onTool) |
| API parse | `home/outbound/AiAgentComposeClient.java` | `tool` 이벤트 파싱 → `onTool` 콜백 |
| API service | `home/service/HomeComposeService.java` | `tool` 패스스루 + `progress`/`tool` 누적 → done 시 `tool_calls` 영속 |
| API DTO/entity | `home/dto/*`, jOOQ record | `tool_calls` 매핑 + 복원 응답에 포함 |
| DB | `db/migration/V83__home_message_tool_calls.sql` | `home_message.tool_calls JSONB NULL` 컬럼 + jOOQ regen |
| web 타입 | `src/types/home.ts` | `ChatTurn.steps`, `HomeMessage.toolCalls`, `ToolStep` 타입 |
| web 스트림 | `src/hooks/queries/useHomeQueries.ts` | `tool` 이벤트 → `onTool` 콜백 |
| web 세션 | `src/hooks/useChatSession.ts` | steps 누적(start→result seq 매칭) + 복원 |
| web 렌더 | `src/components/ai/AIChatPanel.tsx` (+ 신규 `ToolStepList.tsx`) | 인라인 중첩 렌더(firehub `ToolCallDisplay` 스타일) + 도구 라벨/아이콘 맵 |

## 도구 라벨/아이콘 맵

firehub `TOOL_LABELS` 패턴을 workplace 도구셋으로 포팅(프론트, 신규 파일). 예:
- `get_issue_detail` → 🔍 이슈 상세 조회
- `update_status` → ✏️ 상태 변경
- `add_comment` → 💬 코멘트 작성
- `list_issues` → 📋 이슈 목록 조회
- `search_drive` → 🔍 드라이브 검색
- (미정의 도구는 fallback 🔧 + 도구명)

`detail` 추출(firehub `formatToolDetail` 미러): `issueKey`, `status`, 쿼리 키워드 등 표시에 유용한 인자 1~2개를 요약.

## 구현 순서

1. **라이브 캡처 먼저 (검증 게이트)**: 디스패처 래퍼 + 사이드카 경로 주입만 넣고, 격리 ai-agent(7071, tsx)에서 실제 위임 쿼리("EX-2 상태를 진행중으로 바꿔줘") 1건 실행 → 사이드카 파일 확인. 목적: (a) 서브에이전트 도구가 실제로 기록되는지 end-to-end 확인, (b) 실제 toolName/args/result 형태 확보 → 필터·라벨·detail 추출을 추측이 아닌 실데이터로 튜닝, (c) 라이브 테일 타이밍 검증. **mocked 테스트는 모델 실제 도구 시퀀스를 증명 못 함(라이브 LLM 스모크 게이트).**
2. ai-agent 라이브 테일러 + `onTool` + `event: tool` SSE
3. API: `tool` 파싱 + 누적 + V83 마이그레이션 + jOOQ regen + 영속/복원
4. web: 타입 + 스트림 + 세션 누적 + 인라인 렌더 + 라벨맵
5. E2E(Playwright, `tool` SSE + done.toolCalls + 복원 mocking) + 라이브 스모크 재확인

## 테스트 전략

- **ai-agent (vitest)**: 디스패처 래퍼 사이드카 write, 테일 파서(부분 줄/seq 매칭), run-ai-compose `onTool` 발행
- **API (JUnit 통합)**: `tool` SSE 파싱, 누적+영속, 복원에 `tool_calls` 포함, jOOQ 매핑
- **web (Playwright E2E)**: `tool` 이벤트 스트림 mocking → 인라인 중첩 렌더 검증(라벨/상태/들여쓰기), done.toolCalls 영속 후 복원 재현, 입력→처리→출력 파이프라인
- **라이브 스모크**: 실제 위임 쿼리로 end-to-end(필수 게이트)

## 리스크 / 고려사항

- **append 경쟁**: `#351` 주석대로 MCP는 단일 stdio·순차 호출이라 경쟁 없음. 서브에이전트가 별도 MCP 프로세스를 쓰더라도 같은 env(같은 경로)로 같은 파일에 append, 도구 호출은 에이전트 내 순차 → 교차 인터리브 위험 낮음. `seq`로 start/result 매칭하므로 순서 흔들려도 복원 가능.
- **위임-도구 상관**: 두 채널의 정확한 부모-자식 매핑은 타임스탬프 없이 도착 순서에 의존. 순차 위임 전제라 v1 충분. 병렬 위임이 생기면 재검토.
- **라이브 테일 폴링 지연**: 150ms 폴링이라 도구 표시가 최대 ~150ms 지연. UX상 무해.
- **stale dist 함정**: MCP 도구는 `dist/mcp/...`에서 spawn(`ai-agent-stale-dist-mcp` 메모). 디스패처 변경 후 **반드시 `pnpm build`** 해야 라이브 반영. 검증은 격리 7071.
- **jOOQ regen**: `home_message` 컬럼 추가 → 메인 repo `generateJooq` 필요(공유 test DB 드리프트 시 codegen은 test DB 5435 겨냥). `home_message`를 select-star로 읽으면 regen 필수.

## 비목표 (YAGNI)

- 이슈/팀 채팅 경로 변경 (이미 step 표시 있음)
- 도구 결과 raw 데이터의 위젯화 (firehub의 차트 위젯 등) — 기존 `show_*` 위젯 경로 유지
- 도구 호출 취소/재시도 UI
- 위임 외 병렬 도구 실행 상관 추적
