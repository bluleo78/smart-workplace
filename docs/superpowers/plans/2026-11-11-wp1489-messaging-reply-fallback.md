# WP-1489 메시징 실행이 답장 없이 끝날 때 대신 답하기 — 구현 계획

이슈 본문(WP-1489)이 명세다. apps/workplace-ai-agent.

## A. 답장 없이 끝날 때 대신 답하기
- `agent/run-messaging-agent.ts`(및 run-messaging-ai.ts·run-messaging-catchup.ts 등 같은 경로가 있으면 함께)에서 한 실행 동안
  답장 도구(`add_channel_message`·`propose_create_issue`·`propose_create_event`) 중 하나라도 **성공**했는지 추적한다.
  도구 호출·결과는 러너 이벤트(runner-events.ts)·claude-sdk-runner·opencode-runner 가 내는 이벤트에서 얻는다 — 두 러너 모두.
- 성공한 답장이 없이 끝나면: 모델의 마지막 텍스트가 있으면 그 텍스트를, 없으면 「요청을 처리하지 못했습니다. 다시 말씀해 주세요.」를
  그 AI 이름으로 같은 채널(스레드 실행이면 그 스레드)에 올린다. 오류로 끝난 실행도 안내를 올린다.
  올리는 방법은 기존 add_channel_message 도구가 API 를 부르는 경로(같은 AI 토큰/클라이언트)를 재사용한다 — 새 API 를 만들지 않는다.
- 답장 도구가 성공한 실행에서는 아무것도 더 올리지 않는다(중복 금지).

## B. 메시징 실행 기록 로그
- 기존 반복 작업 로그(`recurring_run_trace`, grep)와 같은 모양으로 실행마다 한 줄:
  channelId, agentId, model, outcome(ok/error), toolCalls 수·이름, replied(답장 도구 성공 여부), fallbackUsed, durationMs. 메시지 본문 금지.

## C. 할 수 없는 요청 안내
- `agent/messaging-system-prompt.ts` 에 원칙 추가: 가진 도구로 할 수 없는 요청(예: 이슈 필드 변경)이면 add_channel_message 로
  할 수 없다고 짧게 밝히고 방법(이슈 화면에서 직접 바꾸기, 이슈를 만들어 맡기기 등)을 안내한다.

## 테스트(vitest, 기존 run-messaging-agent.test.ts 패턴)
- 답장 도구 없이 끝남(텍스트 있음 → 그 텍스트, 텍스트 없음 → 안내), 오류로 끝남 → 안내 — 각각 채널(스레드)에 올라감.
- 답장 도구 성공 → 추가 게시 없음.
- 실행 기록 로그 필드.
- 프롬프트에 원칙 문구 포함(기존 프롬프트 테스트가 있으면 거기에).
