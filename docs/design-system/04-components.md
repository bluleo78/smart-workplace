# 04. 컴포넌트 사용 가이드

Smart Workplace 프론트엔드(`apps/workplace-web`)에서 사용하는 UI 컴포넌트의 목록, 스펙, 사용 규칙을 정의한다.

Smart Workplace 는 이슈 트래커 + 이슈 컨텍스트 chat + 팀 채팅(messaging) + 메일 + 연락처 + 홈(대시보드) 를 제공하는 단일 SPA 이다. 아래 컴포넌트는 이 도메인 전반에서 일관되게 재사용된다.

> 관련 문서: [06. Feedback States](./06-feedback-states.md) · [07. Iconography](./07-iconography.md) · [09. Form Patterns](./09-form-patterns.md)

---

## A. shadcn/ui Primitives

`src/components/ui/` 아래 35개 파일로 구성된 기반 컴포넌트 라이브러리다.
모든 컴포넌트는 Radix UI 프리미티브를 기반으로 하며, Tailwind CSS v4(new-york 스타일)로 스타일링된다.

> **편집 규칙**: `src/components/ui/` 의 shadcn primitive 는 `npx shadcn` CLI 로 추가/갱신한다. **수동 편집 금지**. 커스터마이즈가 필요하면 primitive 를 직접 고치지 말고, 아래 §B 의 공통 래퍼 컴포넌트(`status-badge`, `search-input`, `form-field` 등)로 조합(compose)한다. 조합은 항상 `cn()`(아래 §C) 로 클래스를 병합한다.

### A-1. 표준 shadcn primitive (Radix 기반)

| Component | File | Variants / Sizes | Project Default | Notes |
|-----------|------|------------------|-----------------|-------|
| AlertDialog | `alert-dialog.tsx` | `data-size`: `sm`, `default` | `default` | 파괴적 작업 확인 전용 모달. `sm` 은 푸터 2-col 그리드 |
| Avatar | `avatar.tsx` | — | — | fallback initials 조합 사용 |
| Badge | `badge.tsx` | `default`, `secondary`, `destructive`, `outline`, `ghost`, `link`, `success`, `warning`, `info` | `default` | `success`/`warning`/`info` 는 **이미 구현됨**. 의미 기반 상태 표시는 `StatusBadge`(§B-1) 사용 |
| Button | `button.tsx` | variants: `default`, `destructive`, `outline`, `secondary`, `ghost`, `link` / sizes: `default`, `xs`, `sm`, `lg`, `icon`, `icon-xs`, `icon-sm`, `icon-lg` | `variant=default size=default` | 주요 인터랙션 요소. SVG 자동 16px 조정(§D, [07](./07-iconography.md)) |
| Card | `card.tsx` | — | `p-6` 영역 | Header / Title / Description / Action / Content / Footer 서브 컴포넌트 포함 |
| Checkbox | `checkbox.tsx` | — | — | 폼 입력 |
| Collapsible | `collapsible.tsx` | — | — | 사이드바/섹션 접기·펼치기 |
| Command | `command.tsx` | — | — | 커맨드 팔레트 (cmdk 기반). `SearchableSelect`(§B-7)의 기반 |
| Dialog | `dialog.tsx` | — | `sm:max-w-lg` | 모달 다이얼로그 (이슈 생성, 그룹 편집 등) |
| DropdownMenu | `dropdown-menu.tsx` | — | — | 컨텍스트 메뉴, 사용자 메뉴 |
| Input | `input.tsx` | — | `h-9` | 텍스트 입력, `aria-invalid` 지원 |
| Label | `label.tsx` | — | — | 폼 레이블 (`FormField` 가 내부 사용) |
| Popover | `popover.tsx` | — | — | 인라인 편집기, `SearchableSelect` 의 컨테이너 |
| RadioGroup | `radio-group.tsx` | — | — | 폼 라디오 버튼 |
| ScrollArea | `scroll-area.tsx` | — | — | 스크롤 가능한 컨테이너 (채팅 메시지 리스트 등) |
| Select | `select.tsx` | — | — | 드롭다운 선택 |
| Separator | `separator.tsx` | `orientation`: `horizontal`, `vertical` | `horizontal` | 구분선 (prop 기반, cva 아님) |
| Skeleton | `skeleton.tsx` | — | `bg-accent animate-pulse rounded-md` | 로딩 플레이스홀더 |
| Sonner | `sonner.tsx` | — | — | Toast 알림 컨테이너 (`Toaster`). 커스텀 아이콘 내장 ([06](./06-feedback-states.md)) |
| Switch | `switch.tsx` | — | — | 토글 스위치 |
| Table | `table.tsx` | — | — | Table / Header / Body / Footer / Row / Head / Cell / Caption 서브 컴포넌트 포함 |
| Tabs | `tabs.tsx` | `TabsList` variant: `default`, `line` | `line` | 탭 내비게이션. `orientation` horizontal/vertical 지원 |
| Textarea | `textarea.tsx` | — | — | 멀티라인 텍스트 입력 |
| Tooltip | `tooltip.tsx` | — | — | 호버 툴팁 |

