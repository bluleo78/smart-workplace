# AI Pod ↔ 작업 공간 이미지 계약

runner(`apps/workplace-agent-runner`, WP-1251)가 만드는 Pod 와 작업 공간 이미지의 엔트리포인트가 이 문서 하나로 맞물린다. 작업 공간 이미지는 템플릿마다 하나다 — Claude Code(`apps/workplace-agent-claude-code`, 템플릿 `claude-code`, WP-1252), Gen:iA Code(`apps/workplace-agent-genia-code`, 템플릿 `genia-code`, WP-1296), Codex(`apps/workplace-agent-codex`, 템플릿 `codex`, WP-1297), OpenCode(`apps/workplace-agent-opencode`, 템플릿 `opencode`, WP-1410)다 — Gen:iA Code·Codex·OpenCode 는 공용 함수 `lib.sh`·`agent-screen` 을 Claude Code 이미지의 파일 그대로 쓴다. 네 쪽 테스트가 아래 값을 단언한다 — 값을 바꾸면 네 쪽을 함께 바꾼다. runner 가 Works 와 주고받는 API 는 [agent-runner-api.md](agent-runner-api.md) 다.

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
| Secret 어노테이션 | `genia.works/login-version` | 받은 로그인 정보(Gen:iA·ChatGPT) 또는 OpenAI 호환 연결 정보 `version` — Gen:iA·ChatGPT 는 AI 계정 id, OpenAI 호환은 「연결 id + Pod 에 넘길 연결 정보 원문」에서 계산한 값(아래 「OpenCode 연결 정보」). 같으면 다시 받지 않는다 |
| Secret 어노테이션 | `genia.works/repos-version` | 받은 저장소 토큰 `version`(epoch 밀리초). 같으면 다시 받지 않는다 |
| Secret 어노테이션 | `genia.works/repo-hosts` | 받은 토큰의 `kind:host` 목록(`GITHUB:github.com,GITLAB:gitlab.iacloud.kr`, 원문 없음) — Pod 를 만들 때 볼륨 items 를 이것으로 만든다 |
| Pod 어노테이션 | `genia.works/claude-version`·`genia.works/login-version`·`genia.works/repos-version` | Pod 를 만들 때 Secret 에 있던 값(없으면 어노테이션 없음). Secret 의 것과 다르면 Pod 를 다시 만든다 |
| Pod 어노테이션 | `genia.works/service-account` | Pod 를 만들 때 붙인 ServiceAccount(허용 목록에 없으면 어노테이션 없음, WP-2135). runner 설정 `AGENT_SERVICE_ACCOUNTS` 의 것과 다르면 Pod 를 다시 만든다 |
| Secret 어노테이션 | `genia.works/work-node` | hostPath 방식에서 Pod 가 처음 배치된 노드(`spec.nodeName`). 다시 만드는 Pod 를 이 노드에 고정한다 |

runner 는 `managed-by=genia-agent-runner` 라벨이 붙고 **`genia.works/location` 이 자기 위치(desired `locationId`)인** 리소스만 만지고 지운다 — 한 네임스페이스에 runner(위치)가 둘이어도 서로의 리소스를 지우지도 관찰 보고에 넣지도 않는다. 다른 위치의 리소스와 이름이 겹치면(같은 AI) 만들지 않고 `FAILED` 로 알린다. 그래도 **위치당 네임스페이스 하나**를 권장한다. 어노테이션은 runner 가 재시작해도 「이미 받은 키」를 알게 하는 유일한 기록이다 — AI 키를 다시 받으면 곧 교체(generation+1 → Pod 재생성)이기 때문이다.

## Secret 키

| 키 | 내용 |
|---|---|
| `agent-key` | AI 키 원문(`ak_…`). Pod 를 만들기 전에 반드시 있다 |
| `claude-token` | 모델 연결 원문 — provider 가 `anthropic` 일 때만. 연결이 없으면(`version` null) 키를 지운다 |
| `login-info` | 로그인 정보 원문(Gen:iA·ChatGPT 프로그램의 `auth.json` 내용, 또는 OpenCode 템플릿의 OpenAI 호환 연결 정보 — 아래 「OpenCode 연결 정보」, JSON 문자열) — provider 검사 없음(서버가 템플릿 계정과 맞는 것만 준다). 연결이 없으면(`version` null·참조 없음·404) 키와 어노테이션을 지운다 |
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
| `/var/run/secrets/kubernetes.io/serviceaccount/{token,ca.crt,namespace}` | 투영 볼륨 `service-account`(ServiceAccount 토큰 1시간·ConfigMap `kube-root-ca.crt`·downward API 네임스페이스) | agent 컨테이너에만, 읽기 전용. 허용 목록(`AGENT_SERVICE_ACCOUNTS`)에 든 AI 만 — 없으면 볼륨·마운트 자체가 없다. 아래 「클러스터 권한」 |
| `/work` | 노드 폴더 `<agent.workDisk.hostPath>/agent-<id>`(기본 `/var/lib/genia-agents`, DirectoryOrCreate) 또는 PVC `agent-<id>-work` | 아래 「작업 디스크」 |
| `/dind` | emptyDir | agent·dind·dind-gc 컨테이너가 docker 소켓을 나눠 쓴다 |

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

Gen:iA Code·Codex 처럼 ID/비밀번호 로그인(`auth.json`)을 쓰는 템플릿이 쓴다. OpenCode 템플릿(WP-1410)은 같은 경로로 OpenAI 호환 연결 정보를 받는다(아래 「OpenCode 연결 정보」) — runner 는 어느 쪽이든 provider 를 보지 않고 원문을 그대로 Secret 에 넣는다. runner 쪽 규칙:

