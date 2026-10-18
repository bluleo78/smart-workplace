# 이슈 하나 처리 (work-loop)

`SKILL.md` 3번에서 고른 이슈 하나를 처리한다. MAIN·notes 파일·보고 규칙(work-on 4번과 그 예외)·하지 않는 일·근거 이미지·스택 이름은 `SKILL.md` 「우선순위」대로다(아래에서 「우선순위」라고 부른다). 아래에는 work-loop 에서 더하는 것만 적는다.

순서: 시작 → 워크트리 → 이해 → 질문 판단 → 설계·구현 → 리뷰 → 커밋 하나로 합치기 → 브랜치 라이브 검증 → 머지 → main 재확인 → 검토 대기.

**notes 파일**(`MAIN/.work-loop/state/notes/<이슈 키>.md`) — 다음 부르기나 대화 요약 뒤에도 여기서 이어 한다.
- `마지막 완료 단계`: 단계를 마칠 때마다 그 번호와 이름으로 고친다(예: `7. 커밋 하나로 합치기`). 머지 조건을 기다리면 「main 머지 대기」.
- `검증한 HEAD SHA`: 8번을 통과한 커밋(`git -C <워크트리> rev-parse HEAD`). 그 뒤 브랜치가 바뀌면 지운다.
- 「내가 정한 것」 목록과 단계별 시도 횟수. 11번에서 모은다.

### 1. 시작

- notes 파일이 있으면 `마지막 완료 단계` 다음 단계부터 이어 한다(내 행의 note·진행률도 이어받는다). 「main 머지 대기」면 9번부터 다시 한다. 없으면 2번부터다.
- 사람의 새 글로 고른 이슈는 보고하기 **전에** 새 글부터 읽고(`get_issue_chat` — 읽는 법은 work-on 4번), `WORKING` 으로 되돌리는 보고(work-on 4번 — note 에 이어서 할 일, `message` 에 받은 답·요청 확인)를 **한 번만** 한다. 멈추라는 글이면 「우선순위」대로 `PAUSED` 로 보고하고 끝낸다.
- 그 밖에는 `report_agent_work({ issueKey, state: 'WORKING', note: '<한 줄 요약>' })` 로 시작을 알린다.

### 2. 워크트리

- 이슈 전용 워크트리 `MAIN/.claude/worktrees/<이슈 키>`, 브랜치 `ai/<이슈 키>` 에서 일한다. 이미 있으면(`git -C MAIN worktree list`) 그것을 쓴다.
- 만들기 전에 폴더가 MAIN 에서 git 무시인지 본다: `git -C MAIN check-ignore -q .claude/worktrees/x`. 무시가 아니면 `MAIN/.git/info/exclude` 에 `.claude/worktrees/` 한 줄을 덧붙인다(로컬 전용 — 저장소의 `.gitignore` 는 이 일로 고치지 않는다). 안 하면 워크트리 폴더가 MAIN 에 추적 안 된 폴더로 보인다.
- 없으면 최신 main 에서 만든다: `git -C MAIN worktree add .claude/worktrees/<이슈 키> -b ai/<이슈 키> main`. 의존성 설치는 `.work-loop/project.md` 를 따른다.
- **main 작업 폴더에서 브랜치를 만들거나 바꾸지 않는다**(같은 저장소의 사람 세션과 공유한다). 모든 수정은 워크트리 안에서 한다.

### 3. 이해

- `get_issue_detail({ issueKey })` 로 본문·완료 기준을 읽고, 부모 에픽·연결 이슈도 `get_issue_detail` 로 읽는다.
- 이슈 챗의 앞선 글(질문과 답, 요청)도 읽는다. 1번에서 읽은 사람의 새 글이 있으면 그것부터 반영한다.
- 검토 대기 이슈에 사람이 새 요청을 남겼으면 같은 이슈의 추가 작업으로 이 순서를 다시 돈다(새 워크트리를 최신 main 에서 만든다).

### 4. 질문 판단

