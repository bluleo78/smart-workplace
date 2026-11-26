---
name: deploy
description: Use when a deploy-role AI is on a node of the 「운영 배포」 workflow (or a person runs /genia-works:deploy <이슈 키> prepare|apply) — reads the repository's .genia/deploy.yaml, prepares what would ship (current prod tag vs target commit, CI image build, commits·issues·manifest changes → ready·nothing·blocked), and after human approval applies it with the deploy command, waits for rollout, checks the status URL, comments on included issues (deployed) or rolls back with rollout undo (failed).
---

# genia-works 운영 배포 (deploy)

인자: `<이슈 키> prepare|apply`. 이슈 키는 배포 이슈(「운영 배포」 워크플로우가 도는 이슈)다. 앱 저장소 폴더(clone) 안에서 부른다. 앱마다 다른 값은 저장소의 `.genia/deploy.yaml` 에서 읽는다 — 형식은 이 스킬 폴더의 `config.md`. 아래 도구는 모두 genia-works MCP 서버의 도구다.

| 단계 | 하는 일 | 결과(워크플로우 outcome) |
|---|---|---|
| `prepare` (배포 준비) | 클러스터는 **읽기만** — 지금 운영 태그와 낼 커밋 비교, 이미지 빌드 확인, 나갈 변경 정리 | `ready` · `nothing` · `blocked` |
| `apply` (운영 반영) | 승인된 태그만 반영 → rollout 확인 → 상태 주소 확인 → 포함 이슈 댓글. 실패하면 되돌림 | `deployed` · `failed` |

결과 이름과 산출물(`tag`·`commit`·`previousTag`)은 「운영 배포」 워크플로우 템플릿(WP-2144)과 맞춘 계약이다 — 바꾸면 템플릿도 함께 바꾼다. 노드 키는 템플릿이 정하므로 이 스킬은 키에 기대지 않는다: 준비 산출물은 실행 `context` 의 항목(예약 키 `_qa` 빼고) 가운데 `tag`·`commit` 을 함께 가진 것이다(여럿이면 지나온 노드 `path` 에서 가장 최근 것).

`blocked`·`failed` 는 **결과 이동(`move_issue_workflow`)의 결과 이름**이다 — `report_agent_work` 의 `BLOCKED` 상태가 아니다. 워크플로우 노드에서 `BLOCKED` 보고는 실행을 멈추게(SUSPENDED) 하므로 이 스킬은 쓰지 않는다.

## 지키는 것

- **승인 없이 반영하지 않는다.** `apply` 는 「운영 배포」 워크플로우에서 사람이 `approve` 로 넘긴 바로 다음 노드에서만 한다(아래 apply 1번). 워크플로우 밖에서 사람이 `apply` 를 불러도 하지 않는다 — 워크플로우로 배포 이슈를 내라고 안내한다.
- **승인된 태그만 낸다.** `apply` 는 준비 노드가 낸 `tag`·`commit` 을 실행 `context` 에서 읽어 그대로 쓴다. 브랜치 끝을 다시 보거나 새로 고르지 않는다 — 승인 뒤 머지된 커밋이 승인 없이 나가지 않게.
- **규칙의 예외는 이것 하나다.** work-loop·CLAUDE.md 의 「운영 배포 하지 않는다」는 일반 개발 AI 의 규칙이다. 배포 담당 AI 가 이 스킬로 「운영 배포」 워크플로우의 승인 다음 노드에서 하는 반영만 예외다. 그 밖의 운영 변경(이미지 빌드·Secret·다른 네임스페이스·지우기)은 하지 않는다 — 권한도 없다(deploy-target 차트).
- 클러스터는 Pod 의 ServiceAccount 로만 다룬다. `--context` 를 붙이지 않는다.
- 보고는 work-on 4번 규칙(note·message)을 따른다. 워크플로우 노드에서는 결과 이동(`move_issue_workflow`)이 끝이다 — work-loop 「워크플로우 이슈」의 넘기기·`WORKFLOW_STALE` 규칙 그대로.

## 공통: 설정 읽기와 노드 확인

