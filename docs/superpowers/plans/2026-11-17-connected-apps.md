# 설정 › API 토큰 「연결된 앱」·끊기, 「Claude 앱에 연결」 Implementation Plan — WP-1687

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 설정 › API 토큰 화면에 내 OAuth 앱 연결 목록(「연결된 앱」)과 끊기를 두고, 「도구에 연결하기」 안에 Claude 앱 커넥터 주소 복사 블록을 더하며, 새 앱 연결 알림·푸시가 그 절로 바로 가게 한다.

**Architecture:** 서버 API 는 그대로 쓴다(WP-1685 `GET/DELETE /api/v1/users/me/oauth-connections`). 웹은 토큰 쪽과 같은 모양의 데이터 계층(`api/oauthConnections.ts`·`hooks/queries/useOAuthConnections.ts`, 타입은 WP-1686 의 `types/oauth.ts`)을 두고, 자기 쿼리·확인 창·앵커 스크롤을 가진 독립 절 `ConnectedAppsSection` 을 토큰 표 아래에 끼운다. Claude 앱 블록은 `TokenConnectGuide` 의 `showClaudeApp` prop 으로 토큰 화면에서만 그린다. 알림 이동 주소는 웹 `notifTarget` 과 서버 `PushContentService` 의 문자열 한 줄씩을 `/settings/tokens#connected-apps` 로 바꾼다.

**Tech Stack:** React 19 + TS + Vite + Tailwind 4 + shadcn/ui, TanStack Query, axios(`api/client.ts`), sonner, vitest + RTL + MSW(`renderScreen`), Playwright(@layout); Spring Boot + JUnit; 매뉴얼 `docs/manual`(node 스크립트).

**Spec:** `docs/superpowers/specs/2026-11-17-connected-apps-design.md` (권위 — 5.2 절 규칙, 5.4 문구 표, 6 테스트, 7 매뉴얼, 8 내가 정한 것). 서버 계약: `docs/superpowers/specs/2026-11-17-oauth-authorization-server-design.md`(WP-1685).

**바탕:** 구현 시작 전에 이 브랜치(feat/wp-1687)는 WP-1686 커밋 위로 rebase 된다(컨트롤러가 한다). 아래 「WP-1686」 표시 파일은 그 커밋이 더한 것이고, 행 번호는 WP-1686 판 기준 「근처」다 — 줄을 찾을 때는 글자로 찾는다.

## Global Constraints

- 서버 API·응답은 바꾸지 않는다. 바꾸는 서버 코드는 `PushContentService` 의 이동 주소 문자열 한 줄뿐이다.
- 응답 꼴(서버 `OAuthConnectionResponse`) `{ id, clientName, unverified, redirectHost(nullable), tenantId, tenantName, createdAt, lastUsedAt(nullable) }` — 웹 타입은 이것과 1:1.
- 연결 목록 쿼리만 `staleTime: 0`, `refetchOnWindowFocus: true`. 토큰 목록 쿼리 설정은 그대로.
- 끊기 결과(성공·실패 모두) `onSettled` 에서 목록 invalidate. 낙관적 제거 없음. 성공 토스트 「앱 연결을 끊었습니다」, 실패 `handleApiError(e, '앱 연결 끊기에 실패했습니다')`.
- 절 보임: 로딩 중 숨김 · 빈 목록 숨김 · 오류면 보임(표 안 한 줄 「연결된 앱을 불러오지 못했습니다」).
- 앵커 id `connected-apps`, 알림·푸시 이동 주소 `/settings/tokens#connected-apps`.
- 도움말 id: 절·끊기 확인 창 `tokens.apps`, Claude 블록 `tokens.claude-app` — 글자 그대로(`manual:check` 가 소스에서 짝을 본다). 매뉴얼 절에 같은 id.
- 날짜: 연결 `formatDateOnly`(YYYY-MM-DD), 마지막 사용 `formatRelativeTime` + `title={formatDateTimeLocale(…)}`, null 이면 `EMPTY_GLYPH`(`—`). `toLocale*` 직접 호출 금지(ESLint).
- 화면 문구는 spec 5.4 표 글자 그대로(Task 1·2·4 에 옮겨 적었다). 「확인되지 않은 앱」 표시는 동의 카드와 같은 `bg-warning-subtle text-warning-text` 작은 글자.
- 모바일(<md) 열 숨김은 토큰 표와 같은 `hidden md:table-cell` + 이름 아래 메타 줄 `flex flex-wrap gap-x-2`, 항목 `whitespace-nowrap`, 워크스페이스만 `truncate`.
- 시맨틱 토큰만(hex 금지), `src/components/ui/*` 수동 편집 금지. 빨간 ghost 단추는 기존 관례 `variant="ghost" size="sm" className="text-destructive hover:text-destructive"`(`AgentKeysSection.tsx`).
- 응답 목 데이터는 E2E·vitest 가 같은 팩토리 `e2e/factories/oauth.factory.ts` 의 `oauthConnection()` 을 쓴다.
- 한국어 주석(무엇을·왜) 필수 — 컴포넌트·훅·주요 분기.
- 커밋: 제목 `<type>(<scope>): <한국어> (WP-1687)`, 본문 `- ` 한 줄(무엇을+왜), 빈 줄, `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. `--no-verify` 금지. 과제마다 커밋하고 나중에 하나로 합친다.
- 금지: 포트 6060/6070/6080/6090/6095/6173/6174/5434 사용, `pnpm dev`·`pnpm db:*`, `git stash`·push·rebase(컨트롤러 몫). 셸 명령은 짧게 — 길면 스크래치패드 스크립트 파일로.

## Review Focus

spec 이 함의하지만 spec 6절 테스트가 지키지 않는, 사람을 먼저 물 다섯 가지(테스트는 소유 과제에 더했다):

1. **공백 없는 긴 앱 이름**(DCR 앱이 스스로 정한 120자 영문 한 덩어리)과 긴 워크스페이스 이름 — 390px 에서 표뿐 아니라 **끊기 확인 창 본문**도 가로로 넘치지 않아야 한다(이름 칸 `min-w-0`, 배지 `shrink-0`, 창 본문 `break-words`). → Task 3 E2E `@layout` 에 공백 없는 이름 줄 + 확인 창 넘침 검사.
2. **끊기 요청이 도는 동안 같은 줄 「끊기」를 다시 누름** — DELETE 가 두 번 나가 두 번째가 404 오류 토스트로 끝난다. 처리 중인 그 줄의 「끊기」는 `disabled`. → Task 2 `끊는 중에는 그 줄의 끊기를 다시 누를 수 없다`.
3. **다른 탭(동의 화면)에서 연결한 뒤 이 탭으로 돌아옴** — 창 포커스로 목록을 다시 읽어 새 줄이 보여야 한다(spec 이 정한 `refetchOnWindowFocus` 를 아무 테스트도 지키지 않는다). → Task 1 `창으로 돌아오면 목록을 다시 읽는다`.
4. **이미 토큰 화면을 보고 있을 때 알림을 눌러 `#connected-apps` 로 이동**(같은 화면, 새 이동) — 마운트 때 한 번만 스크롤하면 이 경우 움직이지 않는다. 이동(`location.key`)마다 한 번 스크롤. → Task 2 `같은 화면에서 해시로 다시 오면 다시 스크롤한다`.
5. **해시로 들어온 뒤 창 포커스·끊기로 목록을 다시 읽음** — 다시 읽을 때마다 절로 끌려가면 안 된다(staleTime 0 이라 자주 다시 읽는다). → Task 2 `다시 읽어도 다시 스크롤하지 않는다`.

---

## File Structure

