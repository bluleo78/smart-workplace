# workplace-agent-genia-code

Works 가 띄우는 AI Pod 의 Gen:iA Code 작업 공간 이미지다(WP-1296, 템플릿 `genia-code`). runner(`apps/workplace-agent-runner`)가 Pod 를 만들면, 이 이미지의 엔트리포인트가 Gen:iA Code(genia)·플러그인·저장소·work-loop 칸을 사람 손 없이 띄우고 지킨다. Pod 와 무엇을 주고받는지는 [agent-pod-contract.md](../../docs/integrations/agent-pod-contract.md)에 있다. Claude Code 이미지([workplace-agent-claude-code](../workplace-agent-claude-code))와 따로 빌드하지만 공용 함수(`bin/lib.sh`)와 작업 화면(`bin/agent-screen`)은 그 이미지의 파일을 그대로 COPY 해 쓴다.

## genia 를 Pod 가 받는 이유

genia 는 사내 프로그램이고 이 이미지는 Docker Hub 에 공개(`docker.io/iacloudops/genia-works-agent-genia-code`)된다. 그래서 이미지에는 genia 를 넣지 않는다. Pod 가 뜰 때 사내 배포 서버(`https://genia-code-server.iacloud.kr/download`)에서 받고 sha256 을 확인한 뒤 `/work/.genia-app` 에 둔다. 이미지에 들어가는 것은 그 서버와 모델 서버의 루트 CA(`genia-root.crt`, 공개 인증서)뿐이다. **AI Pod 가 그 서버에 닿아야 한다.** PoC 클러스터에서는 닿는 것을 확인했고, 운영은 아직 확인하지 않았다.

## 들어 있는 것

- 베이스 `mcr.microsoft.com/playwright:v1.60.0-noble`. 도구 블록은 Claude Code 이미지와 같다(tmux, git, gh, glab, jq, tini, OpenJDK 21, docker CLI·compose v2, pnpm(corepack), Noto CJK 글꼴, lsof·iproute2 등 포트·프로세스 확인 도구, playwright-cli 와 그 chromium·headless 기본 설정). 한쪽을 바꾸면 다른 쪽도 함께 바꾼다.
- genia-works 플러그인: 빌드할 때 저장소의 `plugins/genia-works` 중 genia 가 쓰는 것(`package.json`·`.claude-plugin`·`genia`·`hooks`·`scripts`·`skills`)만 `/opt/genia/plugin/genia-works` 에 넣는다. 운영 마켓플레이스가 가리키는 옛 ref 에는 `genia/`(Gen:iA Code 확장)가 없기 때문이다.
- `/opt/genia/bin/`: `entrypoint`·`lib-genia.sh`(이 앱), `lib.sh`·`agent-screen`(Claude Code 이미지). `genia-root.crt` 는 시스템 CA(`/usr/local/share/ca-certificates`, `update-ca-certificates`)에 넣어 curl·git 이 그대로 믿는다.
- 개발 절차 플러그인(WP-1336): genia 는 Claude Code 에 설치된 플러그인의 스킬·명령을 그대로 읽는다. 그래서 Claude Code CLI(Claude 이미지와 같은 버전 — 실행하지 않고 받는 데만 쓴다)로 Claude 이미지의 [plugins.lock](../workplace-agent-claude-code/plugins.lock)을 `genia-works` 만 빼고 `/home/agent/.claude` 에 받는다(superpowers 등 — 두 실행기의 개발 절차가 한 벌이 된다). 에이전트 형식이라 genia 가 읽지 못하는 `code-simplifier` 는 같은 내용을 스킬로 옮겨(`skills/code-simplifier`, Apache-2.0) `~/.agents/skills` 에 둔다.
- 사용자 `agent`(UID/GID 1001). jdtls·TS 언어 서버는 넣지 않는다.

## 엔트리포인트 (`bin/entrypoint`, 함수는 `lib.sh` + `bin/lib-genia.sh`)