1. `get_issue_workflow({ issueKey })` 로 실행·지금 노드·고를 결과·`runId`·`revision`·`context` 를 읽는다. 지금 노드가 내 노드가 아니면 아무것도 하지 않는다.
2. 낼 커밋을 정한다.
   - `prepare`: 배포 이슈 본문(또는 이슈 챗의 사람 지시)이 커밋·태그를 정했으면 그것, 아니면 `git fetch origin` 뒤 `origin/<ci.branch>` 끝. 전체 SHA(`git rev-parse`)로 바꾼다.
   - `apply`: 실행 `context` 의 준비 노드 산출물 `commit` 그대로.
3. 그 커밋의 `.genia/deploy.yaml` 을 `git show <커밋>:.genia/deploy.yaml` 로 읽어 `config.md` 의 필수 칸·값을 검사한다. 없거나 틀리면 `prepare` 는 `blocked`(사유에 없는 칸·틀린 값), `apply` 는 `failed`(반영 전이라 되돌릴 것 없음)로 끝낸다.
4. 태그 = `image.tag` 규칙(`short-sha-<n>`)대로 커밋 SHA 앞 n 자리.

## prepare — 배포 준비

`report_agent_work({ issueKey, state: 'WORKING', note: '배포 준비 — 나갈 변경 정리 중' })` 로 시작한다.

1. **지금 운영 태그**: `kubectl -n <namespace> get deploy <deployment> -o jsonpath=...` 로 컨테이너(`target.container`, 없으면 첫 컨테이너) 이미지를 읽는다. 저장소가 `image.repository` 가 아니면 `blocked`. 읽지 못하면(권한·없는 Deployment) `blocked` — 사유에 kubectl 오류 한 줄.
2. **낼 것이 있나**: 지금 태그 = 낼 태그이거나, 낼 커밋이 지금 운영 커밋의 조상이면(`git merge-base --is-ancestor`) → `nothing`(되돌리는 배포는 이 스킬이 하지 않는다). 지금 태그를 커밋으로 찾지 못하면(`git rev-parse <태그>^{commit}` 실패) 비교 없이 계속하되 의견에 「지금 운영 커밋을 저장소에서 찾지 못함」을 적는다.
3. **이미지 빌드**: `"<이 스킬 폴더>/../../scripts/gw-repo" ci-job <전체 SHA> <ci.job>` 의 `status`.
   - `PASS` → 다음으로.
   - `PENDING` → 1분마다 다시 본다. 30분이 지나도 `PENDING` 이면 `blocked`(잡 주소와 함께). 기다리는 동안 `report_agent_work` note 를 `배포 준비 — 이미지 빌드 기다리는 중` 으로.
   - `FAIL`·`NONE` → `blocked`(잡 주소 또는 「잡이 없음」).
   - `gw-repo` 가 실패(종료 3·4 등) → `blocked`, 사유에 stderr 한 줄.
4. **나갈 변경 정리**(지금 운영 커밋..낼 커밋):
   - 커밋: `git log --no-merges --format='%h %s' <지금>..<낼>` (많으면 30개까지 + 「외 n개」).
   - 이슈: 범위의 커밋 제목·본문(`Refs:` 줄 포함)에서 배포 이슈와 같은 프로젝트 키의 이슈 키(`<키>-<번호>`)를 모은다. 배포 이슈 자신은 뺀다. 키마다 `get_issue_detail` 로 제목을 붙인다.
   - 매니페스트: `manifests` 경로의 `git diff --stat <지금>..<낼> -- <경로>` — 바뀌었으면 승인자가 볼 것으로 강조한다.
   - **배포에 쓰이는 것의 변경**: `.genia/deploy.yaml` 과 `deploy.command` 가 부르는 스크립트(예: `scripts/deploy.sh`)의 `git diff <지금>..<낼> -- <파일>`. 반영 단계는 이것을 운영 권한으로 실행하므로, 바뀌었으면 의견 맨 위(첫 줄 바로 아래)에 `⚠ 배포 설정·스크립트 변경` 과 diff 요약을 둔다.