- desired 에 `login` 참조가 있고 `version` 이 Secret 어노테이션 `login-version` 과 다르면 `GET …/secrets/login` 으로 받아 Secret 키 `login-info`·어노테이션에 같은 apply 로 적는다. 참조가 없거나 `version` 이 `null`·404 면 키와 어노테이션을 지운다. 못 받으면 옛 값을 두고 AI 키는 그대로 적는다.
- Pod 는 만들 때 Secret 에 `login-version` 이 있으면 `/run/genia/login-info`(subPath `login-info`, 읽기 전용)를 마운트하고 env `GENIA_LOGIN_VERSION`·Pod 어노테이션 `login-version` 을 넣는다. 없으면 셋 다 없다.
- 로그인 파일은 Pod 시작 때 시딩되므로 모델 연결 교체와 같다 — Secret 의 `login-version` 이 Pod 의 것과 다르면(없음 ↔ 값 포함) `generation`·`applyNow` 와 무관하게 Pod 를 지우고 다음 회차에 다시 만든다. 허용 밖 이미지면 지우지 않고 `FAILED` 로 알린다.

Pod 안 시딩 규칙(이미지 엔트리포인트가 구현한다 — Gen:iA Code 는 WP-1296 에서 구현, Codex 는 WP-1297. OpenCode 는 갱신하는 로그인이 아니라 정적 연결 정보라 보관본·표식 없이 매 부팅 설정 파일을 새로 쓴다 — 아래 「OpenCode 연결 정보」). 프로그램은 로그인을 스스로 갱신(토큰 새로고침)해 파일에 다시 쓰므로, 마운트 파일(읽기 전용 Secret)을 곧바로 쓰지 않고 `$AI_DIR` 아래에 보관본을 둔다.

- 마운트 파일 `/run/genia/login-info` 가 없으면 `$AI_DIR` 아래의 보관본을 지운다(연결이 끊긴 것).
- `GENIA_LOGIN_VERSION` 이 `$AI_DIR/state` 에 적어 둔 표식과 다르면 마운트 파일을 보관본 위치로 복사하고 표식을 기록한다(새로 등록한 로그인으로 교체).
- 같으면 보관본을 그대로 둔다 — 프로그램이 스스로 갱신한 로그인을 옛 Secret 값으로 덮지 않는다.
- **로그인 동기화(WP-1450, Codex)**: 서버에 묶인 ChatGPT 계정은 Works 서버가 만료 전에 갱신한다(Secret 의 `login-version` 은 바뀌지 않아 Pod 는 교체되지 않는다). Codex Pod 는 부팅 때(seed 직후·칸을 띄우기 전)와 감독 회차마다 `GENIA_LOGIN_SYNC_INTERVAL`(기본 300초) 간격으로 AI 키로 `GET /api/v1/agent-runtime/me/login?revision=<표식>` 을 부른다(표식 `$AI_DIR/state/login-revision`, 새 연결이면 지운다). 204(변경 없음)·404(묶이지 않은 옛 로그인 — 지금처럼 Pod 안 Codex 가 스스로 갱신)면 끝. 200 이면 응답 `version` 이 `GENIA_LOGIN_VERSION` 과 다를 때(선택이 바뀐 직후) 쓰지 않고, 같으면 서버 payload 의 `last_refresh` 가 로컬 auth.json 과 같거나 새로울 때 auth.json 을 원자적으로 덮고 표식에 `revision` 을 적는다. 로컬이 엄격히 새로우면(마이그레이션된 계정 등) `PUT …/me/login`(`{version, payload}`)으로 올린다. 칸의 codex 가 도는 중에 덮어도 된다(codex 는 갱신 직전에 디스크를 다시 읽는다). 실패해도 감독은 멈추지 않고 경고 한 줄만 남기며 로그인 원문은 남기지 않는다. Gen:iA Code 는 갱신 토큰이 없어 서버 갱신·동기화가 없다.
- Gen:iA Code 는 `GENIA_CODING_AGENT_DIR`, Codex 는 `CODEX_HOME` 을 `$AI_DIR` 아래로 두고(Codex 는 로그인을 파일 저장소로 강제한다) 보관본이 그 안에 놓이게 한다.
- Gen:iA Code 의 실제 자리: 보관본 `$AI_DIR/genia-agent/auth.json`(600, `GENIA_CODING_AGENT_DIR=$AI_DIR/genia-agent`), 표식 `$AI_DIR/state/login-version`. 마운트가 없거나 비었으면 보관본과 표식을 함께 지운다. 로그인 정보가 없으면 경고 한 줄만 남기고 칸을 띄우지 않는다 — genia 가 로그인 선택 화면에서 멈춰 work-loop 가 돌지 않는다(11-03 실측). 연결하면 runner 가 Pod 를 다시 만든다. 원문은 로그·명령줄에 남기지 않는다.
- Codex 의 실제 자리(WP-1297): `CODEX_HOME=$AI_DIR/codex`(700), 보관본 `$AI_DIR/codex/auth.json`(600), 표식 `$AI_DIR/state/login-version`. 엔트리포인트가 매번 새로 쓰는 `$AI_DIR/codex/config.toml` 에 `cli_auth_credentials_store = "file"` 을 넣어 codex 가 키링이 아니라 이 파일을 읽고 갱신해 다시 쓰게 한다. 마운트가 없거나 비었으면 보관본과 표식을 함께 지우고, 로그인 정보가 없으면 경고 한 줄만 남기고 칸을 띄우지 않는다(모델 목록도 묻지 않는다). 원문은 로그·명령줄에 남기지 않는다.

## OpenCode 연결 정보 (WP-1410)

