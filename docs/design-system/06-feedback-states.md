# 06. Feedback States

로딩, 빈 상태, 에러, 토스트 등 사용자 액션에 대한 피드백 UI 패턴을 정의한다.

Smart Workplace(이슈 트래커 + chat + 메일 + 연락처 + 홈)의 모든 비동기 흐름에 적용된다.

> 관련 문서: [04. Components](./04-components.md) · [07. Iconography](./07-iconography.md) · [09. Form Patterns](./09-form-patterns.md)

---

## A. Loading States (로딩 상태)

기본 로딩 플레이스홀더는 `Skeleton`(`components/ui/skeleton.tsx`)이다. 구현은 단순하다:

```tsx
// skeleton.tsx
<div className="bg-accent animate-pulse rounded-md" {...props} />
```

### 1. Page-level Skeleton (페이지 수준 스켈레톤)

페이지 전체 데이터가 로드되기 전 레이아웃 구조를 미리 보여준다.

```tsx
function PageSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-8 w-64" />    {/* 페이지 타이틀 */}
      <Skeleton className="h-96 w-full" /> {/* 콘텐츠 블록 */}
    </div>
  );
}
```

### 2. Table Skeleton (테이블 스켈레톤)

테이블 데이터 로드 중 행 구조를 유지한다. 직접 작성하지 말고 공통 컴포넌트 `TableSkeletonRows`([04 §B-9](./04-components.md))를 사용한다.

```tsx
<TableBody>
  {isLoading ? (
    <TableSkeletonRows columns={5} rows={10} widths={['w-24','w-full','w-32','w-16','w-12']} />
  ) : (
    items.map((it) => <TableRow key={it.id}>...</TableRow>)
  )}
</TableBody>
```

> `columns` 는 **필수**, `rows` 기본값은 5, `widths` 로 컬럼별 너비를 맞춘다.

### 3. Inline Spinner (인라인 스피너)

버튼/인라인 요소 내부에서 처리 중임을 나타낸다. Lucide `Loader2` + `animate-spin`.

```tsx
<Button type="submit" disabled={isSubmitting}>
  {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
  저장
</Button>
```

### 4. Widget Spinner (위젯 중앙 스피너)

홈 위젯/카드 내부 중앙에 표시한다.

```tsx
function WidgetLoading() {
  return (
    <div className="flex items-center justify-center h-full">
      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
    </div>
  );
}
```

### 5. Full-page Loading (전체 페이지 로딩)

라우트 lazy 로딩의 `Suspense` fallback 으로 사용한다. 워크플레이스는 라우트를 `React.lazy()` + `Suspense` 로 분할한다(`App.tsx`).

```tsx
function FullPageLoading() {
  return (
    <div className="flex items-center justify-center min-h-screen">
      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
    </div>
  );
}

<Suspense fallback={<FullPageLoading />}>
  <PageComponent />
</Suspense>
```

---

### Skeleton 크기 규칙

| 맥락 | 클래스 |
|------|--------|
| 페이지 타이틀 | `<Skeleton className="h-8 w-64" />` |
| 콘텐츠 블록 | `<Skeleton className="h-96 w-full" />` |
| 테이블 셀 (TableSkeletonRows 내부) | `<Skeleton className="h-4 w-full" />` |
| 카드 통계값 | `<Skeleton className="h-8 w-24" />` |
| 아바타 | `<Skeleton className="h-8 w-8 rounded-full" />` |

---

## B. Empty States (빈 상태)

### 테이블 빈 상태 — `TableEmptyRow`

직접 작성하지 말고 공통 컴포넌트 `TableEmptyRow`([04 §B-8](./04-components.md))를 사용한다. **검색어 유무로 두 가지 UI 가 분기**된다.

- `searchKeyword` 있음 → "`'<keyword>'`에 대한 결과가 없습니다." + `SearchX` 아이콘 + (옵션) "검색 초기화" 버튼
- 검색어 없음(진짜 0건) → `message` + (옵션) `emptyAction` CTA

```tsx
<TableBody>
  {items.length === 0 ? (
    <TableEmptyRow
      colSpan={5}
      searchKeyword={search || undefined}
      onResetSearch={() => setSearch("")}      // 검색 0건일 때 "검색 초기화" 버튼
      message="등록된 이슈가 없습니다."
      emptyAction={<Button size="sm" onClick={openCreate}>새 이슈</Button>}
    />
  ) : (
    items.map((it) => <TableRow key={it.id}>...</TableRow>)
  )}
</TableBody>
```

