# 05. 페이지 레이아웃 패턴

Smart Workplace 프론트엔드(`apps/workplace-web`)에서 실제로 반복되는 페이지 레이아웃 구조를 정리한다.
새 페이지를 만들 때 아래 템플릿 중 가장 가까운 것을 기반으로 작성한다.

이 문서의 모든 스켈레톤은 워크플레이스 실제 코드에서 추출한 것이다. 가상의 컴포넌트는 쓰지 않았으며,
패턴이 아직 일관되지 않은 부분은 "As-Is 주의" 로 명시했다.

연관 문서:

- 간격·레이아웃 토큰 — [03-spacing-layout.md](./03-spacing-layout.md)
- 공통 컴포넌트(Table, FormField, Card, Badge 등) — [04-components.md](./04-components.md)
- 로딩/에러/빈 상태 처리 — [06-feedback-states.md](./06-feedback-states.md)

---

## 셸(Shell) 구조 — 모든 페이지의 공통 컨테이너

워크플레이스는 **상단 GNB 가 없다.** 대신 좌측 앱 레일(`AppRail`)이 모듈을 전환하고,
각 페이지는 `AppLayout` 의 `<main>` 안에 렌더된다.

```tsx
// components/layout/AppLayout.tsx
<div className="flex h-screen overflow-hidden bg-background text-foreground">
  <AppRail />
  <main className="relative flex min-w-0 flex-1 flex-col overflow-hidden pt-12 lg:pt-0">
    <Outlet />        {/* ← 여기에 페이지(또는 모듈 레이아웃)가 들어온다 */}
    <GlobalChatDock />
  </main>
</div>
```

핵심 제약:

- `<main>` 은 `flex flex-col overflow-hidden` — 즉 **부모 높이가 고정**되어 있다.
  따라서 마스터-디테일·채팅처럼 내부에서 스크롤을 나눠야 하는 페이지는 `h-full min-h-0` 로 높이를 이어받는다.
- 페이지 최상위 컨테이너는 두 갈래로 나뉜다(아래 As-Is 참고):
  - **콘텐츠 폭 제한형**: `container mx-auto p-6` (projects / issues) 또는 `mx-auto max-w-2xl p-6` (설정 폼)
  - **풀-블리드 분할형**: `flex h-full min-h-0` (메일 / 채팅 / 모듈 레이아웃)

> **As-Is 주의 — 최상위 컨테이너 불일치**
> `ProjectListPage`·`IssueDetailPage` 는 `container mx-auto p-6`,
> `UserListPage` 는 `space-y-6`(패딩 없음, 모듈 레이아웃이 스크롤 담당),
> `ProfileSettingsPage` 는 `mx-auto max-w-2xl ... p-6` 를 쓴다.
> 신규 페이지는 "리스트/상세 = `p-6 space-y-*`", "폼 = `max-w-2xl`" 규칙으로 통일을 권장한다.

### 컨텐츠 헤더 — 옵션 · `PageHeader` · `h-14` 정렬

페이지 상단의 컨텐츠 헤더는 **필수가 아니라 옵션**이다. 두는 경우와 두지 않는 경우의 규칙을 통일한다.

- **헤더 바를 둘 때**: 공용 `PageHeader`(`src/components/layout/PageHeader.tsx`)를 쓴다. 컨테이너가 `flex h-14 shrink-0 ... border-b px-4` 이므로, 2차 사이드바 타이틀 헤더(`sidebarTitleClass`)·홈 헤더와 **같은 `h-14` 로 한 선 정렬**된다. 제목은 사이드바 헤더와 동일한 `appTitleTextClass` 무게를 쓴다. 풀폭 페이지(목록·마스터-디테일·상세)에 적합하다.
- **헤더 바를 두지 않을 때**(문서/설정·가운데 컬럼형): 인-플로우 `<h1>` 제목을 `pageTitleClass`(`text-[28px] leading-[36px] font-semibold tracking-tight`)로 통일한다.
- props 상세는 [04-components.md](./04-components.md) §A-3, 토큰은 [03-spacing-layout.md](./03-spacing-layout.md) Zone 3 참조.

