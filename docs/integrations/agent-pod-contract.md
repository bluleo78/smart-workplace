# AI Pod ↔ 작업 공간 이미지 계약

runner(`apps/workplace-agent-runner`, WP-1251)가 만드는 Pod 와 작업 공간 이미지의 엔트리포인트가 이 문서 하나로 맞물린다. 작업 공간 이미지는 템플릿마다 하나다 — Claude Code(`apps/workplace-agent-claude-code`, 템플릿 `claude-code`, WP-1252)와 Gen:iA Code(`apps/workplace-agent-genia-code`, 템플릿 `genia-code`, WP-1296 — 공용 함수 `lib.sh`·`agent-screen` 은 Claude Code 이미지의 파일을 그대로 쓴다). 두 쪽 테스트가 아래 값을 단언한다 — 값을 바꾸면 두 쪽을 함께 바꾼다. runner 가 Works 와 주고받는 API 는 [agent-runner-api.md](agent-runner-api.md) 다.

## 리소스

AI 한 명(`agentUserId`)마다 runner 가 설치된 네임스페이스에 아래 리소스를 둔다. PVC 는 작업 디스크를 PVC 로 둘 때(Helm `agent.workDisk.type: pvc`)만 만든다 — 기본은 노드 로컬 폴더다(아래 「작업 디스크」).

| 종류 | 이름 | 수명 |
|---|---|---|
| Pod | `agent-<agentUserId>` | generation 이 바뀌고 `applyNow` 일 때, 또는 모델 연결 version 이 Pod 를 만들 때와 달라졌을 때(아래 「모델 연결 교체」) 지우고 다시 만든다 |
| PersistentVolumeClaim | `agent-<id>-work` | pvc 방식에서만. generation 재생성 때 유지, desired 에서 빠지면 바로 삭제(hostPath 방식이어도 예전에 만든 것이 남아 있으면 이때 지운다) |
| Secret | `agent-<id>` | 위와 같음 |
| ConfigMap | `agent-<id>` | desired 에서 빠지면 **마지막에** 삭제 — Pod 가 사라진 뒤 `STOPPED` 보고가 받아들여진 다음. 남아 있으면 「아직 STOPPED 를 보내지 못함」 표시다 |

## 라벨·어노테이션

| 대상 | 키 | 값 |
|---|---|---|
| 네 리소스 모두 | `app.kubernetes.io/managed-by` | `genia-agent-runner` |
| 네 리소스 모두 | `genia.works/agent` | `<agentUserId>` |
| 네 리소스 모두 | `genia.works/location` | `<locationId>` |
| Pod 만 | `genia.works/generation` | 그 Pod 가 반영한 generation |
| Pod 어노테이션 | `genia.works/claude-version` | Pod 를 만들 때 Secret 에 든 모델 연결 `version`(연결이 없으면 어노테이션 없음) |
| Secret 어노테이션 | `genia.works/agent-key-id` | 받은 AI 키 id(`keyId`) |
| Secret 어노테이션 | `genia.works/agent-key-rotate-after` | 받은 키의 `rotateAfter`(ISO-8601) |
| Secret 어노테이션 | `genia.works/claude-version` | 받은 모델 연결 `version` |
| Secret 어노테이션 | `genia.works/login-version` | 받은 로그인 정보(Gen:iA·ChatGPT) `version` — AI 계정 id. 같으면 다시 받지 않는다 |
| Secret 어노테이션 | `genia.works/repos-version` | 받은 저장소 토큰 `version`(epoch 밀리초). 같으면 다시 받지 않는다 |
| Secret 어노테이션 | `genia.works/repo-hosts` | 받은 토큰의 `kind:host` 목록(`GITHUB:github.com,GITLAB:gitlab.iacloud.kr`, 원문 없음) — Pod 를 만들 때 볼륨 items 를 이것으로 만든다 |
| Pod 어노테이션 | `genia.works/claude-version`·`genia.works/login-version`·`genia.works/repos-version` | Pod 를 만들 때 Secret 에 있던 값(없으면 어노테이션 없음). Secret 의 것과 다르면 Pod 를 다시 만든다 |
| Secret 어노테이션 | `genia.works/work-node` | hostPath 방식에서 Pod 가 처음 배치된 노드(`spec.nodeName`). 다시 만드는 Pod 를 이 노드에 고정한다 |