> **cva(variant API)를 실제로 정의한 primitive 는 `button.tsx`, `badge.tsx`, `tabs.tsx` 3개뿐이다.** 나머지는 variant prop 이 없으며(표의 "—"), `AlertDialog`/`Separator` 처럼 일부는 `data-size`·`orientation` 같은 prop 으로 분기한다. 표에 없는 variant 를 임의로 만들어 쓰지 않는다.

### A-2. 워크플레이스 공통 래퍼 (`ui/` 내 비-shadcn 컴포넌트)

`ui/` 디렉터리에는 순수 shadcn primitive 외에, 프로젝트가 반복 패턴을 추상화한 공통 컴포넌트도 함께 위치한다. §B 에서 상세히 다룬다.

| Component | File | 역할 |
|-----------|------|------|
| StatusBadge | `status-badge.tsx` | 의미(semantic) 기반 상태 배지 — Badge variant 래핑 |
| SearchInput | `search-input.tsx` | 돋보기 아이콘 + clear 버튼 내장 검색 입력 |
| SearchableSelect | `searchable-select.tsx` | 검색 가능 단일 선택 콤보박스 (Popover + Command) |
| PasswordInput | `password-input.tsx` | 표시/숨김 토글 비밀번호 입력 |
| FormField | `form-field.tsx` | Label + 입력 + 에러 메시지 래퍼 |
| DeleteConfirmDialog | `delete-confirm-dialog.tsx` | 삭제 확인 AlertDialog 래퍼 |
| SimplePagination | `simple-pagination.tsx` | 페이지 번호 + 사이즈 selector |
| TableEmptyRow | `table-empty.tsx` | 테이블 빈 상태 행 (검색 0건 분기) |
| TableSkeletonRows | `table-skeleton.tsx` | 테이블 로딩 스켈레톤 행 |
| FreshnessBar | `freshness-bar.tsx` | 최근 갱신 시점 막대(신선도) 표시 |
| Sparkline | `sparkline.tsx` | 인라인 막대 추이 |

### A-3. 레이아웃 공통 컴포넌트 (`components/layout/`)

`ui/` 와 별개로, 셸·페이지 구조를 표준화하는 레이아웃 컴포넌트는 `src/components/layout/` 에 위치한다.

| Component | File | 역할 |
|-----------|------|------|
| PageHeader | `layout/PageHeader.tsx` | 컨텐츠 영역 표준 헤더 바 — 옵션·`h-14`·사이드바 헤더와 정렬 |

> **PageHeader props**: `title`(선택, 좌측 제목 — `appTitleTextClass` 무게. 생략 시 제목 영역 미렌더 — 브레드크럼 등 다른 위치 표시자가 있는 페이지에 사용, 예: 드라이브) · `icon`(선택, 제목 앞 아이콘) · `meta`(선택, 제목 옆 보조 메타) · `actions`(선택, 우측 액션 슬롯) · `className` · `data-testid`(기본 `'page-header'`). 컨테이너는 `flex h-14 shrink-0 items-center justify-between gap-2 border-b px-4` 로, 2차 사이드바 헤더(`sidebarTitleClass`)·홈 헤더와 한 선 정렬한다. 컨텐츠 헤더는 **옵션**이며, 두지 않는 문서/설정형 페이지는 인-플로우 제목 토큰 `pageTitleClass` 를 쓴다([05-page-patterns.md](./05-page-patterns.md) 참조).