> `onResetSearch` 의 "검색 초기화" 는 `SearchInput`([04 §B-3](./04-components.md))의 clear(X) 버튼과 동일하게 `setSearch("")` 로 연결한다 — 사용자가 어디서든 동일하게 검색을 비울 수 있다.

### 일반 빈 상태 (테이블 외)

목록이 카드/그리드 형태일 때는 아이콘 + 메시지 + 액션 패턴을 사용한다. 빈 상태에는 **항상 다음 행동(예: "새로 만들기")을 제공**한다.

```tsx
function EmptyState({ icon: Icon, title, description, action }: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
      <Icon className="h-10 w-10 text-muted-foreground" />
      <div className="space-y-1">
        <p className="text-sm font-medium">{title}</p>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
      </div>
      {action}
    </div>
  );
}

// 사용 예시 — 메일함이 비었을 때
<EmptyState
  icon={Inbox}
  title="받은 메일이 없습니다"
  description="새 메일이 도착하면 여기에 표시됩니다"
  action={<Button size="sm" onClick={onCompose}><Plus /> 메일 작성</Button>}
/>
```

**원칙**: 빈 상태는 항상 생산적인 액션을 포함한다.

---

## C. Error States (에러 상태)

### 1. Inline Error (인라인 에러)

폼 필드 에러는 `FormField` 의 `error` prop 으로 표시된다([09 §G](./09-form-patterns.md)). 직접 표기 시:

```tsx
<p className="text-sm text-destructive">{error}</p>
```

### 2. Toast Error (토스트 에러)

API 호출 실패 등 비동기 에러에 사용한다. 워크플레이스는 토스트 래퍼 함수를 표준화해 두었다 — `lib/api-error.ts`.

```tsx
import { handleApiError, extractApiError } from "@/lib/api-error";

// 권장 — 추출 + 토스트를 한 번에
catch (err) {
  handleApiError(err, "이슈 생성에 실패했습니다");
}

// 메시지를 직접 다뤄야 할 때 (예: form.setError)
catch (err) {
  const msg = extractApiError(err, "저장에 실패했습니다");
  form.setError("root", { message: msg });
}
```

> **두 함수 모두 `fallback`(두 번째 인자)이 필수다.** `extractApiError` 는 백엔드 `ErrorResponse` 에서 메시지를 뽑되, 필드 검증 오류(`errors`)가 있으면 첫 번째 한국어 메시지를 우선 반환하고, 없으면 `fallback` 을 쓴다. `responseType: 'blob'` 요청(파일 다운로드 등)의 에러는 `handleApiErrorAsync` / `extractApiErrorAsync` 를 사용한다.

성공 토스트는 Sonner 의 `toast.*` 를 직접 호출한다:

```tsx
import { toast } from "sonner";

await createIssue(data);
toast.success("이슈가 생성되었습니다");
```

### 3. Page Error Boundary (페이지 에러 바운더리)

lazy-loaded 페이지에서 uncaught 렌더링 에러가 나면 흰 화면(WSOD) 대신 복구 UI 를 보여준다. 워크플레이스는 클래스 컴포넌트 `PageErrorBoundary`(`components/PageErrorBoundary.tsx`)를 제공한다.

```tsx
import { PageErrorBoundary } from "@/components/PageErrorBoundary";

<PageErrorBoundary>
  <Suspense fallback={<FullPageLoading />}>
    <SomePage />
  </Suspense>
</PageErrorBoundary>
```

폴백 UI(실제 구현):

```tsx
<div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 p-8 text-center">
  <AlertTriangle className="h-12 w-12 text-destructive" />
  <div className="space-y-2">
    <h2 className="text-lg font-semibold">페이지를 불러오는 중 문제가 발생했습니다</h2>
    <p className="text-sm text-muted-foreground max-w-md">
      일시적인 오류가 발생했습니다. 다시 시도하거나 페이지를 새로고침해 주세요.
    </p>
  </div>
  <Button variant="outline" onClick={handleRetry}>
    <RefreshCw className="mr-2 h-4 w-4" /> 다시 시도
  </Button>
</div>
```

