# 이슈 하나 처리 (work-loop)

`SKILL.md` 3번에서 고른 이슈 하나를 처리한다. MAIN·notes 파일·보고 규칙(work-on 4번과 그 예외)·하지 않는 일·근거 이미지·스택 이름은 `SKILL.md` 「우선순위」대로다(아래에서 「우선순위」라고 부른다). 아래에는 work-loop 에서 더하는 것만 적는다.

순서: 시작 → 워크트리 → 이해 → 질문 판단 → 설계·구현 → 리뷰 → 커밋 하나로 합치기 → 브랜치 라이브 검증 → PR → PR 리뷰 대기 → 검토 대기. 본문 지시로 회차를 나눠 하는 이슈(또는 그런 부모의 하위)는 맨 아래 「본문 지시 회차」 순서를 따른다.

**먼저 갈래를 본다** — 이 이슈의 PR(`gh pr list --state all --search "<이슈 키> in:title" --json number,state,body,headRefName,url,title` 에서 제목이 `<이슈 키> ` 로 시작하는 것 중 가장 최근 것 — 검색은 `WP-12` 로 `WP-123` 도 찾는다)이 있고 그 본문의 `개발: <username>` 줄이 내(1번 신원 확인의 username)가 아니면, 나는 그 PR 의 검토자다. GitHub 계정이 아니라 genia-works 신원으로 가른다 — AI 들이 GitHub 계정 하나를 같이 쓸 수 있다 — 아래 1~11번 대신 「PR 리뷰·머지」 절을 따른다(이미 머지·닫힌 PR 이어도 — 내가 구현할 이슈가 아니다). 내가 만든 PR 이거나 PR 이 없으면 1번부터다. `gh` 가 준비되지 않았으면 「우선순위」대로 `AUTH_REQUIRED` 로 멈춘다.

**notes 파일**(`MAIN/.work-loop/state/notes/<이슈 키>.md`) — 다음 부르기나 대화 요약 뒤에도 여기서 이어 한다.
- `마지막 완료 단계`: 단계를 마칠 때마다 그 번호와 이름으로 고친다(예: `7. 커밋 하나로 합치기`). PR 을 두고 상대를 기다리면 개발자는 「PR 리뷰 대기」, 검토자는 「PR 수정 대기」(`SKILL.md` 3번이 이 값으로 고른다).
- `브랜치`·`PR`: 브랜치 이름과 PR 번호·주소.
- `리뷰한 base`·`리뷰한 HEAD`(검토자): 리뷰를 마친 때의 `git merge-base origin/main HEAD` 와 HEAD. 다시 부탁받으면 그 뒤 달라진 것만 본다(「PR 리뷰·머지」 3번).
- `검증한 HEAD SHA`: 8번을 통과한 커밋(`git -C <워크트리> rev-parse HEAD`). 그 뒤 브랜치가 바뀌면 지운다.
- 「내가 정한 것」 목록과 단계별 시도 횟수. 11번에서 모은다.

### 1. 시작

- notes 파일이 있으면 `마지막 완료 단계` 다음 단계부터 이어 한다(내 행의 note·진행률도 이어받는다). 「PR 리뷰 대기」면 새 글을 읽고 2번(브랜치를 origin 에 맞춤) 뒤 3번 끝의 갈래(머지됨 → 11번, 고칠 것 → 6번)로 간다. 없으면 2번부터다.
- 새 글로 고른 이슈는 보고하기 **전에** 새 글부터 읽고(`get_issue_chat` — 읽는 법은 work-on 4번), `WORKING` 으로 되돌리는 보고(work-on 4번 — note 에 이어서 할 일, `message` 에 받은 답·요청 확인)를 **한 번만** 한다. 멈추라는 글이면 「우선순위」대로 `PAUSED` 로 보고하고 끝낸다. 답할 것이 없는 글이면(검토 대기 보고·인사 등) 보고하지 않고 「답하지 않고 넘긴 글」(`SKILL.md` 3번)로 적고 끝낸다.
- 그 밖에는 `report_agent_work({ issueKey, state: 'WORKING', note: '<한 줄 요약>' })` 로 시작을 알린다.

### 2. 워크트리

