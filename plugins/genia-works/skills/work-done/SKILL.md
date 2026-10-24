---
name: work-done
description: Use when the user wants to wrap up a genia-works issue (e.g. "WP-377 마무리해", "/genia-works:work-done WP-377 검토") — summarizes the result, ends the work with report_agent_work (검토·완료·취소·실패·반려) and cleans up the worktree, branch and local resources used for the issue.
---

# genia-works 이슈 작업 마무리

work-on 의 짝이다. 인자: 이슈 키(예: `WP-377`)와, 있으면 끝낼 방식 — `검토`(review)·`완료`(done)·`취소`(cancel)·`실패`(fail)·`반려`(reject). 아래 도구는 모두 genia-works MCP 서버의 도구다(이름 앞의 `mcp__…__` 는 연결 방식에 따라 다르다). 보고 규칙(note·`message`·되돌리기)은 work-on 4번과 같다.

## 1. 이슈 확인

- `get_issue_detail` 로 이슈를 읽는다. 내가 담당자가 아니거나(보고는 담당자만 가능) 이슈가 이미 DONE·CANCELED 면(409) 이슈에 보고할 수 없다 — 그렇다고 알리고, 2번 요약은 사용자에게만 보여 준 뒤 3·4번을 건너뛰고 5번 정리를 한다.
- 그 결과를 보고 필요한 것만 한 번에 함께 부른다.
  - `agentWork` 의 내 작업이 `INPUT_REQUIRED`·`AUTH_REQUIRED` 면 `get_issue_chat({ issueKey })` — 답이 왔는지 본다.
  - `children` 이 있고 `total > done` 이면 `list_issues({ parent: <이슈 키>, assignee: 'any', status: 'TODO,IN_PROGRESS' })` — 담당자와 상관없이 열린 하위를 찾는다. 부모를 먼저 끝내면 하위가 남고, 에픽은 열린 하위가 하나라도 있으면 서버가 DONE 을 거절한다.
- 답 없는 질문·열린 하위는 3번에서 함께 알린다.

## 2. 결과 요약

이 세션의 기록과 git 에서 사실만 모아 쓴다(기억나지 않는 것은 git·이슈에서 다시 읽는다).

- 커밋·머지 커밋(짧은 SHA와 제목), 지금 어느 브랜치에 있고 main 에 들어갔는지
- 바뀐 범위(앱·모듈·파일 묶음 단위)
- 돌린 테스트·검증과 결과 — 돌리지 못한 것은 못 했다고 적는다
- 내가 정한 것(사용자가 정하지 않았는데 내가 고른 것)
- 남은 일·후속 후보·알려진 위험

## 3. 끝낼 방식 정하기

- 인자로 받았으면 그대로 쓴다. 없으면 2번 요약을 보여 주고 「검토 대기 / 완료 / 취소 / 실패 / 반려」 중 무엇으로 끝낼지 묻는다(검토 대기·완료를 앞에 둔다).
- 1번에서 찾은 답 없는 질문·열린 하위가 있으면 함께 알리고, 그래도 끝낼지 확인한다. 열린 하위가 있는 에픽은 완료로 끝낼 수 없다 — 하위를 먼저 끝내거나 검토 대기로 끝내게 한다.

## 4. 보고

| 방식 | 호출 |
|---|---|
| 검토 대기 | `report_agent_work({ issueKey, state: 'REVIEW', note: '<커밋·머지 한 줄>', message: '<2번 요약>' })` |
| 완료 | `report_agent_work({ issueKey, state: 'WORKING', note: '<커밋·머지 한 줄>', message: '<2번 요약>' })` → `update_issue({ issueKey, status: 'DONE' })`. DONE 이 되면 서버가 진행 중 작업을 COMPLETED 로 닫는다 |
| 취소 | `report_agent_work({ issueKey, state: 'CANCELED', message: '<그만둔 이유·남긴 것>' })` — 사용자가 그만두라고 한 경우 |
| 반려 | `state: 'REJECTED'`, `message` 에 할 수 없거나 하지 않을 이유 |
| 실패 | `state: 'FAILED'`, `message` 에 원인과 시도한 것 |

- 이슈 상태를 바꾸는 것은 완료(DONE)뿐이다. 검토 대기는 작업을 이어 두고, 나머지는 작업 기록만 끝낸다.
- 완료는 검토 대기(REVIEW)로 보고하지 않는다 — REVIEW 는 맡긴 사람에게 검토 요청 알림을 보낸다. 상태를 빼지도 않는다 — 작업이 답변 대기로 남아 있으면 상태 없는 보고의 `message` 가 질문으로 저장돼 답변 필요 알림이 간다. 순서(보고 → DONE)를 바꾸지 않는다 — 완료된 이슈에는 보고할 수 없다(409).
- 완료에서 `update_issue` 가 실패하면 작업은 작업 중으로 남는다. 다시 보고하지 않는다 — 이유를 알리고, 고칠 수 있으면 `update_issue` 만 다시 하거나 사람이 DONE 으로 바꾸게 한다. 사람 검토가 필요해졌으면 검토 대기로 다시 끝낸다.

