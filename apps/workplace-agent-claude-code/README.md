# workplace-agent-claude-code

Works 가 띄우는 AI Pod 의 작업 공간 이미지다(WP-1252). runner(`apps/workplace-agent-runner`)가 Pod 를 만들면, 이 이미지의 엔트리포인트가 Claude Code·플러그인·저장소·work-loop 칸을 사람 손 없이 띄우고 지킨다. Pod 와 무엇을 주고받는지는 [agent-pod-contract.md](../../docs/integrations/agent-pod-contract.md)에 있다.

## 들어 있는 것

- 베이스 `mcr.microsoft.com/playwright:v1.60.0-noble`. 개발용 작업 공간이라 DHI 규칙의 예외다(사유는 Dockerfile 머리에 있다).
- tmux, git, gh, glab(GitLab — 사용 통계·업데이트 확인 끔), jq, tini, OpenJDK 21, docker CLI·compose v2, pnpm(corepack)
- Claude Code `2.1.316`(npm 전역 설치, `DISABLE_AUTOUPDATER=1`)
- 언어 서버 jdtls, typescript-language-server
- 플러그인 8개: 빌드할 때 `/home/agent` 에 받아 이미지에 넣는다. 버전은 [plugins.lock](plugins.lock)에 고정한다. 받은 버전이 lock 과 다르면 빌드가 실패한다.
- 사용자 `agent`(UID/GID 1001)

## 엔트리포인트 (`bin/entrypoint`, 함수는 `bin/lib.sh`)

1. 필수 파일·env(`/run/genia/config.json`, `/run/genia/agent-key`, `GENIA_AGENT_NAME`)를 확인한다. 없으면 이유를 한 줄 남기고 종료 1. `/work` 아래 폴더를 만든다.
2. genia-works 마켓플레이스를 이 Works 주소(`GENIA_WORKS_API_URL` 의 origin + `/claude/marketplace.json`)로 맞춘다. 그 주소에 닿으면 이미지에 넣어 둔 주소와 같든 다르든 지우고 다시 더한 뒤 genia-works 를 받는다(늘 서버의 버전). 닿지 않으면 이미지에 넣어 둔 것을 그대로 쓴다. 템플릿에 새로 넣은 플러그인도 받는다. 그다음 플러그인 스크립트 폴더를 찾아 플러그인 공용 함수(`gw-lib.sh`)를 읽는다 — 이 뒤로는 키 저장·검사·경로·파일 쓰기를 플러그인과 같은 규칙으로 한다.
3. `~/.claude/settings.json` 을 매번 새로 쓴다. 넣는 것: 모델, 켤 플러그인, 마켓플레이스(genia-works 는 2번에서 정한 주소·claude-plugins-official), genia-works MCP 주소(`GENIA_WORKS_MCP_URL`).
4. `~/.claude.json` 에 온보딩 완료·bypass 확인을 적고, AI 폴더와 저장소 폴더를 신뢰한다고 적는다. 상위 폴더를 신뢰하면 하위 폴더도 신뢰된다.
5. AI 키를 플러그인의 `gw-keys add` 로 둔다(형식 검사, 600). git 신원을 정하고, GitHub 토큰은 표준 입력으로 넘겨 `gh auth login` 한 뒤 `gh auth setup-git` 하고, GitLab 토큰은 호스트마다 git 자격 증명 도우미가 그때그때 파일을 읽게 한다(WP-1276). 그보다 앞서(1단계 뒤) 위치의 추가 CA(`/run/genia/ca/ca.crt`)가 있으면 시스템 CA 와 합친다.
6. dind 소켓을 최대 60초 기다린다. 없으면 경고만 남긴다.
7. 맡은 프로젝트마다 진행한다: 저장소 받기 → 저장소의 Playwright 버전에 맞는 chromium 받기 → `agent-project start` 로 칸 띄우기. 다 띄운 뒤 `agent-events ensure` 로 알림 감시 창을 한 번 챙긴다.
8. 60초마다 감독한다. 칸 상태를 tmux 에서 한 번 읽어(`agent-window --states`) 죽었거나 빠진 칸만 다시 띄우고, 6일이 넘은 칸은 새로 시작하고, 끝에 알림 감시 창을 한 번 챙긴다.
9. SIGTERM 을 받으면 칸마다 SIGTERM 을 보내고 최대 40초 기다린 뒤 tmux 를 끄고 종료 0. work-loop 가 멈춰도(DRAIN) 엔트리포인트는 끝내지 않는다.

## 다른 이미지와 함께 쓰는 파일

`bin/lib.sh`·`bin/agent-screen` 은 Gen:iA Code 이미지([workplace-agent-genia-code](../workplace-agent-genia-code))도 그대로 COPY 해 쓴다(그 이미지 전용 함수는 `lib-genia.sh` 가 덮어쓴다). 함수 이름·인자를 바꾸면 그 이미지의 테스트도 돌린다.

## 테스트·빌드

```sh
pnpm --filter @smart-workplace/workplace-agent-claude-code test   # node --test tests/*.test.mjs (tmux 필요)
docker build --platform linux/amd64 apps/workplace-agent-claude-code
```

빌드하려면 네트워크가 필요하다. 플러그인을 Anthropic 디렉터리, GitHub, Works 마켓플레이스에서 받기 때문이다.