웹 (`apps/workplace-web/`)
- `src/types/oauth.ts` (WP-1686) — `OAuthConnection` 인터페이스 추가.
- `src/api/oauthConnections.ts` (신규) — 목록·끊기 호출.
- `src/hooks/queries/useOAuthConnections.ts` (신규) — 쿼리 키·목록 쿼리·끊기 mutation.
- `src/pages/settings/components/ConnectedAppsSection.tsx` (신규) — 절·표·모바일 메타·끊기 확인 창·앵커 스크롤.
- `src/pages/settings/connectedApps.test.tsx` (신규) — 절의 화면 테스트(`renderScreen(<ConnectedAppsSection />)`).
- `src/pages/settings/components/ClaudeAppConnect.tsx` (신규) — 「Claude 앱에 연결」 블록.
- `src/pages/settings/components/TokenConnectGuide.tsx` — `showClaudeApp` prop, 접힘 글자.
- `src/pages/settings/TokenSettingsPage.tsx` — 절 배치, `showClaudeApp`.
- `src/pages/settings/tokenSettings.test.tsx` — 새 GET 핸들러, 배치·Claude 블록 테스트.
- `src/components/home/notifTarget.ts` (+`.test.ts`) (WP-1686) — `CONNECTED_APPS_PATH`.
- `src/lib/notifGrouping.test.ts`, `src/components/layout/appRail.test.tsx` — 기대 주소 갱신.
- `e2e/factories/oauth.factory.ts` (WP-1686) — `oauthConnection()` 팩토리.
- `e2e/pages/mobile/api-tokens.spec.ts` — 390px @layout 새 테스트 + 빈 목록 목.
- `e2e/pages/settings/api-tokens.spec.ts`, `e2e/pages/settings/help-context.spec.ts`, `e2e/pages/settings/settings-layout.spec.ts` — 빈 목록 목.

API (`apps/workplace-api/`)
- `src/main/java/com/workplace/notify/push/PushContentService.java` (WP-1686) — 이동 주소.
- `src/test/java/com/workplace/notify/push/PushContentServiceTest.java` (WP-1686) — 기대값.

매뉴얼 (`docs/manual/`)
- `user/12-my-settings.md` (WP-1686 판), `shots/targets.md`, `scripts/scenes/user.mjs`.

---

### Task 1: 「연결된 앱」 데이터 계층과 목록 절

**Files:**
- Modify: `apps/workplace-web/src/types/oauth.ts` (파일 끝, 51행 근처 뒤)
- Create: `apps/workplace-web/src/api/oauthConnections.ts`
- Create: `apps/workplace-web/src/hooks/queries/useOAuthConnections.ts`
- Create: `apps/workplace-web/src/pages/settings/components/ConnectedAppsSection.tsx`
- Modify: `apps/workplace-web/e2e/factories/oauth.factory.ts` (파일 끝)
- Test: `apps/workplace-web/src/pages/settings/connectedApps.test.tsx`

**Interfaces:**
- Produces:
  - `types/oauth.ts`: `export interface OAuthConnection { id: number; clientName: string; unverified: boolean; redirectHost: string | null; tenantId: number; tenantName: string; createdAt: string; lastUsedAt: string | null }` — 주석에 「서버 OAuthConnectionResponse(WP-1685)와 1:1」.
  - `api/oauthConnections.ts`: `listMyOAuthConnections(): Promise<OAuthConnection[]>`(`client.get('/users/me/oauth-connections')`), `revokeMyOAuthConnection(id: number): Promise<void>`(`client.delete(\`/users/me/oauth-connections/${id}\`)`) — `api/userTokens.ts` 와 같은 모양.
  - `hooks/queries/useOAuthConnections.ts`: `oauthConnectionKeys = { mine: ['oauthConnections', 'me'] as const }`, `useMyOAuthConnections()`(useQuery, `staleTime: 0`, `refetchOnWindowFocus: true`), `useRevokeMyOAuthConnection()`(useMutation<void, unknown, number>, `onSuccess` 토스트 「앱 연결을 끊었습니다」, `onError` `handleApiError(e, '앱 연결 끊기에 실패했습니다')`, `onSettled` invalidate `oauthConnectionKeys.mine`).
  - `ConnectedAppsSection.tsx`: `export function ConnectedAppsSection(): JSX.Element | null` (prop 없음).
  - `oauth.factory.ts`: `export function oauthConnection(over: Partial<OAuthConnection> = {}): OAuthConnection` — 기본값 `{ id: 1, clientName: 'Claude', unverified: false, redirectHost: 'claude.ai', tenantId: 1, tenantName: 'Work Loop', createdAt: '2026-11-12T03:00:00Z', lastUsedAt: null }`.

- [ ] **Step 1: 실패하는 테스트를 쓴다** — `connectedApps.test.tsx`. 머리 주석에 「WP-1687 — 설정 › API 토큰 「연결된 앱」 절 화면 테스트, 390px 넘침만 E2E」. 도우미 `open(list: OAuthConnection[] | (() => Response), path = '/settings/tokens')` 가 `renderScreen(<ConnectedAppsSection />, { path, handlers: [http.get('/api/v1/users/me/oauth-connections', …)] })` 로 띄우고 GET 횟수(`gets`)를 센다(Task 2 가 DELETE 를 더한다). TZ 는 vitest 가 `Asia/Seoul` 로 고정한다.

```tsx
test('연결마다 앱·redirect 호스트·워크스페이스·연결일·마지막 사용이 보인다', async () => {
  const threeHoursAgo = new Date(Date.now() - 3 * 3_600_000).toISOString()
  await open([
    oauthConnection({ id: 1, lastUsedAt: threeHoursAgo }),
    oauthConnection({ id: 2, tenantId: 2, tenantName: 'Gen:iA Lab', clientName: 'Claude', createdAt: '2026-11-17T03:00:00Z' }),
    oauthConnection({ id: 3, clientName: 'My Tool', unverified: true, redirectHost: null }),
  ])
  const region = await screen.findByRole('region', { name: '연결된 앱' })
  expect(within(region).getByRole('table', { name: '연결된 앱 목록' })).toBeInTheDocument()
  for (const h of ['앱', '워크스페이스', '연결', '마지막 사용']) expect(within(region).getByRole('columnheader', { name: h })).toBeInTheDocument()
  const r1 = within(screen.getByTestId('oauth-connection-row-1'))
  expect(r1.getByText('Claude')).toBeInTheDocument()
  expect(r1.getByText('claude.ai')).toBeInTheDocument()
  expect(r1.getAllByText('Work Loop').length).toBeGreaterThan(0)      // 데스크톱 칸 + 모바일 메타
  expect(r1.getAllByText('2026-11-12').length).toBeGreaterThan(0)
  expect(r1.getAllByText('3시간 전').length).toBeGreaterThan(0)
  const meta1 = within(screen.getByTestId('oauth-connection-meta-1'))   // 모바일 메타: 스팬 셋
  for (const t of ['Work Loop', '연결 2026-11-12', '사용 3시간 전']) expect(meta1.getByText(t)).toBeInTheDocument()
  expect(within(screen.getByTestId('oauth-connection-meta-2')).getByText('사용 —')).toBeInTheDocument()   // lastUsedAt null
  const r3 = within(screen.getByTestId('oauth-connection-row-3'))
  expect(r3.getByText('확인되지 않은 앱')).toBeInTheDocument()
  expect(r3.queryByText('claude.ai')).not.toBeInTheDocument()          // redirectHost null → 둘째 줄 없음
  expect(within(screen.getByTestId('oauth-connection-row-2')).queryByText('확인되지 않은 앱')).not.toBeInTheDocument()
  // 같은 앱을 두 워크스페이스에 연결해도 줄마다 끊기 접근 이름이 다르다.
  expect(screen.getByRole('button', { name: 'Claude Work Loop 연결 끊기' })).toBe(screen.getByTestId('oauth-connection-revoke-1'))
  expect(screen.getByRole('button', { name: 'Claude Gen:iA Lab 연결 끊기' })).toBe(screen.getByTestId('oauth-connection-revoke-2'))
})

test('빈 목록이면 절이 없다', …)            // await waitFor(() => expect(gets).toBe(1)); queryByRole('region', { name: '연결된 앱' }) === null
test('불러오는 동안에는 절이 없다', …)        // 핸들러가 테스트가 쥔 promise 를 기다림 → gets 1 뒤에도 region 없음 → 끝에 풀어 준다
test('불러오지 못하면 절과 오류 줄이 보인다', …) // 500 → region 안 '연결된 앱을 불러오지 못했습니다'
test('절에 도움말 id tokens.apps 와 앵커 id 가 있다', …) // getByTestId('connected-apps') 의 data-help === 'tokens.apps', id === 'connected-apps'
// Review Focus 3
test('창으로 돌아오면 목록을 다시 읽는다', async () => {
  // 첫 목록 [] → 절 없음. 다음 GET 은 연결 하나.
  // act(() => { focusManager.setFocused(false); focusManager.setFocused(true) })  (@tanstack/react-query 의 focusManager)
  // → findByTestId('oauth-connection-row-1'), gets === 2. afterEach 에서 focusManager.setFocused(undefined).
})
```

