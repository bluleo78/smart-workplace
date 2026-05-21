# CLAUDE.md (workplace-web)

루트 [CLAUDE.md](../../CLAUDE.md) 와 함께 본다. 본 문서는 프론트엔드 단독 사항만 다룬다.

## 이 앱의 목적

Smart Workplace 의 **단일 SPA**. 현재 인증·프로필·관리자 페이지(사용자/역할/감사) 를 제공한다.

## Commands

```bash
pnpm dev              # Vite dev (port 6173), /api → 9090 프록시
pnpm build            # tsc 검증 + Vite production 빌드
pnpm preview          # production 빌드 미리보기
pnpm lint             # ESLint
pnpm typecheck        # tsc -b --noEmit
pnpm test:e2e         # Playwright E2E (Vite dev 자동 기동)
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

- **shadcn UI primitives** (`src/components/ui/`) 는 `npx shadcn` CLI 로 추가/갱신. 수동 편집 금지
- **테마**: `next-themes` (dark/light/system)
- **토스트**: Sonner (`toast.success()`, `toast.error()`)
- **한국어 주석 필수**: 컴포넌트·훅·주요 로직 (JSDoc/인라인). 상세는 루트 [코딩 컨벤션](../../docs/CODING_CONVENTION.md)
- **Vite 프록시**: `/api` → `localhost:9090` (SSE 응답은 버퍼링 해제 헤더 자동 추가)

## E2E Testing (Playwright)

- 설정: `playwright.config.ts`. 테스트: `e2e/`. baseURL `http://localhost:6173`
- 백엔드 없이 동작 — `page.route()` 로 API 모킹
- 모킹 데이터는 `src/types/` 의 타입 적용 (API 스펙 변경 시 컴파일 에러)
- 타입 체크: `npx tsc -p tsconfig.e2e.json --noEmit`

### 디렉토리

- `e2e/factories/` — 모킹 데이터 팩토리 (`auth.factory.ts` 등)
- `e2e/fixtures/` — fixture (`auth.fixture.ts` 가 인증/관리자 상태의 page 주입)
- `e2e/pages/` — 페이지별 상세 spec
- (추후) `e2e/flows/` — 유저 플로우 시나리오

### Smoke 분류

빠른 회귀 검증을 위해 `@smoke` 태그 사용. 분류 기준 (firehub 정책과 동일):

**Smoke 인 것**
- Happy path — 정상 입력 + 정상 응답에서 기본 결과
- 핵심 사용자 경로 — 페이지 진입 + 대표 CRUD 1개
- 깨지면 도메인 전체가 사실상 불능

**Smoke 아닌 것**
- 에지 케이스, 4xx/5xx, 권한 거부, 토큰 만료
- 회귀 검증 전용, UI 미세 동작(호버/툴팁), 통합 시나리오

부착:
```ts
test('로그인 페이지가 보인다', { tag: '@smoke' }, async ({ page }) => { ... })
```

### 테스트 작성 의무

프론트엔드 코드 수정/신규 기능에는 **반드시 해당 UI 및 로직에 대한 E2E 회귀 테스트** 동반. 테스트 없는 변경은 완료로 간주하지 않는다.

품질 기준 — **입력 → 처리 → 출력 전체 파이프라인** 검증 (요소 존재만 보면 안 됨):
1. 폼 입력 → API payload 검증 (`route.request().postDataJSON()`)
2. API 응답 → UI 반영 (셀 단위로 표/카드 검증)
3. 필터/검색 → API query param 검증
4. 상태 변경 → UI 즉시 반영
5. 에러 처리 (4xx/5xx 메시지 표시)
6. 유효성 검사 (zod 룰이 UI 에러로 반영되는지)