- UI/UX·아키텍처·설계·접근 방안에서 명확하지 않은 부분이 있으면 묻는다. 묻기 직전 `state: 'INPUT_REQUIRED'` + note 에 질문 한 줄, `message` 에 질문과 고를 수 있는 짧은 선택지·추천을 적는다. 그리고 이 이슈는 멈추고 이번 부르기를 끝낸다(답은 다음 확인에 `pendingForMe` 로 들어온다).
- 사용자에게 보이는 화면을 바꾸는 이슈는 전·후 시안을 만들어 보이고 묻는다(시안 이미지는 「우선순위」의 근거 이미지 규칙대로).
- 그 밖의 결정은 스스로 내리고 「내가 정한 것」에 적는다.

### 5. 설계·구현

- superpowers 가 있으면(사용 가능한 스킬에 `superpowers:brainstorming` 이 있으면) brainstorming → writing-plans → subagent-driven-development 로 한다.
  - brainstorming 의 질문은 4번 기준에 해당할 때만 4번처럼 사람에게 묻고, 나머지는 스스로 답한다. 설계 승인처럼 사람의 답을 기다리는 단계는 스스로 승인하고 「내가 정한 것」에 적는다. 브라우저 시안 도우미처럼 사람의 응답이 필요한 제안은 건너뛴다.
  - 마무리 스킬(finishing-a-development-branch)은 쓰지 않는다 — 6~11번이 대신한다.
- 없으면 이 스킬 폴더의 `without-superpowers.md` 대로 한다(첫 실행에 한 번 설치 안내 포함).

### 6. 리뷰

- 브랜치 전체(main 과의 차이)에 `/code-review medium` → `/simplify` 를 돌리고 지적을 반영한다.
- 반영 뒤 `MAIN/.work-loop/project.md` 의 테스트 명령(바뀐 범위별)을 돌린다. 실패하면 고친다.

### 7. 커밋 하나로 합치기

- main 이 브랜치를 만든 뒤 바뀌었으면 `git rebase main` 하고 테스트를 다시 돌린다.
- 브랜치의 커밋을 하나로 합친다(`git reset --soft $(git merge-base main HEAD)` 뒤 커밋). 메시지는 저장소의 커밋 규칙을 따르고 이슈 키를 넣는다.

### 8. 브랜치 라이브 검증

- `MAIN/.work-loop/project.md` 가 없으면 `report_agent_work({ issueKey, state: 'BLOCKED', note: '이 저장소의 검증 방법이 없습니다 — .work-loop/project.md' })` 로 멈춘다(브랜치·워크트리는 남긴다).
- project.md 대로 합친 브랜치(이 워크트리)를 격리 로컬 스택(API·웹·DB)으로 띄운다(이름은 「우선순위」대로 `work-loop`). 다른 세션이 쓰는 포트는 건드리지 않고 겹치지 않는 포트를 쓴다.
- 이슈의 완료 기준을 한 줄씩 **실제로 해 본다**. 화면이면 브라우저로 조작하고 전·후 스크린샷을 남긴다. API 면 실제 요청을 보내고 요청·응답을 요약한다. 테스트 통과는 동작의 근거로 치지 않는다.
- 근거는 「완료 기준 → 확인 결과」로 정리한다(11번 `message` 에 쓴다). 사람이 그것만 보고 동작을 믿을 수 있어야 한다. 스크린샷은 「우선순위」의 근거 이미지 규칙대로 둔다.
- 통과하면 notes 파일에 `검증한 HEAD SHA` 를 적는다. 실패하면 원인을 고쳐 6~8번을 되풀이한다(통과 전에는 머지하지 않는다 — 「우선순위」).
- 로컬에서 검증할 수 없는 이슈(문서만 바뀜, 운영에서만 재현 등)는 「로컬에서 검증할 수 없음」과 이유를 근거에 적고, `검증한 HEAD SHA` 를 적은 뒤 9번으로 간다.
- 다 쓴 스택은 내린다(`LIVE_STACK_NAME=work-loop … down`).

### 9. main 머지