## 5. 리소스 정리

이 이슈를 하려고 만든 것만 지운다. 지우기 전에 목록(무엇을 지우고 무엇을 남기는지와 이유)을 사용자에게 보여 준다.

**찾기**
- 워크트리·브랜치: `git for-each-ref --format='%(refname:short) %(upstream:short) %(worktreepath)' refs/heads` 한 번으로 브랜치·upstream·워크트리 경로를 함께 보고, main 에 들어갔는지는 `git cherry main <브랜치>` 로 본다(`+` 로 시작하는 줄이 없으면 들어갔다 — main 이 rebase 로 펴져 SHA 가 바뀌어도 맞다. 스쿼시 머지라 `+` 가 남으면 `git diff --quiet <브랜치> main -- $(git diff --name-only main...<브랜치>)` 로 내용이 main 과 같은지 본다). 대상은 이 세션이 만든 것이다.
  - 이름에 이슈 키가 들었지만(대소문자 무시, 예: `.claude/worktrees/WP-377`, `ai/WP-377`, `wp-377-…`) 이 세션이 만들지 않은 것은 다른 세션(사람·work-loop)이 같은 이슈로 쓰는 중일 수 있다. 새 세션이라 누가 만들었는지 모를 때도 같다. 이것들은 목록으로 한 번에 묻고, 사용자가 지우라고 한 것만 지운다. `git worktree list --porcelain` 에 `locked` 인 워크트리는 지우지 않는다.
  - 키 바로 뒤에 숫자가 이어지면 다른 이슈다 — `WP-37` 을 정리할 때 `WP-377` 은 고르지 않는다.
- 이 이슈로 띄운 로컬 실행: 격리 스택·dev 서버·컨테이너·백그라운드 프로세스(이 세션에서 띄운 것만 — 포트·이름으로 남이 띄운 것과 가린다).
- 이 이슈로 만든 메모·임시 파일.
- 저장소가 정리 방법을 적어 두었으면(예: `.work-loop/project.md` 의 스택 내리기) 그대로 따른다.

**지워도 되는 조건**
- 브랜치: main 에 들어갔을 때만 지운다 — `git branch -d`, 거절되면(upstream 기준이거나 rebase·스쿼시로 SHA 가 달라서) 위에서 들어간 것을 확인했으니 `git branch -D`. 안 들어갔으면 지우지 않는다 — 검토 대기로 끝냈으면 위치만 알리고, 그 밖에는 main 에 없는 커밋 수(`git rev-list --count main..<브랜치>`)와 함께 지울지 묻는다.
- 원격 브랜치: upstream 이 있는(push 된) 브랜치의 원격 쪽은 지우지 않고 알리기만 한다. 지우라고 하면 그때 지운다.
- 워크트리: 커밋 안 된 변경이 있으면(`git -C <워크트리> status --porcelain` 이 비지 않음) 지우지 않고 무엇이 남았는지 보여 주며 묻는다. 브랜치를 남기면 워크트리도 남길지 함께 묻는다.

**지우는 법**
- 명령은 main 작업 폴더(`git rev-parse --path-format=absolute --git-common-dir` 의 부모)를 `git -C <main 작업 폴더>` 로 가리켜 부른다. 순서: `worktree remove <워크트리>` → 브랜치 지우기.
- 지울 워크트리가 이 세션의 작업 폴더면: 워크트리 진입 도구(EnterWorktree 등)로 들어왔으면 그 도구로 나오며 지운다. 세션이 그 워크트리에서 시작됐으면(명령이 매번 그 폴더에서 시작) 다른 정리를 모두 끝낸 뒤 **마지막 명령 하나**로 `git -C <main 작업 폴더> worktree remove <워크트리> && git -C <main 작업 폴더> branch -d <브랜치>` 를 부른다 — 그 뒤 명령은 폴더가 없어 실패하므로 더 부르지 않고 6번 알림은 글로만 한다.
- 워크트리 제거에 `--force` 는 쓰지 않는다. 거절되면 이유를 보여 주고 묻는다.

**건드리지 않는다**: main 작업 폴더의 브랜치(바꾸지도 지우지도 않는다), 근거로 남긴 이미지·기록.

## 6. 마무리 알림

끝낸 방식, 보고한 내용 한 줄, 지운 것과 남긴 것(남긴 이유)을 사용자에게 짧게 알린다. push·배포는 이 스킬이 하지 않는다 — 필요하면 그렇다고만 알린다.