> 작은 단위(홈 위젯 등)는 위젯 자체에서 에러를 흡수하거나 별도 바운더리로 격리해 한 위젯의 실패가 페이지 전체로 번지지 않게 한다.

### 4. Full Page Error (전체 페이지 에러)

라우트 수준의 복구 불가 에러는 Card 기반 에러 화면을 사용한다.

```tsx
function ErrorPage({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <Card className="w-full max-w-md">
        <CardHeader><CardTitle className="text-destructive">오류가 발생했습니다</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">{error.message}</p>
          <Button onClick={reset}>다시 시도</Button>
        </CardContent>
      </Card>
    </div>
  );
}
```

---

## D. Toast Usage Rules (Sonner)

| 함수 | 사용 시점 | 예시 |
|------|----------|------|
| `toast.success()` | Mutation 성공 (생성, 수정, 삭제, 전송) | `toast.success("이슈가 생성되었습니다")` |
| `toast.error()` | API 실패, 유효성 검사 에러 | `handleApiError(err, "삭제에 실패했습니다")` |
| `toast.info()` | 정보성 알림 | `toast.info("클립보드에 복사되었습니다")` |
| `toast.warning()` | 비차단 경고 | 드물게 사용 |

> 코드베이스 실측: 컴포넌트(`.tsx`)의 직접 `toast.success` 23회, 직접 `toast.error` 14회. 이와 별개로 `handleApiError`(`lib/api-error.ts`) 내부에도 `toast.error` 가 있다 — 즉 에러 토스트는 **직접 호출(14)과 `handleApiError` 래퍼가 병용**된다. 신규 코드는 직접 문자열보다 `handleApiError(err, fallback)` 을 우선한다.

### 현재(As-Is) 표준 패턴

```tsx
const onSubmit = form.handleSubmit(async (data) => {
  try {
    await mutateAsync(data);
    toast.success("저장되었습니다");
    onSuccess();
  } catch (err) {
    handleApiError(err, "저장에 실패했습니다");
  }
});
```

> 다수의 mutation 은 TanStack Query 의 `onError` 에서 `handleApiError` 를 한 번만 처리하고, 컴포넌트의 `catch` 는 비워 두기도 한다(`GroupForm.tsx` 참고). 둘 중 하나로 에러 토스트가 **중복되지 않게** 한다.

### 토스트 설정 (App root)

`Toaster`(`components/ui/sonner.tsx`)는 `main.tsx` 에 마운트되며, next-themes 테마 연동 + 커스텀 Lucide 아이콘이 내장되어 있다.

```tsx
// main.tsx — props 없이 마운트 (sonner.tsx 내부에서 테마/아이콘/CSS 변수 설정)
<Toaster />
```

```tsx
// sonner.tsx (발췌) — 상태별 커스텀 아이콘
icons={{
  success: <CircleCheckIcon className="size-4" />,
  info:    <InfoIcon className="size-4" />,
  warning: <TriangleAlertIcon className="size-4" />,
  error:   <OctagonXIcon className="size-4" />,
  loading: <Loader2Icon className="size-4 animate-spin" />,
}}
```

> fire-hub 와 달리 `position`/`richColors` 를 호출부에서 지정하지 않는다 — 스타일은 `sonner.tsx` 의 CSS 변수(`--normal-bg` 등)로 통일되어 있다.

---

## 패턴 선택 가이드

| 상황 | 권장 패턴 |
|------|----------|
| 폼 필드 유효성 | `FormField error` (`text-sm text-destructive`) |
| API 호출 실패 | `handleApiError(err, fallback)` (토스트) |
| 파일 다운로드(blob) 실패 | `handleApiErrorAsync(err, fallback)` |
| 페이지 렌더링 실패 | `PageErrorBoundary` |
| 페이지 로드(라우트) 실패 | Full page error (Card) |
| 테이블 데이터 없음 | `TableEmptyRow` (검색 0건/진짜 0건 분기) |
| 카드·그리드 데이터 없음 | EmptyState (아이콘 + 메시지 + 액션) |
| 테이블 로딩 중 | `TableSkeletonRows` |
| 페이지/카드 로딩 중 | `Skeleton` 또는 `Loader2` 스피너 |