runner 는 `managed-by=genia-agent-runner` 라벨이 붙고 **`genia.works/location` 이 자기 위치(desired `locationId`)인** 리소스만 만지고 지운다 — 한 네임스페이스에 runner(위치)가 둘이어도 서로의 리소스를 지우지도 관찰 보고에 넣지도 않는다. 다른 위치의 리소스와 이름이 겹치면(같은 AI) 만들지 않고 `FAILED` 로 알린다. 그래도 **위치당 네임스페이스 하나**를 권장한다. 어노테이션은 runner 가 재시작해도 「이미 받은 키」를 알게 하는 유일한 기록이다 — AI 키를 다시 받으면 곧 교체(generation+1 → Pod 재생성)이기 때문이다.

## Secret 키

| 키 | 내용 |
|---|---|
| `agent-key` | AI 키 원문(`ak_…`). Pod 를 만들기 전에 반드시 있다 |
| `claude-token` | 모델 연결 원문 — provider 가 `anthropic` 일 때만. 연결이 없으면(`version` null) 키를 지운다 |
| `login-info` | 로그인 정보 원문(Gen:iA·ChatGPT 프로그램의 `auth.json` 내용, JSON 문자열) — provider 검사 없음(서버가 템플릿 계정과 맞는 것만 준다). 연결이 없으면(`version` null·참조 없음·404) 키와 어노테이션을 지운다 |
| `repo-<kind 소문자>-<host>` | 저장소 토큰 원문(예 `repo-github-github.com`, `repo-gitlab-gitlab.iacloud.kr`) — AI 마다·호스트마다 하나. 받을 때 기존 `repo-*` 키를 모두 바꿔 넣고(빠진 host 는 지움), 등록이 없으면(`version` null·참조 없음) `repo-*` 키와 두 어노테이션을 지운다 |

위치 단위 GitHub Secret(옛 Helm `github.existingSecret`)은 없다 — 저장소 토큰은 AI 마다 Works 에 저장하고 runner 가 받아 이 Secret 에 넣는다.

## 마운트

| 경로 | 출처 | 비고 |
|---|---|---|
| `/run/genia/config.json` | ConfigMap 키 `config.json` | 읽기 전용 |
| `/run/genia/agent-key` | Secret 키 `agent-key` | 읽기 전용 |
| `/run/genia/login-info` | Secret 키 `login-info`(볼륨 `agent-secret`, subPath) | 읽기 전용. Secret 에 `login-version` 이 있을 때만 — 없으면 마운트 자체가 없다. 아래 「로그인 정보」 |
| `/run/genia/repo-tokens/<github\|gitlab>/<host>` | Secret `agent-<id>` 의 `repo-<kind>-<host>` 키(볼륨 `repo-tokens`, items 마다 `path: <kind 소문자>/<host>`) | 읽기 전용. 호스트가 하나도 없으면 볼륨·마운트 자체가 없다 |
| `/run/genia/ca/ca.crt` | 위치 값 `agent.caBundle` 의 ConfigMap 키 `ca.crt`(볼륨 `ca-bundle`, runner env `AGENT_CA_CONFIGMAP`) | 읽기 전용. 값이 없으면 볼륨·마운트 자체가 없다. 아래 「추가 CA」 |
| `/work` | 노드 폴더 `<agent.workDisk.hostPath>/agent-<id>`(기본 `/var/lib/genia-agents`, DirectoryOrCreate) 또는 PVC `agent-<id>-work` | 아래 「작업 디스크」 |
| `/dind` | emptyDir | agent·dind 컨테이너가 docker 소켓을 나눠 쓴다 |

## 저장소 토큰 (WP-1268)

