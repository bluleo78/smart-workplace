# 13. Migration Backlog — 디자인 시스템 정리 잔여 작업

> 이 문서는 sibling `smart-fire-hub` 디자인 시스템을 `smart-workplace`로 이식하면서 발견된 **현황(As-Is)과 권장(To-Be)의 간극**을 우선순위별로 정리한다. 각 항목은 별도 이슈로 분리해 점진 처리한다.

## 우선순위 기준

| 등급 | 의미 |
|------|------|
| **P0** | 정확성/혼란 유발 — 죽은 코드·도메인 누수·잘못된 식별자. 가장 먼저 제거 |
| **P1** | 일관성 부채 — 사용자/개발자가 체감하는 불일치 (컨테이너·제목·삭제 UX) |
| **P2** | 접근성/품질 — a11y 부족, 매직 넘버 |
| **P3** | 미래 대비 — 시맨틱 스케일 도입, 미사용 토큰 정리 판단 |

---

## P0 — 죽은 코드 · fire-hub 도메인 누수 제거

이식 과정에서 sibling 프로젝트에서 물려받은, 워크플레이스에 해당 없는 코드가 다수 확인됐다.

- [ ] **`sparkline.tsx` 도메인 색상 누수** — `color: 'pipeline' | 'dataset' | 'dashboard'` 타입은 fire-hub(파이프라인/데이터셋 도메인) 잔재. 워크플레이스에는 그 도메인이 없다. 시맨틱 식별자(`primary`/`accent`/`muted` 등)로 리네임. ([01-design-tokens.md](./01-design-tokens.md) §domain-token)
- [ ] **죽은 차트 토큰** — `--chart-1..5`는 정의돼 있으나 recharts/nivo 등 차트 라이브러리가 의존성에 없고 sparkline도 `--primary`를 쓴다. 차트 도입 계획 확정 또는 토큰 제거 결정.
- [ ] **죽은 `--dtype-*` / `--dataset` 토큰** — 정의됐으나 어디서도 참조되지 않음. 제거 검토.
- [ ] **죽은 keyframes/스타일** — `index.css`의 `ai-chip-*`, `canvas-*` keyframes 및 `.dark .react-flow__*` 오버라이드는 fire-hub의 AI 캔버스/react-flow 기능 잔재. 워크플레이스에 react-flow 의존성 없음. 제거.
- [ ] **정의됐지만 미연결 유틸** — `.bg-gradient-main`, `.card-hover`, `.status-online`, `.glass`, `logo-pulse*`는 정의만 되고 컴포넌트에서 사용되지 않음. 사용처 연결 또는 제거 결정. (실사용 확인: `.row-hover` 3곳, `.nav-active-indicator` 1곳, `chat-dock-expand`만 실제 사용 — [08-animation-motion.md](./08-animation-motion.md))

---

## P1 — 일관성 부채