---

## A. 리스트/테이블 페이지

검색 + 테이블 + 페이지네이션으로 구성되는 가장 일반적인 패턴이다.
워크플레이스에는 **(A-1) 정식 테이블형** 과 **(A-2) 카드 리스트형** 두 변형이 공존한다.

### A-1. 테이블형

**실제 적용 페이지**: `UserListPage`, `RoleListPage`, `AuditLogListPage` (모두 `settings/*` 하위)

shadcn `Table` + 공통 상태 컴포넌트(`TableSkeletonRows` / `TableEmptyRow`) + `SimplePagination` 을 조합한다.

```tsx
export default function XxxListPage() {
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounceValue(search, 300);
  const [page, setPage] = useState(0);
  const pageSize = 10;

  const { data, isLoading, isError } = useXxx({
    search: debouncedSearch || undefined,
    page,
    size: pageSize,
  });

  return (
    <div className="space-y-6">
      <h1 className="text-[28px] leading-[36px] font-semibold tracking-tight">목록 제목</h1>

      <SearchInput
        placeholder="검색..."
        value={search}
        onChange={(v) => { setSearch(v); setPage(0); }}
      />

      <div className="rounded-md border">
        <Table aria-label="목록">
          <TableHeader>
            <TableRow>
              <TableHead>컬럼 A</TableHead>
              <TableHead>컬럼 B</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableSkeletonRows columns={2} rows={5} />
            ) : isError ? (
              <TableRow>
                <TableCell colSpan={2} className="text-center text-destructive">
                  데이터를 불러오는데 실패했습니다.
                </TableCell>
              </TableRow>
            ) : data && data.content.length > 0 ? (
              data.content.map((row) => (
                <TableRow
                  key={row.id}
                  tabIndex={0}
                  role="button"
                  aria-label={`${row.name} 상세 보기`}
                  className="cursor-pointer hover:bg-muted/50 transition-colors row-hover"
                  onClick={() => navigate(`/settings/xxx/${row.id}`)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') navigate(`/settings/xxx/${row.id}`); }}
                >
                  <TableCell className="font-medium">{row.name}</TableCell>
                  <TableCell>
                    <Badge variant={row.active ? 'default' : 'secondary'}>
                      {row.active ? '활성' : '비활성'}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableEmptyRow
                colSpan={2}
                message="항목이 없습니다."
                searchKeyword={debouncedSearch || undefined}
                onResetSearch={search ? () => { setSearch(''); setPage(0); } : undefined}
              />
            )}
          </TableBody>
        </Table>
      </div>

      {data && (
        <SimplePagination
          page={page}
          totalPages={data.totalPages}
          onPageChange={setPage}
          totalElements={data.totalElements}
          pageSize={pageSize}
        />
      )}
    </div>
  );
}
```

구조/간격 노트:

- 컨테이너 간격은 `space-y-6` (제목 → 검색 → 테이블 → 페이지네이션).
- 행 클릭은 `cursor-pointer hover:bg-muted/50` + **반드시 키보드 접근성**(`tabIndex`/`role="button"`/`onKeyDown`)을 같이 둔다.
- 검색은 `useDebounceValue(value, 300)` 로 디바운스하고, 검색이 바뀌면 `page` 를 0 으로 리셋.
- 로딩=`TableSkeletonRows`, 빈/검색 0건=`TableEmptyRow` 로 통일(자세한 상태 처리는 [06-feedback-states.md](./06-feedback-states.md)).
- 제목 타이포는 어드민/설정 영역에서 `text-[28px] leading-[36px] font-semibold tracking-tight` 를 쓴다.

### A-2. 카드 리스트형

**실제 적용 페이지**: `ProjectListPage`

테이블이 과한 가벼운 목록은 `<ul role="list">` + 카드(`Link`)로 표현한다.