- 토큰은 AI 마다·저장소 호스트마다 Works 에 저장한다(관리자 화면 AI 상세 › 저장소 연결). runner 는 desired 의 `repos` 참조(`WORKS`)가 가리키는 `GET …/secrets/repos` 로 받아 Secret `agent-<id>` 에 `repo-<kind>-<host>` 키로 넣는다. 템플릿이 `repo`(옛 이름 `github`)를 요구하지 않으면 참조가 없고 키도 지운다.
- Pod 는 만들 때 Secret 어노테이션 `repo-hosts` 로 볼륨 `repo-tokens` 를 만든다 — 호스트마다 item `{key: repo-<kind>-<host>, path: <kind 소문자>/<host>}` 를 `/run/genia/repo-tokens` 에 읽기 전용으로 마운트한다.
- 작업 공간 엔트리포인트는 `repo-tokens/github/<host>` 마다 `gh auth login --hostname <host> --with-token`(토큰은 표준 입력으로만)과 `gh auth setup-git --hostname <host>` 를 한다. `repo-tokens/gitlab/<host>` 마다 git 자격 증명 도우미 `credential.https://<host>.helper` 를 걸어, git 이 물을 때 그 파일을 읽어 `username=oauth2`·`password=<토큰>` 으로 답하게 한다(설정에 토큰을 두지 않는다 — WP-1276). GitLab MR 은 플러그인 `gw-repo` 가 같은 파일을 glab 을 부를 때만 `GITLAB_TOKEN` 으로 넘긴다. 토큰 폴더가 없거나 로그인이 실패해도 경고만 하고 뜬다.
- **Pod 재생성**: gh 로그인은 Pod 시작 때 한 번 하고 고정된다. Works 는 토큰 변경에 `generation` 을 올리지 않으므로, runner 는 Pod 어노테이션 `genia.works/repos-version` 이 Secret 의 것과 다르면(없음 ↔ 값 포함) 「모델 연결 교체」와 똑같이 `generation`·`applyNow` 와 무관하게 Pod 를 지우고 다음 회차에 다시 만든다. 토큰을 지워도(값 → 없음) 같다. 허용 밖 이미지면 지우지 않고 `FAILED`.
- 원문은 Secret·Pod 마운트 밖(로그·어노테이션·오류 메시지)에 남기지 않는다.

## 추가 CA (WP-1276)

- 사내 GitLab(gitlab.iacloud.kr)처럼 자체서명 인증서를 쓰는 저장소용이다. 위치(차트 `agent.caBundle.pem` 또는 `existingConfigMap`)에 두면 runner 가 모든 AI Pod 에 `/run/genia/ca/ca.crt` 로 꽂는다.
- 엔트리포인트는 맨 앞(플러그인·저장소보다 먼저)에서 시스템 CA(`/etc/ssl/certs/ca-certificates.crt`)와 이 파일을 합쳐 `$HOME/.genia-ca-bundle.pem` 을 만들고 `SSL_CERT_FILE`·`GIT_SSL_CAINFO`·`CURL_CA_BUNDLE`·`REQUESTS_CA_BUNDLE` 을 그 번들로, `NODE_EXTRA_CA_CERTS` 를 추가분으로 내보낸다. 앞의 넷은 시스템 CA 를 「대신」하므로 추가분만 가리키면 github.com 같은 공인 인증서가 깨진다 — 그래서 합친다. 칸(tmux)은 이 env 를 물려받는다.
- 합치지 못하면 경고만 하고 뜬다(그 저장소의 clone 이 인증서 오류로 실패해 `clone-failed` 로 알린다).

## 작업 공간 이미지의 저장소 CLI (WP-1276)

- 이미지는 `gh` 와 `glab`(공식 릴리스 .deb, 버전·아키텍처별 해시 고정)을 둔다. `GLAB_SEND_TELEMETRY=false`·`GLAB_CHECK_UPDATE=false` — glab 의 사용 통계는 gitlab.com 으로 토큰 헤더를 붙여 보낸다(1.123.0 에서 확인).
- work-loop 의 PR·MR 명령은 플러그인 `gw-repo` 하나로 부른다 — origin 주소로 호스트를 가리고(토큰 폴더 `repo-tokens/<kind>/<host>` 가 있으면 그 종류) GitHub 은 gh, GitLab 은 glab REST 호출로 같은 모양의 JSON 을 낸다.

## 작업 화면 (WP-1277)

