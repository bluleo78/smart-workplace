# WP-1415 최종 전체 리뷰 수정 보고서

## 범위

- 작업 worktree: `.claude/worktrees/integ-developer6-9`
- 수정 기준 HEAD: `8fe3493684fdc7057e6b08c6e0d4cb1b021caaaa`
- 통합 리뷰 finding 세 건을 한 번의 수정 웨이브로 처리했다.
- 접힌 보조 메뉴, 키보드 Escape, 500ms 프레임 샘플러 회귀와 사용자 매뉴얼 설명을 추가했다.
- 1024px + 460px의 동그라미·접힌 메뉴, 1440px + 460px의 알약·접힌 메뉴 기대와 16px 간격을 바꾸지 않았다.

## finding과 변경

1. 프로젝트 보조 링크의 중첩 인터랙티브 요소: 네 항목을 `Button asChild` 안의 `Link`로 바꿔 목적지마다 앵커/menuitem 하나만 남겼다. 회귀는 네 개의 menuitem, 네 개의 고유 href, ArrowDown 이동으로 검사한다.
2. 메뉴 Escape 이벤트 전파: 열린 메뉴의 `document` 핸들러에서 `preventDefault()`를 호출한다. 메뉴는 닫고 포커스를 ⋯ 트리거로 돌리며, AI 패널은 유지되는지 검사한다.
3. 겹침 샘플 시작 시점: 샘플러를 미리 준비하되 실제 click capture 이후 500ms rAF 수집을 시작한다. 기존 500ms와 최소 16px 단언을 유지한다. 650ms 클릭 가림과 클릭 후 150ms 간격 위반을 둔 회귀가 지연된 actionability 뒤의 위반을 잡는다.
4. `docs/manual/user/08-work.md`에 화면 폭이나 AI 어시스턴트로 제목 공간이 줄면 네 링크가 더보기 메뉴로 접힌다는 설명을 더했다.

## TDD 증거

```text
RED — pnpm test:e2e e2e/pages/layout/top-center.spec.ts --grep "접힌 보조 메뉴는 네 목적지" --retries=0 --reporter=line
Expected: 4
Received: 8
Exit code: 1

GREEN — 같은 명령, Button asChild + Link 수정 후
1 passed (6.4s)
Exit code: 0
```

```text
RED — pnpm test:e2e e2e/pages/layout/top-center.spec.ts --grep "접힌 보조 메뉴는 목적지마다" --retries=0 --reporter=line
ArrowDown 이동 단언 이후 Escape 시 ai-side-panel 이 없어져 toBeVisible 실패
Exit code: 1

GREEN — 같은 명령, Escape preventDefault 수정 후
1 passed (6.4s)
Exit code: 0
```

```text
RED — pnpm test:e2e e2e/pages/layout/top-center.spec.ts --grep "레이아웃 샘플은" --retries=0 --reporter=line
650ms 클릭 가림 중 기존 샘플이 먼저 끝나 클릭 후 간격 위반을 놓침; 기대한 failure 값이 undefined
Exit code: 1

GREEN — 같은 명령, click capture 기준 샘플 후
1 passed (4.8s)
Exit code: 0
```

## 최종 검증

```text
pnpm test:e2e e2e/pages/layout/top-center.spec.ts --grep @layout --retries=0 --reporter=line
11 passed (19.6s)
Exit code: 0
```

```text
pnpm test:e2e e2e/pages/layout/top-center.spec.ts --grep @input --retries=0 --reporter=line
1 passed (6.3s)
Exit code: 0
```

두 E2E 실행 모두 `ip: not found` 때문에 네트워크 네임스페이스 격리 없이 진행했다. Playwright의 기존 `NO_COLOR`/`FORCE_COLOR` 경고 외 실패는 없었다.

```text
pnpm exec tsc -p tsconfig.e2e.json --noEmit
출력 없음
Exit code: 0

pnpm exec eslint e2e/pages/layout/top-center.spec.ts src/components/mobile/MobileHeaderMore.tsx src/pages/projects/ProjectDetailPage.tsx
출력 없음
Exit code: 0

pnpm --filter @smart-workplace/workplace-web typecheck
> @smart-workplace/workplace-web@0.0.0 typecheck
> tsc -b --noEmit
Exit code: 0

pnpm --filter @smart-workplace/workplace-web test
Test Files  748 passed (748)
Tests       7945 passed (7945)
Duration    258.31s
Exit code: 0
```

Vitest 로그에는 jsdom canvas/navigation/CSS 미구현 안내가 있었지만 실패한 테스트는 없었다. 전체 로그: `/tmp/wp1415-final-review-vitest.log`.

```text
pnpm manual:check user
OK — user 경로 52개를 장이 모두 덮는다
Exit code: 0

pnpm manual:prose user
[미확인 굵게] 18건 (화면 문구에서 찾지 못함 — 사람이 확인)
  01-introduction.md:47 SSO
  02-login-and-layout.md:98 ○○에서 더 보기
  02-login-and-layout.md:210 새 소식
  03-home.md:81 진행 중 →
  05-chat.md:82 답글 1개
  05-chat.md:97 새 답글 2개
  06-mail.md:77 분류: 프로모션
  06-mail.md:80 분류를 프로모션으로 바꿨어요
  07-calendar.md:133 M365
  10-wiki.md:63 AI
  10-wiki.md:295 하위 페이지도 함께 공유
  10-wiki.md:320 AI
  11-contacts.md:30 외부 연락처 · 개인
  11-contacts.md:30 외부 연락처 · 공유
  11-contacts.md:53 재경팀 ×
  15-agents.md:133 Claude 구독 연결
  16-workspace-settings.md:21 SSO
  19-glossary.md:37 SSO
OK — user 산문 검사 통과 (화면 문구 9018개 수집)
Exit code: 0
```

최종 `git diff --check`: exit 0.

## 매뉴얼 그림과 남은 항목

- 사용자 매뉴얼 그림은 재촬영하지 않았다. `.work-loop/project.md` 규칙에 따라 운영 테넌트 촬영을 하지 않는다.
- 전체 브랜치의 AI 헤더 기하 변경으로 재배치된 AI 칩이 보이는 오래된 그림 id: `work-2`, `work-3`, `work-6`, `work-9`, `ai-collaboration-5`. PR 본문 및 이슈 챗에 `매뉴얼 그림 재촬영 필요`로 알릴 대상이다. `work-1`, `work-5`, `work-7`, `work-8`은 해당 칩이 보이지 않아 목록에서 제외했다.
- 코드·테스트 수정 finding 세 건은 해결했다. push와 live-stack은 실행하지 않았다.
