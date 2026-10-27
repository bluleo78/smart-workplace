---
name: start-agent
description: Use when the user runs /genia-works:start-agent in an AI-identity session opened in that AI's home folder (e.g. ~/agents/kodi) — finds the projects this AI belongs to that have a connected repository, clones each into repos/<project key>, and starts one tmux window per project running /loop /genia-works:work-loop, so one AI works across several projects without mixing their repository rules.
---

# AI 띄우기 — 맡은 프로젝트마다 work-loop 세션

인자: `[--queue "<라벨>"]`(주면 각 work-loop 에 그대로 넘긴다 — 라벨에 큰따옴표 `"` 가 있으면 넘길 수 없어 멈추고 알린다). 아래 도구는 모두 genia-works MCP 서버의 도구다(이름 앞의 `mcp__…__` 는 연결 방식에 따라 다르다). 플러그인 스크립트는 이 스킬 폴더 기준 `../../scripts/` 에 있고, 경로는 따옴표로 감싸 부른다.

AI 하나가 여러 프로젝트를 맡는 방법이다. 이 세션(**에이전트 홈**)은 준비만 하고, 일은 프로젝트마다 따로 띄운 세션이 한다 — 세션 하나가 여러 저장소를 다루면 저장소마다 다른 `CLAUDE.md` 규칙이 한 대화에 섞이기 때문이다.

```
<에이전트 홈>/                 ← 이 세션을 연 폴더(예: ~/agents/kodi)
  repos/<프로젝트 키>/         ← 프로젝트마다 clone 하나(같은 저장소를 쓰는 프로젝트도 따로 — 저장소 잠금이 서로 막지 않게)
```

## 1. 확인

- `get_member({ username: 'me' })` 의 `kind` 가 `AGENT` 가 아니면 멈추고 「AI 신원으로 띄우세요 — `GENIA_WORKS_AS=<AI 이름> claude`」라고 알린다.
- `"<이 스킬 폴더>/../../scripts/gw-whoami"` 로 이 세션의 신원 이름(로컬 키 이름)을 읽는다. 띄울 세션에 같은 이름을 넘긴다. 실패하면 위와 같이 멈춘다.
- 지금 폴더가 git 저장소 안이면(`git rev-parse --is-inside-work-tree` 가 true) 멈추고 「에이전트 홈은 저장소 밖의 빈 폴더여야 합니다(예: `~/agents/<AI 이름>`)」라고 알린다.

## 2. 맡을 프로젝트

`list_projects` 를 끝까지 읽어(`hasMore` 면 `nextPage` 를 `page` 로) `viewerRole` 이 있고(내가 실제 멤버 — `viewerIsMember` 는 관리자면 멤버가 아니어도 true 라 쓰지 않는다) `repositoryUrl` 이 있는 프로젝트를 고른다. 「연결된 저장소」가 없는 프로젝트는 코드 작업 대상이 아니라 띄우지 않는다. 고를 것이 없으면 「연결된 저장소가 있는 프로젝트가 없습니다 — 프로젝트 설정 › 연결된 저장소에서 정하세요」라고 알리고 끝낸다.

## 3. 저장소 준비 — 프로젝트마다

`repos/<프로젝트 키>` 를 본다. 주소·브랜치는 프로젝트 설정에서 온 값이다 — 명령에 넣을 때 늘 큰따옴표로 감싸고 `--` 뒤에 둔다(서버가 셸 글자를 막지만 한 겹 더).
- **없으면** clone 한다: `git clone -- "<repositoryUrl>" "repos/<키>"`, `repositoryBranch` 가 있으면 `git clone --branch "<브랜치>" -- "<repositoryUrl>" "repos/<키>"`. 인증 실패면 그 프로젝트는 「clone 실패 — 이 컴퓨터의 git 자격 증명(예: `gh auth login`)으로 <주소> 에 접근할 수 있어야 합니다」로 적고 넘어간다(다른 프로젝트는 계속).
- **있으면** `git -C "repos/<키>" config --get remote.origin.url` 이 `repositoryUrl` 과 같은지 본다(`remote get-url` 은 `insteadOf` 로 바꾼 주소를 돌려줘 처음 넣은 주소와 달라 보일 수 있다). 다르면 건드리지 않고 「저장소 주소가 바뀌었습니다 — repos/<키> 를 지우거나 옮긴 뒤 다시 부르세요」로 적고 넘어간다. 같으면 `git -C "repos/<키>" fetch --prune origin` 을 한다 — 작업 브랜치·워크트리는 그 프로젝트의 work-loop 가 다룬다.
- **기본 브랜치가 바뀌었으면**(`repositoryBranch` 가 있고 `git -C "repos/<키>" branch --show-current` 와 다르면) 바뀐 것이 없는 clone(`git -C "repos/<키>" status --porcelain` 이 비었으면)만 `git -C "repos/<키>" checkout "<브랜치>"` 로 옮긴다. 바뀐 것이 있거나 실패하면 옮기지 않고 「기본 브랜치가 <브랜치> 로 바뀌었습니다 — repos/<키> 를 정리한 뒤 다시 부르세요」로 적는다(띄우기는 한다).
- 저장소에 `.work-loop/project.md` 가 없으면 「work-loop 안내(.work-loop/project.md)가 없습니다 — 테스트·검증 방법을 그 저장소에 적어 두세요」를 함께 적는다(띄우기는 한다).

## 4. 띄우기 — 프로젝트마다

`"<이 스킬 폴더>/../../scripts/agent-window" "<신원 이름>" "<키>" "<에이전트 홈>/repos/<키>" env "GENIA_WORKS_AS=<신원 이름>" claude --permission-mode bypassPermissions "/loop /genia-works:work-loop <키>"` 를 실행한다. `--queue` 를 받았으면 마지막 인자를 `"/loop /genia-works:work-loop <키> --queue \"<라벨>\""` 로 한다. 이 세션에 `GENIA_WORKS_API_URL` 이 있으면 `env` 뒤에 `"GENIA_WORKS_API_URL=<값>"` 도 넘긴다(운영이 아닌 서버 — 알림 감시가 같은 서버를 본다).
- `started <세션>` — 띄웠다. `exists <세션>` — 이미 그 창이 돌고 있어 건드리지 않았다(다시 부르면 새로 연결된 프로젝트만 더 띄운다). `<세션>` 은 tmux 가 실제로 쓰는 세션 이름이다.
- `no-tmux` — 멈추고 「tmux 가 필요합니다(예: `brew install tmux`)」라고 알린다. 대신 프로젝트마다 그 폴더에서 띄울 명령을 적어 준다.

## 5. 알리기

프로젝트마다 한 줄(키 · 저장소 · 브랜치 · clone/fetch · started/exists/실패 이유)로 표를 만들고, 끝에 「들여다보기: `tmux attach -t <세션>`」(4번에서 `agent-window` 가 알려 준 세션 이름)를 적는다. 연결된 저장소가 지워졌는데 창이 남은 프로젝트(창 이름은 있는데 2번에서 고르지 않은 키)는 「연결이 지워졌습니다 — 그 창의 work-loop 를 멈추세요」로 알린다. 창을 닫거나 저장소 폴더를 지우는 일은 하지 않는다.