- [ ] **Step 2: 실패를 확인한다**
Run: `cd apps/workplace-web && npx vitest run src/pages/settings/connectedApps.test.tsx`
Expected: FAIL — `ConnectedAppsSection`·`oauthConnection` 을 찾을 수 없음.

- [ ] **Step 3: 데이터 계층을 만든다** — 위 Interfaces 의 타입·API·훅·팩토리. 훅 파일 머리 주석에 왜 `staleTime 0`·포커스 다시 읽기인지(연결은 이 탭 밖 — Claude 앱 → 다른 탭 동의 화면 — 에서 생긴다)와 왜 `onSettled` 인지(404 = 다른 곳에서 이미 끊김도 줄이 사라지게)를 적는다.

- [ ] **Step 4: `ConnectedAppsSection` 의 목록 부분을 만든다** — 규칙은 spec 5.2. 정해진 것:
  - `useMyOAuthConnections()` 가 `isLoading` 이거나 성공·빈 배열이면 `null`.
  - `<section id="connected-apps" aria-labelledby="connected-apps-title" data-help="tokens.apps" data-testid="connected-apps" className="space-y-3">`, 제목 `<h2 id="connected-apps-title" className="text-base leading-6 font-semibold">연결된 앱</h2>`, 그 아래 `<div className="rounded-md border"><Table aria-label="연결된 앱 목록">`. 구분선 없음.
  - 열 `앱`(`max-w-[45vw] md:max-w-[260px]`) · `워크스페이스`·`연결`·`마지막 사용`(셋 다 `hidden md:table-cell`) · 빈 머리(`w-20`). `COLUMN_COUNT = 5`. 오류 줄은 `TokenSettingsPage` 오류 줄과 같은 꼴(`colSpan={5} className="py-8 text-center text-destructive"`).
  - 행 `data-testid="oauth-connection-row-{id}"`. 앱 칸: 첫 줄 `flex min-w-0 items-center gap-1.5` 안에 이름(`truncate font-medium`, `title`)과 `unverified` 면 `<span className="shrink-0 rounded-md bg-warning-subtle px-1.5 py-0.5 text-xs font-medium text-warning-text">확인되지 않은 앱</span>`; 둘째 줄 `redirectHost`(`truncate text-xs text-muted-foreground`, null 이면 없음); 셋째 줄 모바일 메타 `data-testid="oauth-connection-meta-{id}"` `md:hidden` — 스팬 셋 `{tenantName}`(`min-w-0 max-w-full truncate`) · `연결 {YYYY-MM-DD}` · `사용 {상대 시각|—}`(둘 다 `whitespace-nowrap`).
  - 마지막 사용 표기는 작은 순수 함수 `lastUsedLabel(at: string | null): string` 를 이 파일에 두어 데스크톱 칸과 메타가 같이 쓴다(null → `EMPTY_GLYPH`).
  - 끊기 칸: `<Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" aria-label={\`${c.clientName} ${c.tenantName} 연결 끊기\`} data-testid="oauth-connection-revoke-{id}">끊기</Button>` — 누르는 동작은 Task 2.

- [ ] **Step 5: 통과를 확인한다**
Run: `cd apps/workplace-web && npx vitest run src/pages/settings/connectedApps.test.tsx`
Expected: PASS (6 tests).

- [ ] **Step 6: 정적 검사**
Run: `cd apps/workplace-web && pnpm typecheck && pnpm lint`
Expected: 오류 없음.

- [ ] **Step 7: 커밋**
```bash
git add apps/workplace-web/src/types/oauth.ts apps/workplace-web/src/api/oauthConnections.ts apps/workplace-web/src/hooks/queries/useOAuthConnections.ts apps/workplace-web/src/pages/settings/components/ConnectedAppsSection.tsx apps/workplace-web/src/pages/settings/connectedApps.test.tsx apps/workplace-web/e2e/factories/oauth.factory.ts
git commit -m "feat(web): 내 OAuth 앱 연결 목록을 「연결된 앱」 절로 보인다 (WP-1687)" -m "- 어떤 앱이 어느 워크스페이스에 내 권한으로 붙어 있는지 이름·주소·연결일·마지막 사용과 함께 보이고, 연결이 없으면 절을 숨긴다" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: 끊기 확인 창과 알림 앵커 스크롤

**Files:**
- Modify: `apps/workplace-web/src/pages/settings/components/ConnectedAppsSection.tsx`
- Test: `apps/workplace-web/src/pages/settings/connectedApps.test.tsx`

**Interfaces:**
- Consumes: Task 1 의 `useRevokeMyOAuthConnection()`(mutate 인자 = 연결 id), `oauthConnection()`, 테스트 도우미 `open`.
- Produces: testid `oauth-connection-confirm-dialog`·`oauth-connection-confirm`·`oauth-connection-cancel`(spec 5.2 의 `-confirm`·`-cancel` 접미).

- [ ] **Step 1: 실패하는 테스트를 더한다** — `open` 에 상태형 목을 더한다: GET 은 지금 `list` 를, `http.delete('/api/v1/users/me/oauth-connections/:id')` 는 `deletes` 에 id 를 쌓고 기본 204 + 그 줄을 `list` 에서 뺀다(응답을 바꾸는 `onDelete` 인자). `scrollIntoView` 는 `vi.spyOn(Element.prototype, 'scrollIntoView')` 로 센다(`setup.ts` 가 빈 구현을 깔아 둔다).

```tsx
test('끊기 → 확인 창에 앱·워크스페이스 → 끊기 → 그 id 로 DELETE 한 번, 줄이 빠지고 토스트', async () => {
  const { user, deletes } = await open([oauthConnection({ id: 1 }), oauthConnection({ id: 2, tenantName: 'Gen:iA Lab', tenantId: 2 })])
  await user.click(await screen.findByTestId('oauth-connection-revoke-2'))
  const dialog = await screen.findByRole('alertdialog')
  expect(dialog).toHaveAttribute('data-help', 'tokens.apps')
  expect(within(dialog).getByRole('heading', { name: '앱 연결 끊기' })).toBeInTheDocument()
  expect(dialog).toHaveTextContent('Claude의 Gen:iA Lab 연결을 끊으시겠습니까? 이 앱은 바로 Gen:iA Works 에 접근할 수 없게 되고, 다시 쓰려면 앱에서 다시 연결해야 합니다.')
  await user.click(within(dialog).getByRole('button', { name: '끊기' }))
  await waitFor(() => expect(screen.queryByTestId('oauth-connection-row-2')).not.toBeInTheDocument())
  expect(deletes).toEqual([2])
  expect(screen.getByTestId('oauth-connection-row-1')).toBeInTheDocument()
  expect(await screen.findByText('앱 연결을 끊었습니다')).toBeInTheDocument()
})
test('확인 창에서 취소하면 DELETE 가 없다', …)        // oauth-connection-cancel 클릭 → alertdialog 사라짐, deletes []
test('이미 끊긴 연결(404)이면 서버 메시지 토스트, 목록을 다시 읽어 줄이 빠진다', …)
  // onDelete: list 에서 그 줄을 빼고 HttpResponse.json({ message: '앱 연결을 찾을 수 없습니다' }, { status: 404 })
  // → findByText('앱 연결을 찾을 수 없습니다'), row 사라짐
test('마지막 연결을 끊으면 절이 사라진다', …)          // 연결 하나 → 끊기 → region '연결된 앱' 없음
// Review Focus 2
test('끊는 중에는 그 줄의 끊기를 다시 누를 수 없다', …)
  // onDelete 가 테스트가 쥔 promise 를 기다림 → 확인 뒤 oauth-connection-revoke-1 toBeDisabled, 다른 줄은 enabled → 끝에 풀어 준다
