# 07. Iconography

Smart Workplace 아이콘 시스템 — 사용 규칙, 크기 스케일, 색상, 정렬 가이드라인.

> 관련 문서: [04. Components](./04-components.md) · [06. Feedback States](./06-feedback-states.md) · [09. Form Patterns](./09-form-patterns.md)

---

## 1. 아이콘 라이브러리

**유일한 아이콘 소스: [Lucide React](https://lucide.dev/)** (`lucide-react ^1.16`).

프로젝트 전반에 걸쳐 Lucide React 단독 사용. 다른 아이콘 라이브러리(Heroicons, Radix Icons, react-icons 등)의 혼용은 금지한다. 일관된 stroke 스타일과 번들 크기 최적화를 위한 결정이다.

```tsx
// 올바른 import
import { Plus, Search, ChevronDown, Trash2, Loader2 } from 'lucide-react';

// 금지: 다른 라이브러리 혼용
// import { FiSearch } from 'react-icons/fi';                      // X
// import { MagnifyingGlassIcon } from '@heroicons/react/24/solid'; // X
```

> shadcn primitive(`sonner.tsx`, `simple-pagination.tsx`, `search-input.tsx`, `password-input.tsx` 등)도 모두 Lucide 를 사용한다. 일부는 `CircleCheckIcon` 처럼 `*Icon` 접미사 별칭을, 일부는 `Search` 처럼 기본 이름을 쓴다 — 같은 파일 안에서는 한 가지 표기로 통일한다.

---

## 2. 크기 스케일

shadcn/ui Button/Badge 는 `[&_svg:not([class*='size-'])]:size-4` 패턴으로 내부 아이콘을 16px 로 자동 조정한다. 아이콘에 크기 클래스(`h-*`, `w-*`, `size-*`)가 없으면 자동으로 16px 이 적용된다(Badge 는 `[&>svg]:size-3` → 12px).

| 컨텍스트 | Size | Tailwind | strokeWidth | 예시 |
|---------|------|----------|-------------|------|
| Badge/tag 내부 | 12px | `h-3 w-3` | 2 | StatusBadge 내 아이콘, SearchInput clear |
| 기본 인라인 | 16px | `h-4 w-4` | 2 | 버튼 아이콘, 테이블 액션, 폼 아이콘, 토스트 아이콘 |
| 사이드바/헤더 | 20px | `h-5 w-5` | 2 | 사이드바 네비게이션, 헤더 |
| 빈 상태/강조 | 24px+ | `h-6 w-6` / `h-8 w-8` / `h-12 w-12` | 2 | EmptyState, PageErrorBoundary(`AlertTriangle h-12`) |

> **strokeWidth**: 모든 크기에서 기본값 `2` 를 유지한다. 특별한 사유 없이 변경하지 않는다. `1.5`/`2.5` 등 커스텀 stroke 는 Lucide 기본 SVG 디자인과 어울리지 않는다.

### 2.1 크기별 TSX 예시

```tsx
// Badge/tag 내부 — 12px (Badge 가 [&>svg]:size-3 으로 자동 적용)
import { Circle } from 'lucide-react';
<Badge variant="success"><Circle /> 완료</Badge>

// 기본 인라인 — 16px (shadcn Button 내부에서 자동 적용)
import { Plus } from 'lucide-react';
<Button><Plus /> 새 이슈</Button>

// 명시적 크기 — 테이블 행 액션
<Button variant="ghost" size="icon-sm">
  <Trash2 className="h-4 w-4 text-destructive" />
</Button>

// 사이드바/헤더 — 20px
<a className="flex items-center gap-3 px-3 py-2 rounded-md hover:bg-muted">
  <ListTodo className="h-5 w-5 flex-shrink-0 text-muted-foreground" />
  <span className="text-[13px] leading-5">이슈</span>
</a>

// 빈 상태 — 24px+
<div className="flex flex-col items-center gap-3 py-12 text-muted-foreground">
  <Inbox className="h-6 w-6" />
  <p className="text-sm">받은 메일이 없습니다</p>
</div>
```

---

## 3. 색상 규칙

아이콘 색상은 CSS `currentColor` 로 부모에서 상속된다. Lucide 아이콘은 `stroke="currentColor"` 로 렌더링되므로, Tailwind `text-*` 클래스로 색을 제어한다.

| 상태 | 클래스 | 용도 |
|------|--------|------|
| 기본 | `text-muted-foreground` | 일반 UI 아이콘, 보조 정보, 검색 아이콘 |
| 활성/브랜드 | `text-primary` | 활성 네비게이션, CTA 아이콘, 선택됨 표시 |
| 성공 | `text-success` (또는 `text-green-600`) | 성공/완료 상태 |
| 경고 | `text-warning` (또는 `text-amber-600`) | 경고 상태 |
| 위험/삭제 | `text-destructive` | 삭제, 에러 상태 |
| 비활성화 | `opacity-50` | 비활성 컨트롤 내 아이콘 |
| 버튼 내부 | (부모 상속) | shadcn Button 이 variant 로 제어 |

> **디자인 토큰 우선**: 워크플레이스는 `--color-success`/`--color-warning`/`--color-info`/`--color-destructive` 토큰(Tailwind `text-success` 등)을 이미 보유한다(`badge.tsx`/`status-badge.tsx`/`freshness-bar.tsx` 가 사용). 새 코드는 `text-green-600` 같은 하드코딩 대신 토큰 클래스를 쓴다.

### 3.1 색상별 TSX 예시

```tsx
import { Search, CheckCircle, AlertTriangle, XCircle, Loader2 } from 'lucide-react';

<Search className="h-4 w-4 text-muted-foreground" />        {/* 기본 */}
<CheckCircle className="h-4 w-4 text-success" />            {/* 성공 */}
<AlertTriangle className="h-4 w-4 text-warning" />          {/* 경고 */}
<XCircle className="h-4 w-4 text-destructive" />            {/* 위험 */}
<Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> {/* 로딩 */}

// 비활성화 — Button 의 disabled 가 opacity 처리 (아이콘 별도 처리 불필요)
<Button disabled><Plus /> 추가</Button>
```

---

## 4. 아이콘-텍스트 간격 (Icon-Text Spacing)

아이콘과 텍스트가 함께 있을 때 `gap-*` 으로 간격을 제어한다. `margin`/`padding` 을 아이콘에 직접 적용하지 않는다. (단, Button 내부는 cva 의 `gap-2`/`gap-1` 이 자동 적용되므로 아이콘에 별도 간격을 주지 않아도 된다.)

| 컨텍스트 | gap | 픽셀 |
|---------|-----|------|
| Badge/chip 내부 | `gap-1` | 4px |
| 기본 (버튼/라벨/인라인) | `gap-2` | 8px |
| 사이드바 네비게이션 | `gap-3` | 12px |

```tsx
// gap-2 — 폼 레이블/인라인
<label className="flex items-center gap-2 text-sm font-medium">
  <Lock className="h-4 w-4 text-muted-foreground" /> 비밀번호
</label>

// gap-3 — 사이드바
<a className="flex items-center gap-3 px-3 py-2 rounded-md">
  <Mail className="h-5 w-5 flex-shrink-0 text-muted-foreground" />
  <span className="text-[13px] leading-5">메일</span>
</a>

// Button 내부 — 명시적 gap 불필요 (cva 의 gap-2 적용)
<Button><Download /> 내보내기</Button>
```

---

## 5. 정렬 규칙

### 5.1 flex 컨테이너 내 정렬

아이콘 컨테이너는 `flex items-center` 를 쓰고, 아이콘에는 `flex-shrink-0` 을 추가해 텍스트가 길어질 때 아이콘이 압축되지 않게 한다.

```tsx
// 올바른 패턴
<div className="flex items-center gap-2">
  <FileText className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
  <span className="text-sm truncate">매우 긴 이슈 제목이 잘려도 아이콘은 유지됩니다</span>
</div>
```

> Button/Badge 내부 아이콘은 cva 가 이미 `[&_svg]:shrink-0` / `[&>svg]:` 를 포함하므로 별도 `flex-shrink-0` 이 필요 없다. 직접 만든 flex 컨테이너에서만 추가한다.

### 5.2 인라인 텍스트 내 정렬

아이콘을 텍스트 사이 `inline` 으로 삽입할 때는 `[vertical-align:-0.125em]` 으로 baseline 을 보정한다.

```tsx
<p className="text-sm text-muted-foreground">
  이슈를{' '}
  <ExternalLink className="inline h-4 w-4 [vertical-align:-0.125em]" />
  {' '}새 탭에서 엽니다
</p>
```

---

## 6. shadcn/ui Button SVG 자동 조정 패턴

Button(`button.tsx`)은 `[&_svg:not([class*='size-'])]:size-4` 로 내부 `<svg>` 에 크기 클래스가 없으면 자동으로 `size-4`(16px)를 적용한다. `size="xs"`/`size="icon-xs"` 에서는 추가로 `[&_svg:not([class*='size-'])]:size-3`(12px)이 적용된다.

```tsx
// 자동 조정 — size 클래스 없음 → 16px
<Button variant="default"><Plus /> 새 이슈</Button>

// 작은 버튼 — xs/icon-xs 는 자동 12px
<Button size="xs"><Plus /> 추가</Button>

// 크기 재정의 — size 클래스를 명시하면 자동 조정 무시
<Button variant="outline" size="lg"><Mail className="h-5 w-5" /> 메일</Button>

// icon 전용 버튼
<Button variant="ghost" size="icon" aria-label="설정"><Settings /></Button>
```

> **주의**: `size-*` 클래스(`size-4` 등)를 쓰면 자동 조정이 비활성화된다(`h-*`/`w-*` 동시 지정과 동일). 16px 을 벗어나야 할 때만 명시적 클래스를 추가한다.

---

## 7. 아이콘 선택 가이드라인

### 7.1 의미 일관성 — 워크플레이스 표준 매핑

같은 개념에는 항상 같은 아이콘을 사용한다.

| 개념 | 아이콘 | import 이름 |
|------|--------|------------|
| 이슈/할 일 | 체크리스트 | `ListTodo` |
| 채팅/메시지 | 말풍선 | `MessageSquare` |
| 메일 | 봉투 | `Mail` |
| 연락처/사람 | 사용자 | `User` / `Users` |
| 드라이브/파일 | 폴더·문서 | `Folder` / `FileText` |
| 홈/대시보드 | 집·레이아웃 | `Home` / `LayoutDashboard` |
| AI 어시스턴트 | 봇·반짝임 | `Bot` / `Sparkles` |
| 추가/생성 | 플러스 | `Plus` |
| 삭제 | 휴지통 | `Trash2` |
| 편집 | 연필 | `Pencil` |
| 검색 | 돋보기 | `Search` |
| 검색 결과 없음 | 돋보기-X | `SearchX` |
| 설정 | 톱니바퀴 | `Settings` |
| 내보내기 | 다운로드 | `Download` |
| 가져오기 | 업로드 | `Upload` |
| 새로고침 | 회전 화살표 | `RefreshCw` |
| 닫기/취소 | X | `X` |
| 확인/성공 | 체크 | `Check` / `CircleCheck` |
| 경고 | 삼각형 | `TriangleAlert` (구 `AlertTriangle`) |
| 정보 | 원형 i | `Info` |
| 에러(토스트) | 팔각형 X | `OctagonX` |
| 로딩 | 로더 | `Loader2` |
| 비밀번호 표시/숨김 | 눈 | `Eye` / `EyeOff` |
| 펼침/접힘 | 셰브론 | `ChevronDown` / `ChevronsUpDown` |
| 페이지 이동 | 셰브론 | `ChevronLeft/Right`, `ChevronsLeft/Right` |
| 외부 링크 | 화살표+박스 | `ExternalLink` |
| 복사 | 클립보드 | `Copy` |

> 실측 근거: `sonner.tsx`(`CircleCheck`/`Info`/`TriangleAlert`/`OctagonX`/`Loader2`), `table-empty.tsx`(`SearchX`), `simple-pagination.tsx`(`Chevron*`), `search-input.tsx`(`Search`/`X`), `password-input.tsx`(`Eye`/`EyeOff`), `searchable-select.tsx`(`Check`/`ChevronsUpDown`), `PageErrorBoundary.tsx`(`AlertTriangle`/`RefreshCw`).

### 7.2 금지 패턴

```tsx
// 금지: 동일 개념에 다른 아이콘 혼용
<Trash className="h-4 w-4" />   // X — Trash2
<Edit className="h-4 w-4" />    // X — Pencil
<Reload className="h-4 w-4" />  // X — RefreshCw

// 금지: 아이콘에 색상/크기 style prop 직접 사용 (vertical-align 보정 제외)
<Plus style={{ color: 'blue', width: 16 }} />  // X — Tailwind 클래스 사용

// 금지: strokeWidth 임의 변경
<Mail strokeWidth={1.5} />  // X — 기본값 2 유지

// 금지: 다른 라이브러리 아이콘
import { FaTrash } from 'react-icons/fa';  // X
```

---

## 8. 접근성

- **장식용 아이콘**: 옆에 텍스트가 있으면 `aria-hidden="true"` 를 추가해 스크린 리더 중복 읽기를 막는다.
- **단독 아이콘 버튼**: 텍스트 없이 아이콘만 있는 버튼은 반드시 `aria-label` 을 제공한다. (실측: `SearchInput` clear 버튼 `aria-label="검색어 지우기"`, `SimplePagination` 의 페이지 버튼들, `PasswordInput` 의 토글 버튼이 모두 `aria-label` 보유.)

```tsx
// 장식용 — aria-hidden
<Button><Plus aria-hidden="true" /> 새 이슈</Button>

// 단독 아이콘 버튼 — aria-label 필수
<Button variant="ghost" size="icon" aria-label="설정 열기">
  <Settings aria-hidden="true" />
</Button>
```

---

## 9. 현재(As-Is) 감사 및 권장 수정

| 발견 가능 패턴 | 권장 수정 |
|-----------|----------|
| `text-blue-600` 아이콘 색상 | `text-primary` 로 교체 |
| `text-red-600` 아이콘 색상 | `text-destructive` 로 교체 |
| `text-green-600`/`text-amber-600` | 토큰 `text-success`/`text-warning` 로 교체 |
| `flex-shrink-0` 누락 (커스텀 flex) | 아이콘에 추가 |
| `aria-label` 없는 icon-only 버튼 | `aria-label` 추가 |
| `strokeWidth` 비기본값 | 제거하여 기본값(2) 사용 |
| 다른 아이콘 라이브러리 import | `lucide-react` 로 통일 |
