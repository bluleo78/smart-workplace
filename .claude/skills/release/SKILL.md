---
name: release
description: Gen:iA Works(smart-workplace) 릴리스를 준비한다 — `/release prepare` 로 기준 릴리스 이후 변경을 모아 버전을 제안하고, WP 이슈를 읽어 사용자용 릴리스 노트(releases/<버전>.md, 앱 「새 소식」)를 쓰고, 검토·커밋·머지·push 뒤 마지막 확인을 받아 vX.Y.Z 태그를 push 한다(GitLab 이 이미지를 빌드). "릴리스 준비해줘", "릴리스 노트 써줘", "v0.9.0 태그 찍어줘", "핫픽스 릴리스" 같은 요청에 쓴다. 운영 반영(deploy)은 하지 않는다 — 그건 사람이 `node deploy/release/release.mjs deploy` 로 한다.
---

# /release prepare

릴리스 한 번 = 노트 커밋 → main(또는 `hotfix/*`) 머지·push → 태그 push. 태그가 GitLab 파이프라인(검증 → 이미지 빌드 → 체크리스트 → GitLab Release)을 돌린다. 전체 절차·반영·롤백은 `docs/ops/release.md`.

**하지 않는 것**: 운영 반영·롤백, 이미 있는 태그를 옮기거나 다시 찍기(태그는 바꾸지 않는다 — 잘못 나갔으면 다음 patch 로), 사용자 확인 없는 push.

## 1. 범위와 버전 제안

워크트리에서 한다(main 작업 폴더에서 브랜치를 만들거나 바꾸지 않는다).

```sh
git fetch origin --tags
git worktree add .claude/worktrees/release-next -b release/next main   # 핫픽스는 4절
cd .claude/worktrees/release-next
node deploy/release/prepare.mjs plan            # 기준 = 조상 중 가장 높은 vX.Y.Z 태그
# 첫 전환 전(v* 태그 없음): node deploy/release/prepare.mjs plan --base <운영 이미지 커밋> --base-version 0.8.0
```

결과(JSON): `base`·`baseVersion`·`to`·`range`·`bump`·`suggestedVersion`·`conflict`·`issues[{key, subjects, internal}]`·`unkeyed[]`.
- 자리 규칙: 깨지는 변경(`type!:`·`BREAKING CHANGE:`) → major(0.x 에서는 minor), `feat` → minor, 그 밖 → patch. 내부 변경(테스트·리팩터·`infra`/`repo` scope)은 자리를 올리지 않는다. `hotfix/*` 는 patch 만. **사람이 확정한다.**
- `conflict` 가 있으면(제안 버전의 태그가 이미 있음) 멈추고 알린다 — 대개 로컬 main 이 뒤처졌다(`git fetch`).
- 이슈 키는 커밋 제목과 본문 `Refs:` 줄에서만 모은다.
- `to` 는 이 릴리스에 담을 마지막 커밋이다. 노트 커밋은 이 커밋 바로 위에 올리고, 태그는 노트 커밋에 찍는다(그 사이 main 에 들어온 다른 머지가 섞이지 않게).
- `local main` 이 `origin/main` 보다 앞서 있으면(`git log origin/main..main`) 그 커밋도 범위에 든다 — 그대로 내보낼지 사용자에게 알린다.

## 2. 노트 초안

`issues` 의 키마다 genia-works MCP `get_issue_detail` 로 **이슈 제목·본문을 읽고** 쓴다(커밋 제목을 옮겨 적지 않는다). `internal: true`(테스트·리팩터·인프라 전용) 이슈도 본문을 한 번 훑어 사용자 체감 변경이 정말 없는지 확인한다. 키 없는 커밋(`unkeyed`)도 본다.

쓰는 법(독자는 팀원·고객사 사용자):
- 화면 영역별 `##` 제목으로 묶는다 — 이슈·메일·드라이브·노트·채팅·캘린더·홈·AI·설정 등 앱 메뉴 이름.
- 항목은 「무엇을 할 수 있게 됐는지」를 사용자 말투(「~할 수 있습니다」·「~합니다」)로 한 줄. 예: `- 한글·오피스 문서를 내려받지 않고 바로 미리볼 수 있습니다`
- 넣지 않는 것: 이슈 키, 기술 이름(Helm·컨테이너·converter·마이그레이션 등), 테스트·리팩터·CI·문서·배포 도구 변경, 사용자가 알아챌 수 없는 내부 수정.
- 버그 수정은 사용자가 겪던 증상 기준으로(「~가 안 되던 문제를 고쳤습니다」).
- 사용자 체감 변경이 하나도 없으면 `hidden: true` + 본문 `사용자에게 보이는 변경 없음` 한 줄(새 소식 목록·안 읽음 점에서 빠진다).