- 이미지는 `/opt/genia/bin/agent-screen` 을 둔다. runner 는 관리자 화면의 「작업 화면 보기」를 이을 때만 agent 컨테이너에 exec 로 이것을 부른다(runner Role `pods/exec`).
  - `attach <세션 id> [--input] [--window <번호>]`(tty): AI tmux 세션(`GENIA_AGENT_NAME` 의 `.`·`:` 을 `_` 로)과 창을 함께 쓰는 보기 세션 `gw-view-<세션 id>` 를 만들어 붙는다. `--input` 이 없으면 tmux read-only 클라이언트다. 끝나면 보기 세션을 지우고, 비정상으로 남은 보기 세션(붙은 클라이언트 없음)은 다음 attach 가 치운다. runner 는 붙을 때마다 「<화면 세션 id>-<회차>」를 세션 id 로 넘긴다 — 입력 허용을 바꿔 다시 붙을 때 옛 exec 의 정리가 새 보기 세션을 지우지 않게.
  - `windows [<세션 id>]`: 「번호·이름·폭·높이·보는 창(1|0)」 탭 구분 한 줄씩. `select <세션 id> <번호>`: 보기 세션의 창만 바꾼다(AI 의 현재 창은 그대로).
  - 보는 동안 AI 창은 관리자 터미널 크기를 따른다(`kubectl exec … tmux attach` 와 같다). 마지막 관리자가 나가면 창을 기본 크기 240x60 으로 되돌린다.
  - 종료 코드 3 = AI 의 tmux 세션이 아직 없음.

## 로그인 정보 (WP-1296)

Gen:iA Code·Codex 처럼 ID/비밀번호 로그인(`auth.json`)을 쓰는 템플릿이 쓴다. runner 쪽 규칙:

- desired 에 `login` 참조가 있고 `version` 이 Secret 어노테이션 `login-version` 과 다르면 `GET …/secrets/login` 으로 받아 Secret 키 `login-info`·어노테이션에 같은 apply 로 적는다. 참조가 없거나 `version` 이 `null`·404 면 키와 어노테이션을 지운다. 못 받으면 옛 값을 두고 AI 키는 그대로 적는다.
- Pod 는 만들 때 Secret 에 `login-version` 이 있으면 `/run/genia/login-info`(subPath `login-info`, 읽기 전용)를 마운트하고 env `GENIA_LOGIN_VERSION`·Pod 어노테이션 `login-version` 을 넣는다. 없으면 셋 다 없다.
- 로그인 파일은 Pod 시작 때 시딩되므로 모델 연결 교체와 같다 — Secret 의 `login-version` 이 Pod 의 것과 다르면(없음 ↔ 값 포함) `generation`·`applyNow` 와 무관하게 Pod 를 지우고 다음 회차에 다시 만든다. 허용 밖 이미지면 지우지 않고 `FAILED` 로 알린다.

Pod 안 시딩 규칙(이미지 엔트리포인트가 구현한다 — Gen:iA Code 는 WP-1296 에서 구현, Codex 는 WP-1297). 프로그램은 로그인을 스스로 갱신(토큰 새로고침)해 파일에 다시 쓰므로, 마운트 파일(읽기 전용 Secret)을 곧바로 쓰지 않고 `$AI_DIR` 아래에 보관본을 둔다.

- 마운트 파일 `/run/genia/login-info` 가 없으면 `$AI_DIR` 아래의 보관본을 지운다(연결이 끊긴 것).
- `GENIA_LOGIN_VERSION` 이 `$AI_DIR/state` 에 적어 둔 표식과 다르면 마운트 파일을 보관본 위치로 복사하고 표식을 기록한다(새로 등록한 로그인으로 교체).
- 같으면 보관본을 그대로 둔다 — 프로그램이 스스로 갱신한 로그인을 옛 Secret 값으로 덮지 않는다.
- Gen:iA Code 는 `GENIA_CODING_AGENT_DIR`, Codex 는 `CODEX_HOME` 을 `$AI_DIR` 아래로 두고(Codex 는 로그인을 파일 저장소로 강제한다) 보관본이 그 안에 놓이게 한다.
- Gen:iA Code 의 실제 자리: 보관본 `$AI_DIR/genia-agent/auth.json`(600, `GENIA_CODING_AGENT_DIR=$AI_DIR/genia-agent`), 표식 `$AI_DIR/state/login-version`. 마운트가 없거나 비었으면 보관본과 표식을 함께 지운다. 로그인 정보가 없으면 경고 한 줄만 남기고 칸을 띄우지 않는다 — genia 가 로그인 선택 화면에서 멈춰 work-loop 가 돌지 않는다(11-03 실측). 연결하면 runner 가 Pod 를 다시 만든다. 원문은 로그·명령줄에 남기지 않는다.