test('#connected-apps 로 열면 목록이 그려진 뒤 절로 한 번 스크롤한다', …)
  // path '/settings/tokens#connected-apps' → findByTestId('oauth-connection-row-1') 뒤
  // spy 가 한 번, spy.mock.contexts[0] === getByTestId('connected-apps'), 인자 { block: 'start' }
test('#connected-apps 로 열어도 연결이 없으면 스크롤하지 않는다', …) // [] → gets 1 뒤 spy 0회
// Review Focus 5
test('해시로 연 뒤 목록을 다시 읽어도 다시 스크롤하지 않는다', …)
  // 스크롤 1회 → focusManager 로 다시 읽기(gets 2) → 여전히 1회
// Review Focus 4
test('같은 화면에서 해시로 다시 오면 다시 스크롤한다', …)
  // ui = <><NavTo to="/settings/tokens#connected-apps" /><ConnectedAppsSection /></>, path '/settings/tokens'
  // NavTo = 테스트 안 작은 컴포넌트(useNavigate 를 부르는 단추 「이동」). 처음 0회 → 단추 클릭 → 1회
```

- [ ] **Step 2: 실패를 확인한다**
Run: `cd apps/workplace-web && npx vitest run src/pages/settings/connectedApps.test.tsx`
Expected: 새 테스트 FAIL(확인 창·스크롤 없음), Task 1 테스트는 PASS.

- [ ] **Step 3: 끊기 확인 창을 구현한다** — `TokenSettingsPage` 의 폐기 창과 같은 모양.
  - 상태 `const [target, setTarget] = useState<OAuthConnection | null>(null)`. 「끊기」 → `setTarget(c)`. `disabled={revoke.isPending && revoke.variables === c.id}`.
  - `<AlertDialog open={target != null} onOpenChange={(o) => { if (!o) setTarget(null) }}>`, `<AlertDialogContent data-testid="oauth-connection-confirm-dialog" data-help="tokens.apps">`, 제목 「앱 연결 끊기」, 본문 `` `${target.clientName}의 ${target.tenantName} 연결을 끊으시겠습니까? 이 앱은 바로 Gen:iA Works 에 접근할 수 없게 되고, 다시 쓰려면 앱에서 다시 연결해야 합니다.` `` — `AlertDialogDescription` 에 `className="break-words"`(Review Focus 1). 단추 `<AlertDialogCancel data-testid="oauth-connection-cancel">취소</AlertDialogCancel>`, `<AlertDialogAction variant="destructive" data-testid="oauth-connection-confirm" onClick={() => target && revoke.mutate(target.id)}>끊기</AlertDialogAction>`(누르면 창이 닫힌다 — 토큰 폐기와 같다).
  - 창이 닫힌 뒤에도 본문이 사라지는 애니메이션 동안 `target` 이 null 이 되므로, 본문은 `target` 이 있을 때만 그린다(제목은 늘).

- [ ] **Step 4: 앵커 스크롤을 구현한다** — 절 컴포넌트 안 `useEffect`. `useLocation()` 의 `hash === '#connected-apps'` 이고 줄이 하나 이상 그려졌고, 이번 `location.key` 로 아직 스크롤하지 않았을 때만 `sectionRef.current?.scrollIntoView({ block: 'start' })` 하고 그 key 를 `useRef` 에 적는다(이동마다 한 번, 다시 읽기로는 다시 안 함). 주석에 왜(알림에서 「내가 하지 않은 연결」을 곧장 끊는 곳으로, 폐기 토큰이 쌓여 긴 목록을 지나치게)를 적는다.

- [ ] **Step 5: 통과를 확인한다**
Run: `cd apps/workplace-web && npx vitest run src/pages/settings/connectedApps.test.tsx`
Expected: PASS (15 tests).

- [ ] **Step 6: 정적 검사**
Run: `cd apps/workplace-web && pnpm typecheck && pnpm lint`
Expected: 오류 없음.

- [ ] **Step 7: 커밋**
```bash
git add apps/workplace-web/src/pages/settings/components/ConnectedAppsSection.tsx apps/workplace-web/src/pages/settings/connectedApps.test.tsx
git commit -m "feat(web): 연결된 앱을 확인 창을 거쳐 끊고 알림 주소로 오면 절로 스크롤한다 (WP-1687)" -m "- 내가 하지 않은 연결을 바로 끊을 수 있게 하고, 이미 끊긴 연결도 목록에서 사라지며 같은 줄을 두 번 끊지 않는다" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: 토큰 화면에 절을 놓고 390px 를 브라우저로 잰다

**Files:**
- Modify: `apps/workplace-web/src/pages/settings/TokenSettingsPage.tsx:179-183` 근처(토큰 표 `</div>` 와 「도구에 연결하기」 `<section>` 사이)
- Modify: `apps/workplace-web/src/pages/settings/tokenSettings.test.tsx:29-46` 근처(`openTokens`) 와 새 테스트
- Modify: `apps/workplace-web/e2e/pages/mobile/api-tokens.spec.ts` (기존 두 테스트에 목, 새 @layout 테스트)
- Modify: `apps/workplace-web/e2e/pages/settings/api-tokens.spec.ts:25` 근처(`setupTokensMock`)·`:163` 근처(@layout 테스트)
- Modify: `apps/workplace-web/e2e/pages/settings/help-context.spec.ts:30-36` 근처(`mockTokens`)·`:206` 근처(늦은 목록 테스트)
- Modify: `apps/workplace-web/e2e/pages/settings/settings-layout.spec.ts:104` 근처

**Interfaces:**
- Consumes: Task 1·2 의 `ConnectedAppsSection`, `oauthConnection()`.

- [ ] **Step 1: 실패하는 vitest 를 쓴다** — `openTokens(initial, issue?, connections: OAuthConnection[] = [])` 로 세 번째 인자를 더하고 `http.get('/api/v1/users/me/oauth-connections', () => HttpResponse.json(connections))` 를 핸들러에 넣는다(기존 테스트 전부가 이 GET 없이는 「처리 못 한 요청」으로 실패한다 — spec R4).

```tsx
test('연결이 있으면 「연결된 앱」 절이 토큰 표와 「도구에 연결하기」 사이에 있다 (WP-1687)', async () => {
  await openTokens([], undefined, [oauthConnection()])
  const apps = await screen.findByRole('region', { name: '연결된 앱' })
  const tokens = screen.getByRole('table', { name: 'API 토큰 목록' })
  const guide = screen.getByRole('region', { name: '도구에 연결하기' })
  expect(tokens.compareDocumentPosition(apps) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(apps.compareDocumentPosition(guide) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(document.querySelector('[data-help="tokens"]')).toContainElement(apps)
})
test('연결이 없으면 「연결된 앱」 절이 없다 (WP-1687)', …)   // openTokens() → 토큰 표가 보인 뒤 region '연결된 앱' 없음
```

- [ ] **Step 2: 실패를 확인한다**
Run: `cd apps/workplace-web && npx vitest run src/pages/settings/tokenSettings.test.tsx`
Expected: 새 테스트 첫째 FAIL(절 없음), 나머지 PASS.

- [ ] **Step 3: 배치한다** — `TokenSettingsPage` 의 토큰 표 `<div className="rounded-md border" data-help="tokens.list">…</div>` 바로 뒤, 「도구에 연결하기」 `<section>` 앞에 `<ConnectedAppsSection />`(`data-help="tokens"` 칸 안). 파일 머리 주석에 WP-1687 한 줄(「표 아래 「연결된 앱」 — OAuth 앱 연결 목록·끊기, 연결이 없으면 숨김」).

- [ ] **Step 4: vitest 통과를 확인한다**
Run: `cd apps/workplace-web && npx vitest run src/pages/settings/tokenSettings.test.tsx src/pages/settings/connectedApps.test.tsx`
Expected: PASS.