OpenCode 템플릿(`opencode`)은 Works 의 「OpenAI 호환」 연결(모델 서버 주소·API 키)로 모델을 부른다. 새 경로를 만들지 않고 위 「로그인 정보」 경로를 그대로 쓴다 — desired 의 `login` 참조 → `GET …/secrets/login` → Secret 키 `login-info` → Pod `/run/genia/login-info`, env `GENIA_LOGIN_VERSION`. runner 는 provider 를 보지 않으므로 이 때문에 달라지는 runner 코드는 없다.

- `version`(desired 의 `login.version` = `secrets/login` 응답의 `version` = Secret·Pod 어노테이션 `login-version`)은 Gen:iA·ChatGPT 와 달리 연결 행 id 가 아니다. 서버가 「연결 행 id + Pod 에 넘길 원문(연결 JSON 에 지정 모델 `assistant_config.model` 에서 온 `defaultModel` 을 더한 것)」의 SHA-256 앞 8바이트를 53비트로 줄인 양수(runner 가 JSON 숫자로 정확히 읽는 범위)로 계산한다 — desired 와 `secrets/login` 이 같은 함수를 쓴다. 그래서 연결을 다시 하거나, 비서 설정에서 모델만 바꾸거나, 같은 연결의 이미지 입력 지정(`vision`)을 고쳐도 version 이 바뀌어 runner 가 연결 정보를 다시 받고 Pod 를 다시 만든다. 생각의 깊이처럼 Pod 에 넘기지 않는 설정은 바꿔도 그대로다. 암호문이 아니라 원문으로 계산하므로 같은 값을 다시 저장하거나 다시 암호화해도(IV 가 바뀜) 그대로다.

- `/run/genia/login-info` 의 모양(JSON 객체, 서버가 등록 때 저장한 연결 정보 원문을 그대로 내고 `defaultModel` 하나를 더한다): `providerId`(필수 — `[A-Za-z0-9._-]+`, 등록 때 서버가 같은 규칙으로 검증한다), `options`(필수 객체 — `baseURL`·`apiKey` 등 OpenCode provider options 그대로), `npm`·`name`·`models`(등록 요청에 넣었으면 있을 수 있다 — 화면 등록은 `providerId`·`options` 만 보내 넣지 않는다. 없으면 `npm` 은 `@ai-sdk/openai-compatible`, `name` 은 `providerId`, `models` 는 고른 모델 한 항목), `vision`(비서 설정에서 이미지 입력을 지정했을 때만 — boolean 또는 모델별 boolean 맵, 이 값이 이 모델에 true 면 이미지 입력을 선언한다), `defaultModel`(연결에 지정한 모델 — 이 연결의 `providerId/` 로 시작하고 모델 id 가 비지 않을 때만 그 값, 아니면(옛 Claude 기본값·다른 연결의 값·지정 없음) `null`).
- 엔트리포인트(`apps/workplace-agent-opencode/bin/lib-opencode.sh write_opencode_config`)는 부팅마다 `$HOME/.config/opencode/opencode.json`(600)을 새로 쓴다: `autoupdate: false`·`share: "disabled"`·`permission: "allow"`, `provider.<providerId>`(`npm`·`name`·`options`·`models` 만 — OpenCode 가 모르는 키는 설정 검증에서 거절되므로 `vision`·`defaultModel` 은 넣지 않는다. 고른 모델 항목에 `limit` 이 없으면 Pod 가 연결의 `{baseURL}/models` 에서 문맥·출력 한도를 읽어 넣는다(WP-1735 — 실패하면 넣지 않고 띄운다)), `model: "<providerId>/<모델 id>"`. MCP 연결·키 보호 플러그인은 구동기(`plugins/genia-works/opencode`)가 env `OPENCODE_CONFIG_CONTENT` 로 넘기고 OpenCode 가 둘을 병합한다.
- 모델 결정: 템플릿 `config.json` 의 `model` 이 `auto` 가 아니고 `<providerId>/` 로 시작하면 그것(칸이 서버의 실시간 모델 목록 — 값 `providerId/modelId` — 에서 고른 값), 아니면(`auto`·비었음·다른 연결의 접두) `defaultModel`. `defaultModel` 이 없거나 이 연결의 `providerId/` 접두가 아니면 접두를 붙여 추측하지 않고 오류 한 줄을 남겨 칸을 띄우지 않는다(엔트리포인트는 끝내지 않는다).
- 마운트가 없거나 비었거나 꼴이 틀리면(연결 끊김·연결 정보 이상) 옛 `opencode.json` 을 지우고 경고·오류 한 줄만 남기고 칸을 띄우지 않는다. 연결하면 runner 가 Pod 를 다시 만든다. 연결 정보 원문(API 키)은 로그·명령줄에 남기지 않는다(`jq` 가 파일을 읽어 조립).
- 대화 기록(OpenCode 의 sqlite — 구동기가 `-s <세션>` 으로 이어 받는다)은 `XDG_DATA_HOME=$AI_DIR/opencode/data`(영속)에 둔다. env `OPENCODE_DISABLE_AUTOUPDATE=1`·`OPENCODE_DISABLE_MODELS_FETCH=1`(모델은 연결 정보로만 정한다)을 내보내 칸이 물려받는다.
- 모델 목록은 Pod 가 보고하지 않는다(「모델 목록 보고」는 로그인 정보 계정용) — 연결이 정적 API 키라 서버가 모델 서버에 직접 물어 실시간 목록을 만든다.
- 사설 CA 가 있으면 공용 `setup_ca` 가 `NODE_EXTRA_CA_CERTS`(추가분)·`SSL_CERT_FILE`(시스템 CA 와 합친 번들)를 내보내고 OpenCode(Bun 실행 파일)가 둘 다 따른다(11-08 opencode 1.18.31 자체서명 서버로 확인). 사내 모델 서버 루트 CA(`genia-root.crt`, Gen:iA Code 이미지와 같은 파일)는 이미지가 시스템 CA 에 넣고, `opencode_ca` 가 그것과 위치 추가 CA 를 이은 `$HOME/.genia-node-ca.pem` 을 `NODE_EXTRA_CA_CERTS` 로 덮어 내보낸다 — Bun 은 시스템 CA 파일을 읽지 않아, 위치 CA 에 그 루트가 없으면 모델 요청이 TLS 로 실패한다(11-09). 스킬은 Claude 이미지와 같은 plugins.lock 의 플러그인 `skills/` 를 `~/.agents/skills/<플러그인>` 으로 이어 OpenCode 가 외부 스킬로 읽는다(`opencode debug skill` 확인).

