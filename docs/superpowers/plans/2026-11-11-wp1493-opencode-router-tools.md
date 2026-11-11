# WP-1493 opencode AI Chat 라우터 도구 축소 — 구현 계획

이슈 본문(WP-1493)이 명세다. apps/workplace-ai-agent. 기반 브랜치 fix/wp-1489(opencode-config·opencode-runner 변경 유지).

## 배경
- opencode 홈 AI Chat(assistant) primary 가 `'workplace*'` 로 전 도구(~130)를 받아 128개 상한 모델(genia/gpt-6-luna)이
  `Invalid 'tools': array too long ... maximum length 128 ... 130` 으로 거절한다.
- Claude 러너는 메인 스레드를 `ASSISTANT_ROUTER_TOOLS`(56)로 좁히고 쓰기는 서브에이전트에 위임한다. opencode 는 `'*': false` 가 `task` 도
  꺼서 좁히지 않았다(WP-351). 1.19.5 실측: `task: true` 를 이름으로 적으면 다시 켜지고, 서브에이전트는 primary 가 끈 workplace 도구도 쓴다.

## 1. config (agent/opencode-config.ts)
- assistant + allowSubagents 면 primary tools = `{ '*': false, task: true, workplace_<라우터 도구>: true }`(`routerToolsFor` 재사용).
  allowFileRead 의 `read` 예외 유지. 다른 프로필·위임 없는 실행은 종전(`'workplace*'`).
- 선행 실측(1.19.5 `opencode debug agent`/`agent list`)에서 발견: 내장 서브에이전트 `general` 은 bash·edit·write·webfetch·모든 MCP 도구가 열려 있다.
  task 를 켜면 라우터가 그쪽으로 위임해 경계를 우회할 수 있으므로 primary `permission.task` = `{'*':'deny', <우리 서브에이전트>:'allow'}` +
  `general`·`explore` 를 `disable: true`(둘 다 실측으로 동작 확인).
- WP-351 주석 정정.

## 2. 라우터 프롬프트 (agent/assistant-system-prompt.ts)
- opencode 도 위임 전용 규칙(Claude 와 같은 본문)을 받고, 위임 도구 표기만 `task` 로(`Agent`·general-purpose 문구 제외).
- 종전 opencode primary 직접 제안 규칙 확인: #842(propose 오류 시 고쳐 재제안)는 제안 도구가 있는 서브에이전트 agent.md 에 있어야 한다 —
  issue-agent 에만 빠져 있어 추가하고 subagent-loader.test 로 고정. #843(승인 결과)은 라우터만 이전 대화를 보므로 라우터 규칙(위임 재시도)으로 남는다.

## 3. 자식 세션 이벤트 (agent/opencode-runner.ts, run-ai-chat.ts)
- 이미 session.created/updated 의 parentID 로 자식 세션 part 를 받는다 — 부모가 알려진 세션이면 편입(손자까지)으로 넓힌다.
- 확인 카드(hostBridge)는 같은 stdio MCP 프로세스라 실행 단위 그대로 동작 — 자식 세션 propose 도구 줄이 onTool 로 나가는지 테스트.
- 자식 session.error: 실행을 끝내지 않고 `opencode_subsession_error` 로 원인을 남긴다(가짜 서버 실측으로 의미 확인 — 자식 실패는 task 결과로 primary 에 가고 primary 가 이어 답한다).
- 위임 도구 `task` 는 tool_use 로만 내고 onTool 도구 줄에는 싣지 않는다(Claude 의 Agent 와 같게). run-ai-chat 의 위임 라벨은 `Agent`·`task` 둘 다.
- filterNarration: primary 의 task 호출 단계 text 는 결과 전 서술이라 지금처럼 걸러진다(변경 없음). 자식 세션 text 는 대상 아님.

## 리뷰 반영
- result 텍스트(정상·오류·압축 실패)는 primary 글만 쌓는다.
- kill·timeout 은 primary 와 알려진 자식 세션을 모두 abort(best effort).
- 위임 뒤 라우터 글: run-ai-chat 이 위임 뒤 라우터 delta 를 모아 두고 위임 답이 있으면 버린다(Claude 도 같은 이중 답 구조라 두 러너 공통으로 적용).
- 런타임 가드: task 의 subagent_type 이 우리 서브에이전트가 아니면 opencode_unknown_subagent 경고 + abort + 실패로 끝냄.
- 위임 도구 이름은 opencode-config 의 OPENCODE_DELEGATION_TOOL 한 곳에서 export.
- 도구 수 로그는 runInput 기준, 와일드카드 primary 는 null.

## 4. 도구 수 로그
- 실행마다 `opencode_tool_count`(profile, primary 수·와일드카드 여부, 서브에이전트 최대 수).

## 문서
- apps/workplace-ai-agent/CLAUDE.md 「AI Chat 라우터 도구 (WP-351)」 opencode 항목 갱신.

## 테스트·검증
- 새 테스트를 고치기 전 코드에서 먼저 돌려 실패를 기록한 뒤 구현.
- vitest: buildOpencodeConfig(assistant+allowSubagents ⇒ task + 라우터 도구만, 와일드카드 없음, task 허용 목록·내장 끄기 / 다른 프로필 그대로),
  러너 자식 세션(진행·오류·제안·손자·task 미러 제외·도구 수 로그), run-ai-chat task 라벨, 프롬프트, 서브에이전트 #842 규칙.
- 로컬 실측: 가짜 OpenAI 호환 서버(128개 초과 시 실제와 같은 400) + 가짜 workplace API + 실제 OpencodeRunner + opencode 1.19.5 바이너리.
- ai-agent typecheck·lint·전체 vitest.
