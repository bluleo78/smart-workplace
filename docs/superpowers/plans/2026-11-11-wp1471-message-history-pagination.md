# WP-1471 채널·DM 이전 메시지 위로 스크롤 로딩 — 구현 계획

## 문제
채널·그룹 DM 에 메시지가 50개를 넘으면 새로고침 뒤 맨 위로 스크롤해도 이전 메시지를 불러오지 않는다.
`hooks/queries/useChannelMessages.ts` 는 `useInfiniteQuery`(nextCursor)지만, `pages/chat/ChannelPage.tsx`·`pages/chat/DmPage.tsx` 가
`fetchNextPage` 를 `components/chat/MessageScrollArea.tsx` 에 넘기지 않고, 그 컴포넌트에 위쪽 끝 로더가 없다.
메시지 순서: `messages = pages.flatMap(items)`(최신 → 오래된 순), `MessageList` 가 reverse 해 오래된 것이 위.

## 작업 (apps/workplace-web/src)

### 1. useStickToBottom — 최초 위치 잡기 완료 여부 노출
- `hooks/useStickToBottom.ts` 는 지금 ref 만 돌려준다. 호출처(AIChatPanel 등)를 깨지 않게, 최초 위치가 확정됐는지(`initialDone`)를
  알 수 있는 방법을 추가한다(예: 옵션 콜백 `onInitialPositioned`, 또는 별도 반환 — 호출처 grep 해서 최소 변경 선택).
- 확정 조건은 기존 그대로(앵커 스크롤 완료, 또는 앵커 없음 + 하단 이동 + scrollHeight>clientHeight).
  콘텐츠가 화면보다 짧아 확정되지 않는 경우(짧은 채널)도 sentinel 을 켜야 한다 — 「앵커 대기 아님(anchorPending=false, 앵커 id 없거나 찾음) && 데이터 로드됨」이면 켜는 식으로, 첫 렌더 scrollTop 0 에서 연쇄 로드되지 않게 한다.

### 2. MessageScrollArea — 위쪽 로더 + 위치 보존 (최종 설계)
- 새 optional prop `older`(`LoadMoreQuery` + `UseInfiniteQueryResult` 의 `isFetchingNextPage`·`data` — infinite query 결과를 그대로 넘긴다). 없으면 지금과 동일.
- 스크롤 컨테이너 요소를 state 로도 잡는다(안정적인 callback ref 로 useStickToBottom 의 ref 와 합침). 요소가 없을 때·1번 조건 전·첫 페이지 전(pageCount 0)에는 enabled=false(root=null 은 뷰포트로 떨어져 WP-94 문제).
- 로더 행: 공용 `LoadMoreFooter`(WP-182)를 children 위에 둔다 — `root`=컨테이너, `enabled`=위 조건, `className` 으로 **고정 높이 h-10**(py-0), errorLabel 「이전 메시지를 불러오지 못했습니다 — 다시 시도」. `hasNextPage` 인 동안 늘 마운트, 실패하면 sentinel 은 멈추고 다시 시도 버튼(`fetchNextPage()`).
- 위치 보존: `distFromBottom = scrollHeight - scrollTop` 를 ref 에 저장한다 — 저장 시점은 scroll 이벤트, ResizeObserver(컨테이너 + 직속 자식, 렌더 없이 바뀌는 이미지 높이 등), `[depKey, pageCount]` 레이아웃 이펙트(복원 뒤)뿐이다. 렌더마다 재지 않는다(강제 레이아웃). 컬럼이 숨겨져 clientHeight 0 이면 저장·복원 모두 건너뛴다.
- 페이지 수가 1 이상에서 늘면 `useLayoutEffect` 에서 `scrollTop = scrollHeight - saved` 로 **절대값 복원**(브라우저 스크롤 앵커링이 먼저 움직였어도 같은 결과). 복원 이펙트는 저장 이펙트보다 먼저 선언하고, ResizeObserver 콜백은 커밋 뒤에 오므로 붙기 전 값이 쓰인다. `overflow-anchor` 는 바꾸지 않는다. 바닥에 붙어 있으면 saved=clientHeight 라 복원 뒤에도 바닥이다.
- 한국어 주석(무엇을·왜, WP-1471).

### 3. ChannelPage·DmPage 연결
- 두 페이지의 `<MessageScrollArea>` 에 `older={messagesQuery}`(+ 필요 시 pageCount) 를 넘긴다.
- `useConversationLinkJump` 도 fetchNextPage 를 부른다 — `cancelRefetch: false` 라 겹쳐도 안전. 2페이지에 있는 `?message=` 링크 점프가 여전히 그 메시지에 닿는지 확인.

### 4. 테스트
- jsdom 의 IntersectionObserver 는 빈 구현(`src/test/setup.ts`) → vitest 로 로드를 트리거할 수 없다. 존재만 보는 vitest 는 쓰지 않는다.
- `@layout` E2E 1개 파일(기존 채널/DM E2E 위치·팩토리·모킹 패턴을 따라 `e2e/pages/` 아래), 채널 1건 + 그룹 DM 1건:
  - 1페이지 50개 + nextCursor, 2페이지 16개(nextCursor 없음) 모킹.
  - (a) 진입 시 메시지 목록 요청이 정확히 1회(연쇄 로드 없음)
  - (b) 스크롤 컨테이너(`data-testid="message-scroll-area"`)를 맨 위로 → cursor 붙은 요청
  - (c) 기준 메시지(1페이지 가장 오래된 것)의 boundingBox top 이 prepend 전후 ±2px
  - (d) 2페이지 가장 오래된 메시지까지 스크롤해 보인다
  - 고치기 전 코드에서 실패하는 것을 먼저 확인(기록).
- 기존 관련 E2E(채널·DM·스크롤 고정·링크 점프·tabbar 등 chat 관련 spec)와 `pnpm test`(web), `pnpm typecheck`, `pnpm lint` 통과.

### 5. 매뉴얼
- `docs/manual/user/` 의 채널·DM 장에 이전 메시지 스크롤 언급이 없으면 수정 불필요. `pnpm manual:check` 실행.

## 범위 밖
- 스레드 답글 페이징, 이슈 챗 목록.