---

## B. 공통 래퍼 컴포넌트 상세

`src/components/ui/` 의 워크플레이스 전용 래퍼 컴포넌트다. 반복 패턴을 추상화하여 일관성을 확보한다. 모두 `cn()` 으로 외부 `className` 을 병합 가능하게 설계되어 있다.

---

### 1. StatusBadge (`status-badge.tsx`)

**목적**: 상태 색을 의미(semantic) 단위로 통일한다. `Badge` 의 `success`/`warning`/`info` variant 를 직접 쓰지 말고, **의미 기반으로 이 컴포넌트를 사용**한다.

**Props API**:

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `type` | `StatusBadgeType` | 필수 | 상태 의미 (아래 매핑 표) |
| `children` | `ReactNode` | 필수 | 표시할 라벨 |
| `className` | `string` | 선택 | 추가 클래스 (색은 `type` 으로만 결정) |

**type → variant 매핑** (앱 전체 동일하게 유지):

| `type` | 의미 | Badge variant | 색 |
|--------|------|---------------|----|
| `active` | 활성/켜짐 | `success` | 녹색 |
| `success` | 완료/정상/성공 | `success` | 녹색 |
| `info` | 진행중/실행중/처리중 | `info` | 파랑 |
| `warning` | 경고/재인증 필요/주의 | `warning` | 주황 |
| `error` | 실패/이상/오류 | `destructive` | 빨강 |
| `inactive` | 비활성/꺼짐 | `secondary` | 회색 |
| `pending` | 대기/예정 | `outline` | 테두리(회색) |
| `unknown` | 미확인/미연결 | `outline` + `text-muted-foreground` | 테두리(muted) |

**사용 예시**:

```tsx
// 이슈 상태 표시
<StatusBadge type="info">진행 중</StatusBadge>
<StatusBadge type="success">완료</StatusBadge>
<StatusBadge type="error" title="2026-04-26 확인">차단됨</StatusBadge>
```

> 실제 사용처: `components/issue/IssueListTable.tsx`, `components/home/widgets/IssueListWidget.tsx`, `pages/projects/components/IssueListView.tsx` 등.

---

### 2. FormField (`form-field.tsx`)

**목적**: 레이블 + 자식 입력 요소 + 에러 메시지를 하나의 블록(`space-y-2`)으로 묶는 래퍼. 자세한 폼 구성 규칙은 [09. Form Patterns](./09-form-patterns.md) 참조.

**Props API**:

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `label` | `string` | 필수 | 레이블 텍스트 |
| `htmlFor` | `string` | 선택 | 내부 `Label` 의 `htmlFor` (입력의 `id` 와 연결) |
| `error` | `string` | 선택 | 에러 메시지 (`text-sm text-destructive` 로 표시) |
| `required` | `boolean` | 선택 | `*`(`text-destructive ml-0.5`) 표시 여부 |
| `children` | `ReactNode` | 필수 | 입력 요소 (Input, Textarea, Select 등) |
| `className` | `string` | 선택 | 래퍼에 병합 |

> 주의: fire-hub 템플릿과 달리 **`description` 슬롯은 없다.** 구조는 Label → 입력 → Error 3단이다.

**사용 예시**:

```tsx
<FormField label="이름" htmlFor="g-name" error={form.formState.errors.name?.message} required>
  <Input id="g-name" {...form.register("name")} placeholder="이름을 입력하세요" />
</FormField>
```

---

### 3. SearchInput (`search-input.tsx`)

**목적**: 돋보기 아이콘 + 값이 있을 때 나타나는 clear(X) 버튼이 내장된 검색 입력. 목록 페이지 상단 검색 바에 공통 사용.