1. 필수 파일·env 를 확인하고 `/work` 아래 폴더를 만든다(lib.sh). 위치의 추가 CA 가 있으면 시스템 CA 와 합친다(`setup_ca`). genia 가 쓸 node 인증서 묶음 `~/.genia-node-ca.pem`(genia-root + 추가 CA)을 만들어 `GENIA_CA_CERT`·`NODE_EXTRA_CA_CERTS` 로 내보낸다(`genia_ca`). 플러그인의 칸 명령이 `NODE_EXTRA_CA_CERTS` 를 `GENIA_CA_CERT` 로 덮으므로, 이 묶음이 없으면 추가 CA 가 칸에서 빠진다.
2. `install_genia`: 배포 서버의 `latest.txt`(「키 파일 이름 sha256」 한 줄씩)에서 아키텍처 키(`cli-linux-x64`·`cli-linux-arm64`)의 줄을 고른다. 그 버전이 `/work/.genia-app/<파일 이름 줄기>` 에 이미 있으면 받지 않는다. 없으면 받아서 sha256 을 확인하고(다르면 버린다) 풀어서 옮긴 뒤 `current` 링크를 바꿔 끼운다. 옛 버전은 지운다. 감싸개 `~/.local/bin/genia` 는 매번 새로 만든다. 서버에 닿지 않으면, 받아 둔 `current` 가 있을 때는 그것으로 계속하고, 없을 때는 끝내지 않고 칸을 미룬 채 감독(60초마다 도는 `tick`)이 다시 받는다. 받은 파일이 손상됐으면(sha 불일치·풀기 실패) 그 파일 이름과 sum 을 `/work/.genia-app/.bad` 에 적고, `latest.txt` 의 그 줄이 바뀔 때까지 다시 받지 않는다.
3. `use_plugin`: 기본은 이미지에 넣은 플러그인이다. Works 마켓플레이스(`<api origin>/claude/marketplace.json`)가 genia-works 를 git 저장소(url·path·ref)로 내고 그 ref 에 `genia/index.ts` 가 있으면, `/work/.genia-plugin/<ref>` 에 얕게 받아서 그것을 쓴다. 릴리스 태그(`genia-works--v…`)는 이미 받았으면 다시 받지 않고, 브랜치처럼 움직이는 ref 는 매번 다시 받는다. 지금 ref 말고 옛 ref 폴더는 지운다. 그다음 플러그인 공용 함수(`gw-lib.sh`)를 읽는다.
4. `genia_env`: `GENIA_CODING_AGENT_DIR=$AI_DIR/genia-agent`(영속). tmux 서버가 뜨기 전에 내보내므로 칸이 물려받는다(`GENIA_SKIP_VERSION_CHECK=1` 은 이미지 ENV).
5. `write_genia_settings`: `$GENIA_CODING_AGENT_DIR/settings.json` 을 매번 새로 쓴다. 넣는 것은 `defaultProvider: genia`, `defaultModel`(config 의 model id), `defaultProjectTrust: always`, `quietStartup: true` 다. `mcp.json` 에는 genia-works 를 쓰지 않는다. 확장이 신원별로 등록해야 하는데, 손으로 적은 항목이 그 등록을 가리기 때문이다.
6. `seed_login`: 로그인 정보(`/run/genia/login-info`)를 `$GENIA_CODING_AGENT_DIR/auth.json`(600)에 심는다. 표식 `$AI_DIR/state/login-version` 이 `GENIA_LOGIN_VERSION` 과 다를 때만 복사한다. 마운트가 없으면 보관본과 표식을 지운다. 로그인 정보가 없으면 경고만 남기고 **칸을 띄우지 않는다** — genia 가 칸에서 로그인 선택 화면(브라우저·코드 입력)을 띄우고 멈춰 work-loop 가 돌지 않기 때문이다(11-03 노트북 genia 로 실측). 감독은 회차마다 다시 보고, 관리 화면에서 연결하면 runner 가 Pod 를 다시 만든다.
7. AI 키·git·저장소 자격 증명·dind 를 준비한다(lib.sh). 그다음 `agent-home set cli genia` 로 실행기를 genia 로 적고, 맡은 프로젝트마다 저장소를 받고 칸을 띄운다(lib.sh 의 `start_projects` — 폴더 신뢰 훅 `trust_folders` 는 이 이미지에서 아무것도 하지 않는다. 신뢰는 칸 명령의 `--approve` 와 `defaultProjectTrust` 가 맡는다). 칸 명령은 플러그인 `agent-project` 의 genia 분기(`genia --approve -e <플러그인> "/gw-loop <키> --queue …"`)다.
8. 오래 걸리는 받기(배포본·플러그인 clone)는 뒤에서 돌리고 기다려 SIGTERM 을 바로 받는다. 감독·SIGTERM 정리는 Claude Code 이미지와 같다(죽은 칸 되살리기, 6일 넘은 칸 다시 띄우기, 알림 감시 창 챙기기, 종료 신호에 칸 정리 후 0).

## 테스트·빌드

```sh
pnpm --filter @smart-workplace/workplace-agent-genia-code test   # node --test tests/*.test.mjs (tmux 필요)
docker build --platform linux/amd64 -f apps/workplace-agent-genia-code/Dockerfile .   # 컨텍스트는 저장소 루트
```

테스트는 배포 서버 대신 `file://` 폴더(가짜 `latest.txt` 와, 가짜 genia 가 든 tar.gz)를 쓰고, 플러그인 스크립트는 저장소의 진짜 스크립트를 쓴다.