- 이슈 전용 워크트리 `MAIN/.claude/worktrees/<이슈 키>` 에서 일한다. 브랜치는 `<커밋 타입>/<소문자 이슈 키>`(예: `feat/wp-123`, `fix/wp-123` — 타입은 저장소 커밋 규칙의 것)다. 이미 있으면(`git -C MAIN worktree list`) 그것을 쓴다.
- 이 이슈의 **열린 PR** 이 있으면(맨 위 갈래에서 본 내 PR) 새로 만들지 않고 그 PR 의 브랜치(`headRefName`)를 받아 쓴다. 원격 브랜치가 다른 곳에서 바뀌었을 수 있으니 로컬 브랜치를 늘 `origin/<브랜치>` 로 맞추고 시작한다(`git fetch origin` 뒤 `git reset --hard origin/<브랜치>` — 워크트리에 커밋 안 한 변경이 없을 때만).
- 만들기 전에 폴더가 MAIN 에서 git 무시인지 본다: `git -C MAIN check-ignore -q .claude/worktrees/x`. 무시가 아니면 `MAIN/.git/info/exclude` 에 `.claude/worktrees/` 한 줄을 덧붙인다(로컬 전용 — 저장소의 `.gitignore` 는 이 일로 고치지 않는다). 안 하면 워크트리 폴더가 MAIN 에 추적 안 된 폴더로 보인다.
- 없으면 최신 origin/main 에서 만든다: `git -C MAIN fetch origin` 뒤 `git -C MAIN worktree add .claude/worktrees/<이슈 키> -b <브랜치> origin/main`. 의존성 설치는 `.work-loop/project.md` 를 따른다.
- **main 작업 폴더에서 브랜치를 만들거나 바꾸지 않는다**(같은 저장소의 사람 세션과 공유한다). 모든 수정은 워크트리 안에서 한다.

### 3. 이해

- `get_issue_detail({ issueKey })` 로 본문·완료 기준을 읽고, 부모 에픽·연결 이슈도 `get_issue_detail` 로 읽는다.
- 이슈 챗의 앞선 글(질문과 답, 요청, 검토자의 리뷰)도 읽는다. 1번에서 읽은 새 글이 있으면 그것부터 반영한다.
- 검토 대기 이슈에 사람이 새 요청을 남겼으면 같은 이슈의 추가 작업으로 이 순서를 다시 돈다(PR 이 머지됐으면 새 워크트리와 새 브랜치를 최신 origin/main 에서 만든다 — 머지된 브랜치 이름이 원격에 남아 있으면 뒤에 `-2` 처럼 붙인다).
- PR 리뷰 대기 중에 검토자의 글이 왔으면 읽고 갈래를 정한다: 머지했다 → 11번. 고칠 것이나 「main 반영 필요」를 남겼다 → 열린 PR 의 브랜치에서 고쳐 6번부터 다시 한다(새 PR 을 만들지 않는다). main 반영은 7번의 rebase 로 한다 — 검토자는 브랜치를 고치지 않는다.

### 4. 질문 판단

- UI/UX·아키텍처·설계·접근 방안에서 명확하지 않은 부분이 있으면 묻는다. 묻기 직전 `state: 'INPUT_REQUIRED'` + note 에 질문 한 줄, `message` 에 질문과 고를 수 있는 짧은 선택지·추천을 적는다. 그리고 이 이슈는 멈추고 이번 부르기를 끝낸다(답은 다음 확인에 `pendingForMe` 로 들어온다).
- 사용자에게 보이는 화면을 바꾸는 이슈는 전·후 시안을 만들어 질문에 첨부해 묻는다(「우선순위」의 근거 이미지·파일 규칙대로).
- 그 밖의 결정은 스스로 내리고 「내가 정한 것」에 적는다.

### 5. 설계·구현

- superpowers 가 있으면(사용 가능한 스킬에 `superpowers:brainstorming` 이 있으면) brainstorming → writing-plans → subagent-driven-development 로 한다.
  - brainstorming 의 질문은 4번 기준에 해당할 때만 4번처럼 사람에게 묻고, 나머지는 스스로 답한다. 설계 승인처럼 사람의 답을 기다리는 단계는 스스로 승인하고 「내가 정한 것」에 적는다. 브라우저 시안 도우미처럼 사람의 응답이 필요한 제안은 건너뛴다.
  - 마무리 스킬(finishing-a-development-branch)은 쓰지 않는다 — 6~11번이 대신한다.
- 없으면 이 스킬 폴더의 `without-superpowers.md` 대로 한다(첫 실행에 한 번 설치 안내 포함).

