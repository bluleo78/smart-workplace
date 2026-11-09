# WP-1453 창이 화면보다 길면 창 안에서 스크롤 — 구현 계획

## 증상
「새 이슈」 창에서 「AI 에게 맡기기」를 펼치면 창이 화면(예: 높이 741px)보다 길어지는데, 창에 높이 상한·스크롤이 없고
Radix 가 body 스크롤을 잠가 제목 입력란과 「만들기」 버튼에 닿을 수 없다.

## 원인
공용 `apps/workplace-web/src/components/ui/dialog.tsx` 의 `DialogContent` 기본 클래스에 높이 상한(`max-h`)과
`overflow-y` 가 없다. 그래서 창마다 따로 `max-h-[85dvh] overflow-y-auto` 등을 붙여 왔다
(AddWidgetModal·ExternalContactFormDialog·WikiShareDialog·AgentLocationTokenDialog 등 6곳). 붙이지 않은 창(새 이슈 등 60여 곳)은 모두 같은 위험이 있다.

## 설계(내가 정한 것)
- 창마다 고치지 않고 공용 `DialogContent` 기본 클래스에 `max-h-[calc(100dvh-2rem)] overflow-y-auto` 를 넣는다.
  - `max-w-[calc(100%-2rem)]`(좌우 1rem 여백)과 같은 여백 규칙으로 위아래 1rem 을 남긴다. `dvh` 로 모바일 주소창 변화에도 맞춘다.
  - 창의 `className` 이 뒤에 오고 `cn`(tailwind-merge)이 같은 유틸을 덮으므로, 이미 `max-h-[85dvh]`·`flex flex-col` 로 안쪽 스크롤을 만든 창은 그대로 동작한다.
- 이미 같은 유틸을 붙인 창의 중복 클래스는 이번에 지우지 않는다(동작 같음, 범위 최소화) — 단, 기본값과 완전히 같은 문자열이면 지워도 된다.
- AlertDialog(짧은 확인 창)는 이번 범위 밖.

## 할 일
1. `dialog.tsx` 기본 클래스에 `max-h-[calc(100dvh-2rem)] overflow-y-auto` 추가 + 한국어 주석(무엇·왜, WP-1453).
2. Playwright E2E `@layout`(jsdom 은 넘침·스크롤을 재지 못한다 — `apps/workplace-web/CLAUDE.md` 「테스트 종류 판정」):
   뷰포트 높이 741(폭 데스크톱) → 프로젝트 보드에서 「새 이슈」 창 열기 → 「AI 에게 맡기기」 펼치기(`CreateAiHandoffSection`) →
   - 창(`[data-slot=dialog-content]`)의 위·아래가 뷰포트 안(top ≥ 0, bottom ≤ 741)
   - 창의 scrollHeight > clientHeight(넘치면 창 안에서 스크롤된다)
   - 제목 입력란이 보이고, 창을 스크롤하면 「만들기」 버튼이 보여 클릭할 수 있다(실제 클릭으로 생성 요청이 나가는지까지 — API 모킹은 기존 E2E fixture 를 따른다).
   기존 spec 위치·fixture 를 따른다(예: `e2e/pages/projects/` — 새 이슈 창을 여는 기존 spec 의 도우미를 재사용).
3. 기존 테스트 회귀 없음: `cd apps/workplace-web && pnpm test`, `pnpm typecheck`, `pnpm lint`, 그리고 dialog 를 많이 쓰는 화면이라 `E2E_SERVER=preview pnpm test:e2e`(공유 컴포넌트 — 전체) 는 push 게이트가 돈다. 로컬에서는 새 spec + `e2e/pages/dialog-state-reset.spec.ts` + 새 이슈 창 관련 spec 을 돌린다.

## Review Focus
- 안쪽 스크롤을 직접 만든 창(`flex flex-col max-h-…` + 안쪽 `overflow-y-auto`)에 바깥 스크롤바가 하나 더 생기지 않는지(바깥 max-h 가 안쪽보다 작아지지 않는지).
- 창 안의 팝오버가 portal 이 아니라 absolute 로 그려지는 곳은 잘릴 수 있다 — 대표 창(새 이슈의 담당자·유형 선택, 일정 창 등)에서 팝오버가 portal 인지 확인.
- 닫기 버튼(absolute top-4 right-4)이 스크롤 컨테이너 안이라 스크롤하면 같이 올라간다 — 허용(Esc·바깥 클릭으로 닫힘).
- 모바일 시트(`MobileIssueCreateSheet`)는 DialogContent 를 쓰지 않으면 무관 — 확인만.