## Gen:iA Code 프로그램 (WP-1296)

- genia 는 사내 프로그램이라 공개 이미지(Docker Hub)에 넣지 않는다. 엔트리포인트가 Pod 가 뜰 때 사내 배포 서버 `https://genia-code-server.iacloud.kr/download`(이미지 env `GENIA_DOWNLOAD_URL` 로 바꿀 수 있다)의 `latest.txt`(「키 파일 이름 sha256」 줄 — 키 `cli-linux-x64`·`cli-linux-arm64`)에서 이 아키텍처의 배포본을 받고, sha256 을 확인해 `/work/.genia-app/<파일 이름 줄기>/` 에 풀고 `/work/.genia-app/current` 링크를 바꿔 끼운다. 같은 버전이 이미 있으면 받지 않고, 옛 버전은 지운다. 이미지는 genia-root.crt 를 시스템 CA 에 넣어 두어(`update-ca-certificates`) 받을 때 따로 CA 를 주지 않는다(위치 추가 CA 가 있으면 setup_ca 의 묶음 — 시스템 CA 를 읽어 만들므로 genia-root 도 들어 있다). 손상된 파일(sha 불일치·풀기 실패)은 `/work/.genia-app/.bad` 에 적고 `latest.txt` 의 그 줄이 바뀔 때까지 다시 받지 않는다.
- **AI Pod 가 그 서버에 닿아야 한다**(사설 IP — PoC 클러스터에서 확인, 운영 위치는 미확인). 닿지 않으면 받아 둔 `current` 로 뜨고, 그것도 없으면 끝내지 않고 칸을 미룬 채 감독 주기마다 다시 받는다.
- 칸 env: `GENIA_CODING_AGENT_DIR`, `GENIA_SKIP_VERSION_CHECK=1`, `GENIA_CA_CERT`·`NODE_EXTRA_CA_CERTS`=`$HOME/.genia-node-ca.pem`(genia-root + 위치 추가 CA — 플러그인 칸 명령이 `NODE_EXTRA_CA_CERTS` 를 `GENIA_CA_CERT` 로 덮어도 추가 CA 가 빠지지 않게). 설정 `$AI_DIR/genia-agent/settings.json` 은 매번 새로 쓴다(`defaultModel`=config 의 model id, `defaultProjectTrust: always`, `quietStartup: true`).
- 플러그인은 이미지에 굳힌 `/opt/genia/plugin/genia-works` 가 기본이다. Works 마켓플레이스의 genia-works ref 에 `genia/index.ts` 가 있으면 `/work/.genia-plugin/<ref>` 에 얕게 받아 그것을 쓴다(릴리스 태그 `genia-works--v…` 는 받아 둔 것을 다시 쓰고, 그 밖의 ref 는 매번 다시 받는다). desired 의 `plugins` 는 쓰지 않는다(템플릿에 없다).

## 모델 목록 보고 (WP-1297)

로그인 정보 계정(Codex 의 ChatGPT 등)은 Works 서버가 모델 목록을 조회하지 않는다 — ChatGPT 의 access token 수명은 10일이고 refresh token 은 1회용(회전)이라 갱신하는 쪽이 둘이면 로그인이 풀린다. WP-1450 이후 서버에 묶인 계정은 서버만 갱신하고 Pod 는 `/me/login` 으로 받아 쓰지만(위 「로그인 동기화」), 모델 목록은 Pod 의 프로그램이 로그인으로 직접 뽑는 편이 계정별 목록을 정확히 얻으므로 여전히 **Pod 가 보고한다**(관리자 화면 「모델」 칸이 이 보고로 채워진다).