### 6. 리뷰

- 브랜치 전체(origin/main 과의 차이)에 `/code-review medium` → `/simplify` 를 돌리고 지적을 반영한다.
- 반영 뒤 `MAIN/.work-loop/project.md` 의 테스트 명령(바뀐 범위별)을 돌린다. 실패하면 고친다.

### 7. 커밋 하나로 합치기

- `git fetch origin` 뒤 브랜치가 origin/main 을 포함하지 않으면(`git merge-base --is-ancestor origin/main HEAD` 실패) `git rebase origin/main` 하고 테스트를 다시 돌린다.
  - 충돌은 내가 모두 푼다 — 양쪽의 뜻을 살려 합치고, 동작이 걸린 충돌이면 이슈 본문·main 쪽 커밋의 이슈를 읽고 둘 다 맞게 한다. 어느 쪽 뜻을 살릴지 정할 수 없으면 4번처럼 묻는다. 마이그레이션 번호는 `.work-loop/project.md` 7번대로다.
  - 푼 충돌(파일·어떻게 합쳤나)은 notes 파일에 적고 10번 `message` 에 쓴다.
- 브랜치의 커밋을 하나로 합친다(`git reset --soft $(git merge-base origin/main HEAD)` 뒤 커밋). 메시지는 저장소의 커밋 규칙을 따르고 이슈 키를 넣는다.

### 8. 브랜치 라이브 검증

- `MAIN/.work-loop/project.md` 가 없으면 `report_agent_work({ issueKey, state: 'BLOCKED', note: '이 저장소의 검증 방법이 없습니다 — .work-loop/project.md' })` 로 멈춘다(브랜치·워크트리는 남긴다).
- project.md 대로 합친 브랜치(이 워크트리)를 격리 로컬 스택(API·웹·DB)으로 띄운다(이름은 「우선순위」대로 `work-loop`). 다른 세션이 쓰는 포트는 건드리지 않고 겹치지 않는 포트를 쓴다.
- 이슈의 완료 기준을 한 줄씩 **실제로 해 본다**. 화면이면 브라우저로 조작하고 전·후 스크린샷을 남긴다. API 면 실제 요청을 보내고 요청·응답을 요약한다. 테스트 통과는 동작의 근거로 치지 않는다.
- 근거는 「완료 기준 → 확인 결과」로 정리한다(11번 `message` 에 쓴다). 사람이 그것만 보고 동작을 믿을 수 있어야 한다. 스크린샷은 11번 보고에 첨부한다(「우선순위」의 근거 이미지·파일 규칙대로).
- 통과하면 notes 파일에 `검증한 HEAD SHA` 를 적는다. 실패하면 원인을 고쳐 6~8번을 되풀이한다(통과 전에는 PR 을 올리지 않는다 — 「우선순위」).
- 앞서 통과한 뒤 main 반영(7번 rebase)만 한 경우에는, 충돌을 푼 곳이 닿는 완료 기준만 다시 해 본다(충돌이 없었으면 다시 하지 않는다 — 합친 결과의 회귀는 9번 게이트가 본다).
- 로컬에서 검증할 수 없는 이슈(문서만 바뀜, 운영에서만 재현 등)는 「로컬에서 검증할 수 없음」과 이유를 근거에 적고, `검증한 HEAD SHA` 를 적은 뒤 9번으로 간다.
- 다 쓴 스택은 내린다(`LIVE_STACK_NAME=work-loop … down`).

### 9. PR

- 로컬 브랜치 HEAD 가 notes 파일의 `검증한 HEAD SHA` 와 같을 때만 올린다. 다르거나 없으면 8번으로 돌아간다.
- 올리기 직전에 `git fetch origin` — 브랜치가 origin/main 을 포함하지 않으면 7번으로 돌아간다. 검토자는 최신 main 을 포함하지 않은 브랜치를 머지하지 않고 돌려보낸다.
- `git push --force-with-lease -u origin <브랜치>` — pre-push 게이트가 돈다(`.work-loop/project.md` 3번 — 10분 이상 걸릴 수 있다). 게이트가 실패하면 고쳐 6번부터 다시 한다. 다시 올리는 PR 이면 같은 명령으로 브랜치만 갱신한다.
- PR 이 없으면 `gh pr create --base main --head <브랜치> --title "<이슈 키> <이슈 제목>" --body-file <파일>`. 본문 첫 줄은 `개발: <내 username>`(맨 위 갈래가 이 줄로 개발자를 가린다), 그 아래 이슈 링크, 완료 기준별 확인 결과, 「내가 정한 것」, 남은 위험이다. notes 파일에 `PR` 을 적는다.