**Props API** (controlled — 일반 input 속성을 상속하지 않는다):

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `value` | `string` | 필수 | 현재 검색어 |
| `onChange` | `(value: string) => void` | 필수 | 값 변경 콜백 (이벤트가 아닌 **문자열**을 전달) |
| `placeholder` | `string` | 선택 | 기본값 `"검색..."` |
| `aria-label` | `string` | 선택 | 스크린리더용 이름 (미지정 시 placeholder 사용) |
| `className` | `string` | 선택 | 래퍼에 병합 |

**구현 특징**: 아이콘 위치를 위해 `pl-9`, clear 버튼이 보일 때 `pr-9` 적용. clear 버튼은 `onChange('')` 로 초기화 — 검색 0건 빈 상태(§B-8, [06](./06-feedback-states.md))의 "검색 초기화" 와 동일한 동작.

**사용 예시**:

```tsx
const [search, setSearch] = useState("");

<SearchInput
  placeholder="이슈 검색..."
  value={search}
  onChange={setSearch}
  className="w-64"
/>
```

---

### 4. SearchableSelect (`searchable-select.tsx`)

**목적**: 검색 가능한 단일 선택 콤보박스. 옵션이 많아 native `<select>` 의 키보드 jump 만으로 탐색이 어려운 경우 사용 (옵션 5개 미만이면 기본 `Select` 권장).

**Props API**:

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `value` | `string \| undefined` | 선택 | 선택된 값 |
| `onChange` | `(value: string \| undefined) => void` | 필수 | 선택 콜백 |
| `options` | `{ value: string; label: string }[]` | 필수 | 옵션 목록 |
| `placeholder` | `string` | 선택 | 기본값 `"선택"` |
| `searchPlaceholder` | `string` | 선택 | 검색창 placeholder |
| `emptyText` | `string` | 선택 | 결과 없음 문구 |
| `allowClear` | `boolean` | 선택 | "선택 안 함" 옵션 표시 |
| `disabled` | `boolean` | 선택 | 비활성화 |
| `id` / `className` | `string` | 선택 | — |

**사용 예시**:

```tsx
<SearchableSelect
  value={assigneeId}
  onChange={setAssigneeId}
  options={members.map(m => ({ value: String(m.id), label: m.name }))}
  placeholder="담당자 선택"
  searchPlaceholder="멤버 검색..."
  allowClear
/>
```

---

### 5. PasswordInput (`password-input.tsx`)

**목적**: 표시/숨김 토글(Eye/EyeOff) 버튼이 우측에 겹쳐진 비밀번호 입력. 로그인/회원가입/비밀번호 변경에 사용.

**Props API**: `type` 을 제외한 표준 `<input>` 속성을 모두 forwarding (`autoComplete` 등 브라우저 비밀번호 매니저 호환).

**사용 예시**:

```tsx
<PasswordInput
  {...form.register("password")}
  autoComplete="current-password"
  placeholder="비밀번호"
/>
```

---

### 6. DeleteConfirmDialog (`delete-confirm-dialog.tsx`)

**목적**: 삭제 작업 전 사용자 확인을 받는 AlertDialog 래퍼. 파괴적 작업의 안전장치. 한국어 조사(을/를)는 `eulReul()`(`lib/utils.ts`) 로 자동 처리된다.

**Props API**:

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `entityName` | `string` | 필수 | 대상 종류 (예: `"이슈"`, `"그룹"`) — 제목과 본문에 사용 |
| `itemName` | `string` | 필수 | 대상 이름 (예: 이슈 제목) — 본문에 인용 |
| `onConfirm` | `() => void` | 필수 | 확인 버튼 클릭 콜백 |
| `trigger` | `ReactNode` | 필수 | 다이얼로그를 여는 트리거 요소 |

> 주의: fire-hub 의 `title`/`description` 자유 문구가 아니라, `entityName`/`itemName` 두 값으로 표준 문구(`"…"<entity>을 정말 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.`)를 자동 생성한다. 트리거/콘텐츠 클릭은 `stopPropagation` 처리되어 행(row) 클릭과 충돌하지 않는다.

**사용 예시**:

```tsx
<DeleteConfirmDialog
  entityName="이슈"
  itemName={issue.title}
  onConfirm={() => deleteIssue(issue.id)}
  trigger={
    <Button variant="ghost" size="icon-sm" className="text-destructive hover:text-destructive">
      <Trash2 className="h-4 w-4" />
    </Button>
  }
/>
```

---

### 7. SimplePagination (`simple-pagination.tsx`)

**목적**: 처음/이전/페이지번호/다음/마지막 버튼 + 선택적 총건수·페이지 사이즈 selector. 목록 페이지 하단에 공통 사용.

**Props API**:

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `page` | `number` | 필수 | 현재 페이지 (**0-based 내부값**, 화면 표기는 1-based) |
| `totalPages` | `number` | 필수 | 전체 페이지 수 |
| `onPageChange` | `(page: number) => void` | 필수 | 페이지 변경 콜백 |
| `totalElements` | `number` | 선택 | 총 건수 (제공 시 "총 N건 중 a-b" 표시) |
| `pageSize` | `number` | 선택 | 페이지 크기 (총건수/사이즈 selector 표시에 필요) |
| `onPageSizeChange` | `(size: number) => void` | 선택 | 제공 시 사이즈 selector 노출 |
| `pageSizeOptions` | `number[]` | 선택 | 기본 `[10, 20, 50, 100]` |

**동작**: 페이지가 7개 이하면 전부, 초과하면 `현재 ±2 + 양 끝 + "..."` 패턴으로 표시. `totalPages <= 1` 이고 사이즈 selector 도 없으면 렌더링을 생략한다.

**사용 예시**:

```tsx
<SimplePagination
  page={page}
  totalPages={data.totalPages}
  onPageChange={setPage}
  totalElements={data.totalElements}
  pageSize={pageSize}
  onPageSizeChange={setPageSize}
/>
```

---

### 8. TableEmptyRow (`table-empty.tsx`)

**목적**: 테이블에 데이터가 없을 때 표시하는 빈 상태 행. **검색어 유무에 따라 두 가지 UI** 로 분기한다. 자세한 빈 상태 원칙은 [06. Feedback States](./06-feedback-states.md) 참조.

**Props API**:

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `colSpan` | `number` | 필수 | 테이블 컬럼 수 (전체 너비 병합) |
| `message` | `string` | 선택 | 데이터 0건 메시지 (기본 `"데이터가 없습니다."`) |
| `searchKeyword` | `string` | 선택 | 검색어 — 있으면 "검색 결과 없음" UI 사용 |
| `onResetSearch` | `() => void` | 선택 | 제공 시 "검색 초기화" 버튼 노출 |
| `emptyAction` | `ReactNode` | 선택 | 진짜 0건 상태의 추가 CTA (예: "새로 만들기") |

> export 이름은 **`TableEmptyRow`** 다 (fire-hub 의 `TableEmpty` 아님).

**사용 예시**:

```tsx
<TableBody>
  {items.length === 0 ? (
    <TableEmptyRow
      colSpan={5}
      searchKeyword={search || undefined}
      onResetSearch={() => setSearch("")}
      message="등록된 이슈가 없습니다."
      emptyAction={<Button size="sm" onClick={openCreate}>새 이슈</Button>}
    />
  ) : (
    items.map((it) => <TableRow key={it.id}>...</TableRow>)
  )}
</TableBody>
```

---

### 9. TableSkeletonRows (`table-skeleton.tsx`)

**목적**: 데이터 로딩 중 테이블 형태의 Skeleton 행을 표시.

**Props API**:

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `columns` | `number` | **필수** | 컬럼 수 |
| `rows` | `number` | 선택 | 행 수 (기본값 5) |
| `widths` | `string[]` | 선택 | 컬럼별 너비 클래스 (예: `['w-24', 'w-full', 'w-16']`) |

> export 이름은 **`TableSkeletonRows`** 이며 `columns` 는 필수다.

**사용 예시**:

```tsx
<TableBody>
  {isLoading ? (
    <TableSkeletonRows columns={5} rows={10} widths={['w-24','w-full','w-32','w-16','w-12']} />
  ) : (
    items.map((it) => <TableRow key={it.id}>...</TableRow>)
  )}
</TableBody>
```