- 이미지 엔트리포인트(Codex 이미지)는 칸을 띄울 수 있을 때(로그인 있음) 부팅 첫 회차와 이후 주기적으로(하루 1회 또는 6시간) 프로그램에서 모델 목록을 뽑는다. Codex: `codex debug models` 의 `visibility == "list"` 만 `priority` 오름차순으로, `{id: slug, label: display_name, efforts: supported_reasoning_levels[].effort}` 로 바꾼다.
- 그 JSON `{"models":[…]}` 을 플러그인 스크립트에 표준 입력으로 넘긴다: `"$GW_SCRIPTS/gw-models" < models.json` (`GW_SCRIPTS` = 이미지의 플러그인 `scripts/` 폴더). 스크립트가 AI 키·서버 주소·워크스페이스를 `gw-status` 와 같은 방식으로 읽고, env `GENIA_LOGIN_VERSION`(이 Pod 가 받은 로그인 정보의 `version` = 연결 행 id)을 `jq` 로 본문에 `loginVersion` 으로 덧붙여 `PUT /api/v1/agent-runtime/me/models` 를 부른다(계약은 `agent-runner-api.md` 「로그인 계정 모델 목록 보고」). `GENIA_AGENT_GENERATION` 이나 `GENIA_LOGIN_VERSION` 이 없으면(Works 가 띄운 AI 가 아니거나 로그인이 없음) 아무것도 하지 않는다. 이미지에는 `jq` 가 있어야 한다.
- 보고는 최선 노력이다 — 스크립트는 실패해도(키 없음·서버 오류·닿지 못함) 표준 오류에 한 줄만 남기고 늘 종료 0 이다. 엔트리포인트는 실패 때문에 칸을 멈추지 않는다. 목록을 뽑은 출력·로그에 로그인 토큰이 섞이지 않게 한다(모델 목록만 넘긴다).
- 서버는 보고한 `loginVersion` 이 지금 활성 연결 행 id 와 같을 때만 저장한다(다르면 저장 없이 204) — 로그인을 바꾼 직후 옛 Pod 가 늦게 보고해도 새 연결에 옛 계정의 목록이 들어가지 않는다. 조회도 저장된 보고의 연결 행이 지금 활성 행과 같을 때만 쓴다. 관리자가 연결을 다른 로그인으로 바꾸면 Pod 가 다시 만들어지므로(위 「로그인 정보」) 새 Pod 의 첫 보고가 목록을 채운다.

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
| `GENIA_AGENT_POD_UID` | downward API `metadata.uid` — Pod 정체. 안의 AI 는 보고(gw-status·gw-boot)에 `podUid` 로 실어 서버가 옛/새 Pod 를 시계가 아니라 정체로 가른다(WP-1968) |
| `GENIA_WORKS_TENANT` | desired `tenantId` |
| `GENIA_WORKS_API_URL` | desired `apiUrl`(`/api/v1` 까지) |
| `GENIA_WORKS_MCP_URL` | desired `mcpUrl` |
| `CLAUDE_CODE_OAUTH_TOKEN` | Secret `claude-token`(optional — 없으면 비움). env 라 Pod 시작 때 고정된다(아래 「모델 연결 교체」) |
| `GENIA_LOGIN_VERSION` | Secret 의 `login-version`(Pod 어노테이션과 같은 값). 로그인 정보(OpenCode 는 연결 정보)가 있을 때만 — 없으면 이 env 도 없다. Gen:iA Code·Codex 는 시딩 여부를 정하는 표식(OpenCode 는 쓰지 않는다) |
| `DOCKER_HOST` | `unix:///dind/docker.sock` |

### 모델 연결 교체

`CLAUDE_CODE_OAUTH_TOKEN` 은 Secret 에서 env 로 들어가 Pod 를 시작할 때 고정된다. Works 는 연결을 다시 등록해도 `generation` 을 올리지 않는다(언제 다시 만들지는 runner 가 정한다). 그래서 runner 는 Secret 어노테이션 `genia.works/claude-version` 이 Pod 어노테이션의 것과 다르면(없음 ↔ 값 포함) `generation`·`applyNow` 와 무관하게 Pod 를 지우고 다음 회차에 다시 만든다 — 재등록은 대개 옛 토큰이 끊겼을 때라 쉴 때까지 기다리지 않는다. 템플릿 이미지가 허용 밖으로 바뀌었으면 지우지 않고 `FAILED` 로 알린다.

## 자원

네임스페이스 `ResourceQuota`(Helm `quota.*`, 기본 켜짐 — `requests.cpu`·`requests.memory`)는 requests 가 없는 컨테이너가 하나라도 있으면 Pod 를 승인에서 거절한다. 그래서 runner 는 **모든 컨테이너에 requests 를 둔다.**

| 컨테이너 | requests | limits |
|---|---|---|
| agent | 템플릿 `cpuRequest`·`memoryRequest` → 없으면 템플릿 limit → 없으면 **cpu `1`·memory `2Gi`** | 템플릿 `cpuLimit`·`memoryLimit`(있을 때만) |
| dind | Helm `dind.resources`(env `DIND_RESOURCES`, 기본 **cpu `250m`·memory `512Mi`**) | 같은 값(기본 **cpu `2`·memory `4Gi`**) |
| dind-gc(dind 가 있을 때 runner 가 넣음) | **cpu `10m`·memory `32Mi`** | memory `128Mi` |
| 그 밖의 sidecar | **cpu `100m`·memory `128Mi`** | 없음 |

클러스터가 Pod 등을 거절하면(쿼터·PodSecurity·검증) runner 는 그 AI 를 `FAILED` 로 보고하고(message: 종류·이름·HTTP 상태·서버 사유 한 줄 — Secret 은 사유만) 30초 뒤 다시 본다.

AI Pod 는 Deployment 없는 맨 Pod(`restartPolicy: Always`)다. 떠 있어야 할 AI 의 Pod 가 사라지거나(kubectl delete 등) phase 가 `Succeeded`·`Failed` 로 끝나면(노드 재시작 뒤 Completed·Error) runner 가 `CLUSTER_CHECK_SECONDS`(기본 30초) 안에 알아채 끝난 Pod 를 지우고 다시 만든다 — `generation`·`applyNow` 와 무관(WP-1501). 컨테이너 재시작·CrashLoopBackOff 는 kubelet 몫이라 건드리지 않고, `Unknown`(노드 연락 끊김)도 끝난 것으로 보지 않는다.