- [ ] **Step 5: E2E 목을 더한다** — 토큰 화면을 여는 네 spec 에서 토큰 목록 목 옆에 빈 연결 목록을 둔다(없으면 503 → 오류 줄이 섞인다): `await page.route(/\/api\/v1\/users\/me\/oauth-connections$/, (route) => route.fulfill({ json: [] }))`(settings-layout 은 같은 파일의 `mockApi(page, 'GET', '/api/v1/users/me/oauth-connections', [])`). help-context 는 `mockTokens` 와 206행 근처 테스트 두 곳, api-tokens 는 `setupTokensMock` 과 163행 근처 @layout 테스트, mobile 은 기존 두 테스트.

- [ ] **Step 6: 390px @layout 테스트를 더한다** — `e2e/pages/mobile/api-tokens.spec.ts`. 응답은 `oauthConnection()` 으로 만든다(`import { oauthConnection } from '../../factories/oauth.factory'`).

```ts
const NO_SPACE_APP = 'SuperLongDynamicallyRegisteredConnectorName'.repeat(3)   // 공백 없는 DCR 이름(Review Focus 1)
test('연결된 앱 — 긴 앱·워크스페이스 이름도 가로 넘침 없이 끊기·요약 줄이 화면 안에, 확인 창도 넘치지 않는다 (WP-1687)', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
  // api-tokens 목은 [], oauth-connections 목은 세 줄:
  //  1: clientName LONG_NAME(공백 있음), tenantName '누리커머스 고객경험 혁신 태스크포스 워크스페이스', lastUsedAt 있음
  //  2: clientName NO_SPACE_APP, unverified true, redirectHost 'very-long-subdomain.connector.example.com'
  //  3: 기본값
  // goto('/settings/tokens') → 각 줄: oauth-connection-revoke-{id} toBeInViewport({ ratio: 1 }),
  //   oauth-connection-meta-{id} 의 「연결 …」·「사용 …」 스팬 scrollWidth <= clientWidth
  // 표의 스크롤러(table.parentElement) scrollWidth <= clientWidth + 1, expectBodyNoHorizontalOverflow(page)
  // 줄 2 의 끊기 → oauth-connection-confirm-dialog 가 보이고 그 상자 x+width <= 390, expectBodyNoHorizontalOverflow(page)
})
```

- [ ] **Step 7: E2E 를 돌린다**
Run: `cd apps/workplace-web && pnpm test:e2e e2e/pages/mobile/api-tokens.spec.ts e2e/pages/settings/api-tokens.spec.ts e2e/pages/settings/help-context.spec.ts e2e/pages/settings/settings-layout.spec.ts`
Expected: 모두 PASS. 새 @layout 이 넘침으로 실패하면 Task 1·2 의 클래스(`min-w-0`·`shrink-0`·`break-words`)를 고친다 — 테스트를 느슨하게 하지 않는다.

- [ ] **Step 8: 정적 검사**
Run: `cd apps/workplace-web && pnpm typecheck && pnpm lint`
Expected: 오류 없음(태그 없는 E2E 는 lint 가 막는다).