```tsx
export default function ProjectListPage() {
  const [open, setOpen] = useState(false);
  const { data, isLoading } = useProjects();

  return (
    <div className="container mx-auto p-6 space-y-4">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-semibold">프로젝트</h1>
        <Button onClick={() => setOpen(true)}>+ 새 프로젝트</Button>
      </div>

      {isLoading ? (
        <p className="text-muted-foreground">로딩 중…</p>
      ) : data && data.content.length === 0 ? (
        <p className="text-muted-foreground">아직 프로젝트가 없습니다. 우상단 버튼으로 시작하세요.</p>
      ) : (
        <ul className="space-y-2" role="list">
          {data?.content.map((p) => (
            <li key={p.id}>
              <Link
                to={`/projects/${p.key}`}
                className="block p-4 border rounded hover:bg-accent transition-colors"
              >
                <div className="font-medium">
                  {p.name} <span className="text-muted-foreground">({p.key})</span>
                </div>
                {p.description && (
                  <p className="text-sm text-muted-foreground mt-1">{p.description}</p>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}

      <ProjectCreateDialog open={open} onOpenChange={setOpen} />
    </div>
  );
}
```

구조/간격 노트:

- 생성은 **별도 페이지가 아니라 Dialog**(`ProjectCreateDialog` / `IssueCreateDialog`)로 띄운다 — 워크플레이스의 지배적 생성 패턴. F. 폼 페이지 참고.
- 카드 항목 간격 `space-y-2`, 카드 내부 패딩 `p-4`.
- 헤더: 풀폭 목록은 제목+우측 버튼을 옵션 `<PageHeader title="프로젝트" actions={<Button …/>} />`(`h-14` 정렬)로 두는 것을 권장한다. 헤더 바를 쓰지 않으면 인-플로우 제목은 `pageTitleClass` 로 통일(위 "컨텐츠 헤더" 절). 프로젝트 목록/상세는 이미 적용됨.

> **As-Is 주의**: A-1(테이블)은 `space-y-6` + 패딩 없음, A-2(카드)는 `container mx-auto p-6 space-y-4` 로 간격 스케일이 다르다.
> 같은 "리스트" 의미인데 토큰이 갈리므로 신규 페이지는 한쪽으로 맞추는 것을 권장한다.

---

## B. 모듈 셸 + 2차 사이드바

메일·채팅·드라이브·설정처럼 **하나의 앱(모듈) 안에서 여러 하위 페이지를 오가는** 영역은
`*ModuleLayout` 컴포넌트가 좌측 2차 사이드바를 고정하고 `<Outlet />` 으로 하위 페이지를 갈아끼운다.

**실제 적용**: `SettingsModuleLayout`, `MailModuleLayout`, `ChatModuleLayout`, `DriveModuleLayout`

```tsx
// 공통 골격 (예: SettingsModuleLayout)
export function XxxModuleLayout() {
  return (
    <div className="flex h-full min-h-0 flex-1">
      <XxxSidebar />
      <div className="min-w-0 flex-1 overflow-y-auto">  {/* 메일/채팅은 overflow-hidden */}
        <Outlet />
      </div>
    </div>
  );
}
```

사이드바 자체는 `sidebar-link.tsx` 의 공통 클래스를 쓴다.

```tsx
// components/layout/SettingsSidebar.tsx
<aside className="flex w-56 shrink-0 flex-col border-r bg-sidebar/40">
  {/* 앱 타이틀 헤더 — 레일 마크와 높이(h-14) 정렬 */}
  <div className={sidebarTitleClass}>
    <Settings className="h-[18px] w-[18px] shrink-0 text-muted-foreground" />
    설정
  </div>
  <div className="flex-1 overflow-y-auto p-3">
    <GroupLabel>개인 설정</GroupLabel>
    <nav className="space-y-1">
      {PERSONAL_ITEMS.map(({ label, href, icon: Icon }) => (
        <NavLink key={href} to={href} className={sidebarLinkClass}>
          <Icon className="h-4 w-4" /> {label}
        </NavLink>
      ))}
    </nav>
    {isAdmin && (/* 워크스페이스 관리 그룹 — 어드민 전용 */ null)}
  </div>
</aside>
```

구조/간격 노트:

- 사이드바 폭은 `w-56`(설정) — `shrink-0 border-r bg-sidebar/40` 로 고정.
- 사이드바 최상단 타이틀 헤더는 `sidebarTitleClass`(= `h-14 border-b ...`)로 **레일 앱 마크/홈 헤더와 가로 정렬**한다. 신규 모듈 사이드바도 이 높이를 맞춘다.
- 네비 링크는 반드시 `sidebarLinkClass`(활성=`bg-accent font-medium`)와 `NavLink` 사용. 직접 스타일링하지 말 것.
- `flex h-full min-h-0` 가 핵심: 셸의 고정 높이를 이어받아 사이드바와 콘텐츠가 각자 스크롤한다.
- `MailModuleLayout` 처럼 모듈 전역 상태(작성 도크 Provider, `MailComposeDock`)가 필요하면 레이아웃에서 Provider 로 감싼다.

---

## C. 마스터-디테일 페이지

좌측 목록(마스터) + 우측 상세(디테일)를 한 화면에서 동시에 보는 패턴이다.
모듈 셸(B)의 `<Outlet />` 안쪽에 들어가며, 셸 높이를 `h-full min-h-0` 로 이어받아 좌/우가 독립 스크롤한다.

**실제 적용 페이지**: `MailInboxPage`(목록↔본문), `ContactsPage`(목록↔상세), `DrivePage`(목록↔파일 상세), `ChannelPage`(메시지↔스레드 패널)

### C-1. 목록 ↔ 본문 (메일)

```tsx
export function MailInboxPage() {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  // ...accountId / folder / search 는 URL SearchParams 가 source of truth

  return (
    <div className="flex h-full min-h-0">
      {/* 목록 (마스터) — 모바일에선 전체폭, lg 이상에서 최대 max-w-md */}
      <div className="flex min-w-0 flex-1 flex-col border-r lg:max-w-md" data-testid="mail-list">
        {/* 툴바: 폴더 토글 + 새 메일 + 동기화 + 검색 */}
        <div className="flex flex-col gap-2 border-b p-3">
          {/* ... */}
        </div>

        {/* 목록 본체 — 자체 스크롤 */}
        <div className="flex-1 overflow-y-auto">
          {messages.map((m) => (
            <MessageRow key={m.id} m={m} active={selectedId === m.id} onSelect={() => setSelectedId(m.id)} />
          ))}
        </div>
      </div>

      {/* 본문 (디테일) — lg 미만에서는 숨김(목록만 노출) */}
      <div className="hidden min-w-0 flex-1 lg:block" data-testid="mail-detail-pane">
        <MessageDetailPanel messageId={selectedId} /* ... */ />
      </div>
    </div>
  );
}
```

### C-2. 본문 ↔ 보조 패널 (채팅 스레드)

```tsx
export default function ChannelPage() {
  const [openThreadId, setOpenThreadId] = useState<number | null>(null);

  return (
    <div className="flex h-full min-h-0">
      {/* 채널 본문 컬럼 — 헤더 / 스크롤 영역 / 작성기 수직 스택 */}
      <div className="flex h-full min-h-0 flex-1 flex-col">
        <ChannelHeader channel={channel} /* ... */ />
        <MessageScrollArea depKey={/* ... */}>
          <MessageList messages={messages} onOpenThread={setOpenThreadId} /* ... */ />
        </MessageScrollArea>
        <MessageComposer disabled={channel.archived} onSend={/* ... */} />
      </div>

      {/* 스레드 패널 — 선택 시에만 우측에 렌더 */}
      {openThreadParent && (
        <ThreadPanel parent={openThreadParent} onClose={() => setOpenThreadId(null)} /* ... */ />
      )}
    </div>
  );
}
```

구조/간격 노트:

- 최상위는 항상 `flex h-full min-h-0`. 자식 패널은 `min-w-0 flex-1` 로 폭을 나누고, **스크롤은 안쪽 영역**(`flex-1 overflow-y-auto`)이 담당한다. `min-w-0` 누락 시 긴 텍스트가 flex 컬럼을 밀어내므로 필수.
- 마스터 목록 폭 제한: 메일은 `lg:max-w-md`. 디테일은 `flex-1`(나머지 전부).
- **선택 상태는 로컬 `useState`**(`selectedId`/`openThreadId`)로, 필터/계정/폴더 같은 공유 상태는 **URL SearchParams**로 둔다(메일의 `?folder`, `?q`).
- 반응형: 좁은 화면(`lg` 미만)에선 디테일 패널을 `hidden` 처리하고 목록만 보인다. 보조 패널(스레드)은 조건부 렌더(없으면 본문이 전체폭).
  - 메일·연락처·드라이브의 마스터-디테일은 **`lg` 미만에서 제자리 전환**(목록 표시 중 항목 선택 → 목록 숨김 + 상세 전체폭, 상세에 `‹ 목록` 뒤로가기 버튼 노출)을 추가로 적용한다.
- 선택 없음/로딩/에러 빈 상태는 디테일 패널 내부에서 안내 문구로 처리(메일 "메일을 선택하세요"). [06-feedback-states.md](./06-feedback-states.md) 참고.
- 풀폭 페이지이므로 각 컬럼 상단 헤더(예: `ChannelHeader`, 목록 툴바)는 옵션 `PageHeader`(`h-14`·`border-b`)로 두면 사이드바 헤더와 한 선 정렬된다(위 "컨텐츠 헤더" 절). **메일·연락처·드라이브·채팅 헤더 표준화 완료**(#113, 2026-06-06).
  - 드라이브: 전폭 `PageHeader`(title="드라이브", actions=검색·새 폴더·업로드·휴지통) 아래 **폴더명 breadcrumb 행**을 별도로 둔다(`GET /drive/folders/{id}/path`로 폴더 경로 조회, 깊으면 `…` 접기).
  - 채팅 `ChannelHeader`/`DmHeader`: 내부 높이·타이포를 `h-14`·`appTitleTextClass`로 정렬(기능 무변).

---

## D. 상세 페이지 (사이드바형)

단일 리소스의 본문(메인) + 메타데이터/인라인 편집(우측 aside)을 2열 그리드로 배치하는 패턴이다.
워크플레이스의 대표 상세 화면인 **이슈 상세**가 이 형태다(탭 기반이 아니라 그리드 기반).

**실제 적용 페이지**: `IssueDetailPage`

```tsx
export default function IssueDetailPage() {
  const { key = '', number = '' } = useParams();
  const { data, isLoading } = useIssue(key, Number(number));

  if (isLoading) return <p className="container mx-auto p-6 text-muted-foreground">로딩 중…</p>;
  if (!data) return <p className="container mx-auto p-6 text-destructive">태스크를 찾을 수 없습니다</p>;

  return (
    <div className="container mx-auto p-6 grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-6">
      {/* 메인 컬럼 — 헤더 / 본문 / 자식 / 코멘트 / 챗 */}
      <div className="space-y-4">
        <div>
          <p className="text-sm font-mono text-muted-foreground">{summary.projectKey}-{summary.number}</p>
          <div className="flex items-center gap-3 flex-wrap">
            <IssueTypeSelectPopover /* ... */ />
            <h1 className="text-2xl font-semibold">{summary.title}</h1>
            {/* 헤더 우측 액션: 구독 토글 / 삭제 */}
            <Button variant="outline" size="sm" /* watch toggle */>구독</Button>
            <Button variant="outline" size="sm" onClick={onDelete}>
              <Trash2 className="h-4 w-4 mr-1" /> 삭제
            </Button>
          </div>
        </div>
        <article className="prose dark:prose-invert max-w-none whitespace-pre-wrap">{body}</article>
        <IssueChildrenSection /* ... */ />
        <IssueCommentList /* ... */ />
        <IssueChatSection /* ... */ />
      </div>

      {/* 우측 aside — 인라인 편집 메타 패널 */}
      <aside className="space-y-4">
        <div className="space-y-1">
          <label className="text-sm text-muted-foreground">상태</label>
          <IssueStatusSelect value={summary.status} onChange={(v) => patch({ status: v })} />
        </div>
        <div className="space-y-1">
          <label className="text-sm text-muted-foreground">우선순위</label>
          <IssuePrioritySelect value={summary.priority} onChange={(v) => patch({ priority: v })} />
        </div>
        {/* 담당자 / 라벨 / 사이클 / 첨부 / 의존성 / 커스텀필드 / 활동 ... 각 섹션 */}
      </aside>
    </div>
  );
}
```

구조/간격 노트:

- 레이아웃: `grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-6` — 메인 가변폭 + **고정 280px aside**. 모바일은 1열로 떨어진다.
- 메인/aside 내부 모두 `space-y-4`.
- aside 의 메타 항목은 `<div className="space-y-1"><label .../> <Control/></div>` 패턴으로 라벨+컨트롤을 1쌍씩 쌓는다.
- **인라인 편집(즉시 저장)**: 필드 변경마다 `patch()`(단일 필드 `mutateAsync`) → 성공 토스트 → invalidate 로 재조회. "저장" 버튼 없는 낙관적 UX.
- 헤더 메타 줄은 `flex items-center gap-3 flex-wrap` 로 제목+배지+액션을 한 줄에 흘려놓는다. 풀폭 상세는 이 헤더를 옵션 `PageHeader`(`h-14`·`border-b`, `meta`/`actions` 슬롯)로 표준화해 사이드바 헤더와 정렬할 수 있다(위 "컨텐츠 헤더" 절). 이슈 상세는 이미 적용됨.
- 상태 배지(차단됨 등)는 `bg-destructive/15 text-destructive` 형태의 인라인 칩. 공통 Badge 사용은 [04-components.md](./04-components.md) 참고.

> **As-Is 주의 — 삭제 확인**
> `IssueDetailPage`·`ProjectSettingsPage` 는 브라우저 기본 `confirm()` 으로 삭제를 확인한다.
> 디자인 일관성을 위해 공통 확인 다이얼로그(AlertDialog 기반)로 통일하는 것이 To-Be.
>
> **As-Is 주의 — 상세 컨테이너 갈래**
> "상세" 가 한 형태가 아니다. 이슈 상세는 본문+aside 의 **2열 그리드형**(`container mx-auto p-6 grid ...`),
> 어드민 상세(`UserDetailPage`)는 폼에 가까운 **단일 컬럼 Card 형**(`mx-auto max-w-2xl space-y-6` + `Card`)이다.
> 즉 메타 편집이 많은 리소스는 그리드형(D), 정보 표시·소수 편집은 Card 형(E 에 가까움)을 쓴다.
> 탭(`Tabs`)으로 정보를 나누는 상세 패턴은 워크플레이스에 아직 정착하지 않았다.

---

## E. 설정/폼 페이지

리소스 정보를 편집하는 폼 화면. `react-hook-form` + `zod`(`@hookform/resolvers`)로 검증하고,
shadcn `Card` 로 섹션을 나누며, 항목은 공통 `FormField` 로 감싼다.

**실제 적용 페이지**: `ProfileSettingsPage`(인라인 폼), `ProjectSettingsPage`(인라인 폼).
`MailSettingsPage`·`AssistantSettingsPage` 는 같은 컨테이너 셸(`mx-auto max-w-2xl space-y-6 p-6`)을 쓰되,
폼 본체를 섹션 컴포넌트(`MailAccountsSection` / `PersonalAssistantSection`)로 분리한다.

```tsx
export default function ProfileSettingsPage() {
  const profileForm = useForm<UpdateProfileFormData>({
    resolver: zodResolver(updateProfileSchema),
    defaultValues: { name: '', email: '' },
  });

  const onSubmit = async (data: UpdateProfileFormData) => {
    try {
      await usersApi.updateMe({ name: data.name, email: data.email || undefined });
      toast.success('프로필이 업데이트되었습니다.');
    } catch (error) {
      profileForm.setError('root', { message: extractApiError(error, '입력값을 확인하세요.') });
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      <h1 className="text-[28px] leading-[36px] font-semibold tracking-tight">프로필</h1>

      <Card>
        <CardHeader>
          <CardTitle>프로필 정보</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={profileForm.handleSubmit(onSubmit)} className="space-y-4">
            <FormField label="이름" htmlFor="profile-name" error={profileForm.formState.errors.name?.message}>
              <Input id="profile-name" type="text" maxLength={100} {...profileForm.register('name')} />
            </FormField>
            <FormField label="이메일" htmlFor="profile-email" error={profileForm.formState.errors.email?.message}>
              <Input id="profile-email" type="email" placeholder="email@example.com" {...profileForm.register('email')} />
            </FormField>
            {/* 폼 전역 에러는 root 로 노출 */}
            {profileForm.formState.errors.root && (
              <p className="text-sm text-destructive">{profileForm.formState.errors.root.message}</p>
            )}
            <Button type="submit" disabled={profileForm.formState.isSubmitting}>
              {profileForm.formState.isSubmitting ? '저장 중...' : '저장'}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Separator />

      {/* 독립된 의미 단위(비밀번호 변경 등)는 별도 Card + 별도 useForm 으로 분리 */}
      <Card>
        <CardHeader><CardTitle>비밀번호 변경</CardTitle></CardHeader>
        <CardContent>{/* passwordForm ... */}</CardContent>
      </Card>
    </div>
  );
}
```

구조/간격 노트:

- 컨테이너: `mx-auto max-w-2xl space-y-6 p-6` — 폼은 화면 가운데 정렬 + 가독 폭 제한.
- 섹션 단위로 `Card`(`CardHeader > CardTitle` + `CardContent`)를 쓰고, 섹션 사이는 `Separator`.
- **관심사가 다른 폼은 각각 별도 `useForm`** 으로 분리(프로필 폼 / 비밀번호 폼). 한 폼에 섞지 않는다.
- 모든 입력은 `FormField`(`label`/`htmlFor`/`error` props)로 감싼다 — `Input` 옆에 수동으로 에러 `<p>` 를 붙이지 말 것.
- 검증 즉시성이 필요한 폼(비밀번호 확인 등)은 `useForm({ mode: 'onChange' })`.
- 제출 버튼은 `disabled={isSubmitting}` + 진행 중 라벨("저장 중...").
- 성공은 Sonner 토스트(`toast.success`), 서버 에러는 `setError('root', ...)` 로 폼 상단 인라인 표시(자세히는 [06-feedback-states.md](./06-feedback-states.md)).

> **생성(Create)은 폼 페이지가 아니라 Dialog 가 기본**
> 프로젝트/이슈 생성은 별도 라우트가 아니라 `ProjectCreateDialog`·`IssueCreateDialog`(모달)로 처리한다.
> 풀-페이지 폼은 주로 **편집/설정**에 쓰인다. 새 리소스 생성은 먼저 Dialog 패턴을 검토할 것.

---

## F. 홈 / 캔버스 페이지

AI Native 홈 — 사이드바가 없는 단일 캔버스. 상단 헤더 + 위젯 그리드 + (멀티페이지) 인디케이터로 구성된다.
전역 챗 도크는 셸(`AppLayout`)이 담당하므로 페이지는 콘텐츠만 그린다.

**실제 적용 페이지**: `HomePage` → `HomeShell` / `HomeCanvas`

```tsx
// HomeShell — 헤더(앱 타이틀 + 세션 스위처) + 캔버스
export function HomeShell() {
  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* 홈 헤더 — 사이드바가 없으므로 이 헤더가 앱 타이틀 담당. h-14·border-b 로 타 모듈과 정렬 */}
      <header className="flex h-14 shrink-0 items-center justify-between border-b px-4">
        <div className={appTitleTextClass}>Smart Workplace</div>
        <SessionSwitcher /* ... */ />
      </header>
      <div className="relative flex-1 overflow-hidden">
        <HomeCanvas pages={session.pages} activeIndex={session.activeIndex} onSelectPage={session.setActive} />
      </div>
    </div>
  );
}

// HomeCanvas — 위젯 그리드 + 페이지 인디케이터
export function HomeCanvas({ pages, activeIndex, onSelectPage }: Props) {
  const active = pages[activeIndex];
  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-auto p-6">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {active?.widgets.map((w) => {
            const Widget = getWidget(w.spec.type);
            return Widget ? (
              <Suspense key={w.id} fallback={<Skeleton className="h-32 w-full" />}>
                <Widget params={w.spec.params} />
              </Suspense>
            ) : null;
          })}
        </div>
      </div>
      {/* 멀티페이지일 때만 하단 도트 인디케이터 */}
      {pages.length > 1 && (
        <div className="flex justify-center gap-2 py-2">{/* dots, 활성=bg-ai-accent */}</div>
      )}
    </div>
  );
}
```

구조/간격 노트:

- 홈도 셸 높이를 잇기 위해 `flex h-full flex-col overflow-hidden`.
- 헤더는 `h-14 border-b px-4` — 다른 모듈의 2차 사이드바 타이틀 헤더와 **반드시 같은 높이**로 가로 정렬한다(`appTitleTextClass` 공유).
- 위젯 그리드: `grid grid-cols-1 gap-4 md:grid-cols-2`, 캔버스 패딩 `p-6`.
- 위젯은 **레지스트리(`getWidget`)로 동적 로드** + `Suspense` 폴백 `Skeleton`. 위젯을 늘릴 때 페이지를 고치지 말고 레지스트리에 등록한다.
- AI 강조 색은 전용 토큰 `bg-ai-accent`(인디케이터 활성 등) 사용.

---

## 패턴 선택 가이드

| 상황 | 사용할 패턴 | 대표 페이지 |
|------|-------------|-------------|
| 여러 리소스를 검색/페이지네이션과 함께 나열 | **A-1 테이블형** | `UserListPage` |
| 가벼운 목록(설명 카드 위주) | **A-2 카드형** | `ProjectListPage` |
| 한 모듈 안에서 하위 페이지를 오감 | **B 모듈 셸 + 사이드바** | `SettingsModuleLayout` |
| 목록과 상세를 한 화면에서 동시 표시 | **C 마스터-디테일** | `MailInboxPage`, `ChannelPage` |
| 단일 리소스 본문 + 인라인 편집 메타 | **D 상세(사이드바형)** | `IssueDetailPage` |
| 정보/설정을 편집하는 폼 | **E 설정/폼** | `ProfileSettingsPage` |
| 새 리소스 생성 | **Dialog 우선**(E 참고) | `IssueCreateDialog` |
| AI 캔버스 홈 | **F 홈/캔버스** | `HomeShell` |

---

## 현재(As-Is) 공통 문제점 및 개선 방향(To-Be)

| 현재 문제 | 권장 개선 방향 |
|-----------|---------------|
| 최상위 컨테이너가 `container mx-auto p-6` / `space-y-6` / `mx-auto max-w-2xl` 로 갈림 | 리스트·상세=`p-6 space-y-6`, 폼=`max-w-2xl`, 분할형=`flex h-full min-h-0` 으로 역할별 통일 |
| 로딩 표현이 `<p>로딩 중…</p>` / `TableSkeletonRows` / `Skeleton` 으로 혼재 | 테이블=`TableSkeletonRows`, 단일 리소스=`Skeleton`, 단순 텍스트 폴백 지양 ([06-feedback-states.md](./06-feedback-states.md)) |
| 제목 타이포가 `text-2xl font-semibold`(projects) vs `text-[28px] leading-[36px] ...`(settings) 로 다름 | 인-플로우 제목 토큰 `pageTitleClass`로 통일(설정·어드민·누락 페이지 적용 완료, #113). 나머지 `text-2xl` 페이지는 기회 있을 때 정리. ([03-spacing-layout.md](./03-spacing-layout.md)) |
| 삭제 확인이 브라우저 `confirm()` (이슈/프로젝트 설정) | 공통 확인 다이얼로그(AlertDialog) 컴포넌트로 통일 |
| 탭형 상세 패턴이 없음(그리드형만 존재) | 탭이 필요한 상세가 생기면 `Tabs` 사용 규약을 별도 정의 |