계속 끝나는 AI(DinD `emptyDir` sizeLimit 초과·노드 압박으로 거듭 Evicted)는 끝없이 바로 다시 띄우지 않는다. 첫 번째는 바로, 연속으로 다시 만들수록 마지막으로 다시 만든 때부터 30초·1분·2분·5분(이후 5분)을 기다린 뒤 다시 만든다(실제로는 다음 `CLUSTER_CHECK_SECONDS` 확인 때). 끝난 Pod 를 지우기 전에 `status.reason`·`message` 를 로그에 남기고, runner 가 끝난 Pod 를 알아채 지운 때(다시 띄운 때 — Pod 가 실제로 끝난 시각이 아니다)부터 6시간 동안(`RESTART_NOTICE_MS`) 관찰 보고에 지금 phase 그대로 message `이전 Pod 가 끝나 다시 띄웠습니다 — <reason — message>` 를 싣는다(컨테이너 재시작 알림이 있으면 `재시작 알림 / 끝난 Pod 알림` 으로 함께). 단 `FAILED`(runner 실패, 또는 관찰상 CrashLoopBackOff·ImagePullBackOff·ErrImagePull·Pod phase Failed 처럼 `FAILED` 로 보이는 상태)로 보고할 때는 실패 사유만 싣고 이 알림은 싣지 않는다. 연속 3번째부터는 `FAILED`(message `AI Pod 가 연속 N번 끝나 간격을 늘려 다시 띄웁니다 — <사유>`)로 보고한다. 새 Pod 가 Ready 로 10분 넘게 떠 있거나 `generation` 이 바뀌면 연속 횟수를 0 으로 되돌린다. 횟수는 runner 메모리에만 있어 runner 가 다시 뜨면 0 부터다.

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
- agent 컨테이너는 `appArmorProfile: Unconfined` — Ubuntu 26.04 노드에서 containerd 기본 프로필이 같은 컨테이너 안 프로세스끼리의 신호(kill)도 막기 때문이다.
- `HOME=/home/agent` — 이미지 안(휘발). Claude Code 설정·플러그인·genia-works 키는 시작할 때마다 새로 만든다 — 재생성된 Pod 에 옛 키·옛 플러그인이 남아 새 값을 가리지 않게.
- genia-works 플러그인은 엔트리포인트가 `GENIA_WORKS_API_URL` 의 origin + `/claude/marketplace.json` 에 닿으면 그 마켓플레이스를 지우고 다시 더해 Works 서버의 버전으로 받는다(이미지의 주소와 같아도). 닿지 않으면 이미지에 굳힌 버전으로 뜬다. `settings.json` 의 마켓플레이스 주소도 그 결과에 맞춘다.
- AI 키(`agent-key`)는 플러그인의 키 저장(`gw-keys add`)으로 놓는다 — AI 키 형식(`ak_…`)이 아니면 엔트리포인트가 한 줄 사유로 끝난다.
- `/work` 에는 다시 받기 비싼 것만 둔다.

| 경로 | 용도 |
|---|---|
| `/work/agents/<username>/` | AI 폴더(start-agent 의 「홈/AI 이름」) — `agent.conf`, `state/`, `repos/<프로젝트 키>`. 끝난(완료·취소) 이슈의 워크트리는 부팅 때 모든 저장소에서 지운다(`agent-sweep`, WP-1683) |
| `/work/tmp` | `TMPDIR` — 부팅 때 안을 모두 비우고, 도는 동안 1시간에 한 번 3일 넘게 안 바뀐(mtime·ctime 둘 다) 것을 지운다(소켓·FIFO·Chrome 잠금 `Singleton*` 링크·`claude-*` 폴더는 남김, WP-1683) |
| `/work/.cache` | `XDG_CACHE_HOME`, `PLAYWRIGHT_BROWSERS_PATH=/work/.cache/ms-playwright` — 저장소 Playwright 는 버전마다 `ms-playwright/.genia-installs/<버전>` 에 받아 설치 기록(`.links`)이 재시작 뒤에도 유효하다. 어느 저장소도 쓰지 않는 브라우저는 부팅 때 지운다(`browser-prune`, WP-1683) |
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

### 저장 공간 정리 — dind-gc (WP-1581)

`/var/lib/docker` emptyDir 은 Pod 를 다시 만들 때만 비워진다. AI 가 남긴 이미지·볼륨·빌드 캐시가 쌓여 상한을 넘으면 kubelet 이 Pod 를 쫓아낸다(Evicted). 그래서 dind 가 있으면 runner 가 `dind-gc` 컨테이너를 함께 넣는다.

- 이미지: dind sidecar 의 이미지 그대로(docker CLI 포함, 이미지 허용 목록 그대로). `privileged: false`, `runAsUser: 0`(du 가 root 전용 레이어 폴더까지 읽게), AppArmor `Unconfined`(agent 와 같은 이유)
- 마운트: `/dind`(소켓), `/dind-storage`(볼륨 `dind-storage`, 읽기 전용 — 사용량을 du 로 잰다)
- env: `DOCKER_HOST=unix:///dind/docker.sock`, `DIND_GC_THRESHOLD_KIB`(상한 × Helm `dind.gcThresholdPercent`(기본 70)%), `DIND_GC_CRITICAL_KIB`(상한 × 90%, 임계값보다 낮지 않게), `DIND_GC_INTERVAL_SECONDS=60`, `DIND_GC_FAST_INTERVAL_SECONDS=15`, `DIND_GC_IMAGE_COOLDOWN_SECONDS=600`, `DIND_GC_CRITICAL_COOLDOWN_SECONDS=120`
- 동작: 60초마다(임계값의 80% 이상이면 15초마다 — `DIND_GC_INTERVAL_SECONDS`·`DIND_GC_FAST_INTERVAL_SECONDS`) 사용량을 재 임계값(`DIND_GC_THRESHOLD_KIB`) 이상이면 `container prune -f --filter until=10m`(만든 지 10분 안 된 컨테이너는 시작 전일 수 있어 지우지 않는다) → `volume prune -af`(쓰지 않는 볼륨을 이름 있는 것까지 모두 — 멈춘 스택의 데이터 볼륨도 지워진다). 그래도 임계값 이상이면 `builder prune -af`·`image prune -af` 를 하되 쿨다운(`DIND_GC_IMAGE_COOLDOWN_SECONDS`, 600초)에 한 번만 한다(실행 중인 것만으로 넘는 동안 빌드 캐시·이미지를 거듭 지워 다시 만들거나 받게 하지 않게). 단 위급선(`DIND_GC_CRITICAL_KIB`, 상한의 90%) 이상이면 곧 쫓겨나므로 쿨다운이 짧은 위급 쿨다운(`DIND_GC_CRITICAL_COOLDOWN_SECONDS`, 120초)이다. 실행 중인 컨테이너가 쓰는 이미지·볼륨은 지우지 않는다. 시간마다 무조건 이미지를 지우지 않는 이유는, 막 받은 이미지까지 지워 테스트 시작과 부딪히기 때문이다(prune 의 `until` 은 받은 시각이 아니라 이미지를 만든 시각 기준). 사용량을 잴 수 없으면(du 실패) 그때마다 로그를 남기고 건너뛴다.
- 템플릿 sidecar 가 이미 `dind-gc` 라는 이름을 쓰면 넣지 않는다(이름이 겹치면 Pod 가 거절된다). `DIND_STORAGE_LIMIT` 은 1Gi 이상의 쿠버네티스 수량이어야 runner 가 시작한다.
- TERM 을 받으면 바로 끝난다.
- runner 는 spec 이 달라졌다고 Pod 를 다시 만들지 않으므로, runner 를 올린 뒤 새로 만들어지는 Pod 부터 들어간다.