5. **넘기기**: `move_issue_workflow({ issueKey, fromNode, outcome, outputs, comment, assignees, expectedRevision, runId })`.
   - `ready`: `outputs` = `{ tag, commit: <전체 SHA>, previousTag: <지금 운영 태그> }`, `comment` = 준비 의견 — 첫 줄 `<이미지>:<지금 태그> → <낼 태그>`, 이어서 (있으면) 배포 설정·스크립트 변경, 이미지 빌드(잡 주소), 포함 이슈(키·제목), 커밋 목록, 매니페스트 변경, 배포 명령(태그를 채운 것)과 상태 주소.
   - `nothing`: `comment` = `운영이 이미 <지금 태그> — 낼 변경 없음`(낼 커밋이 더 오래됐으면 그렇다고).
   - `blocked`: `comment` = 무엇이 막았는지와 사람이 할 일 한 줄(설정 파일 고치기·CI 다시 돌리기 등).
   - 결과에 꼭 낼 산출물·다음 담당 후보는 `get_issue_workflow` 가 준 것을 따른다 — 다음 담당이 필요한 결과(`assigneeRequired`)면 후보(승인자 역할)에서 골라 `assignees` 로 넘긴다(배포 이슈의 사람 담당자·작성자와 겹치는 사람을 먼저, 아니면 첫 사람).

## apply — 운영 반영

`report_agent_work({ issueKey, state: 'WORKING', note: '운영 반영 중 — <낼 태그>' })` 로 시작한다.

1. **승인 확인**: `get_issue_workflow` 의 지나온 노드(`path`) 마지막이 결과 `approve` 로 나간 노드여야 한다. 아니거나, 실행 `context` 에 준비 노드의 `tag`·`commit` 이 없거나, 지금 태그 규칙으로 `commit` 에서 만든 태그가 `tag` 와 다르면 반영하지 않고 `failed` — 의견에 「승인 기록 없음」 또는 어긋난 값.
2. **반영 전 상태**: 지금 운영 태그를 다시 읽어 둔다(되돌림 확인용). 이미 낼 태그면 3번 반영은 건너뛰고 4번 확인부터 한다.
3. **반영**: 낼 커밋의 깨끗한 작업 폴더에서 배포 명령을 부른다 — `git worktree add --detach <임시 폴더> <commit>` 에서 `deploy.command` 의 `{tag}` 를 태그로 바꿔 실행(`KUBE_CONTEXT` 를 넘기지 않는다). 끝나면 그 워크트리를 지운다.
4. **확인**:
   - `kubectl -n <namespace> rollout status deploy/<deployment> --timeout=<deploy.timeout>s`.
   - 컨테이너 이미지가 `<image.repository>:<tag>` 인지.
   - `check.url` 을 `curl -s -o /dev/null -w '%{http_code}'` 로 10초 간격 최대 6번 — `check.expect` 가 한 번 나오면 통과.
5. **성공 → `deployed`**:
   - 준비 의견의 포함 이슈마다 `add_comment({ issueKey: <포함 이슈>, body: '운영 반영(<tag>) — <배포 이슈 키>' })`. 댓글이 실패한 이슈는 의견에 적고 넘어간다(배포는 이미 성공).
   - `move_issue_workflow` 결과 `deployed`, `comment` = `<이미지>:<이전 태그> → <tag> 반영, rollout·상태 주소(<url> <코드>) 정상, 댓글 n건`.
6. **실패 → 되돌린 뒤 `failed`**(배포 명령 실패·rollout 시간 초과·이미지 불일치·상태 주소 실패 중 하나):
   - 지금 이미지가 반영 전 태그와 다르면 `kubectl -n <namespace> rollout undo deploy/<deployment>` → `rollout status` 를 다시 기다리고 → 이미지가 반영 전 태그로 돌아왔는지 본다.
   - 포함 이슈에는 댓글을 달지 않는다.
   - `move_issue_workflow` 결과 `failed`, `comment` = 어디서 실패했는지(명령 출력 마지막 몇 줄·rollout 메시지·상태 코드), 되돌림 결과(`<이전 태그>` 로 돌아옴 / 돌아오지 않음). 되돌림까지 실패했으면 첫 줄에 `되돌리지 못함 — 사람 확인 필요` 를 쓴다. `rollout undo` 는 Deployment 만 되돌린다 — 명령이 Service·Ingress 도 바꿨으면 그렇다고 적는다.
   - `failed` 는 승인자에게 돌아간다 — 다음 담당이 필요하면 prepare 5번과 같은 규칙으로 `assignees` 를 넘긴다(1번 승인 확인 실패도 같다).

## 워크플로우 밖에서 부르면

사람이 `/genia-works:deploy <이슈 키> prepare` 를 부르면 같은 준비를 하고, 결과를 결과 이동 대신 `report_agent_work({ issueKey, message: <준비 의견> })` 로 남긴다(미리 보기). `apply` 는 위 「지키는 것」대로 하지 않는다.