---

## C. `cn()` 조합 패턴

`ui/` 컴포넌트는 shadcn CLI 로 생성되며 **직접 커스터마이즈하지 않는다**. 변형이 필요하면 호출부에서 `className` 을 넘겨 `cn()`(`src/lib/utils.ts`) 으로 병합한다.

```ts
// src/lib/utils.ts
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

`cn()` 은 `clsx`(조건부 클래스) + `tailwind-merge`(상충 클래스 마지막 우선) 를 결합한다. 모든 primitive 가 내부에서 `cn(variants(...), className)` 형태로 외부 클래스를 받으므로, 같은 컴포넌트를 맥락별로 미세 조정할 수 있다.

```tsx
// variant 는 그대로 두고 색만 보강
<Button variant="ghost" size="icon-sm" className="text-destructive hover:text-destructive">
  <Trash2 />
</Button>

// 상충 시 마지막 값이 이김 (h-9 → h-8)
<Input className="h-8 text-xs" />
```

`lib/utils.ts` 에는 한국어 조사 헬퍼 `eulReul()`(을/를), `iGa()`(이/가) 도 함께 제공된다 — 동적 문구 생성 시 사용한다(`DeleteConfirmDialog` 내부에서 사용).

---

## D. 컴포넌트 조합 패턴

프로젝트 전반에서 반복 사용되는 조합 패턴이다. 새 페이지 개발 시 우선 참고한다.

### 패턴 1. Status Badge (의미 기반)

색을 하드코딩하지 않고 항상 `StatusBadge` 를 사용한다.

```tsx
// 권장 — 의미 기반
<StatusBadge type="info">진행 중</StatusBadge>
<StatusBadge type="error">차단됨</StatusBadge>
<StatusBadge type="success">완료</StatusBadge>

// 지양 — Badge variant 직접 사용 / 색 하드코딩
<Badge variant="success">완료</Badge>                 // StatusBadge 로
<Badge className="bg-green-100 text-green-800">완료</Badge>  // 금지
```

### 패턴 2. Icon Button

```tsx
// 편집
<Button variant="ghost" size="icon-sm"><Pencil className="h-4 w-4" /></Button>
// 삭제
<Button variant="ghost" size="icon-sm" className="text-destructive hover:text-destructive">
  <Trash2 className="h-4 w-4" />
</Button>
// 더보기
<Button variant="ghost" size="icon-sm"><MoreHorizontal className="h-4 w-4" /></Button>
```

### 패턴 3. Table Row with Hover Actions

```tsx
<TableRow className="cursor-pointer hover:bg-muted/50 transition-colors group">
  <TableCell>{issue.title}</TableCell>
  <TableCell><StatusBadge type="info">{issue.status}</StatusBadge></TableCell>
  <TableCell>
    <div className="opacity-0 group-hover:opacity-100 transition-opacity flex gap-1 justify-end">
      <Button variant="ghost" size="icon-xs"><Pencil className="h-3 w-3" /></Button>
      <Button variant="ghost" size="icon-xs" className="text-destructive hover:text-destructive">
        <Trash2 className="h-3 w-3" />
      </Button>
    </div>
  </TableCell>
</TableRow>
```

### 패턴 4. Search + Filter Toolbar

```tsx
<div className="flex items-center gap-3 flex-wrap">
  <SearchInput placeholder="이슈 검색..." value={search} onChange={setSearch} className="w-64" />

  <Select value={statusFilter} onValueChange={setStatusFilter}>
    <SelectTrigger className="w-36"><SelectValue placeholder="상태" /></SelectTrigger>
    <SelectContent>
      <SelectItem value="all">전체</SelectItem>
      <SelectItem value="open">열림</SelectItem>
      <SelectItem value="closed">닫힘</SelectItem>
    </SelectContent>
  </Select>

  <Button variant="outline" size="sm">
    <Filter className="h-4 w-4" /> 필터
  </Button>