## 클러스터 권한 (WP-2135)

- 대부분의 AI 는 쿠버네티스 API 를 쓰지 않는다. 배포 담당 AI 처럼 권한이 꼭 필요한 AI 만 Helm 값 `agent.serviceAccounts`(`{AI 사용자 id: ServiceAccount 이름}`, runner env `AGENT_SERVICE_ACCOUNTS`)에 적는다. Works 의 템플릿·desired 로는 정할 수 없다 — Works 관리자가 임의의 AI 에 클러스터 권한을 붙이지 못하게. 이름이 아니라 id 로 고르는 것도 같은 까닭이다(사용자 이름은 Works 에서 바뀐다).
- 허용 목록에 든 AI 의 Pod 는 `serviceAccountName` 을 그 이름으로 두되 `automountServiceAccountToken: false` 는 그대로고, 토큰은 투영 볼륨으로 **agent 컨테이너에만** 꽂는다 — 자동 마운트는 dind·dind-gc·사이드카에도 토큰을 넣어 특권 dind 를 통해서도 권한이 새기 때문이다. 경로·파일 이름은 kubectl·client 라이브러리의 클러스터 안 설정이 그대로 찾는 표준 자리다.
- 다만 투영 토큰도 노드의 kubelet 폴더에 파일로 있어, 같은 노드에 뜬 특권 dind(다른 AI 의 것 포함)가 노드 디스크를 마운트하면 읽을 수 있다 — 사이드카와 나누지 않는 것까지가 이 장치의 범위고, 노드 수준 격리(배포 담당 AI 전용 위치·노드)는 따로 해야 한다. 배포 담당 AI 의 템플릿에는 dind 사이드카를 두지 않는다(docker 가 필요 없다).
- ServiceAccount·Role·RoleBinding 은 runner·차트가 만들지 않는다(클러스터 운영자 몫). 없는 이름이면 Pod 가 거절되어 `FAILED` 로 보인다.
- **Pod 재생성**: 허용 목록이 바뀌어도 desired `generation` 은 그대로라, Pod 어노테이션 `genia.works/service-account` 가 설정과 다르면(없음 ↔ 값 포함) 「모델 연결 교체」처럼 Pod 를 다시 만든다. 미뤄 둔 generation(applyNow=false)이 있어도 기다리지 않는다 — 허용 목록에서 뺀 AI 의 권한이 쉴 때까지 남지 않게.

## 위치 값

nodeSelector·tolerations·hostAliases·storageClass·imagePullSecrets 는 위치(Helm 값)마다 하나다. runner 가 env 로 받아 그 위치의 모든 AI Pod 에 똑같이 넣는다. hostAliases 는 차트의 공용 `hostAliases`(runner Deployment 에도 들어감 — Works 에 내부 IP 로 닿는 위치) 뒤에 `agent.hostAliases`(AI Pod 에만)를 이어 붙인 값이다(WP-1269). 작업 공간 이미지는 비공개 Docker Hub 에 있어 Helm 기본값이 `dockerhub-pull` 이다.

## 시작·종료

