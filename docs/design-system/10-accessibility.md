# 10. 접근성 (Accessibility)

**목표 기준**: WCAG 2.2 AA

Smart Workplace 는 사람과 AI 가 함께 일하는 협업 플랫폼으로, 이슈 트래커·채팅·메일·드라이브 등 텍스트 밀도가 높은 업무 도구를 제공한다. 키보드 사용자와 스크린 리더 사용자가 핵심 워크플로(이슈 탐색·생성, 대화, 메일 처리)를 끝까지 완료할 수 있어야 한다.

---

## A. 기반: shadcn/ui + Radix

UI primitive 는 shadcn/ui (new-york) 로 추가하며, 그 기반은 **Radix UI** 다. Dialog / Dropdown / Tooltip / Tabs / Select / Checkbox / Radio 등은 Radix 가 다음을 기본 제공한다.

- 포커스 트랩 (Dialog / AlertDialog) 및 닫힘 시 트리거로 포커스 복귀
- `Escape` 닫기, 화살표 키 옵션 탐색 등 WAI-ARIA 키보드 패턴
- `role` / `aria-expanded` / `aria-controls` / `aria-selected` 등 ARIA 속성 자동 부착
- 호버와 포커스 모두에서 표시되는 Tooltip

> **원칙**: a11y 동작이 필요한 곳은 직접 `div` + 이벤트로 구현하지 말고 Radix primitive(=`src/components/ui/`)를 우선 사용한다. primitive 는 `npx shadcn` CLI 로만 추가/갱신하며 수동 편집하지 않는다. 직접 만든 커스텀 컴포넌트만 본 문서의 ARIA·키보드 규칙을 명시적으로 책임진다.

---

## B. 색상 대비 (Color Contrast)

토큰 정의는 [01-design-tokens.md](01-design-tokens.md), 다크 모드 대비는 [11-dark-mode.md](11-dark-mode.md) 참조.

| 텍스트 유형 | 최소 비율 | 현재 상태 |
|-------------|-----------|-----------|
| 일반 텍스트 (< 18px) | 4.5:1 | foreground `oklch(0.145)` on background `oklch(0.985)` ≈ 18:1 ✅ |
| 큰 텍스트 (≥ 18px bold) | 3:1 | ✅ |
| muted-foreground on background | 4.5:1 | `oklch(0.5)` on `oklch(0.985)` ≈ 6:1 ✅ |
| primary-foreground on primary | 4.5:1 | `oklch(0.985)` on `oklch(0.45 0.2 264)` (버튼·뱃지) ✅ |
| UI 컴포넌트 (테두리, 아이콘) | 3:1 | border `oklch(0.94)` on background — 비필수 구분선은 낮은 대비 허용 ⚠️ |
| 비활성(Disabled) 상태 | N/A | `disabled:opacity-50` — 의도적으로 낮은 대비 |

- **색상에만 의존 금지** (WCAG 1.4.1): 이슈 상태/우선순위, 온라인 점(`.status-online`), AI 진행 칩 등은 색상 외에 텍스트·아이콘·라벨을 함께 제공한다.
- 테마(`theme-ocean` / `theme-sunset`)와 다크 모드 전환 시에도 위 비율을 유지하도록 토큰을 정의했다.

---

## C. Focus Indicator (포커스 표시)

- **현재(As-Is)**: shadcn 기본값 `focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]` 가 Button / Input / Select / Checkbox / Radio 에 적용된다.
- Ring 색상: `--ring: oklch(0.55 0.15 264)` (다크: `oklch(0.65 0.2 264)`) — 배경 대비 충분.
- 전역 base 레이어에서 `* { outline-ring/50 }` 로 outline 기본 색도 ring 토큰을 따른다.
- 커스텀 인터랙티브 요소(예: `SortableHeader` 내부 버튼)도 `focus-visible:ring-2 focus-visible:ring-ring/40` 로 포커스 표시를 직접 부착한다.

**권장(To-Be)**: shadcn 기본 포커스 스타일을 유지한다. `div`/`span` 에 `onClick` 을 다는 대신 `<button>`/Radix primitive 를 사용해 포커스 가능성과 포커스 링을 함께 얻는다. 부득이하게 비표준 요소를 클릭 가능하게 만들면 `tabIndex={0}` + 키보드 핸들러 + `focus-visible` 스타일을 함께 부여한다.

---

## D. ARIA 패턴 현황 (As-Is)

현재 앱(shadcn primitive 자동 부착분 포함)에서 ARIA 속성 사용 현황은 다음과 같다.