- `git -C MAIN rev-parse ai/<이슈 키>` 가 notes 파일의 `검증한 HEAD SHA` 와 같을 때만 머지한다. 다르거나 없으면 8번으로 돌아간다.
- 머지 전 확인: `"<이 스킬 폴더>/../../scripts/merge-ready" "<MAIN>" ai/<이슈 키>` 를 실행한다. MAIN 이 `main` 인지, 진행 중인 git 작업(머지·rebase·cherry-pick·revert)·스테이징한 변경이 없는지, MAIN 에서 바뀐 파일(추적 안 된 새 파일 포함)이 브랜치가 바꾼 파일과 겹치지 않는지, 브랜치가 `ai/*` 인지 본다. MAIN 은 사람이 쓰는 폴더라, 사람이 하던 일을 건드릴 수 있으면 기다린다.
- 무엇이든 출력하면(종료 코드가 0 이 아니면) 머지하지 않는다 — notes 파일의 `마지막 완료 단계` 를 「main 머지 대기」로 적고, note 「main 머지 대기 — main 작업 폴더 사용 중」으로 `WORKING` 을 둔 뒤, 같은 부르기에서 `SKILL.md` 3번의 다음 후보로 넘어간다(이 이슈는 다음 확인에 다시 시도한다).
- 아무것도 출력하지 않으면 `git -C MAIN merge --no-ff ai/<이슈 키> -m "merge: <이슈 키> <제목>"`. merge-ready 가 통과했으니 머지 전에는 MERGE_HEAD 가 없었다. 실패하면 MERGE_HEAD 를 다시 본다(`[ -e "$(git -C MAIN rev-parse --path-format=absolute --git-path MERGE_HEAD)" ]`) — 지금 있으면 이 머지가 남긴 충돌이다. 그때만 `git -C MAIN merge --abort` 로 되돌리고, 워크트리에서 main 위로 rebase 해 6번부터 다시 한다. MERGE_HEAD 가 없으면(머지가 시작도 못 함 — 예: 작업 폴더의 파일을 덮어쓰게 돼 git 이 거절) 되돌릴 것이 없다 — 아무것도 고치지 않고 「main 머지 대기」로 둔다.

### 10. main 재확인

- 검증한 브랜치와 머지 결과의 내용이 같으면(`git rev-parse ai/<이슈 키>^{tree}` 와 `main^{tree}` 가 같다 — 그 사이 main 이 안 바뀜) 다시 띄우지 않는다.
- 다르면 워크트리를 머지된 main 으로 옮겨(`git switch --detach main`) 스택을 다시 띄우고 완료 기준을 한 번 더 확인한다.
- 여기서 실패하면 다른 변경과 얽힌 것이다. `BLOCKED` + note 에 이유, `message` 에 머지 커밋과 실패한 기준을 적는다. 머지는 되돌리지 않는다.

### 11. 검토 대기

- `report_agent_work({ issueKey, state: 'REVIEW', note: '<머지 커밋> main 머지 — 검토 대기', message: '<보고>' })` 로 올린다. 보고에는 머지 커밋, 완료 기준별 확인 결과(스크린샷·요청/응답 요약), 「내가 정한 것」 목록, 남은 위험을 적는다. `message` 길이·나눠 보내기·되풀이 금지는 work-on 4번.
- 그 뒤 이 이슈의 워크트리·브랜치와 notes 파일을 지운다(main 에 들어갔고 보고에 다 담았으므로). 먼저 `cd MAIN` 으로 워크트리 밖에 나온 뒤 `git -C MAIN worktree remove .claude/worktrees/<이슈 키>`, `git -C MAIN branch -d ai/<이슈 키>`.
- DONE·push·배포는 「우선순위」대로 하지 않는다 — 사람이 한다.

### 막힘

- 같은 단계가 3번 되풀이돼도 풀리지 않으면(테스트·검증 실패, 혼자 풀 수 없는 머지 충돌 등) `report_agent_work({ issueKey, state: 'BLOCKED', note: '<이유 한 줄>', message: '<시도한 것, 브랜치·워크트리 위치>' })` 로 남기고 이번 부르기를 끝낸다(다음 확인에 다음 이슈로 넘어간다).
- 머지 전 단계에서 막히면 main 은 그대로다. 브랜치·워크트리는 지우지 않고 남겨 둔다.
- 할 수 없는 일·시도했지만 실패한 일도 `BLOCKED` 다(끝내는 상태는 보고하지 않는다 — 「우선순위」).