초안과 제안 버전을 사용자에게 보여 주고 **버전과 문장을 확정받는다**. 고치라는 데는 고쳐 다시 보여 준다.

## 3. 노트 커밋 → 머지 → push → 태그

```sh
# releases/<버전>.md — 형식은 앱이 읽는 것과 같다(apps/workplace-web/e2e/fixtures/releases 참고)
cat > releases/0.9.0.md <<'NOTE'
---
version: 0.9.0
date: 2026-10-20
range: v0.8.0..4257f9e1f718
---

## 드라이브
- 한글·오피스 문서를 내려받지 않고 바로 미리볼 수 있습니다
NOTE
node deploy/release/prepare.mjs check-note releases/0.9.0.md --base-version <baseVersion>
git add releases/0.9.0.md && git commit -m "docs(repo): v0.9.0 릴리스 노트를 추가한다"
```

- `date` 는 태그 찍는 날(KST), `range` 는 plan 결과 그대로, `hidden` 은 숨길 때만.
- 노트 커밋의 부모가 plan 의 `to` 인지 확인한다(`git rev-parse release/next^`). 그 사이 main 이 움직였어도 노트 커밋은 그대로 둔다 — 태그는 노트 커밋에 찍으므로 새 머지는 이번 릴리스에 들지 않는다.
- main 작업 폴더에서 `git merge --no-ff release/next` 로 머지(머지 메시지 `merge: v0.9.0 릴리스 노트`). 노트만 바뀐 커밋이라 pre-commit·pre-push 회귀는 생략된다.
- **push 는 사용자 확인 뒤**: `git push origin main` → `git push --no-verify gitlab main`(GitLab 이 태그 파이프라인을 돌리는 곳, 미러라 훅 생략).
  - 전제: GitLab `main` 이 origin `main` 의 미러다(WP-442 에서 전환 — 그 전엔 무관한 README 커밋이라 이 push 가 거부된다). 거부되면 멈추고 알린다(강제 push 하지 않는다).
- **태그 전 확인**:
  - 노트 커밋이 GitLab main 에 들어 있는지: `git fetch gitlab main && git merge-base --is-ancestor <노트 커밋> FETCH_HEAD` — 아니면 멈춘다(verify-tag 가 main·hotfix/* 에 없는 커밋의 태그를 거부한다).
  - 체크리스트 미리보기: `node deploy/release/checklist.mjs --from <base> --to <노트 커밋> --base-version <baseVersion> --out /tmp/…` (GitLab 토큰이 없으면 새 앱 판정만 빠진다). ⚠ 섹션(새 앱·새 환경변수·마이그레이션·Helm 변경)을 사용자에게 요약해 보여 준다.
- **마지막 확인을 받은 뒤** 태그:

```sh
git tag -a v0.9.0 -m "v0.9.0" <노트 커밋>
git push origin v0.9.0
git push --no-verify gitlab v0.9.0      # GitLab 파이프라인 시작
```

- 끝나면 GitLab 파이프라인 주소와 다음 단계(사람이 체크리스트 확인 → `node deploy/release/release.mjs deploy 0.9.0`)를 알려 주고, 워크트리·`release/next` 브랜치를 지운다.

## 4. 핫픽스

운영 릴리스(예: v0.9.0)에 급한 수정만 얹어 v0.9.1 을 낸다.

```sh
git worktree add .claude/worktrees/hotfix-0.9.1 -b hotfix/0.9.1 v0.9.0
# 수정 커밋을 cherry-pick 하거나 여기서 고친다(main 에도 같은 수정이 들어가야 한다)
node deploy/release/prepare.mjs plan --to hotfix/0.9.1      # 기준 = v0.9.0
```

- 노트·check-note·커밋은 같은 방식으로 hotfix 브랜치에. push 는 `git push origin hotfix/0.9.1` 과 `git push --no-verify gitlab hotfix/0.9.1`, 태그는 hotfix 브랜치 커밋에.
- 노트 파일은 main 에도 반영한다(`git cherry-pick <노트 커밋>` 을 main 쪽 워크트리에서) — 다음 main 릴리스 빌드의 「새 소식」에 핫픽스 노트가 빠지지 않게.
- 다음 main 릴리스는 기준이 main 조상의 가장 높은 태그(v0.9.0)라 핫픽스 커밋도 다시 범위에 보일 수 있다 — 이미 v0.9.1 노트에 쓴 항목은 빼고 쓴다. plan 은 이미 있는 태그 버전(v0.9.1)을 제안하지 않고 비는 patch 까지 올린다.