## Gen:iA Code 프로그램 (WP-1296)

- genia 는 사내 프로그램이라 공개 이미지(Docker Hub)에 넣지 않는다. 엔트리포인트가 Pod 가 뜰 때 사내 배포 서버 `https://genia-code-server.iacloud.kr/download`(이미지 env `GENIA_DOWNLOAD_URL` 로 바꿀 수 있다)의 `latest.txt`(「키 파일 이름 sha256」 줄 — 키 `cli-linux-x64`·`cli-linux-arm64`)에서 이 아키텍처의 배포본을 받고, sha256 을 확인해 `/work/.genia-app/<파일 이름 줄기>/` 에 풀고 `/work/.genia-app/current` 링크를 바꿔 끼운다. 같은 버전이 이미 있으면 받지 않고, 옛 버전은 지운다. 이미지는 genia-root.crt 를 시스템 CA 에 넣어 두어(`update-ca-certificates`) 받을 때 따로 CA 를 주지 않는다(위치 추가 CA 가 있으면 setup_ca 의 묶음 — 시스템 CA 를 읽어 만들므로 genia-root 도 들어 있다). 손상된 파일(sha 불일치·풀기 실패)은 `/work/.genia-app/.bad` 에 적고 `latest.txt` 의 그 줄이 바뀔 때까지 다시 받지 않는다.
- **AI Pod 가 그 서버에 닿아야 한다**(사설 IP — PoC 클러스터에서 확인, 운영 위치는 미확인). 닿지 않으면 받아 둔 `current` 로 뜨고, 그것도 없으면 끝내지 않고 칸을 미룬 채 감독 주기마다 다시 받는다.
- 칸 env: `GENIA_CODING_AGENT_DIR`, `GENIA_SKIP_VERSION_CHECK=1`, `GENIA_CA_CERT`·`NODE_EXTRA_CA_CERTS`=`$HOME/.genia-node-ca.pem`(genia-root + 위치 추가 CA — 플러그인 칸 명령이 `NODE_EXTRA_CA_CERTS` 를 `GENIA_CA_CERT` 로 덮어도 추가 CA 가 빠지지 않게). 설정 `$AI_DIR/genia-agent/settings.json` 은 매번 새로 쓴다(`defaultModel`=config 의 model id, `defaultProjectTrust: always`, `quietStartup: true`).
- 플러그인은 이미지에 굳힌 `/opt/genia/plugin/genia-works` 가 기본이다. Works 마켓플레이스의 genia-works ref 에 `genia/index.ts` 가 있으면 `/work/.genia-plugin/<ref>` 에 얕게 받아 그것을 쓴다(릴리스 태그 `genia-works--v…` 는 받아 둔 것을 다시 쓰고, 그 밖의 ref 는 매번 다시 받는다). desired 의 `plugins` 는 쓰지 않는다(템플릿에 없다).

## 작업 디스크 (WP-1270)

- **hostPath(기본)**: `/work` 는 노드 폴더 `<hostPath>/agent-<id>` 다. kubelet 이 root 소유로 만들고 fsGroup 도 적용되지 않으므로,
  init 컨테이너 `work-owner`(작업 공간 이미지, root, requests cpu 100m·memory 128Mi)가 `chown 1001:1001 /work` 로 폴더 자체의 주인만 넘긴다.
  Pod 가 처음 배치되면 runner 가 노드 이름을 Secret 어노테이션 `genia.works/work-node` 에 적고, 그 뒤 다시 만드는 Pod(generation·모델 연결
  교체)는 `nodeAffinity`(`metadata.name` = 그 노드)로 같은 노드에 고정한다. Secret 은 desired 에서 빠지면 지워지므로 끄고 켜면 고정이 풀린다.
  노드 폴더는 runner 가 지우지 않는다 — 같은 노드에 다시 뜨면 이어 쓰고, 버릴 때는 관리자가 노드에서 지운다(차트 README 「삭제」).
- **pvc**: `/work` 는 PVC `agent-<id>-work`(템플릿 `resources.workDisk` 크기, Helm `agent.storageClass`). 노드 고정·init 컨테이너는 없다.

엔트리포인트는 `/work` 가 비어 있어도(처음 뜸) 차 있어도(다시 뜸) 같게 동작해야 한다 — 하위 폴더는 엔트리포인트가 `mkdir -p` 로 만든다.

