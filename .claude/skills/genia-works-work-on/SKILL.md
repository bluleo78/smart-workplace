---
name: genia-works-work-on
description: Use when the user asks you to work on a genia-works issue (e.g. "WP-377 작업해", "/genia-works-work-on WP-377") — reports your progress with report_agent_work so the issue shows up under AI 위임 작업 with its state, note and progress.
---

# genia-works 이슈 작업 보고

인자: 이슈 키(예: `WP-377`). genia-works MCP 가 연결돼 있어야 한다.

1. `get_issue_detail` 로 이슈를 읽는다. `agentWork` 에 내 진행 중 작업이 있으면 그 note·진행률을 이어받는다. 내가 담당자가 아니면 사용자에게 담당자로 지정할지 묻는다(보고는 담당자만 가능).
2. `report_agent_work({ issueKey, state: 'WORKING', note: '<한 줄 요약>' })` — 시작. 이슈가 TODO 면 서버가 진행 중으로 바꾼다.
3. 작업 중 규칙
   - 사용자에게 질문하기 **직전** `state: 'INPUT_REQUIRED'`, note 에 질문 한 줄.
   - 인증·권한이 필요해 진행할 수 없으면 `state: 'AUTH_REQUIRED'`, note 에 필요한 것 한 줄(예: 어떤 토큰·권한).
   - 할 일 목록을 세우거나 바뀌면 `stepsDone`/`stepsTotal` 갱신, 큰 단계마다 note 갱신. `stepsDone` 은 항상 `stepsTotal` 과 함께 보낸다(`stepsDone` 만 보내면 서버가 거부한다).
   - 막히면 `state: 'BLOCKED'` + note 에 이유.
   - 사용자가 멈추라고 하면 `state: 'PAUSED'`.
   - 사용자가 답하거나 필요한 인증·권한을 받아 다시 진행할 수 있게 되면 바로 `report_agent_work({ issueKey, state: 'WORKING', note: '<이어서 할 일 한 줄, 예: A안으로 진행>' })` 로 작업 중으로 되돌린다(이슈를 쓰기 전까지는 "답변 필요"·"인증 필요" 로 남고, 특히 인증 필요는 사용자 답 글로도 풀리지 않는다). 새 note 를 함께 보내야 한다 — 없으면 앞의 note 가 지워져 빈 채로 남는다.
4. 마무리: 사용자에게 "완료 처리 / 검토 대기" 를 묻는다.
   - 완료면: (선택) 먼저 `report_agent_work({ issueKey, state: 'COMPLETED', message: '<최종 요약>' })` 로 작업을 완료로 끝내며 요약을 이슈 채팅에 남긴 뒤, `update_issue({ issueKey, status: 'DONE' })` 를 호출한다. 순서가 반대면 안 된다 — 완료·취소된 이슈에는 보고할 수 없다(409).
   - 검토 대기면: `report_agent_work({ issueKey, state: 'REVIEW', note: '<PR·커밋 링크 요약>' })`.
   - `message` 를 붙인 호출은 호출할 때마다 이슈 채팅에 새 메시지를 남긴다. 재시도할 때 같은 `message` 를 반복해 보내지 않는다.
5. 작업을 끝내는 그 밖의 경우(모두 기록이 종료된다)
   - 사용자가 그만두라고 하면 `report_agent_work({ issueKey, state: 'CANCELED' })`.
   - 내가 할 수 없거나 하지 않을 일이면 `state: 'REJECTED'`, `message` 에 이유.
   - 시도했지만 실패했으면 `state: 'FAILED'`, `message` 에 원인.