### 10. PR 리뷰 대기

- 검토자(「우선순위」)가 없으면 기다리지 않고 11번으로 간다 — 보고에 PR 주소를 넣어 사람이 리뷰·머지하게 한다. 워크트리·브랜치는 지우지 않는다(머지 전이다).
- 검토자가 담당자에 없으면 `update_issue` 로 더한다(기존 담당자 유지 — `get_issue_detail` 의 username 을 함께 넘긴다). 이유는 「우선순위」대로 `add_comment` 로 남긴다(예: 「PR #12 리뷰·머지를 <검토자> 에게 맡깁니다」).
- `report_agent_work({ issueKey, state: 'SCHEDULED', note: 'PR #<번호> 리뷰 대기', message: '<PR 주소> 검토 부탁드립니다 — <바뀐 것 한두 줄>' })` — `nextRunAt` 은 넣지 않는다. 다시 올린 PR 이면 `message` 에 고친 것을 적는다. notes 파일의 `마지막 완료 단계` 를 「PR 리뷰 대기」로 적고 이번 부르기를 끝낸다. 검토자의 글이 오면 3번에서 이어진다.

### 11. 검토 대기

- 검토자가 머지했으면 `gh pr view <번호> --json state,mergeCommit` 로 `MERGED` 와 머지 커밋을 확인한다(아니면 검토자에게 이슈 챗으로 묻고 10번처럼 기다린다).
- `report_agent_work({ issueKey, state: 'REVIEW', note: '<머지 커밋> 머지 — 검토 대기', message: '<보고>' })` 로 올린다. 검토자가 없어 머지 전이면 note 를 「PR #<번호> — 사람 리뷰·머지 대기」로 한다. 보고에는 PR·머지 커밋, 완료 기준별 확인 결과(요청/응답 요약, 스크린샷은 `fileIds` 로 첨부), 「내가 정한 것」 목록, 남은 위험을 적는다. `message` 길이·나눠 보내기·되풀이 금지는 work-on 4번.
- 머지됐으면 이 이슈의 워크트리·로컬 브랜치와 notes 파일을 지운다(main 에 들어갔고 보고에 다 담았으므로). 먼저 `cd MAIN` 으로 워크트리 밖에 나온 뒤 `git -C MAIN worktree remove .claude/worktrees/<이슈 키>`, `git -C MAIN branch -D <브랜치>`(GitHub 에서 머지돼 로컬 main 에는 들어 있지 않으니 `-d` 는 거절된다). 원격 브랜치는 지우지 않는다.
- DONE·gitlab push·배포는 「우선순위」대로 하지 않는다 — 사람이 한다.

### PR 리뷰·머지 (검토자)

이 이슈의 열린 PR 을 다른 AI·사람이 만들었고 내가 담당자일 때다(맨 위 갈래). notes 파일·워크트리 위치는 같다(`MAIN/.claude/worktrees/<이슈 키>`, 브랜치는 PR 의 `headRefName`). 검토자는 리뷰와 머지 판단만 한다 — PR 브랜치를 고치거나 rebase 하거나 push 하지 않는다. 고칠 것과 main 반영은 개발자에게 돌려보낸다.

1. **시작**: PR 이 이미 머지·닫혔으면 새 글만 읽는다 — 나에게 묻거나 부탁한 글이면 상태 없이 `report_agent_work({ issueKey, message })` 로 답하고, 아니면(개발자의 검토 대기 보고 등) 「답하지 않고 넘긴 글」(`SKILL.md` 3번)로 적고 끝낸다. 열린 PR 이면 위 1번과 같다(새 글부터 읽고 `WORKING`).
2. **받기**: `git -C MAIN fetch origin` 뒤 워크트리가 없으면 `git -C MAIN worktree add .claude/worktrees/<이슈 키> -B <브랜치> origin/<브랜치>`, 있으면 그 안에서 `git reset --hard origin/<브랜치>`. 의존성 설치는 `.work-loop/project.md` 를 따른다.
3. **리뷰**: 이슈 본문·완료 기준, PR 본문, 개발자의 근거를 읽고 브랜치 전체(origin/main 과의 차이)에 `/code-review medium` 을 돌린다. 근거가 모자라거나 의심스러우면 8번처럼 격리 스택으로 직접 확인한다.
   - 다시 부탁받은 PR 이고 notes 파일에 `리뷰한 base`·`리뷰한 HEAD` 가 있으면 처음부터 다시 리뷰하지 않는다 — `git range-diff <리뷰한 base>..<리뷰한 HEAD> origin/main..HEAD` 로 그 뒤 달라진 것(고친 것·충돌을 푼 곳)만 보고, 그 부분에 리뷰를 돌린다. 옛 커밋을 찾을 수 없으면 전체를 다시 본다.
   - 리뷰를 마치면 notes 파일에 `리뷰한 base`(`git merge-base origin/main HEAD`)·`리뷰한 HEAD` 를 적는다.
4. **반려**: 고칠 것이 있으면(5번의 「main 반영 필요」 포함 — 함께 있으면 한 글에) `gh pr review <번호> --request-changes --body '<고칠 것>'`, `report_agent_work({ issueKey, state: 'SCHEDULED', note: 'PR #<번호> 수정 대기', message: '<고칠 것 — 파일·이유>' })`(`nextRunAt` 없음), `마지막 완료 단계` 를 「PR 수정 대기」로 적고 끝낸다. 개발자가 고쳐 다시 부탁하면 2번부터 다시 한다.
5. **main 포함 확인**: 리뷰를 통과해도 `git fetch origin` 뒤 브랜치가 origin/main 을 포함하지 않으면(`git merge-base --is-ancestor origin/main HEAD` 실패) 머지하지 않고 4번처럼 반려한다(「main 반영 필요 — 최신 origin/main 위로 rebase 해 다시 올려 주세요」, 충돌이 날 파일을 알면 함께). 충돌이 없어도 그렇다 — 머지되는 트리가 개발자의 push 때 pre-push 게이트를 통과한 트리와 같아야 한다(GitHub 은 충돌만 없으면 낡은 브랜치도 머지해 준다). 내가 rebase 하지 않는다.
6. **머지**: 머지 직전에 다시 `git fetch origin` — 그 사이 origin/main 이 바뀌어 포함하지 않게 됐으면 5번처럼 반려한다. 포함하면 `gh pr review <번호> --approve`(PR 을 만든 GitHub 계정과 같은 계정이라 승인이 거절되면 대신 `gh pr comment <번호> --body '검토자 <내 username> 승인'`) 뒤 `gh pr merge <번호> --merge --match-head-commit <리뷰한 HEAD> --subject "merge: <이슈 키> <이슈 제목>"`(그 사이 누가 브랜치를 바꿨으면 거절된다). 머지가 거절되면 2번부터 다시 한다(브랜치 보호가 다른 계정의 승인을 요구해 거절되면 `BLOCKED` + 이유).
7. **알림**: `report_agent_work({ issueKey, state: 'REVIEW', note: '<머지 커밋> 머지 — 검토 대기', message: '<PR> 을 머지했습니다(<머지 커밋>) — 리뷰 결과, 남은 위험' })`. 이 글이 개발자를 깨운다. 그 뒤 워크트리·로컬 브랜치·notes 파일을 위 11번처럼 지운다.
- 같은 단계가 3번 되풀이돼도 풀리지 않으면 아래 「막힘」대로다. DONE·gitlab push·배포는 하지 않는다.

### 막힘

- 같은 단계가 3번 되풀이돼도 풀리지 않으면(테스트·검증 실패, 혼자 풀 수 없는 머지 충돌 등) `report_agent_work({ issueKey, state: 'BLOCKED', note: '<이유 한 줄>', message: '<시도한 것, 브랜치·워크트리 위치>' })` 로 남기고 이번 부르기를 끝낸다(다음 확인에 다음 이슈로 넘어간다).
- 머지 전 단계에서 막히면 main 은 그대로다. 브랜치·워크트리(올렸으면 PR 도)는 지우지 않고 남겨 둔다.
- 할 수 없는 일·시도했지만 실패한 일도 `BLOCKED` 다(끝내는 상태는 보고하지 않는다 — 「우선순위」).

### 본문 지시 회차

지시한 이슈와 그 하위의 회차다(`SKILL.md` 「본문 지시」 — 허락 범위·바꾸지 못하는 규칙·이해 남기기는 거기). 예: 지시한 이슈가 「평일마다 09:00 에 그날 하위를 만들어 처리하고, 마감이 지난 하위는 닫는다」, 그 하위가 「한 회차에 영역 하나를 탐색하고 찾은 결함은 버그로 등록한다」.

**코드를 바꾸는 회차**는 이 절 대신 1~11번대로 하고 검토 대기로 끝낸다(닫지 않는다). 아래는 코드를 바꾸지 않는 회차(탐색·정리·하위 관리)다. 날짜는 `TZ=Asia/Seoul date +%F`, 요일은 `TZ=Asia/Seoul date +%a` 로 구한다.

1. **시작**: 1번과 같다.
2. **이해**: 이슈 본문과, 하위면 부모 본문을 읽는다. 지시한 이슈의 notes 파일에 「이해를 남김」이 없으면 「본문 지시」대로 남기거나 묻는다.
3. **이번 회차**: 본문이 시킨 만큼 하고, 결과를 근거(본 것·만든 이슈 키·스크린샷)와 함께 모은다 — 스크린샷은 만든 결함 이슈나 회차 보고에 첨부한다. 본문에 시간 상한이 없어도 한 회차는 60분을 넘기지 않는다. 지시한 이슈의 회차는 먼저 닫을 하위를 닫고(5번) 그다음 만들 것을 만든다.
   - **만들기 전에 찾는다**(`SKILL.md` 「이슈 만들기·담당 바꾸기」): 같은 범위에서 닫힌 것까지 찾아 없을 때만 `create_issue` 한다.
     - 회차마다 만드는 하위: 이번 몫을 이미 만들었는지 본다 — 날마다면 `list_issues({ parent: <이슈 키>, reporter: 'me', assignee: 'any', status: 'TODO,IN_PROGRESS,DONE,CANCELED', createdFrom: <오늘>, createdTo: <오늘> })`(주기가 다르면 기간을 그 주기로). 제목·마감을 사람이 바꿔도, 사람이 따로 만든 하위가 있어도 틀리지 않는다. 없고 이번이 본문의 실행일이면 본문이 정한 제목·본문·우선순위·마감, 담당 `me`, 부모 이 이슈로 만든다. 놓친 회차는 따라잡지 않는다.
     - 찾은 결함 같은 부모 없는 이슈: `list_issues({ projectKey, assignee: 'any', q: <제목 핵심어> })` 로 같은 것이 없을 때만, 부모 없이(본문이 따로 정하면 그대로) 만들고 본문에 찾은 회차(이 이슈 키)를 적는다.
4. **양보**: 본문에 다음 회차 시점이 있으면 `report_agent_work({ issueKey, state: 'SCHEDULED', nextRunAt: '<KST ISO 시각>', note: '<다음에 할 일 한 줄>', message: '<이번 회차 결과>' })` (`nextRunAt` 규칙은 work-on 4번). 마감이 있는 이슈는 그 날을 넘는 시각을 잡지 않는다 — 그날 할 일이 끝났으면 5번으로 닫는다. 어디까지 했는지·다음 대상은 notes 파일에 남긴다. 지시한 이슈는 사람이 닫을 때까지 늘 여기로 끝난다.
5. **닫기**: 본문이 닫으라고 한 때에만, 「본문 지시」가 허락한 닫기만 한다. 끝내는 상태는 보고하지 않는다 — 요약을 남긴 뒤 `update_issue` 로 이슈 상태를 바꾸면 서버가 내 행을 함께 끝낸다.
   - 요약은 그 이슈에 내 작업이 진행 중이면 그 이슈에 상태 없이(`report_agent_work({ issueKey, message: '<마지막 요약 — 회차 수·만든 이슈·남은 것>' })`), 시작 전인 하위(지시한 이슈가 닫는 마감 지난 하위)면 지시한 이슈의 회차 `message` 에 적는다 — 시작 전 하위에 보고하면 작업 중으로 바뀌어 일한 것처럼 남는다.
   - 그다음 `update_issue({ issueKey, status: 'DONE' })` — 한 번도 손대지 못한 하위는 `CANCELED`.
   - 실패하면 한 번 다시 하고, 그래도 실패하면 그 이슈를 `BLOCKED` + note 에 이유로 둔다(작업 중으로 남기지 않는다).
   - 닫은 이슈의 워크트리·브랜치·notes 파일은 11번처럼 지운다.