## 환경 변수 (agent 컨테이너)

| 이름 | 값 |
|---|---|
| `GENIA_AGENT_NAME` | desired `username` |
| `GENIA_AGENT_GENERATION` | desired `generation` |
| `GENIA_WORKS_TENANT` | desired `tenantId` |
| `GENIA_WORKS_API_URL` | desired `apiUrl`(`/api/v1` 까지) |
| `GENIA_WORKS_MCP_URL` | desired `mcpUrl` |
| `CLAUDE_CODE_OAUTH_TOKEN` | Secret `claude-token`(optional — 없으면 비움). env 라 Pod 시작 때 고정된다(아래 「모델 연결 교체」) |
| `GENIA_LOGIN_VERSION` | Secret 의 `login-version`(Pod 어노테이션과 같은 값). 로그인 정보가 있을 때만 — 없으면 이 env 도 없다. 엔트리포인트가 시딩 여부를 정하는 표식 |
| `DOCKER_HOST` | `unix:///dind/docker.sock` |

### 모델 연결 교체

`CLAUDE_CODE_OAUTH_TOKEN` 은 Secret 에서 env 로 들어가 Pod 를 시작할 때 고정된다. Works 는 연결을 다시 등록해도 `generation` 을 올리지 않는다(언제 다시 만들지는 runner 가 정한다). 그래서 runner 는 Secret 어노테이션 `genia.works/claude-version` 이 Pod 어노테이션의 것과 다르면(없음 ↔ 값 포함) `generation`·`applyNow` 와 무관하게 Pod 를 지우고 다음 회차에 다시 만든다 — 재등록은 대개 옛 토큰이 끊겼을 때라 쉴 때까지 기다리지 않는다. 템플릿 이미지가 허용 밖으로 바뀌었으면 지우지 않고 `FAILED` 로 알린다.

## 자원

네임스페이스 `ResourceQuota`(Helm `quota.*`, 기본 켜짐 — `requests.cpu`·`requests.memory`)는 requests 가 없는 컨테이너가 하나라도 있으면 Pod 를 승인에서 거절한다. 그래서 runner 는 **모든 컨테이너에 requests 를 둔다.**

| 컨테이너 | requests | limits |
|---|---|---|
| agent | 템플릿 `cpuRequest`·`memoryRequest` → 없으면 템플릿 limit → 없으면 **cpu `1`·memory `2Gi`** | 템플릿 `cpuLimit`·`memoryLimit`(있을 때만) |
| dind | Helm `dind.resources`(env `DIND_RESOURCES`, 기본 **cpu `500m`·memory `1Gi`**) | 같은 값(기본 **cpu `4`·memory `6Gi`**) |
| 그 밖의 sidecar | **cpu `100m`·memory `128Mi`** | 없음 |

클러스터가 Pod 등을 거절하면(쿼터·PodSecurity·검증) runner 는 그 AI 를 `FAILED` 로 보고하고(message: 종류·이름·HTTP 상태·서버 사유 한 줄 — Secret 은 사유만) 30초 뒤 다시 본다.

## config.json

```json
{
  "agent": { "userId": 42, "username": "dev-ai", "tenantId": 1, "generation": 7 },
  "works": { "apiUrl": "https://genia-works.iacloud.kr/api/v1", "mcpUrl": "https://genia-works.iacloud.kr/mcp" },
  "template": { "name": "claude-code", "version": "1" },
  "config": { "model": "opus", "queue": "AI 개발팀" },
  "plugins": [{ "marketplace": "genia-works", "name": "genia-works", "version": "0.1.31" }]
}
```

`config` 는 desired 의 `config` 그대로, `plugins` 는 desired 의 `plugins` 그대로다.

## 사용자·디스크 배치

