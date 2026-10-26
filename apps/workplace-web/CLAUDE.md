# CLAUDE.md (workplace-web)

루트 [CLAUDE.md](../../CLAUDE.md) 와 함께 본다. 본 문서는 프론트엔드 단독 사항만 다룬다.

## 이 앱의 목적

Smart Workplace 의 **단일 SPA**. 인증·프로필·관리자(사용자/역할/감사), 이슈 트래커(프로젝트·칸반 보드·이슈·라벨·subtask·의존성·custom field·Saved View), 이슈 컨텍스트 chat, 팀 채팅(messaging) 을 제공한다.

## Commands

```bash
pnpm dev              # Vite dev (port 6173), /api → 6060 프록시
pnpm build            # tsc 검증 + Vite production 빌드
pnpm preview          # production 빌드 미리보기
pnpm lint             # ESLint
pnpm typecheck        # tsc -b --noEmit
pnpm test             # vitest 단위·페이지·컴포넌트 테스트 (src/**/*.test.ts · *.test.tsx, 3분 안팎 — 페이지 테스트 빼면 40초 안팎)
pnpm e2e:tag-baseline # E2E 판정 태그 기준선(e2e/untagged-baseline.json) 갱신 — 이관 뒤 낮출 때
pnpm test:e2e         # Playwright E2E (Vite dev 자동 기동)
E2E_SERVER=preview pnpm test:e2e  # 빌드 결과물 서빙 (전체 스위트용)
pnpm test:e2e:ui      # Playwright UI 모드
pnpm test:e2e:headed  # 브라우저 창 띄우고 실행
```

## Stack

Vite 7 + React 19 + TypeScript, TanStack Query, React Router v7 (BrowserRouter), shadcn/ui (new-york, Radix + Tailwind 4), Zod + React Hook Form, Axios. Path alias `@/` → `src/`.

## Layered Structure

```
src/
  api/          # axios 도메인별 호출 (auth, users, roles, permissions, auditLogs, files)
  types/        # 백엔드 DTO 와 1:1 매칭되는 TS 인터페이스
  lib/          # api-error, formatters, error-classifier, download, validations/(zod)
  hooks/        # useAuth(AuthContext) + queries/(TanStack Query 훅)
  components/
    ui/         # shadcn primitives (CLI 자동 생성. 수동 편집 금지)
    layout/     # AppLayout (헤더 + 본문 + 테마 토글)
    ProtectedRoute / AdminRoute / PageErrorBoundary
  pages/        # 라우트 페이지 (Login/Signup/Home/Profile + admin/)
```

## Key Patterns

- **API Client** (`src/api/client.ts`): axios `/api/v1` 기본 경로. JWT Bearer 자동 첨부. 401 발생 시 `/auth/refresh` 호출 후 큐잉된 요청 재시도. Access 토큰은 메모리 (localStorage X)
- **Auth** (`src/hooks/AuthContext.tsx`): `AuthProvider` 가 앱을 감싸고 `useAuth()` 에서 `user`, `isAdmin`, `hasRole()`, `login/signup/logout` 제공. 라우트는 `ProtectedRoute` / `AdminRoute` 로 보호
- **Server State**: TanStack Query 훅 (`src/hooks/queries/`). `useQuery` 읽기, `useMutation` + `invalidateQueries()` 쓰기
- **Form Validation**: Zod (`src/lib/validations/`) + `@hookform/resolvers`
- **Error Handling**: `handleApiError()` (`src/lib/api-error.ts`) → `ErrorResponse.message` 추출 + Sonner 토스트
- **Routing** (`src/App.tsx`): 페이지는 `React.lazy()` + `Suspense`. 라우트 트리: `ProtectedRoute > AppLayout > ...`, 관리자는 추가로 `AdminRoute` 감쌈

## Conventions

