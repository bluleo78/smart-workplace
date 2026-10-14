---
name: genia-works-work-on
description: Use when the user asks you to work on a genia-works issue (e.g. "WP-377 작업해", "/genia-works-work-on WP-377") — reports your progress with report_agent_work so the issue shows up under AI 위임 작업 with its state, note and progress.
---

# genia-works 이슈 작업 보고

인자: 이슈 키(예: `WP-377`). genia-works MCP 가 연결돼 있어야 한다.

1. `get_issue_detail` 로 이슈를 읽는다. `agentWork` 에 내 진행 중 작업이 있으면 그 note·진행률을 이어받는다. 내가 담당자가 아니면 사용자에게 담당자로 지정할지 묻는다(보고는 담당자만 가능).
2. `report_agent_work({ issueKey, state: 'WORKING', note: '<한 줄 요약>' })` — 시작. 이슈가 TODO 면 서버가 진행 중으로 바꾼다.
3. 하위 항목 확인: `list_issues({ parent: <이슈 키>, assignee: 'null' })` 로 담당자 없는 바로 아래 하위를 찾고(`get_issue_detail` 의 `children` 은 개수만 준다), 그중 열린 항목(DONE·CANCELED 제외)이 있으면 목록(번호·키·제목, 에픽이면 각 항목의 하위 수 `children.total`)을 만들어
   `report_agent_work({ issueKey, state: 'INPUT_REQUIRED', note: '담당자 없는 하위 n개 — 맡을지 확인', message: '<목록>\n\n함께 맡을까요? 「맡아」라고 하시면 전부, 번호로 답하시면 그것만 맡을게요.' })` 로 묻는다.
   - 이미 이 이슈 챗에 같은 하위 항목 질문을 남겼거나 답을 받았으면 다시 묻지 않는다(`get_issue_chat` 으로 확인).
   - 답이 「맡아」면 전부, 번호면 그 항목만 `update_issue({ issueKey: <하위 키>, assignees: ['me'] })` 로 맡는다. 서버는 담당자가 비어 있는 바로 아래 하위만 허용한다 — 사람이 담당한 하위는 묻지도 건드리지도 않는다.
   - 맡은 뒤 `report_agent_work({ issueKey, state: 'WORKING', note: '<맡은 항목 요약>' })` 로 되돌린다.
4. 작업 중 규칙
   - 사용자에게 질문하기 **직전** `state: 'INPUT_REQUIRED'`, note 에 질문 한 줄.
   - 질문한 뒤에는 `get_issue_chat({ issueKey })`(after 생략)으로 내 마지막 글 이후 새 글을 읽어 답을 확인한다. 더 있으면 응답의 `next` 를 `after` 로 넘긴다. 첨부는 `read_file({ source: 'issue_chat', issueKey, messageId, attachmentId })`.
   - 여러 이슈를 돌며 답을 기다릴 때는 `list_issues({ pendingForMe: true })` 로 새 글이 온 이슈만 고른다.
   - 인증·권한이 필요해 진행할 수 없으면 `state: 'AUTH_REQUIRED'`, note 에 필요한 것 한 줄(예: 어떤 토큰·권한).
   - 할 일 목록을 세우거나 바뀌면 `stepsDone`/`stepsTotal` 갱신, 큰 단계마다 note 갱신. `stepsDone` 은 항상 `stepsTotal` 과 함께 보낸다(`stepsDone` 만 보내면 서버가 거부한다).
   - 막히면 `state: 'BLOCKED'` + note 에 이유.
   - 사용자가 멈추라고 하면 `state: 'PAUSED'`.
   - 사용자가 답하거나 필요한 인증·권한을 받아 다시 진행할 수 있게 되면 바로 `report_agent_work({ issueKey, state: 'WORKING', note: '<이어서 할 일 한 줄, 예: A안으로 진행>' })` 로 작업 중으로 되돌린다(이슈를 쓰기 전까지는 "답변 필요"·"인증 필요" 로 남고, 특히 인증 필요는 사용자 답 글로도 풀리지 않는다). 새 note 를 함께 보내야 한다 — 없으면 앞의 note 가 지워져 빈 채로 남는다. 답을 읽고 되돌릴 때는 `message` 로 받은 답을 한 줄로 확인해 남긴다(예: 「1, 2번을 맡았어요」) — 내 글이 남아야 그 이슈가 `pendingForMe` 에서 빠진다.
5. 마무리: 사용자에게 "완료 처리 / 검토 대기" 를 묻는다.
   - 완료면: (선택) 먼저 `report_agent_work({ issueKey, state: 'COMPLETED', message: '<최종 요약>' })` 로 작업을 완료로 끝내며 요약을 이슈 채팅에 남긴 뒤, `update_issue({ issueKey, status: 'DONE' })` 를 호출한다. 순서가 반대면 안 된다 — 완료·취소된 이슈에는 보고할 수 없다(409).
   - 검토 대기면: `report_agent_work({ issueKey, state: 'REVIEW', note: '<PR·커밋 링크 요약>' })`.
   - `message` 를 붙인 호출은 호출할 때마다 이슈 채팅에 새 메시지를 남긴다. 재시도할 때 같은 `message` 를 반복해 보내지 않는다.
6. 작업을 끝내는 그 밖의 경우(모두 기록이 종료된다)
   - 사용자가 그만두라고 하면 `report_agent_work({ issueKey, state: 'CANCELED' })`.
   - 내가 할 수 없거나 하지 않을 일이면 `state: 'REJECTED'`, `message` 에 이유.
   - 시도했지만 실패했으면 `state: 'FAILED'`, `message` 에 원인.
