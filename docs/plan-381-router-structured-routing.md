# #381 Group A 캐리어 — 라우터 구조화 출력-라우팅 (결정적 강제-위임)

> 결정(2026-06-21): Group A의 "라우터가 위임 없이 응답/날조" 결함 10건을 하나의 결정적 메커니즘으로 해결.
> 대상: `apps/workplace-ai-agent`. 캐리어 #381, 동반 해결 #372 #388 #411 #417 #420 #427 #428 #434 #437.

## 1. 문제 (검증 완료)

`run-ai-compose.ts`는 도메인별 정규식·버퍼·사이드카 밴드에이드 ~20개의 묘지다(#383 #390 #400 #404 #405 #406 #408 #409 #410 #415 #421 #422 #423 #426 #429 #436 #439 #440 #441 …). **이들 거의 전부의 공통 목적 = "라우터(홈 비서)가 새어나온 자유 prose를 사용자에게서 숨기기"**:
- 라우터가 위임 없이 "삭제 제안 등록했습니다" 류 **성공 날조** (#427 #428 #434 #437 #372)
- 라우터 **위임 preamble** 노출("…에게 위임하겠습니다") (#440 #441 #410 #429 #388)
- 내부 SDK 용어·서브에이전트 식별자 노출 (#410 #421 #426 #379 #407)

근본원인: 라우터가 **모든 경우에 최종 prose를 직접 작성**하고, 그 prose가 그대로(혹은 정규식으로 불완전 sanitize되어) 사용자에게 스트리밍된다. 정규식·버퍼는 LLM 문장 변형을 못 따라가 회귀 반복(#440이 3차까지 감).

## 2. 검증된 아키텍처 사실

- 라우터의 직접 행동은 **3종뿐**: ① `show_*` 위젯 호출(show_my_tasks/show_issue_list/show_issue_detail/show_activity), ② `Agent` 위임, ③ 인사/종합 prose. (assistant-system-prompt.ts:26-27)
- **위젯은 라우터의 show_* 직접호출로만** 생성된다(subagent 내부 tool_use는 stream-json에 노출 안 됨 — 권위 확인). 도메인 읽기/쓰기는 전부 subagent 위임.
- stream-json에서 **최상위 tool_use(show_*, Agent)와 Agent tool_result는 보인다.** subagent 내부 도구만 안 보인다.
- `--allowed-tools` 좁히기는 무효(--dangerously-skip-permissions가 무력화) + subagent 무장해제 위험 → 도구 제한 방식 폐기.

## 3. 설계: 단일 불변식

> **라우터의 자유 prose는 사용자에게 절대 도달하지 않는다.**
> 사용자가 보는 것 = `{ show_* 가 만든 위젯 } + { 텍스트: respond_chat 인자 OR subagent 결과 OR 결정적 fallback }`.

라우터는 한 턴에 다음 중 행동을 한다(prose 자유 작성은 금지):
| 의도 | 행동(도구) | 사용자 텍스트 | 위젯 |
|---|---|---|---|
| 인사·능력질문·종합 | **`respond_chat(text)`** (신규 도구) | text 인자 | 없음 |
| 목록·요약 조회 | `show_*` | (선택) 동반 respond_chat | show_* |
| 도메인 작업/조회 | `Agent` 위임 | subagent tool_result 텍스트 | 없음 |
| 아무 도구도 안 부름 | — | **결정적 fallback** "요청을 처리하지 못했습니다." | 없음 |

### 결정적 enforcement (run-ai-compose)
1. **라우터 text_delta를 사용자에게 emit하지 않는다.** (모든 prose-sanitizer/버퍼/preamble 차단 로직 삭제 대상)
2. 스트림에서 구조화 결과 수집:
   - `respond_chat` tool_use → `userText = input.text` (partial tool_use input으로 스트리밍 가능; v1은 완료 시 일괄 emit 허용)
   - `Agent` tool_use → `delegated=true`; **위임 답은 사이드카에서** (아래 ⚠️)
   - `show_*` tool_use → 기존 parseComposeLines 위젯 경로

> ⚠️ **위임 답 출처 (검증으로 확정):** Agent **tool_result는 collapsed(요약·축약)** 되고 `compose-parser`가 추출하지도 않는다(`run-ai-compose.ts:512` 주석 + 테스트 픽스처에 tool_result 부재로 확인). 현재 위임 답 = 라우터의 `result` synthesis = **이 PR이 죽이려는 바로 그 prose.** → tool_result에 의존 불가.
> **해결: subagent가 최종 답을 사이드카에 기록한다.** propose_*/unassign 이 이미 쓰는 사이드카 idiom 그대로. 신규 MCP 도구 `submit_response(text)` 를 각 subagent agent.md 의 **마지막 필수 단계**로 추가 → 핸들러가 `WORKPLACE_RESPONSE_PATH` 사이드카에 기록 → run-ai-compose 가 위임 후 그 파일을 **권위 답**으로 읽는다. 사이드카 없음(=subagent가 submit_response 누락) → 결정적 fallback.
3. 최종 텍스트 우선순위: subagent 결과(`submit_response`) > `respond_chat` > (위젯만 있으면 빈 텍스트) > fallback. (위임 답이 라우터 단순응답보다 우선.)
4. 어떤 도구도 안 불렀고 respond_chat도 없으면 → fallback. **"위임 없이 prose 날조" = 구조적으로 도달 불가.**

### 신규 도구 `respond_chat`
- MCP가 아닌 **라우터 전용 마커 도구**. API 미호출, 입력 `{text:string}`를 그대로 답으로 사용.
- assistant 프로파일 allowed-tools에 추가, agent.md/subagent에는 미노출(라우터만).
- 시스템 프롬프트: "절대 자유 텍스트로 답하지 말 것. 단순 응답은 반드시 `respond_chat`로."

## 4. 삭제/유지 분류

**삭제 가능(목적=prose 억제, 불변식으로 대체):**
- `SUBAGENT_ID_RE` `KOREAN_AGENT_ID_RE` `SUBAGENT_DIRECT_MSG_RE` `AGENT_TOOL_ABSENT_RE` `HOME_ROUTER_PREAMBLE_RE` `ENUM_PARENTHETICAL_RE` 및 적용부
- `isMailQuery`/`mailQueryBuffer`, `isDriveQuery`/`driveQueryBuffer`, `isContactsQuery`, `deltaCarry` 버퍼 + 관련 flush
- `isWikiDeleteQuery`/`isDriveUnsupportedQuery`/`isProposalApprovalHallucination` 직접-응답 override (→ subagent가 "미지원" 답하거나 respond_chat)
- "Agent 도구 비활성/현재 환경에서…" 내부메시지 정규식 override

**유지(기능적, prose와 무관):**
- `pendingActionPath` 사이드카(확인 카드) + propose 흐름
- `unassign_self` 성공/에러 사이드카 + userId 재처리(#406 #378 #415) — 실제 작업 수행/정정
- `filterIssueDetailWidgets`(#404) — 위젯 존재 검증
- `isCreatedDateFilterQuery` early-return — 잘못된 show_issue_list 방지(또는 respond_chat로 이전)
- 화이트리스트(`checkSubagentWhitelist`)+kill

## 5. UX 영향 (사용자 승인됨)
- **위임 답변은 토큰 스트리밍 안 됨** — subagent 완료 후 tool_result로 한 번에 도착. (단순 turn의 latency/UX 저하, 사용자 사전 동의.)
- `respond_chat`는 partial tool_use input으로 스트리밍 가능(v2). v1은 일괄 emit.

## 6. 테스트 전략 (run-ai-compose.test.ts = 87 케이스)
- 기존 테스트는 합성 NDJSON 스트림을 onLine에 주입하는 방식 → **라이브 스택 불요**, 동일 방식으로 신규 로직 검증.
- 분류:
  - **재작성**: prose-누수/preamble/override 케이스 → 이제 "라우터 prose 미도달 + 올바른 구조화 결과" 단언으로 변경.
  - **유지**: 위젯·pending_action·unassign·whitelist 케이스.
  - **신규**: respond_chat 경로, "도구 없음 → fallback", Agent tool_result → userText, show_*+respond_chat 콤보.
- 단계: (a) respond_chat 도구 + enforcement 추가하고 신규 테스트 green → (b) 밴드에이드 한 묶음씩 삭제하며 해당 테스트를 불변식 단언으로 이관 → (c) 전체 87 재정렬. 각 단계 typecheck+test green 유지.

## 7. 롤아웃/검증
- 워크트리 `feat/ai-agent-router-guard`. 단위테스트로 1차 검증.
- 머지 후 격리 7071(tsx, 빌드불요) + api 9090로 라이브 위임 1~2건 실측(메모리 레시피). 라우터 prose 미노출·subagent 결과 표시 확인.
- 머지 후 inspector 재실행으로 Group A 멤버 10건 일괄 재검증 → 해소분 close.

## 8b. 구현 스펙 (확정)

### 신규 MCP 도구 2개 (tools.ts, assistant 프로파일)
- **`respond_chat({text})`** — **라우터 전용**(subagent frontmatter 미포함). 단순 인사·능력질문·종합 응답을 제출. `WORKPLACE_ROUTER_RESPONSE_PATH` 사이드카에 `{text}` 기록(first-write-guard), ack 반환.
- **`submit_response({text})`** — **각 subagent 전용**(8개 agent.md frontmatter tools 에 추가, 라우터 allowed-tools 미포함). subagent 의 **마지막 필수 단계**. `WORKPLACE_SUBAGENT_RESPONSE_PATH` 사이드카에 기록.
- 두 핸들러는 stream 비노출이어도 MCP 서버에서 실행되어 파일을 쓴다(propose_* 사이드카와 동일 원리).
- mcp-config.ts: 두 경로를 env 로 child 에 전달(pendingActionPath 패턴).

### run-ai-compose onLine (단순화)
- **라우터 text_delta 를 onText 로 emit 하지 않는다**(핵심 불변식). delta 누적·sanitize·버퍼(mail/drive/carry) 전부 제거.
- 유지: `assistant`>`tool_use`>`Agent` 감지 → `checkSubagentWhitelist`(위반 kill) + `delegated=true` + `onProgress(label)`.

### run-ai-compose handle.done 후 (해결 순서)
1. `policyDeny` → throw (유지)
2. unassign 복합 재처리(#406) + unassign error canonical override(#378) + simple-unassign 미처리 가드(#415) (유지 — 기능적)
3. `pendingAction` 사이드카 읽기(유지)
4. **답 텍스트 결정**: `submitResponse 사이드카 존재 → 그 text` (위임 답 우선) → `elif respond_chat 사이드카 → 그 text`(pure_chat) → `else fallback "요청을 처리하지 못했어요. 다시 시도해 주세요."`
5. `onText(answerText)` 1회 emit(v1 일괄) + widgets = parseComposeLines + filterIssueDetailWidgets(#404 유지)
6. return `{ fullText: answerText, widgets, pendingAction }`

### 삭제 (must-remove — early-return 으로 새 경로 차단)
`isMailQuery && !delegated` override / `isContactsQuery && !delegated` override / `isWikiDeleteQuery` override / `isDriveUnsupportedQuery` override / SDK-leak 정규식 override + 관련 detector 함수(isMailQuery·isContactsQuery·isWikiDeleteQuery·isDriveUnsupportedQuery·isDriveQuery) + 모든 delta sanitize 상수(SUBAGENT_ID_RE·KOREAN_AGENT_ID_RE·SUBAGENT_DIRECT_MSG_RE·AGENT_TOOL_ABSENT_RE·HOME_ROUTER_PREAMBLE_RE·ENUM_PARENTHETICAL_RE) + 버퍼(mailQueryBuffer·driveQueryBuffer·deltaCarry).

### 유지 (기능적·prose 무관)
`isCreatedDateFilterQuery` early-return / pendingAction / unassign 일체 / filterIssueDetailWidgets / whitelist+kill / `isProposalApprovalHallucination`(phantom 승인 가드, 정상 흐름 미차단).

### 시스템 프롬프트 (assistant-system-prompt.ts)
- 라우터: "**절대 자유 텍스트로 답하지 마세요.** 단순 응답은 반드시 `respond_chat(text)`. 도메인은 `Agent` 위임(위임 시 너는 respond_chat 호출 금지 — 서브에이전트가 답한다). 표시는 show_*."
- 각 subagent agent.md: "**마지막에 반드시 `submit_response(최종 사용자 답변)` 를 호출**하라. 자유 텍스트로 끝내지 마라." + tools 에 `mcp__workplace__submit_response` 추가.

## 8. 열린 질문 (검토)
- Q1: `respond_chat` v1 스트리밍 — 일괄 emit(단순) vs partial-input 스트리밍(복잡)? → **권장 일괄(v1), 스트리밍은 후속.**
- Q2: 밴드에이드 삭제를 이번 PR에 전부 vs 불변식만 추가하고 삭제는 후속 정리 PR? → **권장: prose-누수류는 이번에 삭제(불변식이 보장), 기능성은 유지.** 한 PR에 묶되 단계적 커밋.
- Q3: 라우터가 show_* + Agent를 한 턴에 모두 쓰면 텍스트는 subagent 결과 우선(위젯은 show_*). 확정?