</div>
```

---

## E. Button 사용 규칙

Button 의 `variant` 는 사용 맥락에 따라 엄격히 구분한다.

| Variant | 사용 맥락 | 예시 |
|---------|-----------|------|
| `default` | 페이지/폼의 주요 액션 | 저장, 생성, 보내기, 확인 |
| `destructive` | 삭제/제거 액션 | 삭제, 초기화 |
| `outline` | 보조 액션, 취소 | 취소, 닫기, 내보내기, 페이지네이션 |
| `secondary` | 3순위 액션 | 필터, 정렬, 미리보기 |
| `ghost` | 인라인/아이콘 액션 | 편집 아이콘, 더보기, 행 내 액션 |
| `link` | 텍스트 내비게이션 링크 | "자세히 보기", 외부 링크 |

**Size 선택 기준**:

| Size | 사용 맥락 | SVG 자동 크기 |
|------|-----------|---------------|
| `lg` (h-10) | 인증 페이지(로그인/회원가입) 주 CTA | 16px |
| `default` (h-9) | 페이지 헤더 주 액션 | 16px |
| `sm` (h-8) | 툴바, 카드 내 액션, 페이지네이션 | 16px |
| `xs` (h-6) | 인라인 텍스트 레벨 액션 | **12px** |
| `icon` (size-9) | 독립 아이콘 버튼 | 16px |
| `icon-sm` (size-8) | 테이블 행 액션, 밀도 높은 UI | 16px |
| `icon-xs` (size-6) | 태그 삭제 등 매우 작은 아이콘 | **12px** |
| `icon-lg` (size-10) | 강조 아이콘 버튼 | 16px |

> Button 내부 `<svg>` 는 크기 클래스가 없으면 자동으로 16px(`xs`/`icon-xs` 는 12px)로 조정된다. 자세한 규칙은 [07. Iconography §6](./07-iconography.md) 참조.

---

## F. 홈 대시보드 위젯 시스템 (`components/home/widgets/`)

홈 화면은 lazy-loaded 위젯을 캔버스에 배치하는 시스템이다. `registry.ts` 가 위젯 타입 → React 컴포넌트를 매핑한다.

**위젯 레지스트리** (`components/home/widgets/registry.ts`):

```ts
const registry: Record<WidgetType, LazyExoticComponent<...>> = {
  my_tasks:     lazy(() => import('./MyTasksWidget')),
  issue_list:   lazy(() => import('./IssueListWidget')),
  issue_detail: lazy(() => import('./IssueDetailWidget')),
  activity:     lazy(() => import('./ActivityWidget')),
};

// 알 수 없는 type 은 null → 캔버스가 무시
export function getWidget(type: string) { return registry[type as WidgetType] ?? null; }
```

**WidgetProps** (모든 위젯 공통): `{ params?: Record<string, unknown> }` — 캔버스(`HomeCanvas.tsx`)가 `spec.params` 를 그대로 전달한다.

**공통 프레임**: `WidgetFrame.tsx` 가 카드 헤더/본문을 감싼다. 위젯은 내부에서 `StatusBadge`, `Skeleton`, `TableEmptyRow` 등 §A~B 컴포넌트를 재사용한다.

> 새 위젯 추가 = 컴포넌트 작성 + registry 에 import 한 줄. fire-hub 의 MCP 도구 매핑 기반 AI 챗 위젯(`show_dataset`/`show_table` 등)과 달리, 워크플레이스는 홈 대시보드 전용의 단순 레지스트리다.

---

## G. 채팅/메일 리치 입력 (tiptap)

이슈 댓글·팀 채팅·메일 본문의 멘션/리치 입력은 tiptap(`@tiptap/*`)로 구현된다. shadcn `Textarea` 를 대체하는 별도 컴포넌트다.

| Component | File | 역할 |
|-----------|------|------|
| RichInput | `components/mentions/RichInput.tsx` | 멘션 칩 + `@` suggestion. Enter=전송, Shift+Enter=줄바꿈, Esc=취소 |
| MailComposer | `components/mail/MailComposer.tsx` | 메일 본문 작성 (tiptap 기반) |

자세한 폼/입력 작성 규칙은 [09. Form Patterns](./09-form-patterns.md) 참조.