- **디자인 시스템 필수 참조**: UI 작업(새 페이지·컴포넌트 생성, 기존 UI 수정) 시 반드시 [`docs/design-system/`](../../docs/design-system/index.md)를 참조해 구현한다. 타이포그래피·간격·페이지 패턴·폼·피드백 상태·색상 토큰 등 모든 UI 규칙의 **단일 원본(Single Source of Truth)**. 컴포넌트에는 hex/임의 색 금지 — 시맨틱 토큰(`bg-primary` 등)만 사용.
- **shadcn UI primitives** (`src/components/ui/`) 는 `npx shadcn` CLI 로 추가/갱신. 수동 편집 금지
- **테마**: `next-themes` (dark/light/system)
- **토스트**: Sonner (`toast.success()`, `toast.error()`)
- **한국어 주석 필수**: 컴포넌트·훅·주요 로직 (JSDoc/인라인). 상세는 루트 [코딩 컨벤션](../../docs/CODING_CONVENTION.md)
- **날짜/시간 표시**: `src/lib/formatters.ts` 공용 포매터만 사용. `toLocaleDateString`/`toLocaleString`/`toLocaleTimeString` 직접 호출은 ESLint 가 에러로 막는다. 용도별 선택 표는 [코딩 컨벤션 — 날짜/시간 표시 포맷](../../docs/CODING_CONVENTION.md#날짜시간-표시-포맷-workplace-web)
- **Vite 프록시**: `/api` → `localhost:6060` (SSE 응답은 버퍼링 해제 헤더 자동 추가)

## 테스트 종류 판정 (WP-971)

**새 테스트는 기본이 vitest 다. E2E 는 아래 다섯 가지 중 하나일 때만 쓰고, 그 이유를 태그로 단다.** 태그 없는 E2E 는 lint(`e2e/require-reason-tag`)가 막는다.

| 태그 | E2E 로 쓰는 경우 | 예 |
|---|---|---|
| `@layout` | jsdom 이 잴 수 없는 기하 — 폭·겹침·넘침·잘림·스크롤 위치·정렬·sticky | 360px 에서 ‹ › 가 영상을 덮지 않는다, 헤더 제목과 툴바 x 가 같다 |
| `@input` | 실제 브라우저 입력 — 포커스 이동·복원, IME 조합, 드래그, 길게 누르기, 호버, 붙여넣기, 파일 드롭, 키보드 탐색 | 조합 중 Enter 에도 글자가 남는다, 대화상자를 닫으면 포커스가 돌아온다 |
| `@platform` | 브라우저·외부 연결 — SW/PWA, 다운로드, 클립보드, 실제 SSE·WebSocket·collab 서버, PDF·미디어 렌더, 새로고침 뒤 유지 | 두 사람이 다른 셀을 고쳐도 병합된다 |
| `@wiring` | **화면당 1건** — 라우트 → 페이지 → API → 화면이 실제로 이어진다(대표 정상 흐름) | 이슈 목록에 들어가면 목록 API 결과가 행으로 보인다 |
| `@flow` | 여러 화면을 넘나드는 사용자 흐름 | 라벨을 만들고 → 보드 필터에 적용하면 → URL 에 반영된다 |

`@smoke` 는 위 태그와 함께 쓴다(`tag: ['@wiring', '@smoke']`). `test.describe` 에 단 태그는 그 안의 모든 테스트에 적용된다.

**vitest 로 가는 것** — 브라우저 없이 판정되는 것은 모두:

| 무엇 | 어디에 |
|---|---|
| 포매터·파서·그룹핑·상태 분기·zod 스키마·권한/비활성 판정 | 순수 함수 `*.test.ts` |
| 폼 입력 → API payload, 쿼리 파라미터 | 페이지·컴포넌트 테스트 `*.test.tsx`(MSW 로 요청 검사) |
| API 4xx/5xx → 오류 메시지·다시 시도 | 페이지·컴포넌트 테스트 |
| 권한·역할·조건부 렌더(보인다/안 보인다/비활성) | 페이지·컴포넌트 테스트 |
| 유효성 검사가 UI 오류로 보임 | 페이지·컴포넌트 테스트 |
| 빈 화면·로딩·실패 상태, 배지·칩·라벨 문구 | 페이지·컴포넌트 테스트 |
| 저장 뒤 목록 갱신(캐시 무효화), URL 상태·이동 | 페이지·컴포넌트 테스트(MemoryRouter) |

**애매하면**: 「jsdom 에서 이 단언이 거짓으로 통과하거나 잴 수 없는가?」 그렇다면 E2E, 아니면 vitest.

품질 기준 — **입력 → 처리 → 출력 전체 파이프라인**은 그대로다. 위치만 바뀐다(요소 존재만 보면 어디서든 안 된다):
1. 폼 입력 → API payload 검증
2. API 응답 → UI 반영(셀 단위로 표/카드 검증)
3. 필터/검색 → API query param 검증
4. 상태 변경 → UI 즉시 반영
5. 에러 처리(4xx/5xx 메시지 표시)
6. 유효성 검사(zod 룰이 UI 에러로 반영되는지)

E2E 를 vitest 로 옮길 때는 옮긴 테스트마다 로직을 일부러 깨 새 테스트가 실패하는지 확인하고, 화면의 `@wiring` 1건은 남긴다. 옮긴 뒤 `pnpm e2e:tag-baseline` 으로 기준선을 낮춘다.

## 단위·페이지 테스트 (vitest)

- 설정: `vitest.config.ts` — 프로젝트 둘. **node**: `src/**/*.test.ts`(DOM 이 필요한 파일만 `// @vitest-environment jsdom`). **dom**: `src/**/*.test.tsx`(jsdom + React Testing Library + MSW, 셋업 `src/test/setup.ts`)
- pre-commit(web 변경 시)은 **페이지 테스트를 뺀 전체**(`VITEST_SKIP_PAGE_TESTS=1`, 40초 안팎), pre-push 는 **페이지 테스트까지 전체**(3분 안팎)를 돌린다 — 게이트에 없던 동안 3건이 깨진 채 방치됐었다(WP-79). 페이지 테스트는 파일마다 App 전체를 띄워 파일당 10초 안팎이 든다(WP-995)
- **순수 함수(`*.test.ts`)**: 화면 안의 한 줄짜리 권한·비활성 판정도 순수 함수로 꺼내 지킨다(예: `lib/projectPermissions`·`lib/driveRowActions`·`lib/issueRowMenu`)
- **페이지 테스트(`*.test.tsx` + `renderPage`, WP-971)**: `renderPage(path, { user, roles, handlers })`(`src/test/renderPage.tsx`)가 실제 라우트 트리(App)·인증(AuthProvider)·토스트를 띄운다 — E2E 의 `authenticatedPage` + `goto` 와 같은 상태. 훅을 `vi.mock` 으로 끊지 않고 **MSW 로 네트워크 계층에서 모킹**한다(`handlers` 에 `http.get(...)` 등). 응답 데이터는 E2E 와 같은 팩토리(`e2e/factories/`)를 쓴다. 예: `src/pages/projects/issueRowMenu.test.tsx`·`src/pages/drive/driveSpaceCreate.test.tsx`
  - 앱 셸이 늘 부르는 부가 조회는 `src/test/msw/baseHandlers.ts` 가 빈 성공으로 깐다(E2E `setupAuthMocks` 와 같은 목록). **핸들러가 없는 요청은 테스트 실패**다(E2E 의 「모킹 누락은 503」과 같은 원칙) — 화면 데이터(목록·쿼터 등)는 테스트가 준다
  - 첫 `findBy*` 에는 `{ timeout: PAGE_LOAD_TIMEOUT }` — 워커가 페이지 모듈을 처음 불러오는 데 5~6초가 든다. 그 뒤 단언은 기본값
  - 주소 이동은 반환값 `location()` 으로 단언한다. 쓰기 요청은 핸들러에서 `request.json()` 을 모아 비교한다
  - 글자 입력은 키 하나하나가 의미 있을 때만 `user.type`(키당 약 25ms), 값만 채우면 `user.paste`·`fireEvent.change`
  - Radix 하위 메뉴는 호버 대신 키보드(포커스 → `{ArrowRight}`)로 연다 — jsdom 은 레이아웃이 없어 호버로 연 하위 메뉴가 포인터를 옮기는 순간 닫힌다
  - 모바일 화면은 파일 맨 위(첫 `renderPage` 전)에서 `mockViewport()`(`src/test/viewport.ts`, iPhone 13 폭·터치 포인터)를 한 번 부른다 — matchMedia 결과가 파일 안에서 캐시되므로 한 파일은 뷰포트 하나만 쓴다
  - 「같은 틱에 두 번 클릭」 같은 경합은 `fireEvent` 대신 `act(() => { el.dispatchEvent(...); el.dispatchEvent(...) })` — `fireEvent` 는 매번 다시 그려 두 번째 클릭이 disabled 에 막힌다
- **컴포넌트 테스트(`*.test.tsx` + `renderWithProviders`, WP-413)**: 컴포넌트 하나만 볼 때. QueryClient(재시도 끔)·MemoryRouter·고정 AuthContext·TooltipProvider 로 감싸고 데이터 훅은 `vi.mock` 으로 끊는다(예: `IssueAttachmentStrip.test.tsx`). 훅은 `renderHook`

## E2E Testing (Playwright)

- 설정: `playwright.config.ts`. 테스트: `e2e/`. baseURL 은 런마다 20000번대 랜덤 `E2E_PORT` 로 자체 Vite 를 띄운다(`CI` 일 때만 6173)
- 서버 모드: 기본 dev(즉시 기동, 소수 spec·디버그용) / `E2E_SERVER=preview`(포트별 임시 디렉토리에 빌드 후 `vite preview`, 전체 스위트용). pre-push 와 pre-commit 의 전체 E2E 경로는 preview, 도메인 한정 경로는 dev
- E2E 가 강제 종료(SIGKILL·timeout)돼 남은 webServer(동기화 테스트 서버·20000번대 dev·preview)는 다음 E2E 가 전역 락을 잡은 뒤 정리한다 — 부모가 Playwright 러너가 아닌 그룹 우두머리만, 명령줄 전체가 같을 때만(`scripts/e2e-orphan-webservers.mjs`, WP-972)
- 로컬 E2E·pre-commit·pre-push 게이트는 **6173 dev 서버를 쓰지 않는다** — push/테스트 전에 6173 을 확인·종료할 필요 없음(병렬 세션 dev 서버 kill 금지)
- 백엔드 없이 동작 — `page.route()` 로 API 모킹
- **모든 테스트에 판정 태그**(`@layout`·`@input`·`@platform`·`@wiring`·`@flow`) — 위 「테스트 종류 판정」. 이관 전 테스트는 `e2e/untagged-baseline.json` 의 파일별 수만큼만 허용하고 늘면 lint 오류다(WP-971)
- 모킹 데이터는 `src/types/` 의 타입 적용 (API 스펙 변경 시 컴파일 에러)
- 타입 체크: `npx tsc -p tsconfig.e2e.json --noEmit`
- **고정 대기(`waitForTimeout`) 지양**: 양성 대기는 조건 대기(`expect.poll`·`toBeVisible`·`waitForResponse`)로, 앱 타이머(디바운스·지연 삭제 등)는 `page.clock` 으로 경과시킨다. "N 초 동안 일어나지 않음" 부재 확인처럼 불가피한 경우만 사유 주석과 함께 둔다(WP-82)
- 에러 토스트는 fixture 가 포인터 이벤트를 통과시킨다 — 모킹 누락 API 의 에러 토스트가 버튼을 덮어 클릭이 ~4초씩 지연되던 문제(`e2e/fixtures/auth.fixture.ts`)

### 디렉토리

- `e2e/factories/` — 모킹 데이터 팩토리 (`auth.factory.ts` 등)
- `e2e/fixtures/` — fixture (`auth.fixture.ts` 가 인증/관리자 상태의 page 주입)
- `e2e/pages/` — 페이지별 상세 spec
- (추후) `e2e/flows/` — 유저 플로우 시나리오

### Smoke 분류

빠른 회귀 검증을 위해 `@smoke` 태그 사용(판정 태그와 함께 단다). 분류 기준 (firehub 정책과 동일):

**Smoke 인 것**
- Happy path — 정상 입력 + 정상 응답에서 기본 결과
- 핵심 사용자 경로 — 페이지 진입 + 대표 CRUD 1개
- 깨지면 도메인 전체가 사실상 불능

**Smoke 아닌 것**
- 에지 케이스, 4xx/5xx, 권한 거부, 토큰 만료
- 회귀 검증 전용, UI 미세 동작(호버/툴팁), 통합 시나리오

부착:
```ts
test('로그인 페이지가 보인다', { tag: ['@wiring', '@smoke'] }, async ({ page }) => { ... })
```

### 테스트 작성 의무

프론트엔드 코드 수정/신규 기능에는 **반드시 회귀 테스트**를 동반한다. 테스트 없는 변경은 완료로 간주하지 않는다.
어디에 쓸지는 위 「테스트 종류 판정」을 따른다 — 기본은 vitest(순수 함수·페이지 테스트), 브라우저가 필요한 이유가 있을 때만 태그를 단 E2E.

## AI 화면 컨텍스트 (WP-54)

새 화면에서 AI 가 "이거" 를 알게 하려면 `src/lib/aiScreenContext/builders/` 에 순수 builder 를 두고, 페이지에서 `useRegisterAiScreenContext` 를 **화면당 1회, early return 전에** 등록한다(React Compiler memo lint 가 불평하면 primitive deps 를 받는 모듈 레벨 훅으로 분리). 로드되지 않은 데이터는 절대 보내지 않고, `refs` 키는 MCP 도구 인자명과 일치시킨다. 칩은 `src/components/ai/ScreenContextChip.tsx`(× = 다음 전송 1회만 제외, "되돌리기" 가능), 전송은 `AIChatPanel` 이 처리한다. AI 입력을 열어둔 채 써야 하는 엔티티 다이얼로그는 `useAiPanelAwareDialog`(`src/components/ai/useAiPanelAwareDialog.tsx`)를 쓴다 — side 모드 전용이며 페이지 영역만 inert 처리. 알려진 한계: `/drive/attachments` 뷰(`DriveAttachmentsView`)의 첨부 미리보기는 컨텍스트를 등록하지 않고(드라이브 파일 미리보기는 등록한다), 전체화면 AI 모드에서는 엔티티 다이얼로그가 여전히 modal 이다.