- [ ] **페이지 최상위 컨테이너 3종 혼재** — `container mx-auto p-6` / `space-y-6` / `mx-auto max-w-2xl`이 페이지마다 제각각. [05-page-patterns.md](./05-page-patterns.md)의 표준 컨테이너로 통일.
  - 진행: 컨텐츠 헤더 = **옵션** 원칙 확정 + 공용 `PageHeader`(옵션·`h-14`·사이드바 헤더와 정렬) 도입(2026-06-06). Phase 1–2 적용: 프로젝트 목록/상세·이슈 상세·홈·캘린더. **Phase 3–4 완료(#113, 2026-06-06)**: 메일·연락처·드라이브 마스터-디테일(전폭 `PageHeader` + 좁은 화면 제자리 전환+뒤로가기), 드라이브 폴더명 breadcrumb 행, 채팅 `ChannelHeader`/`DmHeader` `h-14`·`appTitleTextClass` 정렬 적용.
- [ ] **페이지 제목 타이포 불일치** — 대부분 `text-2xl font-semibold`이나 일부 `text-[28px]`. 또한 페이지 제목과 섹션 제목이 같은 `text-2xl`을 공유해 H1/H2 시각 계층이 없음. [02-typography.md](./02-typography.md)의 시맨틱 스케일로 정리.
  - 진행: 인-플로우 제목 토큰 `pageTitleClass`(`text-[28px] leading-[36px] font-semibold tracking-tight`) + 헤더 바 제목 `appTitleTextClass` 분리 도입(2026-06-06). Phase 1–2 적용: 프로젝트 목록/상세·이슈 상세·홈·캘린더. **Phase 3–4 완료(#113, 2026-06-06)**: 설정·어드민 영역 `pageTitleClass` 통일 + 메일 설정·비서 설정 누락 제목 추가. 잔여: 프로젝트 목록 등 `text-2xl` 그대로인 페이지(기회 있을 때 정리).
- [ ] **삭제 확인 UX 불일치** — 일부 삭제가 브라우저 네이티브 `confirm()`을 사용. 전부 `DeleteConfirmDialog`/`AlertDialog`로 통일. ([06-feedback-states.md](./06-feedback-states.md))
- [ ] **상세 페이지 탭 패턴 부재** — 탭형 상세 레이아웃이 아직 없음. 필요 모듈(이슈/프로젝트) 식별 후 표준 정의 여부 결정.

---

## P2 — 접근성 · 매직 넘버

- [x] **`text-[10px]`/`text-[11px]`/`text-[13px]` 매직 넘버** — 정리 완료(2026-06-18). `text-[10px]`/`text-[11px]`(접근성 12px 미만) → `text-xs`, `text-[13px]` → `text-sm` 로 일괄 상향(21파일). 공식 토큰 `pageTitleClass`(`text-[28px]`)·`appTitleTextClass`(`text-[15px]`)는 예외 유지.
- [ ] **ARIA live region 부재** — 메일 동기화 진행·토스트 등 동적 변화에 live region 미적용. ([10-accessibility.md](./10-accessibility.md))
- [ ] **Sonner 토스트 role 미검증** — 스크린리더 안내 여부 확인 및 보완.
- [ ] **대비비(contrast) 회귀 점검** — `text-muted-foreground` on `bg-muted` 등 경계 조합 WCAG AA 4.5:1 검증.

---

## P3 — 미래 대비 · 판단 필요

- [ ] **시맨틱 타이포 스케일 도입** — [02-typography.md](./02-typography.md)의 15단계 To-Be 스케일(`heading-page`(신규 28px) 등) 채택 여부. 채택 시 `@layer` 유틸 또는 컴포넌트화.
- [ ] **`tabular-nums` 적용** — 정의돼 있으나 미사용. 숫자 정렬이 필요한 테이블(이슈 번호·메트릭)에 적용.
- [x] **하드코딩 색 리터럴 정리** — 완료(2026-06-18). `chat-rich-input.css` 의 `rgb()` 3건(멘션 칩 bg/text, placeholder) → `color-mix(in oklch, var(--primary) …)`·`var(--primary)`·`var(--muted-foreground)` 토큰화. `pages` 내 팔레트색 위반(`text-green-600`→`text-success`, `text-amber-600`→`text-warning`)도 시맨틱 토큰으로 교체.
- 식별색 팔레트(라벨/아바타/프로젝트)는 **승인된 categorical 예외**로 분류·문서화([01-design-tokens.md §1-7](./01-design-tokens.md)). 아바타 색 중복(`UserAvatar` 자체 팔레트)은 `avatarColor.ts` 단일 출처로 통합 완료.
- [ ] **`ui/` 수동 편집 차단 정책** — fire-hub는 `components/ui/`를 ESLint ignore로 수동 편집을 막아 스타일 크리프를 방지. 동일 정책 도입 검토.
- [ ] **차트 라이브러리 도입 결정** — 도입 시 `--chart-*` 토큰 활용, 미도입 시 P0의 토큰 제거와 연동.

---

## 처리 원칙

- P0는 기능 영향 없는 순수 정리라 빠르게 일괄 처리 가능.
- P1/P2는 해당 모듈 작업 시 함께 정리(보이스카우트 규칙) 또는 별도 정리 PR.
- 각 항목 처리 시 이 체크박스를 갱신하고, 관련 문서(As-Is 기술 부분)도 함께 업데이트한다.