| 속성 | 사용 수(대략) | 주요 사용처 |
|------|---------------|-------------|
| `aria-label` | ~150 | 아이콘 전용 버튼(앱 레일 햄버거 "메뉴 열기", 홈 마크 "홈"), 입력·액션 버튼 다수 |
| `aria-invalid` | ~18 | React Hook Form + Zod 검증 실패 입력 (테두리/링이 destructive 로 전환) |
| `aria-pressed` | ~13 | 토글 버튼(필터·뷰 전환 등) |
| `aria-hidden` | ~12 | 텍스트와 중복되는 장식 아이콘 |
| `aria-current="page"` | ~5 | 앱 레일 활성 모듈 링크 (`AppRail`) |
| `aria-sort` | ~4 | 정렬 가능한 테이블 헤더 (`SortableHeader`) |
| `aria-expanded` | ~2 | combobox / 펼침 컨트롤 |
| `aria-disabled` | ~2 | 예정(비활성) 모듈 표시 |

> 이슈 트래커가 핵심이라 데이터 테이블 a11y 가 비교적 성숙하다. shadcn 기본 `Table` 에는 없던 정렬 기능을 `SortableHeader` 헬퍼로 추가하며 `aria-sort` 표준값(`ascending`/`descending`/`none`)을 부착했다(이슈 #80). 헤더 영역 전체가 `<button>` 이라 Enter/Space 로도 정렬을 토글할 수 있다.

---

## E. ARIA 부족 항목 (현재 문제점)

1. **라이브 영역(Live Region) 부재**: 비동기 로딩/목록 갱신/동기화 진행률(예: 메일 동기화 진행바)을 알리는 `aria-live` 영역이 없다. 시각 사용자는 스피너로 알지만 SR 사용자는 변화를 인지하기 어렵다.
2. **Toast 알림 읽기 확인 필요**: Sonner 토스트가 스크린 리더에 올바르게 전달되는지(`role="status"`/`role="alert"`) 검증되지 않았다. 에러 토스트는 `assertive`, 일반 알림은 `polite` 가 적절하다.
3. **일부 아이콘 전용 버튼 `aria-label` 누락 가능성**: 다수가 부착되어 있으나 신규 컴포넌트에서 누락되기 쉽다. 코드 리뷰 체크리스트로 강제한다.
4. **장식 아이콘 `aria-hidden` 일관성 부족**: 텍스트 라벨과 함께 쓰이는 아이콘 일부에 `aria-hidden="true"` 가 빠져 SR 이 중복 낭독할 수 있다.
5. **채팅/메일 가상 스크롤 영역**: 새 메시지 도착·목록 추가 시 SR 공지가 없다(향후 라이브 영역 검토).

---

## F. 권장 ARIA 패턴 (To-Be)

```tsx
// 1. 아이콘 전용 버튼 — aria-label 필수
<Button variant="ghost" size="icon" aria-label="이슈 편집">
  <Pencil className="size-4" aria-hidden="true" />
</Button>

// 2. 데이터 테이블 — 내용 설명 + 정렬 표시
<Table aria-label="이슈 목록">
  <TableHeader>
    <TableRow>
      {/* SortableHeader 가 <th aria-sort=...> 와 키보드 토글 버튼을 함께 렌더 */}
      <SortableHeader
        direction={sortKey === 'title' ? sortOrder : 'none'}
        onSort={() => toggleSort('title')}
      >
        제목
      </SortableHeader>
    </TableRow>
  </TableHeader>
</Table>

// 3. 상태 Badge — 색상에만 의존하지 않기
<Badge variant="success" aria-label="상태: 완료">
  <CheckCircle className="size-3" aria-hidden="true" />
  완료
</Badge>

// 4. 비동기 업데이트용 Live Region (메일 동기화 진행률 등)
<div aria-live="polite" aria-atomic="true" className="sr-only">
  {isSyncing ? `동기화 중 ${progress}%` : `${total}개 메일`}
</div>

// 5. 에러 토스트 — 즉시 공지
toast.error('저장에 실패했습니다.') // Sonner: role="alert" / aria-live="assertive" 확인
```

---

## G. 키보드 내비게이션 (Keyboard Navigation)

대부분 Radix primitive 가 처리하며, 직접 구현한 부분(앱 레일 드로어 등)은 별도 표기한다.

| 패턴 | 키 | 기대 동작 | 처리 주체 |
|------|-----|-----------|-----------|
| Modal / Dialog (이슈 생성·삭제 확인 등) | `Escape` | 닫기 + 트리거로 포커스 복귀 | Radix Dialog/AlertDialog |
| Dialog | `Tab` / `Shift+Tab` | 포커스 트랩(다이얼로그 밖으로 못 나감) | Radix |
| Dropdown / Select | `Arrow Up/Down` | 옵션 탐색 | Radix |
| Dropdown / Select | `Enter` / `Space` | 옵션 선택 | Radix |
| Command Palette (`Command`) | 타이핑 / `Arrow` / `Enter` | 검색·이동 | cmdk(Radix 호환) |
| Tabs | `Arrow Left/Right` | 탭 전환 | Radix Tabs |
| 정렬 테이블 헤더 | `Tab` → `Enter`/`Space` | 정렬 토글 | `SortableHeader` (직접) |
| 데이터 테이블 셀 | `Tab` | 인터랙티브 셀(링크/버튼) 간 이동 | 표준 포커스 |
| 앱 레일 모바일 드로어 | `Escape` | 드로어 닫기 | `AppRail` (직접, `keydown` 리스너) |
| Form | `Enter` | 제출 | 표준 form |
| Tooltip | Hover / Focus | 호버·포커스 모두 표시 | Radix Tooltip |

> **미구현**: 전역 검색 단축키(`/` 포커스), 이슈 보드 칸반 카드의 화살표 키 이동/드래그 키보드 대체는 아직 없다. 칸반은 드래그 중심이라 키보드 전용 사용자를 위한 대체 경로(예: "다른 컬럼으로 이동" 메뉴) 마련을 백로그로 둔다.

---

## H. 모달 포커스 트랩 (Radix Dialog)

이슈 생성/편집, 삭제 확인(`DeleteConfirmDialog`/`AlertDialog`) 등은 모두 Radix `Dialog`/`AlertDialog` 위에 구현한다. 직접 오버레이를 만들지 않는다. Radix 가 제공하는 보장:

- 열리면 다이얼로그 내부로 포커스 이동, `Tab` 이 내부에 갇힘(포커스 트랩).
- `Escape` 또는 오버레이 클릭으로 닫기.
- 닫히면 직전 트리거 요소로 포커스 복귀.
- `aria-modal="true"` + 배경 콘텐츠 `aria-hidden` 처리.

```tsx
<Dialog>
  <DialogTrigger asChild>
    <Button>이슈 만들기</Button>
  </DialogTrigger>
  <DialogContent>
    {/* DialogTitle 은 필수 — SR 이 다이얼로그 제목을 낭독한다 */}
    <DialogTitle>새 이슈</DialogTitle>
    <DialogDescription className="sr-only">제목과 설명을 입력하세요</DialogDescription>
    {/* ...form... */}
  </DialogContent>
</Dialog>
```

> **주의**: `DialogContent` 에는 반드시 `DialogTitle` 을 둔다(Radix 가 접근 가능한 이름을 요구). 시각적으로 숨겨야 하면 `sr-only` 로 처리하되 생략하지 않는다.

---

## I. 터치 타겟 (Touch Targets)

| 요소 | 크기 | WCAG 2.5.5 (44px) |
|------|------|---------------------|
| 기본 버튼 (`size="default"`) | h-9 (36px) | 패딩 포함 히트 영역으로 보완 |
| `size="icon"` | size-9 (36px) | 패딩으로 보완 |
| `size="icon-sm"` | size-8 (32px) | 최소 미달 — 데스크톱 보조 동작에 한정 |
| `size="icon-xs"` | size-6 (24px) | **최소 미달** — 비필수·데스크톱 전용 동작에만 제한적 사용 |
| `size="icon-lg"` | size-10 (40px) | 권장(터치 중요 액션) |

> Smart Workplace 는 데스크톱-우선 앱(마우스/키보드 주 사용)이라 36px 아이콘 버튼이 기본이다. 반응형 전략은 [12-responsive.md](12-responsive.md) 참조. 모바일에서 빈번한 터치 동작에는 `icon-lg`(40px) 이상을 사용하고, `icon-xs` 는 모바일 노출을 피한다.

---

## J. 체크리스트 (PR 리뷰용)

- [ ] 아이콘 전용 버튼에 `aria-label` 이 있는가?
- [ ] 텍스트와 중복되는 장식 아이콘에 `aria-hidden="true"` 가 있는가?
- [ ] 클릭 동작은 `<button>`/Radix primitive 로 만들었는가? (`div` + `onClick` 지양)
- [ ] 새 커스텀 인터랙션에 `focus-visible` 스타일과 키보드 핸들러가 있는가?
- [ ] 상태/우선순위 표시가 색상 외 텍스트·아이콘을 함께 제공하는가?
- [ ] 정렬 테이블은 `SortableHeader`(=`aria-sort`)를 사용했는가?
- [ ] 비동기 진행/결과 변화가 SR 에 전달되는가(`aria-live` 또는 토스트)?
- [ ] Dialog 에 `DialogTitle` 이 있는가?