- agent 컨테이너는 UID/GID **1001**, `runAsNonRoot: true`. Pod `securityContext.fsGroup: 1001`.
- `HOME=/home/agent` — 이미지 안(휘발). Claude Code 설정·플러그인·genia-works 키는 시작할 때마다 새로 만든다 — 재생성된 Pod 에 옛 키·옛 플러그인이 남아 새 값을 가리지 않게.
- genia-works 플러그인은 엔트리포인트가 `GENIA_WORKS_API_URL` 의 origin + `/claude/marketplace.json` 에 닿으면 그 마켓플레이스를 지우고 다시 더해 Works 서버의 버전으로 받는다(이미지의 주소와 같아도). 닿지 않으면 이미지에 굳힌 버전으로 뜬다. `settings.json` 의 마켓플레이스 주소도 그 결과에 맞춘다.
- AI 키(`agent-key`)는 플러그인의 키 저장(`gw-keys add`)으로 놓는다 — AI 키 형식(`ak_…`)이 아니면 엔트리포인트가 한 줄 사유로 끝난다.
- `/work` 에는 다시 받기 비싼 것만 둔다.

| 경로 | 용도 |
|---|---|
| `/work/agents/<username>/` | AI 폴더(start-agent 의 「홈/AI 이름」) — `agent.conf`, `state/`, `repos/<프로젝트 키>` |
| `/work/tmp` | `TMPDIR` |
| `/work/.cache` | `XDG_CACHE_HOME`, `PLAYWRIGHT_BROWSERS_PATH=/work/.cache/ms-playwright` |
| `/work/.gradle` | `GRADLE_USER_HOME` |
| `/work/.pnpm-store` | `npm_config_store_dir` |
| `/work/.genia-app` | Gen:iA Code 이미지만 — 받은 genia(버전 폴더 + `current` 링크) |
| `/work/.genia-plugin` | Gen:iA Code 이미지만 — 마켓플레이스 ref 별로 받은 genia-works 플러그인 |

## dind

템플릿 sidecar 이름이 `dind` 이면 runner 가 고정으로 배선한다(템플릿에는 이름·이미지·privileged 만 있다).

- `securityContext.privileged: true`
- args: `--host=unix:///dind/docker.sock --group=1001`(agent 사용자가 소켓을 쓸 수 있게)
- env: `DOCKER_TLS_CERTDIR=""`
- `/var/lib/docker` 는 emptyDir(Helm `dind.storageLimit`, 기본 20Gi), `/dind` 마운트
- resources: Helm `dind.resources`(위 「자원」)

다른 이름의 sidecar 는 배선 없이 이름·이미지·privileged 만으로 컨테이너를 만든다(쿼터용 기본 requests 만 붙인다).

## 위치 값

nodeSelector·tolerations·hostAliases·storageClass·imagePullSecrets 는 위치(Helm 값)마다 하나다. runner 가 env 로 받아 그 위치의 모든 AI Pod 에 똑같이 넣는다. hostAliases 는 차트의 공용 `hostAliases`(runner Deployment 에도 들어감 — Works 에 내부 IP 로 닿는 위치) 뒤에 `agent.hostAliases`(AI Pod 에만)를 이어 붙인 값이다(WP-1269). 작업 공간 이미지는 비공개 Docker Hub 에 있어 Helm 기본값이 `dockerhub-pull` 이다.

## 시작·종료

- `automountServiceAccountToken: false` — AI 는 쿠버네티스 API 를 쓰지 않는다(기본값이면 네임스페이스 기본 서비스 계정 토큰이 마운트된다).
- `restartPolicy: Always` — 컨테이너가 죽으면 kubelet 이 그 자리에서 다시 띄운다. Pod 를 지우고 다시 만드는 것(교체)은 runner 만 한다.
- `terminationGracePeriodSeconds` 기본 60(Helm `terminationGraceSeconds`).
- 엔트리포인트는 SIGTERM 을 받으면 work-loop 칸들을 정리하고 종료 코드 0 으로 끝낸다.
- 맡는 프로젝트는 부팅 때 `GET /api/v1/agent-runtime/me/projects`(플러그인 `gw-agent-projects --assigned`)로 읽어 칸을 연다. 그 뒤에 새로 맡은 프로젝트는 알림 감시 창이 그 프로젝트의 알림을 받는 즉시(WP-1272), 알림이 없으면 work-loop 의 「새 프로젝트 확인」(깨어날 때 5분에 한 번)이 칸을 연다.
- **work-loop 가 DRAIN·RESTART 를 받고 멈춰도 엔트리포인트는 끝내지 않는다.** 끝내면 kubelet 이 같은 generation 으로 다시 띄워 헛돈다. 새 설정은 runner 가 Pod 를 지우고 다시 만들어서 반영한다.