- `automountServiceAccountToken: false` — 기본값이면 네임스페이스 서비스 계정 토큰이 모든 컨테이너에 마운트된다. 허용 목록에 든 AI 만 agent 컨테이너에 토큰을 따로 꽂는다(위 「클러스터 권한」).
- `restartPolicy: Always` — 컨테이너가 죽으면 kubelet 이 그 자리에서 다시 띄운다. Pod 를 지우고 다시 만드는 것(교체)은 runner 만 한다.
- `terminationGracePeriodSeconds` 기본 60(Helm `terminationGraceSeconds`).
- 엔트리포인트는 SIGTERM 을 받으면 work-loop 칸들을 정리하고 종료 코드 0 으로 끝낸다.
- 맡는 프로젝트는 부팅 때 `GET /api/v1/agent-runtime/me/projects`(플러그인 `gw-agent-projects --assigned`)로 읽어 칸을 연다. 그 뒤에 새로 맡은 프로젝트는 알림 감시 창이 그 프로젝트의 알림을 받는 즉시(WP-1272), 알림이 없으면 work-loop 의 「새 프로젝트 확인」(깨어날 때 5분에 한 번)이 칸을 연다.
- **work-loop 가 DRAIN·RESTART 를 받고 멈춰도 엔트리포인트는 끝내지 않는다.** 끝내면 kubelet 이 같은 generation 으로 다시 띄워 헛돈다. 새 설정은 runner 가 Pod 를 지우고 다시 만들어서 반영한다.
- **AI 상태 보고(WP-1250)**: work-loop 는 플러그인 `gw-status` 로 `PUT /api/v1/agent-runtime/me/status` 에 칸 상태를 보고하며, 본문에 `podStartedAt`(Pod 시작 시각)과 함께 `podUid`(env `GENIA_AGENT_POD_UID` — 위 환경 변수 표)를 실어 서버가 지금 Pod 의 보고를 시계가 아니라 **정체**로 가른다(WP-1968). 지금 정체도 바로 앞 정체도 아닌 보고는 관찰(약 60초)을 기다리지 않고 재시작 직후 새 Pod 로 받아들여 쓰되(보고에 Pod 시작 시각이 있어야 하고, 시작이 지금 알던 것보다 30초 넘게 이른 정체·시각이 걸려 없는 모르는 정체는 받지 않는다 — WP-1968 2차 반려 ②), 바로 앞 정체의 보고(끝나는 중인 옛 Pod 의 늦은 보고)와 시각 없는 모르는 정체의 보고는 칸·합친 상태·기준을 저장 없이 무시하되 응답은 그대로 200(`desired`)이다 — 상태 보고는 매 회차 다시 오므로 `gw-status` 는 지금처럼 응답의 `desired` 를 내고 종료 0 으로 일을 계속한다(정체가 없는 옛 이미지는 시각 규칙 그대로). runner 관찰도 지난 정체를 아예 받지 않는데, 정체가 바로 앞 정체일 때뿐 아니라 끝나는 중 phase(STOPPING·STOPPED — FAILED 는 관찰한 시작이 지금 알던 시작보다 **뒤**일 때만 지난 것으로 보지 않는다, 처음 관찰될 때 이미 실패한 새 Pod 의 「오류」가 화면에 안 뜨지 않게)이거나 지금 알던 Pod 시작보다 **시계 차이 여유(30초 — `isOlderPod` 와 같은 값)만큼** 이른 정체가 다른 관찰도 previous 가 비어 있어도 지난 것으로 본다(WP-1968 2차 반려 ① — 배포 직후 새 Pod 보고가 정체를 채운 뒤 옛 Pod 관찰이 정체를 뒤집지 않게 · 3차 반려 ①②).
- **칸 차단 보고(WP-1913)**: 진입점이 설정·연결 오류로 칸을 띄우지 못하면 `$AI_DIR/state/pane-blocked` 에 사유 한 줄을 남기고, 감독 회차(`tick`)마다 플러그인 `gw-boot blocked` 로 서버(`PUT /api/v1/agent-runtime/me/pane`)에 보고한다. 정상으로 띄우는 첫 회차(표식 `$AI_DIR/state/pane-boot-ok-sent`)와, 차단 사유 파일이 아직 남아 있는 성공 회차(표식과 무관하게 — 막혔다 다시 띄우는 경우)에 `gw-boot ok` 를 보내 차단 표시를 지운다. gw-boot 는 성공하면 종료 0, 실패하면(경고 한 줄과 함께) 종료 1 이므로 감독 회차는 **종료 코드로 성공을 판정**해 표식을 남기고 파일을 지우며, 실패하면 다음 회차에 다시 보고한다 — 표준 오류에 실린 무해한 경고가 회차를 헛나가게 하지 않기 때문이다(WP-1913 리뷰 반려 ③). 보고는 최선 노력이라 감독은 멈추지 않고 진입점은 끝내지 않는다. 막힌 회차에는 `pane_blocked_reason`(이미지 훅)이 **이번 까닭을 다시 판정**해 상태 파일을 고친 뒤 보고한다 — 지난 회차의 사유가 그대로 보내져 틀린 오류가 화면에 남지 않게(WP-1913 리뷰 반려 ②). 본문에는 `GENIA_AGENT_GENERATION` 을 `generation` 으로 실어 옛 Pod 의 늦은 보고를 서버가 걸러 내게 한다(WP-1913 리뷰 반려 ①). 또한 `podStartedAt`(Pod 시작 시각, 칸 상태 보고와 같은 값)을 함께 실어, **같은 generation 재시작** 뒤 옛 Pod 의 늦은 `BLOCKED`·`OK` 도 서버가 지금 Pod 시작과 견줘 걸러 내게 한다(WP-1958 — 시각을 못 읽으면 생략, 서버는 그대로 믿는다). 이어 `podUid`(env `GENIA_AGENT_POD_UID` — 위 환경 변수 표)도 함께 실어 정체를 가리고, 지난 정체의 보고·시각 없는 모르는 정체의 보고·정체를 모르는(옛 이미지) 보고 중 옛 시각인 것은 서버가 **409** 로 거절한다 — 정체가 같은 지금 Pod 의 보고는 generation 을 보지 않고 받아야 시작 OK 가 매 회차 버려지지 않는다(WP-1968 반려 ①·⑤). 다만 정체를 모르는 보고의 **옛 generation 은 저장 없이 조용한 204** 다 — 그 이미지는 generation 이 다시 맞을 일이 없어 다시 보내도 성공할 수 없으므로 409 면 표식 없이 계속 다시 보내는 고리가 된다(WP-1968 2차 반려 ③). `gw-boot` 는 204·200 이 아니면 실패(종료 1)이므로 감독 회차는 표식과 차단 파일을 남긴 채 다음 회차에 다시 보낸다(정체가 없는 옛 이미지는 지금처럼 시각으로만 가른다).