- [ ] **Step 9: 커밋**
```bash
git add apps/workplace-web/src/pages/settings/TokenSettingsPage.tsx apps/workplace-web/src/pages/settings/tokenSettings.test.tsx apps/workplace-web/e2e/pages/mobile/api-tokens.spec.ts apps/workplace-web/e2e/pages/settings/api-tokens.spec.ts apps/workplace-web/e2e/pages/settings/help-context.spec.ts apps/workplace-web/e2e/pages/settings/settings-layout.spec.ts
git commit -m "feat(web): API 토큰 화면 토큰 표 아래에 「연결된 앱」 절을 둔다 (WP-1687)" -m "- 외부 도구 연결을 관리하던 같은 화면에서 앱 연결도 보고 끊게 하고, 휴대폰 폭에서 긴 이름도 옆으로 넘치지 않게 한다" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: 「도구에 연결하기」 안 「Claude 앱에 연결」 블록

**Files:**
- Create: `apps/workplace-web/src/pages/settings/components/ClaudeAppConnect.tsx`
- Modify: `apps/workplace-web/src/pages/settings/components/TokenConnectGuide.tsx:16-25`(props)·`:46-54` 근처(3단계 뒤·접힘 앞)·`:59`(접힘 글자)·`:53`(주석)
- Modify: `apps/workplace-web/src/pages/settings/TokenSettingsPage.tsx:198` 근처(`<TokenConnectGuide … showClaudeApp />`)
- Modify: `apps/workplace-web/e2e/pages/settings/api-tokens.spec.ts:163` 근처(@layout 테스트에 한 줄)
- Test: `apps/workplace-web/src/pages/settings/tokenSettings.test.tsx`

**Interfaces:**
- Produces: `export function ClaudeAppConnect({ testIdPrefix }: { testIdPrefix: string }): JSX.Element`; `TokenConnectGuideProps.showClaudeApp?: boolean`(기본 false — 발급 결과 모달은 넘기지 않아 그대로). testid `${p}-claude-app`, `${p}-claude-app-url`, 복사 단추 `${p}-claude-app-url-copy`(`CopyableCommand` 규칙).

- [ ] **Step 1: 실패하는 테스트를 쓴다** — `tokenSettings.test.tsx`.

```tsx
test('「Claude 앱에 연결」이 Claude Code 안내 뒤·다른 도구 접힘 앞에 있고 커넥터 주소를 복사한다 (WP-1687)', async () => {
  const { user } = await openTokens()
  const guide = within(await screen.findByRole('region', { name: '도구에 연결하기' }))
  const block = guide.getByTestId('connect-guide-claude-app')
  expect(block).toHaveAttribute('data-help', 'tokens.claude-app')
  expect(within(block).getByText('Claude 앱에 연결')).toBeInTheDocument()
  expect(block).toHaveTextContent('Claude 앱(데스크톱·웹)의 커넥터 추가 화면에 아래 주소를 넣으세요. 토큰은 필요 없어요 — 로그인한 뒤 동의 화면에서 워크스페이스를 고르고 허용하면 연결됩니다.')
  expect(block).toHaveTextContent('연결한 앱은 위 「연결된 앱」에서 보고 끊을 수 있어요.')
  expect(guide.getByTestId('connect-guide-claude-app-url')).toHaveTextContent(MCP_ENDPOINT)
  // 순서: 3단계 확인 → Claude 앱 → 다른 도구 접힘
  const step3 = guide.getByText('3. 확인')
  const other = guide.getByTestId('connect-guide-other-tools')
  expect(step3.compareDocumentPosition(block) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(block.compareDocumentPosition(other) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(other).toHaveTextContent('다른 도구로 연결 (ChatGPT 등)')
  await user.click(guide.getByRole('button', { name: '커넥터 주소 복사' }))
  await waitFor(async () => expect(await navigator.clipboard.readText()).toBe(MCP_ENDPOINT))
  expect(await screen.findByText('커넥터 주소를 복사했습니다')).toBeInTheDocument()
})
test('토큰 발급 결과 창에는 Claude 앱 블록이 없다 (WP-1687)', …)
  // fillIssueForm → 발급 → findByTestId('token-issue-dialog') 안에 queryByText('Claude 앱에 연결') === null, queryByTestId(/claude-app/) 없음
```
기존 WP-875 테스트(106–136행 근처)는 바꾸지 않아도 통과해야 한다(접근 이름 `연결 주소 복사`·`설치 명령 복사` 그대로).

- [ ] **Step 2: 실패를 확인한다**
Run: `cd apps/workplace-web && npx vitest run src/pages/settings/tokenSettings.test.tsx`
Expected: 새 테스트 첫째 FAIL(`connect-guide-claude-app` 없음).

- [ ] **Step 3: `ClaudeAppConnect` 를 만든다** — `<div className="space-y-1.5 border-t pt-3" data-help="tokens.claude-app" data-testid={\`${p}-claude-app\`}>` 안에 차례로 `<p className="text-sm font-medium">Claude 앱에 연결</p>`, 설명 `<p className="text-xs text-muted-foreground">`(문구는 테스트의 글자), `<CopyableCommand command={MCP_ENDPOINT} label="커넥터 주소" testId={\`${p}-claude-app-url\`} />`, 끝 안내 `<p className="text-xs text-muted-foreground">연결한 앱은 위 「연결된 앱」에서 보고 끊을 수 있어요.</p>`. 머리 주석: 주소가 `MCP_ENDPOINT` 인 까닭(보호 리소스 메타데이터 `resource` 가 요청 공개 원점 기준이라 늘 같다, spec 3절)과 토큰 화면에서만 보이는 까닭.

- [ ] **Step 4: `TokenConnectGuide` 를 고친다** — prop `showClaudeApp?: boolean`(JSDoc: 토큰 화면만 true, 발급 모달은 토큰을 막 발급한 사람에게 토큰 없는 연결을 섞지 않으려 false). 「3. 확인」 블록 뒤·`<Collapsible>` 앞에 `{showClaudeApp && <ClaudeAppConnect testIdPrefix={p} />}`. 접힘 글자를 `다른 도구로 연결 (ChatGPT 등)` 으로, 그 위 주석의 「Claude.ai·ChatGPT 등」을 「ChatGPT 등 — Claude 앱은 위 블록」으로. `TokenSettingsPage` 의 `<TokenConnectGuide tokenSource="saved" testIdPrefix="connect-guide" showClaudeApp />`.

- [ ] **Step 5: E2E 한 줄** — `e2e/pages/settings/api-tokens.spec.ts` 의 「휴대폰 폭에서 연결 안내…(WP-875)」 테스트에 `await expect(guide.getByTestId('connect-guide-claude-app-url')).toBeVisible()` 를 넣는다(기존 가로 넘침 단언이 새 블록까지 잰다).

- [ ] **Step 6: 통과를 확인한다**
Run: `cd apps/workplace-web && npx vitest run src/pages/settings/tokenSettings.test.tsx`
Expected: PASS.
Run: `cd apps/workplace-web && pnpm test:e2e e2e/pages/settings/api-tokens.spec.ts`
Expected: PASS(발급 흐름 @wiring 의 `token-other-tools` 단언은 testid 라 그대로 통과).

- [ ] **Step 7: 정적 검사**
Run: `cd apps/workplace-web && pnpm typecheck && pnpm lint`
Expected: 오류 없음.

- [ ] **Step 8: 커밋**
```bash
git add apps/workplace-web/src/pages/settings/components/ClaudeAppConnect.tsx apps/workplace-web/src/pages/settings/components/TokenConnectGuide.tsx apps/workplace-web/src/pages/settings/TokenSettingsPage.tsx apps/workplace-web/src/pages/settings/tokenSettings.test.tsx apps/workplace-web/e2e/pages/settings/api-tokens.spec.ts
git commit -m "feat(web): 도구에 연결하기에 Claude 앱 커넥터 주소 복사 안내를 더한다 (WP-1687)" -m "- 토큰 없이 OAuth 로 연결하는 Claude 앱에 넣을 주소를 어디서 얻는지 알 수 있게 Claude Code 안내 다음에 둔다" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: 새 앱 연결 알림·푸시가 「연결된 앱」 절로 간다

**Files:**
- Modify: `apps/workplace-web/src/components/home/notifTarget.ts:60-62`·`:79`·`:84` 근처 (WP-1686)
- Modify: `apps/workplace-web/src/components/home/notifTarget.test.ts:141-144` 근처 (WP-1686)
- Modify: `apps/workplace-web/src/lib/notifGrouping.test.ts:306` 근처 (WP-1686)
- Modify: `apps/workplace-web/src/components/layout/appRail.test.tsx:537` 근처 (WP-1686)
- Modify: `apps/workplace-api/src/main/java/com/workplace/notify/push/PushContentService.java:46-56` 근처 (WP-1686)
- Modify: `apps/workplace-api/src/test/java/com/workplace/notify/push/PushContentServiceTest.java:141` 근처 (WP-1686)

**Interfaces:**
- Produces: `notifTarget.ts` 의 `export const CONNECTED_APPS_PATH = '/settings/tokens#connected-apps'` — `TOKEN_SETTINGS_PATH` 를 대신한다(다른 곳에서 쓰지 않는다: `grep -rn TOKEN_SETTINGS_PATH apps/workplace-web/src` 로 확인 뒤 지운다). 앵커 글자 `connected-apps` 는 Task 1 의 절 id 와 같아야 한다(주석으로 서로 가리킨다).

- [ ] **Step 1: 기대값을 먼저 바꾼다**
  - `notifTarget.test.ts`: 테스트 이름 「/settings/tokens#connected-apps 로 연다, …」, 두 `toBe` 를 `'/settings/tokens#connected-apps'`.
  - `notifGrouping.test.ts`: `expect(mine[0].target).toBe('/settings/tokens#connected-apps')`.
  - `appRail.test.tsx`: `location()` 은 pathname+search 만 돌려주므로 `toBe('/settings/tokens')` 는 두고 바로 뒤에 `expect(window.location.hash).toBe('#connected-apps')`.
  - `PushContentServiceTest.forInbox_oauthAppConnected_buildsTokenSettingsMessage`: `assertThat(m.url()).isEqualTo("/settings/tokens#connected-apps");`, Javadoc 의 「설정 › API 토큰을 연다」를 「설정 › API 토큰의 「연결된 앱」 절을 연다(WP-1687)」로.

- [ ] **Step 2: 실패를 확인한다**
Run: `cd apps/workplace-web && npx vitest run src/components/home/notifTarget.test.ts src/lib/notifGrouping.test.ts src/components/layout/appRail.test.tsx`
Expected: 세 곳 FAIL(지금은 `/settings/tokens`).
Run: `cd apps/workplace-api && ./gradlew test --tests "com.workplace.notify.push.PushContentServiceTest"`
Expected: `forInbox_oauthAppConnected_buildsTokenSettingsMessage` FAIL.

- [ ] **Step 3: 구현한다** — `notifTarget.ts` 에서 상수를 `CONNECTED_APPS_PATH` 로 바꾸고 `isOAuthAppConnectedType(n)` 분기가 그것을 돌려준다. 주석(79행 근처 JSDoc 포함)을 「설정 › API 토큰의 「연결된 앱」 절(`/settings/tokens#connected-apps`, WP-1687)」로. `PushContentService` 의 `"/settings/tokens"` 를 `"/settings/tokens#connected-apps"` 로, 위 주석의 「설정 › API 토큰으로 보낸다」를 「설정 › API 토큰의 「연결된 앱」 절로 보낸다(WP-1687)」로. 서비스워커 `safeTarget` 은 해시를 보존하므로(`sw/logic.ts` — pathname+search+hash) 따로 고치지 않는다.

- [ ] **Step 4: 통과를 확인한다**
Run: `cd apps/workplace-web && npx vitest run src/components/home/notifTarget.test.ts src/lib/notifGrouping.test.ts src/components/layout/appRail.test.tsx`
Expected: PASS.
Run: `cd apps/workplace-api && ./gradlew spotlessApply && ./gradlew test --tests "com.workplace.notify.push.PushContentServiceTest"`
Expected: BUILD SUCCESSFUL.

- [ ] **Step 5: 정적 검사**
Run: `cd apps/workplace-web && pnpm typecheck && pnpm lint`
Expected: 오류 없음.

- [ ] **Step 6: 커밋**
```bash
git add apps/workplace-web/src/components/home/notifTarget.ts apps/workplace-web/src/components/home/notifTarget.test.ts apps/workplace-web/src/lib/notifGrouping.test.ts apps/workplace-web/src/components/layout/appRail.test.tsx apps/workplace-api/src/main/java/com/workplace/notify/push/PushContentService.java apps/workplace-api/src/test/java/com/workplace/notify/push/PushContentServiceTest.java
git commit -m "feat(web): 새 앱 연결 알림과 푸시가 연결된 앱 절로 바로 간다 (WP-1687)" -m "- 내가 하지 않은 연결이면 긴 토큰 목록을 지나지 않고 곧장 끊는 곳에 닿게 웹 알림과 푸시의 이동 주소에 앵커를 붙인다" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: 매뉴얼 12장 — 연결된 앱·Claude 앱 주소 복사

**Files:**
- Modify: `docs/manual/user/12-my-settings.md:176-231` 근처 (WP-1686 판), `:117` 근처(알림 종류 절의 링크)
- Modify: `docs/manual/shots/targets.md:230` 근처(my-settings-5)·`:235` 근처 뒤(my-settings-11 새 행)
- Modify: `docs/manual/scripts/scenes/user.mjs:1014-1029` 근처(my-settings-5 장면)

**Interfaces:**
- Consumes: 화면 글자(Task 1·2·4): **연결된 앱**, **끊기**, **앱 연결 끊기**, **확인되지 않은 앱**, **Claude 앱에 연결**, **복사**, **도구에 연결하기**, **다른 도구로 연결 (ChatGPT 등)**, **연결 주소**. 도움말 id `tokens.apps`·`tokens.claude-app`(화면 `data-help` 와 짝).

그림 결정(spec 7절과 다름 — 끝의 「spec 과 다르게 정한 것」 1): 사용자 매뉴얼 촬영 환경은 운영 테넌트이고 「배포되지 않은 기능은 찍을 수 없다」(스킬 `manual-authoring` 「촬영 환경」). my-settings-11 준비(DCR·승인·교환)는 운영에 쓰기라 사람 확인이 필요하다. 그래서 이 과제에서는 **찍지 않는다**: 장면·촬영 대상 표는 배포 뒤 재촬영할 모양으로 고쳐 두고, 본문의 my-settings-5 지시문 `crop=claude+url marks=claude,other,url` 은 그대로 둔다(지금 `boxes.json` 에 `app` 상자가 없어 marks 를 바꾸면 `manual:check` 가 실패한다). my-settings-11 은 지시문 없이 표 행만 넣는다.

- [ ] **Step 1: 본문을 고친다** (스킬 `manual-authoring` 의 문체·도움말 절 규칙)
  - `## 외부 AI 도구를 연결한다` 첫 문단 끝 「…도구에 연결하는 방법을 봅니다」 → 「…도구에 연결하는 방법을 보고, 연결한 앱을 보고 끊습니다」.
  - `### 도구에 연결한다` 그림 뒤 목록 2번: 「Claude 앱은 토큰 없이 연결합니다. **Claude 앱에 연결** 의 커넥터 주소를 씁니다([Claude 앱에 연결한다](#tokens.claude-app)). ChatGPT 같은 다른 도구는 **다른 도구로 연결 (ChatGPT 등)** 을 펼칩니다.」 (번호 셋 = 표식 셋 유지.)
  - `### Claude 앱에 연결한다` → `### Claude 앱에 연결한다 {help=tokens.claude-app label=Claude 앱에 연결}`. 1단계: 「**설정 › API 토큰** 화면 **도구에 연결하기** 의 **Claude 앱에 연결** 에서 커넥터 주소를 **복사** 해 Claude 앱의 커넥터 추가 화면 서버 주소에 넣습니다.」(`https://<회사 주소>/mcp` 문장 삭제). 도움말 패널에서 이 절만 보여도 통하게 「위에서」 같은 기댐을 쓰지 않는다. 끝 문단의 「연결 끊기는 **설정 › API 토큰 › 연결된 앱** 에서 하고」 뒤에 「([연결된 앱을 보고 끊는다](#tokens.apps))」.
  - 117행 근처 링크 `(#claude-앱에-연결한다)` 를 `(#tokens.claude-app)` 로(도움말 id 앵커를 먼저 찾는다 — 스킬 「절 링크」).
  - 새 절 `### 연결된 앱을 보고 끊는다 {help=tokens.apps label=연결된 앱}` 를 「Claude 앱에 연결한다」 절 끝(「동의 화면이 다음 중 하나를…」 목록 뒤), `## 내가 공유한 노트를 모아 본다` 앞에. 담을 것(합니다체, 절차 3단계):
    - 첫 문단: **설정 › API 토큰** 화면 토큰 목록 아래 **연결된 앱** 에 Claude 앱처럼 내 계정으로 연결한 앱이 앱 이름·앱 주소·워크스페이스·연결일·마지막 사용과 함께 보인다. 같은 앱을 다른 워크스페이스에 연결하면 줄이 따로 있다. 연결한 앱이 없으면 **연결된 앱** 이 보이지 않는다.
    - 절차: 1. 끊을 줄의 **끊기** 를 누릅니다. 2. **앱 연결 끊기** 창에서 앱과 워크스페이스를 확인합니다. 3. **끊기** 를 누릅니다. — 이어서 「그 앱은 곧바로 접근이 막히고, 다시 쓰려면 Claude 앱에서 다시 연결합니다.」
    - `> **주의**` 상자: 앱 이름 옆 **확인되지 않은 앱** 이나 내가 연결한 기억이 없는 줄은 바로 끊는다.
    - 한 문장: 비밀번호를 바꾸면 모든 앱 연결이 함께 끊긴다.

- [ ] **Step 2: 촬영 대상 표를 고친다** — my-settings-5 행의 준비 조작을 「**다른 도구로 연결 (ChatGPT 등)** 을 펼친다(배포 뒤 재촬영 — 그때 본문 지시문 marks 를 `claude,app,other,url` 로, 목록을 넷으로)」, 표식 키 칸 `claude,app,other,url`. my-settings-10 행 뒤에 새 행: `| my-settings-11 | /settings/tokens | 김서연 | DCR 등록 → 김서연으로 승인 → 토큰 교환으로 연결 하나를 만들고 찍은 뒤 끊는다(my-settings-10 과 같은 준비, 운영에 쓰기 — 사람 확인 뒤, 끊긴 연결 행·감사가 남는다) | apps | app,workspace,revoke | OAuth 클라이언트(DCR)·연결 하나 |`.

- [ ] **Step 3: 장면을 고친다** — `scenes/user.mjs` my-settings-5: 펼칠 글자 `'다른 도구로 연결 (ChatGPT 등)'`(두 곳), 주소 찾기는 같은 주소가 Claude 블록에도 있어 `getByText` 가 둘을 잡으므로 `page.getByTestId('connect-guide-mcp-endpoint')`, 상자 `claude: [getByText('Claude Code 에 연결', { exact: true }), getByRole('button', { name: '설치 명령 복사' })]`, 새 `app: [getByText('Claude 앱에 연결', { exact: true }), getByRole('button', { name: '커넥터 주소 복사' })]`, `url: [getByText('연결 주소', { exact: true }), getByRole('button', { name: '연결 주소 복사' })]`. 장면 주석에 「WP-1687 — 배포 뒤 다시 찍는다」. my-settings-11 장면은 쓰지 않는다.

- [ ] **Step 4: 검사한다**
Run: `pnpm manual:check user`
Expected: 오류 0 — 특히 `[data-help 짝 없음]` 이 없다(`tokens.apps`·`tokens.claude-app` 짝), `[절 링크 없음]` 이 없다.
Run: `pnpm manual:prose user`
Expected: 통과. 「미확인 굵게」 목록에 이 절의 굵은 글자가 없다(있으면 화면 글자와 맞춘다).
Run: `pnpm test:manual`
Expected: PASS(장면 파일을 바꿨다).

- [ ] **Step 5: 커밋**
```bash
git add docs/manual/user/12-my-settings.md docs/manual/shots/targets.md docs/manual/scripts/scenes/user.mjs
git commit -m "docs(repo): 매뉴얼 12장에 연결된 앱 보기·끊기와 Claude 앱 주소 복사를 쓴다 (WP-1687)" -m "- 동의 화면과 알림이 가리키는 끊는 곳을 도움말에서 찾을 수 있게 하고, 커넥터 주소를 직접 적지 않고 화면에서 복사하게 안내한다" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 6: 이슈에 남길 것을 적어 둔다** — 컨트롤러가 이슈 보고에 옮기도록 과제 결과에 「매뉴얼 그림 재촬영 필요: my-settings-5(배포 뒤, 지시문 marks `claude,app,other,url`·목록 넷), 매뉴얼 그림 촬영 필요: my-settings-11(운영 쓰기 — 사람 확인)」.

---

### Task 7: 라이브 검증 (커밋 없음 — 컨트롤러가 따로 맡긴다)

**Files:** 없음(증거만). 스크린샷 `test-results/exploratory/connected-apps/<ts>/screenshots/`(워크트리 기준, `<ts>` = `date +%Y%m%d-%H%M%S`).

명령은 짧게 쓰고, curl 여러 단계는 스크래치패드에 스크립트 파일로 둔다. OAuth 준비 절차는 WP-1686 계획 Task 9 Step 2 와 같다(DCR `POST <web>/api/v1/oauth/register` redirect `http://127.0.0.1:<임의>/callback` → PKCE S256 → 브라우저로 `<web>/oauth/authorize?…` → 로그인 → 동의 **허용** → 주소창의 code → `POST <web>/api/v1/oauth/token`(form: `grant_type=authorization_code`, `code`, `redirect_uri`, `code_verifier`, `client_id`, `resource`) → `swo_…`).

- [ ] **Step 1: 스택을 띄운다**
Run: `LIVE_STACK_NAME=work-loop scripts/live-stack.sh up <WP-1687 워크트리 절대 경로>`
Expected: API·웹·DB 가 6160/6273/5444 대 포트(금지 포트 아님)로 뜨고 상태 파일 `MAIN/.work-loop/state/live-stack-work-loop.env` 가 생긴다. 화면은 `http://localhost:<WEB_PORT>` 로 연다(127.0.0.1 은 로그인 403).

- [ ] **Step 2: 완료 기준 3 — 연결 없으면 절 없음** — ADMIN 으로 로그인해 `/settings/tokens` 를 연다. 「연결된 앱」 절이 없다. 「도구에 연결하기」 안 「Claude 앱에 연결」과 끝 안내가 보인다. 스크린샷 `01-no-connections.png`. 결과: ☐

- [ ] **Step 3: 완료 기준 1 — 연결이 보인다** — 위 OAuth 준비로 연결 하나(확인되지 않은 앱)를 만든다. 다른 탭에서 동의한 뒤 토큰 화면 탭으로 돌아오면(창 포커스) 새 줄이 보인다. 줄에 앱 이름·redirect 호스트(`127.0.0.1`)·「확인되지 않은 앱」·워크스페이스·연결일(YYYY-MM-DD)·마지막 사용(교환 직후 「방금 전」). 스크린샷 `02-connected-desktop.png`. 감사 로그 화면에 연결 기록(WP-1685)이 있는지 확인만. 결과: ☐

- [ ] **Step 4: 알림 클릭이 절로 이동** — 토큰을 몇 개 발급해 화면을 길게 한 뒤 다른 화면으로 가서, 인박스 「새 앱 연결」을 누른다. 주소가 `/settings/tokens#connected-apps` 이고 「연결된 앱」 절 머리가 뷰포트 위쪽에 있다. 이미 토큰 화면에 있을 때 같은 알림을 눌러도 절로 간다. 스크린샷 `03-notification-anchor.png`. (푸시 클릭은 이 스택에서 볼 수 없으면 「로컬에서 검증할 수 없음 — 서비스워커 safeTarget 이 해시를 보존(테스트 근거)」으로 적는다.) 결과: ☐

- [ ] **Step 5: 완료 기준 4 — 복사** — 「커넥터 주소 복사」를 누르면 토스트 「커넥터 주소를 복사했습니다」, 클립보드가 화면의 주소(로컬 dev 빌드면 `http://localhost:6090/mcp` — 알려진 위험 R2, 운영은 `https://genia-works.iacloud.kr/mcp`)와 같다. 결과: ☐

- [ ] **Step 6: 완료 기준 2 — 끊기 뒤 401** — 끊기 전 `curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer <swo_…>" http://localhost:<API_PORT>/api/v1/auth/me` 가 200. 화면에서 그 줄 **끊기** → 확인 창(앱·워크스페이스 문구) → **끊기** → 줄이 빠지고 토스트 「앱 연결을 끊었습니다」, 마지막 연결이면 절이 사라진다. 같은 curl 이 401. 스크린샷 `04-confirm-dialog.png`·`05-after-revoke.png`. MCP 경유 401 은 이 스택에 MCP 가 없어 API 기준으로 확인(알려진 위험 R1). 결과: ☐

- [ ] **Step 7: 완료 기준 5 — 390px** — 연결 둘(긴 앱 이름 하나 포함)을 만든 상태로 뷰포트 390x844. `document.documentElement.scrollWidth <= 390`, 끊기·메타 줄이 화면 안, 확인 창도 넘치지 않음. 스크린샷 `06-mobile-390.png`·`07-mobile-dialog.png`. 결과: ☐

- [ ] **Step 8: 기록하고 내린다** — 완료 기준 1~5·알림 이동을 한 줄씩(통과/실패·근거 스크린샷) 과제 결과에 적는다. claude.ai 실제 커넥터 연결은 「배포 뒤 사람 확인」으로 남긴다.
Run: `LIVE_STACK_NAME=work-loop scripts/live-stack.sh down`
Expected: 이 이름의 스택만 내려가고 상태 파일이 지워진다(포트 경고가 남으면 남의 것일 수 있으니 죽이지 않는다).

---

## Self-Review

1. **Spec coverage** — 5.1 파일 표: types·api·hooks·ConnectedAppsSection(T1–2), ClaudeAppConnect·TokenConnectGuide·TokenSettingsPage(T3–4), notifTarget·PushContentService(T5), 매뉴얼 파일(T6; help-figures 는 그림을 바꾸지 않아 돌리지 않음). 5.2 보임 규칙·열·모바일·앱 칸·날짜·끊기·확인 창·앵커·testid(T1–2). 5.3 블록(T4). 5.4 문구 표 전부(T1·T2·T4 테스트에 글자 그대로; 실패 토스트 기본값은 T1 훅). 6 테스트: connectedApps 1–6(T1–2), tokenSettings(T3–4), notifTarget(T5), PushContentServiceTest(T5), E2E @layout + 네 spec 목(T3), 라이브(T7). 7 매뉴얼(T6, 그림은 아래 차이 1). 완료 기준 1–5(T7 체크리스트), 6(T6). 빈 곳 없음.
2. **Step scan** — 문구·클래스·이름이 정해지지 않은 단계 없음. 함수 본문은 앵커 스크롤 조건(이동마다 한 번)만 글로 정했다.
3. **Type consistency** — `OAuthConnection`, `listMyOAuthConnections`/`revokeMyOAuthConnection`, `oauthConnectionKeys.mine`, `useMyOAuthConnections`/`useRevokeMyOAuthConnection`, `oauthConnection()`, `ConnectedAppsSection`, `ClaudeAppConnect({ testIdPrefix })`, `showClaudeApp`, `CONNECTED_APPS_PATH`, testid `oauth-connection-*`·`connect-guide-claude-app(-url)` — 모든 과제에서 같은 이름.
4. **Review Focus** — 다섯 줄 모두 소유 과제에 테스트가 있다(1→T3 E2E, 2·4·5→T2, 3→T1).
5. **Proportion** — 코드 블록은 테스트 단언과 정해진 글자뿐, 컴포넌트 본문은 없다.

## spec 과 다르게 정한 것

1. **매뉴얼 그림을 이번에 찍지 않는다**(spec 7: my-settings-5 재촬영·my-settings-11 새로). 사용자 매뉴얼은 운영 테넌트에서 찍고 배포 전 화면은 찍을 수 없으며, my-settings-11 준비는 운영 쓰기라 사람 확인이 필요하다. 장면·촬영 대상 표는 재촬영 모양으로 고치고, 본문 my-settings-5 지시문은 지금 `boxes.json` 과 맞게 그대로(표식 셋·목록 셋), my-settings-11 은 표 행만. 이슈에 「매뉴얼 그림 재촬영 필요」로 남긴다(web CLAUDE.md 「매뉴얼 동반 수정」 규칙).
2. **처리 중인 줄의 「끊기」 비활성**과 **앵커 스크롤을 이동(`location.key`)마다 한 번**으로 — spec 은 「한 번」만 말했다. Review Focus 2·4·5 를 막는 보강이다.
3. spec 6절에 없던 기존 테스트 갱신: `notifGrouping.test.ts`·`appRail.test.tsx`(알림 이동 주소), 매뉴얼 117행 링크를 도움말 id 앵커로.
