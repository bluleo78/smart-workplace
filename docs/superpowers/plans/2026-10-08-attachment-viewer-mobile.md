# 통합 첨부 뷰어 — 모바일 배치·제스처 (WP-278) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** WP-277 의 통합 첨부 뷰어(`AttachmentViewer`)에 모바일 전체 화면 배치(상단 바·하단 4칸 액션 바·AI 요약 바텀시트·safe-area·theme-color·가로 모드)와 터치 제스처(스와이프 넘김·러버밴드·내용 우선·아래로 쓸어 닫기·탭 바 토글·핀치·두 번 탭 확대), iOS 저장·공유를 더한다. 데스크톱 동작은 바뀌지 않는다.

**Architecture:** 배치는 `useIsMobile`(폭 < 64rem)로, 제스처 활성은 `useIsCoarsePointer`(`pointer: coarse`)로 따로 판정한다(iPad 가로 = 데스크톱 배치 + 터치 제스처). 판정 로직(스와이프·닫기·러버밴드·속도·핀치 배율·확대 기준점 스크롤·하단 슬롯·공유/저장 방식·iOS 판정)은 전부 순수 함수로 두고 vitest 로 검증한다. 제스처는 본문을 감싼 "무대(stage)" 요소에 Touch Events 를 직접(`addEventListener`, `touchmove` 는 `passive:false`) 걸고, 첫 이동에서 우리 제스처로 판정됐을 때만 `preventDefault` 한다. 핀치는 새 의존성 없이 무대에 CSS `transform: scale()` 미리보기를 걸었다가 손을 뗄 때 WP-277 의 레이아웃 확대 상태(`zoom`)에 한 번만 반영하고, 기준점이 제자리에 남도록 스크롤을 맞춘다.

**Tech Stack:** React 19 · TypeScript · Tailwind 4 · shadcn/ui(Radix Dialog) · TanStack Query · `pdfjs-dist`(기존) · vitest · Playwright(`mobile` 프로젝트 = iPhone 13 뷰포트 + chromium, CDP 터치)

**Spec:** `/Users/bluleo78/git/smart-workplace/docs/superpowers/specs/2026-10-07-attachment-viewer-design.md` — 이 계획 범위는 §7-2(§4.2 모바일, §5.1 제스처, §5.4 저장·공유, §8.1 판정 순수 함수, §8.3 모바일 E2E 중 영상 제외). **워크트리에는 spec 이 없다(`docs/superpowers/` 는 gitignore) — 위 절대 경로로 읽는다.**
- 선행 계획(WP-277, 머지 완료): `/Users/bluleo78/git/smart-workplace/docs/superpowers/plans/2026-10-07-attachment-viewer-core.md`
- 확정 시안(메인 저장소): `/Users/bluleo78/git/smart-workplace/.superpowers/brainstorm/64115-1791377246/content/revised-viewer.html`(M1~M5·iPad), `gestures.html`, `mobile-viewer-layout.html`

## Global Constraints

- 작업 위치: 워크트리 `/Users/bluleo78/git/smart-workplace/.claude/worktrees/wp-278-viewer-mobile`, 브랜치 `feat/wp-278-viewer-mobile`. main 에 직접 쓰지 않는다. 모든 명령은 `apps/workplace-web` 에서 실행(아래 "실행 위치").
- 커밋은 워크트리 로컬 커밋 `git commit --no-verify` 까지. push·main 머지는 사용자 승인 후.
- 커밋 메시지: `docs/COMMIT_CONVENTION.md` — 헤더 `<type>(web): <한글 제목> (WP-278)`, 본문 첫 줄 `- WP-278`, 한글 평문 3~5줄, 끝에 아래 두 줄:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_0118pvsRQTanEBAzhsKg7E1o
  ```
- 한국어 주석 필수(모듈·export 함수·주요 분기·매직 넘버에 무엇을·왜) — `docs/CODING_CONVENTION.md`.
- 색은 시맨틱 토큰만(`bg-background`, `text-foreground`, `bg-black/60` 은 WP-277 이 이미 쓰는 오버레이 톤이라 허용). 예외: `<meta name="theme-color">` 값 `#000000` 은 CSS 가 아니라 브라우저 크롬 색이라 리터럴(주석으로 사유 명시).
- 백엔드 변경 없음. **새 npm 의존성 없음**(아래 판정 R1).
- 데스크톱(`chromium` 프로젝트) 기존 E2E 무수정 통과 — 특히 `e2e/pages/drive/attachment-viewer.spec.ts`, `drive-preview-*.spec.ts`, `e2e/pages/projects/attachments.spec.ts`.
- 기존 data-testid·접근 이름 유지: `attachment-viewer`, `preview-body`, `preview-meta`, `preview-download`(모바일에선 ⬇ 저장 칸에 단다), `pdf-document`, `pdf-page-{n}`, `viewer-side-panel`(데스크톱 패널), `viewer-live`, 버튼 이름 `닫기`·`더 보기`·`이전 파일`·`다음 파일`·`AI 요약`.
- 영상·오디오(`MediaPlayer`, 재생 막대 스와이프 제외 `inScrubZone`)는 WP-281 범위 — 이 계획에서 만들지 않는다.
- vitest 는 `src/**/*.test.ts` 만 잡는다(`.tsx` 테스트 금지). DOM 이 필요한 파일만 첫 줄 `// @vitest-environment jsdom`.
- E2E 고정 대기 금지(`waitForTimeout`) — 제스처 자체의 시간(느린 끌기)·"N ms 동안 일어나지 않음" 부재 확인만 `// eslint-disable-next-line playwright/no-wait-for-timeout -- <사유>` 와 함께 허용(`e2e/fixtures/mobile-chat.ts` `longPress` 관례).
- E2E 의 터치는 **반드시 CDP `Input.dispatchTouchEvent`**(Task 5 의 `e2e/fixtures/touch.ts`). `page.mouse`(=`pointerType: 'mouse'`)로 흉내 내지 않는다 — touch-action·Touch Events 경로를 전혀 타지 않아 실기기 실패를 놓친다.

### 실행 위치

```bash
cd /Users/bluleo78/git/smart-workplace/.claude/worktrees/wp-278-viewer-mobile/apps/workplace-web
```
- 단위: `pnpm exec vitest run <파일>`
- E2E 모바일: `pnpm exec playwright test e2e/pages/mobile/attachment-viewer-mobile.spec.ts --project=mobile`
- E2E 데스크톱: `pnpm exec playwright test e2e/pages/drive/attachment-viewer.spec.ts --project=chromium`
- 타입: `pnpm typecheck && npx tsc -p tsconfig.e2e.json --noEmit` · 린트: `pnpm lint`

## 판정 기록 (Rulings — 스펙이 비었거나 스펙과 다르게 정한 것)

- **R1 핀치는 새 의존성 없이 구현 — 스펙 §2·§6 의 `react-zoom-pan-pinch` 를 대체.** 근거: WP-277 의 확대는 transform 이 아니라 레이아웃 폭(`fitWidth × zoom`, PDF `cssWidth = width × zoom`)이라 스크롤 영역이 실제로 커지고 키보드·＋/－·가로 스크롤 양보 규칙이 그 위에 서 있다. 라이브러리는 transform 기반이라 이 모델과 충돌한다. 대신 핀치 중에는 무대에 `transform: scale(live/committed)` 미리보기만 걸고(PDF 캔버스 재렌더 폭주 방지), 손을 뗄 때 `zoom` 을 한 번 커밋 + `anchorScroll` 로 두 손가락 중점(두 번 탭은 탭 지점)이 제자리에 남게 스크롤을 맞춘다. (코드 리뷰로 수정: 페이지 간격·여백은 배율을 따르지 않아 단순 비례가 어긋나므로, 제스처 시작 때 기준 요소(PDF 페이지·이미지) 안 비율을 재 두고 레이아웃 뒤 그 요소의 실제 위치로 맞춘다 — `anchoredScroll`.) 커밋된 배율로 PDF 가 다시 그려지므로 글자도 선명하다(스펙 §5.1 "확대 배율로 재렌더").
- **R2 제스처 이벤트 모델 = Touch Events + `touchmove {passive:false}` + 무대 `touch-action`.** Pointer Events 는 브라우저가 스크롤을 가져가는 순간 `pointercancel` 로 제스처를 잃어 "넓은 표는 내용 먼저, 가장자리에선 넘김"·"문서는 맨 위에서 당길 때만 닫기"를 표현할 수 없다. React `onTouchMove` 는 passive 로 등록돼 `preventDefault` 가 무시되므로 `useEffect` 에서 `addEventListener` 로 건다. 무대 `touch-action`: 맞춤(1×) 이미지 = `none`(스크롤할 것이 없음 — 스와이프·닫기·핀치 전부 우리 것), 그 외 = `pan-x pan-y`(네이티브 스크롤 유지, 브라우저 핀치 확대만 끔). 스크롤 컨테이너마다 touch-action 이 따로 계산되므로 무대 자손 전체에 같은 값을 건다(index.css). Android 당겨서 새로고침은 닫기 판정 시 `preventDefault` + `overscroll-behavior: contain` 으로 막는다. Task 5 첫 단계에서 chromium(CDP 터치)으로 이 모델이 성립하는지 먼저 확인한다(성립하지 않으면 BLOCKED 로 보고 — 임의 대체 금지).
- **R3 스펙 `decideSwipe(dx, velocity, canPanX, atEdge, startX, inScrubZone)` 는 두 함수로 나눈다.** 첫 이동에서의 방향 잠금 `lockGesture`(가장자리 20px·내용 우선·맨 위 닫기)와 손을 뗄 때의 확정 `decideSwipe`(25%·플링·끝). `inScrubZone` 은 WP-281 이 `lockGesture` 입력에 더한다.
- **R4 제스처 대상 스크롤 영역 찾기 규칙(하나로 통일):** 손가락 아래 요소에서 무대까지 조상을 올라가며 `overflow-x|y: auto|scroll` 이고 실제로 넘치는(±1px 허용) 첫 요소. 가로 여유(`canPanLeft/Right`)와 맨 위 판정(`atTop`, 세로 스크롤 영역이 없으면 참) 모두 이 규칙. 확대 기준점 스크롤은 무대 안 첫 `[data-hscroll]`(이미지 = 본문 자신, PDF = `pdf-document`).
- **R5 탭 = 바 토글은 "모바일 배치 + coarse" 에서만.** iPad(데스크톱 배치 + coarse)는 스와이프·핀치·두 번 탭·아래로 닫기만 켜고 바 토글은 없다(데스크톱 헤더는 숨기지 않음). 좁은 창 + 마우스(fine)는 제스처 없음·바 항상 표시.
- **R6 단일 탭은 항상 `DOUBLE_TAP_MS`(300ms) 뒤 처리.** 두 번 탭과 구분하려는 이유 외에, 탭으로 포커스가 본문으로 옮겨진 뒤 "포커스가 바 안이면 숨기지 않음" 을 판정하기 위함(형식과 무관하게 같은 지연).
- **R7 제스처로 넘길 때는 끝에서 반대쪽 ‹ › 로 포커스를 옮기지 않는다**(`go(dir, { moveFocus: false })`). 옮기면 숨김 대상(‹ ›) 안에 포커스가 생겨 다음 탭이 바를 숨기지 못한다. 키보드·버튼 넘김의 WP-277 포커스 규칙은 그대로.
- **R8 플로팅 `－ 폭 맞춤 ＋` 는 모바일 배치에서 숨긴다**(하단 액션 바와 겹침, 확대는 핀치·두 번 탭). 데스크톱·iPad 는 유지.
- **R9 터치 확대 범위 1~3×(이미지·PDF 공통), 두 번 탭 = 1× ↔ 2×**(확대 중 두 번 탭 = 1×). 데스크톱 버튼·키보드 범위(0.5~3, 25% 단계)는 그대로.
- **R10 모바일 배치에서 AI 요약 시트는 항상 닫힌 채 열린다**(저장된 패널 상태·`defaultPanelOpen` 무시). 모바일에서 열고 닫은 것은 저장하지 않는다 — 데스크톱의 마지막 패널 상태를 덮지 않게.
- **R11 "참조된 곳" 띠(요약 숨김·없음 + backlinks)는 모바일에선 하단 액션 바 위(같은 겹침 레이어)에 둔다**, 요약 시트가 열리면 시트 안에 이미 있다.
- **R12 하단 4칸 상태:** ⬇ = 사용 불가(링크 원본 삭제)면 빈칸, 아니면 활성 / ⤴ = 사용 불가면 빈칸, blob 준비 + `canShare` 참이면 활성, blob 을 받는 중이면 "받는 중" 비활성, 그 외(미지원 형식처럼 blob 을 받지 않음·10MB 동의 대기·오류·브라우저 미지원·`canShare` 거짓)는 "공유할 수 없음" 비활성 / ☁ = `importFileId` 없으면 빈칸, 가져오기 준비 전이면 비활성 / ✨ = 요약 `show` 일 때만 활성, 아니면 빈칸. 위치는 항상 4칸 그리드로 고정.
- **R13 ⬇ 저장:** 기본은 기존 `downloadViewerItem`(드라이브는 `/download` 경로 = 감사 로그). iOS 홈 화면 앱(standalone)이고 blob 이 메모리에 있고 `canShare` 참이면 공유 시트로 저장. 이 경로는 미리보기 blob 을 쓰므로 드라이브 다운로드 감사 로그가 남지 않는다(알려진 한계 — 위험 기록). 공유 취소(`AbortError`)는 조용히 무시, 그 외 실패만 토스트.
- **R14 `revokeObjectURL` 지연:** `lib/download.ts` `downloadBlob` 이 60초 뒤 해제하고, `driveApi.downloadByPath` 는 자체 복사본 대신 `downloadBlob` 을 쓴다(뷰어 ⬇ 경로가 실제로 이 함수다).
- **R15 theme-color 는 모바일 배치에서 뷰어가 열려 있는 동안만 `#000000`**, 닫히면(언마운트) 원래 값(`#4338ca`)으로 복원. — **코드 리뷰로 수정:** 리터럴 `#000000` 대신 뷰어 배경 레이어(`bg-background` 토큰)의 계산값을 rgb 로 읽어 넣는다(상태바가 뷰어 배경과 같은 색, 위 Global Constraints 의 리터럴 예외는 더 이상 쓰지 않음).
- **R16 HTML·DOCX 는 iframe 안 터치가 iframe 문서로 가므로 그 위에서는 스와이프·탭이 동작하지 않는다**(알려진 한계). 모바일은 ‹ › 가 상시 보여 넘김 수단이 남는다.

## Review Focus

1. **⤴/⬇ 를 blob 도착 전·blob 을 받지 않는 형식(미지원 zip·10MB 동의 대기)에서 누름, 공유 시트 취소** — "받는 중"이 영원히 남지 않고 "공유할 수 없음"으로 구분되며, 취소는 오류 토스트를 띄우지 않는다. → Task 2 vitest(`resolveShareState`) + Task 8 E2E.
2. **제스처가 바·버튼·⋯ 메뉴·요약 시트·본문 안 링크/버튼에서 시작** — 넘김·바 토글·닫기가 일어나지 않는다(무대 밖이거나 `INTERACTIVE` 제외). → Task 5 E2E(다시 시도 버튼 위 스와이프) + Task 6 E2E(시트 위 탭).
3. **스와이프 도중 두 번째 손가락이 닿음** — 넘김이 일어나지 않고(무대 원위치), 확대 가능 형식이면 핀치로 이어진다. → Task 5 E2E(2점 터치 후 카운터 불변) + Task 7 E2E.
4. **열린 채 회전(세로↔가로)** — 가로는 바 숨김이 기본, 세로로 돌아오면 다시 보이고, 어느 쪽도 가로 넘침이 없다. → Task 6 E2E.
5. **끝까지 스와이프한 뒤 탭 / 바 숨김 중 Tab** — 끝에서 포커스가 ‹ › 로 가지 않아 탭이 바를 숨기고(R7), 숨긴 바는 `inert` 라 Tab 이 들어가지 않는다. → Task 6 E2E.

---

## File Structure

| 파일 | 책임 |
|---|---|
| Create `src/components/viewer/viewerGestures.ts` (+ `.test.ts`) | 제스처 판정 순수 함수·상수(잠금·넘김·닫기·러버밴드·속도·두 번 탭·핀치 배율·기준점 스크롤) |
| Create `src/components/viewer/viewerActions.ts` (+ `.test.ts`) | 하단 4칸 슬롯 상태, 공유 상태, 저장 방식 순수 함수 |
| Create `src/lib/platform.ts` (+ `.test.ts`) | iOS 기기·standalone 판정(푸시 지원 판정과 공유) |
| Modify `src/lib/push/support.ts` | `readPushEnv` 가 `platform.ts` 를 쓴다(중복 제거) |
| Modify `src/lib/download.ts` (+ Create `src/lib/download.test.ts`) | object URL 해제 지연 |
| Modify `src/api/drive.ts:238-248` | `downloadByPath` 가 `downloadBlob` 재사용 |
| Modify `src/lib/mobile/mediaQueryStore.ts` | 가로 방향 스토어 추가 |
| Create `src/hooks/useIsLandscape.ts` | 가로 방향 구독 훅 |
| Create `src/hooks/useThemeColor.ts` | 열린 동안 theme-color 덮어쓰기·복원 |
| Create `src/components/viewer/ViewerMobileBars.tsx` | 모바일 상단 바·하단 4칸 액션 바 |
| Modify `src/components/viewer/ViewerSidePanel.tsx` | 내용 추출(`ViewerPanelContent`) + 모바일 바텀시트(`ViewerSummarySheet`) |
| Create `src/components/viewer/useViewerGestures.ts` | 무대 Touch Events 배선(스와이프·닫기·탭·핀치·두 번 탭) + 스크롤 영역 찾기 |
| Create `src/components/viewer/viewerShare.ts` | Web Share 지원·파일 공유 호출(취소 무시) |
| Modify `src/components/viewer/AttachmentViewer.tsx` | 배치 분기·무대·바 상태·제스처 연결·확대 기준점·공유/저장 |
| Modify `src/components/viewer/ViewerBody.tsx` | 바 겹침 여백(`chromeInset`)·blob 상태 보고(`onSource`) |
| Modify `src/components/viewer/ViewerMoreMenu.tsx` | 트리거 터치 크기(`pointer-coarse:size-11`) |
| Modify `src/index.css` | 무대 touch-action 규칙, 키보드 열림 다이얼로그 규칙에서 뷰어 제외 |
| Create `e2e/fixtures/touch.ts` | CDP 터치 헬퍼(끌기·탭·두 번 탭·핀치) |
| Create `e2e/pages/mobile/attachment-viewer-mobile.spec.ts` | 모바일 E2E 전부(작업별로 테스트 추가) |
| Modify `e2e/pages/drive/attachment-viewer.spec.ts` | 데스크톱 회귀: 하단 바 없음·확대 툴바 유지 |

---

### Task 1: 제스처 판정 순수 함수

**Files:**
- Create: `apps/workplace-web/src/components/viewer/viewerGestures.ts`
- Test: `apps/workplace-web/src/components/viewer/viewerGestures.test.ts`

**Interfaces:**
- Consumes: 없음
- Produces (Task 5·6·7 이 그대로 import):
  - 상수 `EDGE_GUARD_PX=20`, `SWIPE_COMMIT_RATIO=0.25`, `FLING_VELOCITY=0.5`, `FLING_MIN_DISTANCE=30`, `LOCK_SLOP_PX=6`, `DISMISS_RATIO=0.2`, `DOUBLE_TAP_MS=300`, `DOUBLE_TAP_DIST_PX=30`, `TOUCH_ZOOM_MIN=1`, `TOUCH_ZOOM_MAX=3`, `DOUBLE_TAP_ZOOM=2`, `VELOCITY_WINDOW_MS=100`
  - `type GestureLock = 'pending' | 'swipe' | 'dismiss' | 'native'`
  - `interface Sample { t: number; x: number; y: number }`
  - `interface LockInput { dx: number; dy: number; startX: number; viewportWidth: number; canPanLeft: boolean; canPanRight: boolean; atTop: boolean; zoom: number }`
  - `lockGesture(i: LockInput): GestureLock`
  - `decideSwipe(i: { dx: number; vx: number; width: number; hasPrev: boolean; hasNext: boolean }): 'prev' | 'next' | 'stay'`
  - `decideDismiss(i: { dy: number; vy: number; height: number }): boolean`
  - `rubberBand(dx: number, limit: number): number`
  - `dragOffset(dx: number, width: number, hasPrev: boolean, hasNext: boolean): number`
  - `releaseVelocity(samples: Sample[], windowMs?: number): { vx: number; vy: number }`
  - `isDoubleTap(prev: Sample | null, cur: Sample): boolean`
  - `pinchZoom(startZoom: number, startDist: number, dist: number): number`
  - `doubleTapTarget(zoom: number): number`
  - `anchorScroll(i: { scrollLeft: number; scrollTop: number; focusX: number; focusY: number; from: number; to: number }): { left: number; top: number }`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/components/viewer/viewerGestures.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import {
  anchorScroll,
  decideDismiss,
  decideSwipe,
  doubleTapTarget,
  dragOffset,
  isDoubleTap,
  type LockInput,
  lockGesture,
  pinchZoom,
  releaseVelocity,
  rubberBand,
} from './viewerGestures'

const lock: LockInput = { dx: 0, dy: 0, startX: 200, viewportWidth: 390, canPanLeft: false, canPanRight: false, atTop: true, zoom: 1 }

describe('lockGesture', () => {
  it('흔들림(6px 미만)은 아직 판정하지 않는다', () => {
    expect(lockGesture({ ...lock, dx: -5, dy: 2 })).toBe('pending')
  })
  it('가로가 우세하고 내용이 그 방향으로 더 갈 수 없으면 넘김', () => {
    expect(lockGesture({ ...lock, dx: -20, dy: 3 })).toBe('swipe')
    expect(lockGesture({ ...lock, dx: 20, dy: 3 })).toBe('swipe')
  })
  it('내용 우선 — 손가락이 왼쪽으로 가는데 오른쪽 여유가 있으면 네이티브(내용 이동)', () => {
    expect(lockGesture({ ...lock, dx: -20, canPanRight: true })).toBe('native')
    // 반대 방향 여유만 있으면 넘김(가장자리에 닿은 상태)
    expect(lockGesture({ ...lock, dx: -20, canPanLeft: true })).toBe('swipe')
    expect(lockGesture({ ...lock, dx: 20, canPanLeft: true })).toBe('native')
  })
  it('화면 가장자리 20px 안에서 시작하면 무시(iOS 뒤로가기 보호)', () => {
    expect(lockGesture({ ...lock, startX: 10, dx: 100 })).toBe('native')
    expect(lockGesture({ ...lock, startX: 375, dx: -100 })).toBe('native')
    expect(lockGesture({ ...lock, startX: 20, dx: 100 })).toBe('swipe')
  })
  it('원래 크기에서 맨 위일 때 아래로 당기면 닫기', () => {
    expect(lockGesture({ ...lock, dy: 20 })).toBe('dismiss')
  })
  it('맨 위가 아니거나 확대 중이거나 위로 밀면 네이티브(스크롤·팬)', () => {
    expect(lockGesture({ ...lock, dy: 20, atTop: false })).toBe('native')
    expect(lockGesture({ ...lock, dy: 20, zoom: 2 })).toBe('native')
    expect(lockGesture({ ...lock, dy: -20 })).toBe('native')
  })
})

describe('decideSwipe', () => {
  const base = { dx: 0, vx: 0, width: 400, hasPrev: true, hasNext: true }
  it('폭 25% 초과 이동이면 넘김(왼쪽 = 다음)', () => {
    expect(decideSwipe({ ...base, dx: -101 })).toBe('next')
    expect(decideSwipe({ ...base, dx: 101 })).toBe('prev')
  })
  it('25% 이하·느리면 제자리', () => {
    expect(decideSwipe({ ...base, dx: -100, vx: -0.2 })).toBe('stay')
  })
  it('플링(같은 방향 0.5px/ms 초과 + 30px 초과)이면 짧아도 넘김', () => {
    expect(decideSwipe({ ...base, dx: -40, vx: -0.8 })).toBe('next')
    expect(decideSwipe({ ...base, dx: -20, vx: -0.8 })).toBe('stay')
    // 반대 방향 속도(되돌리는 중)는 플링 아님
    expect(decideSwipe({ ...base, dx: -40, vx: 0.8 })).toBe('stay')
  })
  it('끝에서는 그 방향으로 넘기지 않는다(순환 없음)', () => {
    expect(decideSwipe({ ...base, dx: -300, hasNext: false })).toBe('stay')
    expect(decideSwipe({ ...base, dx: 300, hasPrev: false })).toBe('stay')
  })
})

describe('decideDismiss', () => {
  it('높이 20% 초과 또는 아래 방향 플링이면 닫기', () => {
    expect(decideDismiss({ dy: 170, vy: 0, height: 800 })).toBe(true)
    expect(decideDismiss({ dy: 60, vy: 0.9, height: 800 })).toBe(true)
    expect(decideDismiss({ dy: 100, vy: 0.1, height: 800 })).toBe(false)
    expect(decideDismiss({ dy: 60, vy: -0.9, height: 800 })).toBe(false)
  })
})

describe('rubberBand / dragOffset', () => {
  it('러버밴드는 방향을 지키며 실제 이동보다 작고 한계를 넘지 않는다', () => {
    expect(rubberBand(0, 120)).toBe(0)
    const r = rubberBand(-100, 120)
    expect(r).toBeLessThan(0)
    expect(Math.abs(r)).toBeLessThan(100)
    expect(Math.abs(rubberBand(10_000, 120))).toBeLessThan(120)
  })
  it('갈 곳이 있으면 손가락을 그대로 따르고, 끝이면 러버밴드', () => {
    expect(dragOffset(-80, 400, true, true)).toBe(-80)
    expect(Math.abs(dragOffset(-80, 400, true, false))).toBeLessThan(80)
    expect(Math.abs(dragOffset(80, 400, false, true))).toBeLessThan(80)
  })
})

describe('releaseVelocity', () => {
  it('마지막 100ms 창의 평균 속도(px/ms)', () => {
    expect(releaseVelocity([{ t: 0, x: 0, y: 0 }, { t: 50, x: -50, y: 0 }, { t: 100, x: -100, y: 10 }])).toEqual({ vx: -1, vy: 0.1 })
  })
  it('창 밖의 오래된 표본은 무시한다(멈췄다 튕긴 경우)', () => {
    expect(releaseVelocity([{ t: 0, x: 0, y: 0 }, { t: 500, x: -10, y: 0 }, { t: 550, x: -60, y: 0 }]).vx).toBe(-1)
  })
  it('표본이 하나뿐이면 0', () => {
    expect(releaseVelocity([{ t: 0, x: 0, y: 0 }])).toEqual({ vx: 0, vy: 0 })
  })
})

describe('isDoubleTap', () => {
  it('300ms·30px 안의 두 번째 탭', () => {
    expect(isDoubleTap({ t: 0, x: 100, y: 100 }, { t: 250, x: 110, y: 105 })).toBe(true)
    expect(isDoubleTap({ t: 0, x: 100, y: 100 }, { t: 350, x: 100, y: 100 })).toBe(false)
    expect(isDoubleTap({ t: 0, x: 100, y: 100 }, { t: 100, x: 200, y: 100 })).toBe(false)
    expect(isDoubleTap(null, { t: 0, x: 0, y: 0 })).toBe(false)
  })
})

describe('pinchZoom / doubleTapTarget', () => {
  it('두 손가락 거리 비율로 배율을 바꾸고 1~3 으로 자른다', () => {
    expect(pinchZoom(1, 100, 200)).toBe(2)
    expect(pinchZoom(2, 100, 50)).toBe(1)
    expect(pinchZoom(1, 100, 50)).toBe(1)
    expect(pinchZoom(2, 100, 400)).toBe(3)
    expect(pinchZoom(1.5, 0, 100)).toBe(1.5)
  })
  it('두 번 탭은 맞춤 ↔ 2배', () => {
    expect(doubleTapTarget(1)).toBe(2)
    expect(doubleTapTarget(2)).toBe(1)
    expect(doubleTapTarget(2.6)).toBe(1)
  })
})

describe('anchorScroll', () => {
  it('확대 시 기준점이 화면의 같은 자리에 남는다', () => {
    expect(anchorScroll({ scrollLeft: 0, scrollTop: 0, focusX: 100, focusY: 50, from: 1, to: 2 })).toEqual({ left: 100, top: 50 })
  })
  it('축소는 반대로, 음수 스크롤은 0', () => {
    expect(anchorScroll({ scrollLeft: 100, scrollTop: 50, focusX: 100, focusY: 50, from: 2, to: 1 })).toEqual({ left: 0, top: 0 })
    expect(anchorScroll({ scrollLeft: 0, scrollTop: 0, focusX: 100, focusY: 50, from: 2, to: 1 })).toEqual({ left: 0, top: 0 })
  })
  it('잘못된 기준 배율(0 이하)이면 그대로', () => {
    expect(anchorScroll({ scrollLeft: 7, scrollTop: 9, focusX: 1, focusY: 1, from: 0, to: 2 })).toEqual({ left: 7, top: 9 })
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm exec vitest run src/components/viewer/viewerGestures.test.ts`
Expected: FAIL — `Failed to resolve import "./viewerGestures"`

- [ ] **Step 3: 구현**

`src/components/viewer/viewerGestures.ts`:

```ts
// 통합 뷰어 터치 제스처 판정 순수 로직(WP-278). 훅(useViewerGestures)은 DOM 에서 값만 재서 넘기고 결과대로만 움직인다.
// 왜 순수 함수인가: 25%·플링·내용 우선·가장자리 같은 규칙은 브라우저 없이 경계값까지 검증해야 회귀를 잡는다(스펙 §8.1).

/** 화면 좌우 가장자리 이 폭 안에서 시작한 제스처는 무시 — iOS 가장자리 뒤로가기와 겹치지 않게(스펙 §5.1). */
export const EDGE_GUARD_PX = 20
/** 넘김 확정 이동 비율 — 무대 폭의 25% 초과(스펙 §5.1). */
export const SWIPE_COMMIT_RATIO = 0.25
/** 플링 판정 속도(px/ms ≈ 500px/s) — 짧게 튕겨도 넘어가게 하는 사진 앱 체감값. */
export const FLING_VELOCITY = 0.5
/** 플링이어도 이 거리(px)는 넘어야 확정 — 탭 흔들림을 플링으로 오인하지 않게. */
export const FLING_MIN_DISTANCE = 30
/**
 * 방향 잠금 전 허용 흔들림(px). 브라우저가 스크롤을 시작하는 임계(약 10px)보다 작아야
 * 잠금 직후 preventDefault 가 아직 취소 가능한 touchmove 에 걸린다.
 */
export const LOCK_SLOP_PX = 6
/** 아래로 쓸어 닫기 확정 비율 — 무대 높이의 20%(사진 앱 체감값, 스펙은 수치 미정). */
export const DISMISS_RATIO = 0.2
/** 두 번 탭 판정 간격(ms)·거리(px) — 단일 탭도 이만큼 기다렸다 처리한다(판정 R6). */
export const DOUBLE_TAP_MS = 300
export const DOUBLE_TAP_DIST_PX = 30
/** 터치 확대 범위 — 맞춤(1) 아래로는 줄이지 않는다. PDF 1~3×(스펙 §5.1), 이미지도 같은 상한(판정 R9). */
export const TOUCH_ZOOM_MIN = 1
export const TOUCH_ZOOM_MAX = 3
/** 두 번 탭 확대 배율(스펙 §5.1: 1× ↔ 2×). */
export const DOUBLE_TAP_ZOOM = 2
/** 손 뗄 때 속도를 재는 최근 구간(ms) — 멈췄다 놓은 경우 오래된 이동이 속도에 섞이지 않게. */
export const VELOCITY_WINDOW_MS = 100

/** 첫 이동에서 정한 제스처 소유권 — pending(아직 모름)·swipe(파일 넘김)·dismiss(아래로 닫기)·native(브라우저 스크롤에 맡김). */
export type GestureLock = 'pending' | 'swipe' | 'dismiss' | 'native'

/** 터치 표본 — 시각(ms)과 화면 좌표. */
export interface Sample {
  t: number
  x: number
  y: number
}

/** 방향 잠금 입력 — 훅이 시작 시점의 스크롤 여유와 누적 이동을 재서 넘긴다. */
export interface LockInput {
  /** 시작점 대비 누적 이동(px). */
  dx: number
  dy: number
  /** 시작점 화면 x(clientX) — 가장자리 판정용. */
  startX: number
  viewportWidth: number
  /** 손가락 아래 가로 스크롤 영역이 왼쪽/오른쪽으로 더 갈 수 있는가(시작 시점). */
  canPanLeft: boolean
  canPanRight: boolean
  /** 손가락 아래 세로 스크롤 영역이 맨 위인가(세로 스크롤 영역이 없으면 참). */
  atTop: boolean
  zoom: number
}

/**
 * 첫 의미 있는 이동에서 제스처 소유권을 정한다(스펙 §5.1).
 * - 가장자리 20px 시작은 OS 몫(native).
 * - 가로 우세: 내용이 그 방향으로 더 갈 수 있으면 내용 먼저(native), 가장자리에 닿아 있으면 넘김(swipe).
 * - 세로 우세: 원래 크기 + 맨 위 + 아래로 당김이면 닫기(dismiss), 그 외는 스크롤·팬(native).
 */
export function lockGesture(i: LockInput): GestureLock {
  if (i.startX < EDGE_GUARD_PX || i.startX > i.viewportWidth - EDGE_GUARD_PX) return 'native'
  const ax = Math.abs(i.dx)
  const ay = Math.abs(i.dy)
  if (Math.max(ax, ay) < LOCK_SLOP_PX) return 'pending'
  if (ax > ay) {
    // 손가락이 왼쪽(dx<0) = 내용은 오른쪽을 보려는 것 → 오른쪽 여유가 있으면 내용이 먼저 움직인다.
    const room = i.dx < 0 ? i.canPanRight : i.canPanLeft
    return room ? 'native' : 'swipe'
  }
  return i.dy > 0 && i.zoom === 1 && i.atTop ? 'dismiss' : 'native'
}

/** 손을 뗄 때 넘김 확정 — 폭 25% 초과 또는 같은 방향 플링. 끝에서는 그 방향으로 넘기지 않는다(순환 없음). */
export function decideSwipe(i: { dx: number; vx: number; width: number; hasPrev: boolean; hasNext: boolean }): 'prev' | 'next' | 'stay' {
  const far = Math.abs(i.dx) > i.width * SWIPE_COMMIT_RATIO
  const fling = Math.abs(i.vx) > FLING_VELOCITY && Math.sign(i.vx) === Math.sign(i.dx) && Math.abs(i.dx) > FLING_MIN_DISTANCE
  if (!far && !fling) return 'stay'
  if (i.dx < 0) return i.hasNext ? 'next' : 'stay'
  return i.hasPrev ? 'prev' : 'stay'
}

/** 손을 뗄 때 아래로 닫기 확정 — 높이 20% 초과 또는 아래 방향 플링. */
export function decideDismiss(i: { dy: number; vy: number; height: number }): boolean {
  if (i.dy > i.height * DISMISS_RATIO) return true
  return i.vy > FLING_VELOCITY && i.dy > FLING_MIN_DISTANCE
}

/**
 * 러버밴드 — 끝에서 더 끌면 점점 덜 따라오게(iOS 스크롤 바운스 곡선). 결과는 limit 를 넘지 않는다.
 * f(x) = (1 - 1 / (|x|·0.55 / limit + 1)) · limit
 */
export function rubberBand(dx: number, limit: number): number {
  if (dx === 0 || limit <= 0) return 0
  return Math.sign(dx) * (1 - 1 / ((Math.abs(dx) * 0.55) / limit + 1)) * limit
}

/** 끌기 중 무대 이동량 — 넘길 곳이 있으면 손가락을 그대로, 처음·끝이면 러버밴드(폭 30% 한계). */
export function dragOffset(dx: number, width: number, hasPrev: boolean, hasNext: boolean): number {
  const blocked = (dx < 0 && !hasNext) || (dx > 0 && !hasPrev)
  return blocked ? rubberBand(dx, width * 0.3) : dx
}

/** 최근 windowMs 구간의 평균 속도(px/ms). 표본이 부족하거나 시간이 0 이면 0. */
export function releaseVelocity(samples: Sample[], windowMs = VELOCITY_WINDOW_MS): { vx: number; vy: number } {
  if (samples.length < 2) return { vx: 0, vy: 0 }
  const last = samples[samples.length - 1]
  let first = last
  for (let k = samples.length - 2; k >= 0 && last.t - samples[k].t <= windowMs; k--) first = samples[k]
  const dt = last.t - first.t
  if (dt <= 0) return { vx: 0, vy: 0 }
  return { vx: (last.x - first.x) / dt, vy: (last.y - first.y) / dt }
}

/** 직전 탭과 이번 탭이 두 번 탭인가(시간·거리 모두 안). */
export function isDoubleTap(prev: Sample | null, cur: Sample): boolean {
  if (!prev) return false
  return cur.t - prev.t <= DOUBLE_TAP_MS && Math.hypot(cur.x - prev.x, cur.y - prev.y) <= DOUBLE_TAP_DIST_PX
}

/** 두 손가락 거리 비율로 새 배율 — 터치 범위(1~3)로 자른다. 시작 거리가 0 이하면 그대로. */
export function pinchZoom(startZoom: number, startDist: number, dist: number): number {
  if (startDist <= 0) return startZoom
  return Math.min(TOUCH_ZOOM_MAX, Math.max(TOUCH_ZOOM_MIN, startZoom * (dist / startDist)))
}

/** 두 번 탭 목표 배율 — 맞춤이면 2배, 확대 중이면 맞춤. */
export function doubleTapTarget(zoom: number): number {
  return zoom > 1 ? 1 : DOUBLE_TAP_ZOOM
}

/**
 * 배율이 from → to 로 바뀐 뒤의 스크롤 위치 — 스크롤 영역 안 기준점(focus, 영역 왼쪽 위 기준 px)이 화면의 같은 자리에 남게 한다.
 * 확대는 레이아웃 폭을 키우는 방식(WP-277)이라 내용 좌표가 배율에 비례한다는 가정. 음수는 0 으로(브라우저가 최대값은 자른다).
 */
export function anchorScroll(i: { scrollLeft: number; scrollTop: number; focusX: number; focusY: number; from: number; to: number }): { left: number; top: number } {
  if (i.from <= 0) return { left: i.scrollLeft, top: i.scrollTop }
  const r = i.to / i.from
  return {
    left: Math.max(0, Math.round((i.scrollLeft + i.focusX) * r - i.focusX)),
    top: Math.max(0, Math.round((i.scrollTop + i.focusY) * r - i.focusY)),
  }
}
```

- [ ] **Step 4: 통과 확인**

Run: `pnpm exec vitest run src/components/viewer/viewerGestures.test.ts`
Expected: PASS (전 케이스). `releaseVelocity` 의 `vy: 0.1` 처럼 부동소수 비교가 깨지면 해당 단언만 `toBeCloseTo` 로 바꾼다.

- [ ] **Step 5: 커밋**

```bash
git add apps/workplace-web/src/components/viewer/viewerGestures.ts apps/workplace-web/src/components/viewer/viewerGestures.test.ts
git commit --no-verify -m "$(cat <<'EOF'
feat(web): 뷰어 터치 제스처 판정을 순수 함수로 만든다 (WP-278)

- WP-278
- 첫 이동의 방향 잠금(가장자리 20px·내용 우선·맨 위 닫기)과 손 뗄 때의 넘김·닫기 확정을 분리해 경계값까지 단위 검증한다
- 러버밴드·속도·두 번 탭·핀치 배율·확대 기준점 스크롤 계산을 DOM 없이 재사용할 수 있게 한다

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0118pvsRQTanEBAzhsKg7E1o
EOF
)"
```

---

### Task 2: 하단 슬롯·공유/저장 판정, iOS 판정, 다운로드 URL 해제 지연

**Files:**
- Create: `apps/workplace-web/src/components/viewer/viewerActions.ts`
- Test: `apps/workplace-web/src/components/viewer/viewerActions.test.ts`
- Create: `apps/workplace-web/src/lib/platform.ts`
- Test: `apps/workplace-web/src/lib/platform.test.ts`
- Modify: `apps/workplace-web/src/lib/push/support.ts` (`readPushEnv`)
- Modify: `apps/workplace-web/src/lib/download.ts`
- Test: `apps/workplace-web/src/lib/download.test.ts`
- Modify: `apps/workplace-web/src/api/drive.ts:237-248` (`downloadByPath`)

**Interfaces:**
- Consumes: 없음
- Produces:
  - `type SlotId = 'save' | 'share' | 'drive' | 'summary'`, `type SlotState = 'enabled' | 'disabled' | 'empty'`, `interface ActionSlot { id: SlotId; state: SlotState }`
  - `type ShareState = 'ready' | 'loading' | 'unavailable'`
  - `resolveShareState(i: { supported: boolean; fetches: boolean; blobReady: boolean; canShareFile: boolean }): ShareState`
  - `actionSlots(i: { unavailable: boolean; share: ShareState; importable: 'none' | 'ready' | 'disabled'; summary: boolean }): ActionSlot[]` — 항상 길이 4, 순서 save·share·drive·summary
  - `resolveSaveMethod(i: { iosStandalone: boolean; blobReady: boolean; canShareFile: boolean }): 'share' | 'download'`
  - `detectIOS(env: { userAgent: string; platform: string; maxTouchPoints: number }): boolean`, `isIOSDevice(): boolean`, `isStandaloneDisplay(): boolean` (`src/lib/platform.ts`)
  - `REVOKE_DELAY_MS = 60_000`, `downloadBlob(filename, blob)` 시그니처 불변

- [ ] **Step 1: 실패하는 테스트 작성**

`src/components/viewer/viewerActions.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { actionSlots, resolveSaveMethod, resolveShareState } from './viewerActions'

describe('resolveShareState', () => {
  const ok = { supported: true, fetches: true, blobReady: true, canShareFile: true }
  it('blob 이 있고 공유 가능하면 ready', () => {
    expect(resolveShareState(ok)).toBe('ready')
  })
  it('받는 중이면 loading', () => {
    expect(resolveShareState({ ...ok, blobReady: false, canShareFile: false })).toBe('loading')
  })
  it('blob 을 받지 않는 항목(미지원 형식·10MB 동의 대기·오류)은 영원히 받는 중이 아니라 unavailable', () => {
    expect(resolveShareState({ ...ok, fetches: false, blobReady: false })).toBe('unavailable')
  })
  it('브라우저 미지원·형식 공유 불가(canShare 거짓)는 unavailable', () => {
    expect(resolveShareState({ ...ok, supported: false })).toBe('unavailable')
    expect(resolveShareState({ ...ok, canShareFile: false })).toBe('unavailable')
  })
})

describe('actionSlots', () => {
  const base = { unavailable: false, share: 'ready' as const, importable: 'ready' as const, summary: true }
  it('항상 4칸, 순서 고정', () => {
    expect(actionSlots(base).map((s) => s.id)).toEqual(['save', 'share', 'drive', 'summary'])
    expect(actionSlots({ ...base, importable: 'none', summary: false }).map((s) => s.id)).toEqual(['save', 'share', 'drive', 'summary'])
  })
  it('없는 기능은 빈칸(위치 유지)', () => {
    const s = actionSlots({ ...base, importable: 'none', summary: false })
    expect(s.map((x) => x.state)).toEqual(['enabled', 'enabled', 'empty', 'empty'])
  })
  it('공유 준비 전·불가는 비활성, 가져오기 준비 전은 비활성', () => {
    expect(actionSlots({ ...base, share: 'loading' })[1].state).toBe('disabled')
    expect(actionSlots({ ...base, share: 'unavailable' })[1].state).toBe('disabled')
    expect(actionSlots({ ...base, importable: 'disabled' })[2].state).toBe('disabled')
  })
  it('링크 원본 삭제면 저장·공유도 빈칸', () => {
    expect(actionSlots({ ...base, unavailable: true }).map((x) => x.state)).toEqual(['empty', 'empty', 'enabled', 'enabled'])
  })
})

describe('resolveSaveMethod', () => {
  it('iOS 홈 화면 앱 + blob + 공유 가능이면 공유 시트로 저장', () => {
    expect(resolveSaveMethod({ iosStandalone: true, blobReady: true, canShareFile: true })).toBe('share')
  })
  it('그 외는 기존 다운로드', () => {
    expect(resolveSaveMethod({ iosStandalone: false, blobReady: true, canShareFile: true })).toBe('download')
    expect(resolveSaveMethod({ iosStandalone: true, blobReady: false, canShareFile: false })).toBe('download')
    expect(resolveSaveMethod({ iosStandalone: true, blobReady: true, canShareFile: false })).toBe('download')
  })
})
```

`src/lib/platform.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { detectIOS } from './platform'

describe('detectIOS', () => {
  it('iPhone·iPad UA', () => {
    expect(detectIOS({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)', platform: 'iPhone', maxTouchPoints: 5 })).toBe(true)
  })
  it('iPadOS 데스크톱 UA 는 MacIntel + 터치 포인트로 보정', () => {
    expect(detectIOS({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', platform: 'MacIntel', maxTouchPoints: 5 })).toBe(true)
    expect(detectIOS({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', platform: 'MacIntel', maxTouchPoints: 0 })).toBe(false)
  })
  it('Android 는 아님', () => {
    expect(detectIOS({ userAgent: 'Mozilla/5.0 (Linux; Android 14)', platform: 'Linux armv8l', maxTouchPoints: 5 })).toBe(false)
  })
})
```

`src/lib/download.test.ts`:

```ts
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { downloadBlob, REVOKE_DELAY_MS } from './download'

describe('downloadBlob', () => {
  const revoke = vi.fn()
  beforeEach(() => {
    vi.useFakeTimers()
    URL.createObjectURL = vi.fn(() => 'blob:x')
    URL.revokeObjectURL = revoke
  })
  afterEach(() => {
    vi.useRealTimers()
    revoke.mockReset()
  })
  it('클릭 직후가 아니라 지연 뒤에 object URL 을 해제한다(iOS 저장 실패 방지)', () => {
    downloadBlob('a.txt', new Blob(['x']))
    expect(revoke).not.toHaveBeenCalled()
    vi.advanceTimersByTime(REVOKE_DELAY_MS)
    expect(revoke).toHaveBeenCalledWith('blob:x')
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm exec vitest run src/components/viewer/viewerActions.test.ts src/lib/platform.test.ts src/lib/download.test.ts`
Expected: FAIL — viewerActions·platform import 실패, download 는 `REVOKE_DELAY_MS` undefined / revoke 즉시 호출.

- [ ] **Step 3: 구현**

`src/components/viewer/viewerActions.ts`:

```ts
// 모바일 하단 액션 바(⬇ 저장 · ⤴ 공유 · ☁ 드라이브 · ✨ 요약)와 저장·공유 방식 판정 순수 로직(WP-278, 스펙 §4.2·§5.4·§8.1).
// 칸 위치는 4칸 고정 — 없는 기능은 빈칸으로 두어 넘겨도 다른 버튼이 움직이지 않게 한다(판정 R12).

export type SlotId = 'save' | 'share' | 'drive' | 'summary'
export type SlotState = 'enabled' | 'disabled' | 'empty'
export interface ActionSlot {
  id: SlotId
  state: SlotState
}
/** 공유 상태 — ready(누르면 공유)·loading(blob 받는 중)·unavailable(이 항목·브라우저로는 공유 불가). */
export type ShareState = 'ready' | 'loading' | 'unavailable'

/**
 * ⤴ 공유 상태. Web Share 는 사용자 제스처 직후에만 호출할 수 있어(await 뒤 호출 시 NotAllowedError)
 * blob 이 이미 메모리에 있을 때만 활성화한다(스펙 §5.4).
 * fetches = 이 항목이 지금 미리보기 blob 을 받는(받을) 상태인가 — 미지원 형식·10MB 동의 대기·오류면 거짓이라 "받는 중"이 끝나지 않는 일이 없다.
 */
export function resolveShareState(i: { supported: boolean; fetches: boolean; blobReady: boolean; canShareFile: boolean }): ShareState {
  if (!i.supported) return 'unavailable'
  if (i.blobReady) return i.canShareFile ? 'ready' : 'unavailable'
  return i.fetches ? 'loading' : 'unavailable'
}

/** 하단 4칸 상태 — 순서 save·share·drive·summary 고정. */
export function actionSlots(i: {
  unavailable: boolean
  share: ShareState
  importable: 'none' | 'ready' | 'disabled'
  summary: boolean
}): ActionSlot[] {
  return [
    { id: 'save', state: i.unavailable ? 'empty' : 'enabled' },
    { id: 'share', state: i.unavailable ? 'empty' : i.share === 'ready' ? 'enabled' : 'disabled' },
    { id: 'drive', state: i.importable === 'none' ? 'empty' : i.importable === 'ready' ? 'enabled' : 'disabled' },
    { id: 'summary', state: i.summary ? 'enabled' : 'empty' },
  ]
}

/**
 * ⬇ 저장 방식. iOS 홈 화면 앱(standalone)은 a[download] 가 불안정해 공유 시트("파일에 저장")로 대체한다(스펙 §5.4).
 * 공유 시트도 blob 이 메모리에 있어야 제스처 직후 호출할 수 있으므로, 없으면 기존 다운로드로 둔다.
 */
export function resolveSaveMethod(i: { iosStandalone: boolean; blobReady: boolean; canShareFile: boolean }): 'share' | 'download' {
  return i.iosStandalone && i.blobReady && i.canShareFile ? 'share' : 'download'
}
```

`src/lib/platform.ts`:

```ts
// 실행 플랫폼 판정 — iOS 기기·홈 화면 앱(standalone). 푸시 지원 판정(lib/push/support)과 뷰어 저장 방식(WP-278)이 같이 쓴다.
// 판정(detectIOS)은 순수 함수로 두고 브라우저 값 읽기만 감싼다.

/** iOS(iPhone·iPod·iPad) 인가. iPadOS 는 데스크톱(Mac) UA 를 쓰므로 MacIntel + 터치 포인트로 보정한다. */
export function detectIOS(env: { userAgent: string; platform: string; maxTouchPoints: number }): boolean {
  return /iPad|iPhone|iPod/.test(env.userAgent) || (env.platform === 'MacIntel' && env.maxTouchPoints > 1)
}

/** 현재 브라우저가 iOS 인가. */
export function isIOSDevice(): boolean {
  if (typeof navigator === 'undefined') return false
  return detectIOS({ userAgent: navigator.userAgent, platform: navigator.platform, maxTouchPoints: navigator.maxTouchPoints })
}

/** 홈 화면 앱(standalone)으로 실행 중인가 — 표준 display-mode + iOS 의 navigator.standalone. */
export function isStandaloneDisplay(): boolean {
  if (typeof window === 'undefined') return false
  return (
    (typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches) ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  )
}
```

`src/lib/push/support.ts` 의 `readPushEnv` 에서 `isIOS`·`isStandalone` 계산 두 줄을 교체:

```ts
import { isIOSDevice, isStandaloneDisplay } from '../platform'
// ...
export function readPushEnv(): PushEnv {
  const hasNotification = 'Notification' in window
  return {
    hasServiceWorker: 'serviceWorker' in navigator,
    hasPushManager: 'PushManager' in window,
    hasNotification,
    permission: hasNotification ? Notification.permission : 'unavailable',
    isIOS: isIOSDevice(),
    isStandalone: isStandaloneDisplay(),
  }
}
```
(주석 "현재 브라우저 값 수집. iPadOS 는 …" 은 `platform.ts` 로 옮겨졌으므로 "현재 브라우저 값 수집 — iOS·standalone 판정은 lib/platform." 으로 바꾼다.)

`src/lib/download.ts` 의 `downloadBlob` 교체(파일 상단 모듈 주석이 없으면 추가):

```ts
// 브라우저 다운로드 트리거 — 메모리의 Blob 을 a[download] 로 저장시킨다.

/**
 * object URL 해제 지연(ms). iOS Safari·홈 화면 앱은 a[download] 클릭 직후 URL 을 해제하면
 * 저장이 실패하거나 빈 파일이 된다(스펙 §5.4). 1분이면 저장 시작에 충분하고 메모리도 곧 돌려받는다.
 */
export const REVOKE_DELAY_MS = 60_000

/** Blob 을 filename 으로 내려받게 한다. URL 해제는 REVOKE_DELAY_MS 뒤. */
export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS);
}
```

`src/api/drive.ts` 의 `downloadByPath` 를 `downloadBlob` 재사용으로(이미 `import { downloadBlob } from '../lib/download'` 있음):

```ts
  // 임의 콘텐츠 경로 다운로드 → a[download] 트리거. URL 해제 지연은 downloadBlob 이 맡는다(iOS 저장 실패 방지, WP-278).
  downloadByPath: async (path: string, fileName: string) => {
    const { data } = await client.get<Blob>(stripApiPrefix(path), { responseType: 'blob' })
    downloadBlob(fileName, data)
  },
```

- [ ] **Step 4: 통과 확인**

Run: `pnpm exec vitest run src/components/viewer/viewerActions.test.ts src/lib/platform.test.ts src/lib/download.test.ts && pnpm test && pnpm typecheck`
Expected: 신규 3파일 PASS, 전체 vitest PASS(기존 `lib/push` 테스트 포함), typecheck 오류 없음.

- [ ] **Step 5: 커밋**

```bash
git add apps/workplace-web/src/components/viewer/viewerActions.ts apps/workplace-web/src/components/viewer/viewerActions.test.ts apps/workplace-web/src/lib/platform.ts apps/workplace-web/src/lib/platform.test.ts apps/workplace-web/src/lib/push/support.ts apps/workplace-web/src/lib/download.ts apps/workplace-web/src/lib/download.test.ts apps/workplace-web/src/api/drive.ts
git commit --no-verify -m "$(cat <<'EOF'
feat(web): 뷰어 하단 슬롯·공유·저장 판정과 다운로드 URL 해제 지연을 더한다 (WP-278)

- WP-278
- 하단 4칸을 위치 고정·빈칸 규칙으로 계산하고, 공유는 blob 이 메모리에 있을 때만 켜되 blob 을 받지 않는 항목은 받는 중으로 남지 않게 한다
- iOS 홈 화면 앱은 공유 시트로 저장하도록 판정하고, iOS 판정을 푸시 지원 판정과 한곳에서 공유한다
- 다운로드 직후 object URL 을 해제하면 iOS 저장이 실패하므로 1분 뒤 해제하고 드라이브 경로 다운로드도 같은 함수를 쓴다

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0118pvsRQTanEBAzhsKg7E1o
EOF
)"
```

---

### Task 3: 모바일 전체 화면 배치 — 상단 바·하단 4칸·safe-area·--vvh·theme-color

**Files:**
- Create: `apps/workplace-web/src/components/viewer/ViewerMobileBars.tsx`
- Create: `apps/workplace-web/src/hooks/useThemeColor.ts`
- Modify: `apps/workplace-web/src/components/viewer/AttachmentViewer.tsx`
- Modify: `apps/workplace-web/src/components/viewer/ViewerBody.tsx` (`chromeInset` prop)
- Modify: `apps/workplace-web/src/components/viewer/ViewerMoreMenu.tsx` (트리거 `pointer-coarse:size-11`)
- Modify: `apps/workplace-web/src/index.css` (키보드 열림 규칙에서 뷰어 제외)
- Test: Create `apps/workplace-web/e2e/pages/mobile/attachment-viewer-mobile.spec.ts`
- Test: Modify `apps/workplace-web/e2e/pages/drive/attachment-viewer.spec.ts` (데스크톱 회귀 1건)

**Interfaces:**
- Consumes: `actionSlots`, `SlotId`, `ActionSlot`, `ShareState` (Task 2); `middleEllipsis`, `navState` (기존 `viewerNav.ts`); `useIsMobile`(기존)
- Produces:
  - `ViewerMobileTopBar({ item, meta, hidden, barRef, more }: { item: ViewerItem; meta: string; hidden: boolean; barRef?: React.Ref<HTMLElement>; more: React.ReactNode })`
  - `ViewerActionBar({ slots, share, summaryOpen, hidden, barRef, onAction, children }: { slots: ActionSlot[]; share: ShareState; summaryOpen: boolean; hidden: boolean; barRef?: React.Ref<HTMLDivElement>; onAction: (id: SlotId) => void; children?: React.ReactNode })` — 칸 래퍼에 `data-slot-id`·`data-state`, 버튼 testid: save=`preview-download`, share=`viewer-slot-share`, drive=`viewer-slot-drive`, summary=`viewer-slot-summary`; 바 testid `viewer-action-bar`, 상단 바 testid `viewer-top-bar`
  - `useThemeColor(color: string, active: boolean): void`
  - `ViewerBody` 새 prop `chromeInset?: boolean`
  - `AttachmentViewer` 안 지역 값: `mobile`(useIsMobile), `onSlot(id: SlotId)`, `barsHidden`(이 Task 에선 항상 false — Task 6 이 상태로 바꾼다)
  - E2E 헬퍼(같은 spec 파일 상단, 이후 Task 들이 재사용): `stubDriveFiles(page, files, opts)`, `openViewer(page, name)`, 상수 `SPACE_ID`

- [ ] **Step 1: 실패하는 E2E 작성**

`e2e/pages/mobile/attachment-viewer-mobile.spec.ts` (이후 Task 들이 이 파일 끝에 테스트를 추가한다):

```ts
// 통합 첨부 뷰어 모바일 배치·제스처(WP-278) — iPhone 13 뷰포트 + chromium(coarse 포인터).
// 터치는 CDP(e2e/fixtures/touch.ts)로만 만든다 — page.mouse 는 Touch Events·touch-action 경로를 타지 않는다.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import type { Page } from '@playwright/test'

import { createSpace, personalSpace } from '../../factories/drive.factory'
import { json } from '../../fixtures/mobile-chat'
import { expect, test } from '../../fixtures/mobile.fixture'
import { solidPng } from '../../fixtures/png'

const SPACE_ID = 1
const HERE = path.dirname(fileURLToPath(import.meta.url))
const PDF = fs.readFileSync(path.join(HERE, '../../fixtures/sample-3p.pdf'))

interface StubFile {
  id: number
  name: string
  mimeType: string
  body: string | Buffer
  /** 요약 응답 — 숫자면 그 HTTP 상태(403 = ✨ 숨김), 없으면 DONE 요약. */
  summary?: number | { summary: string | null; status: string }
  /** 콘텐츠 응답 지연(ms) — 공유 "받는 중" 확인용. */
  delayMs?: number
}

/** 드라이브 공간·목록·파일별 콘텐츠/썸네일/요약/참조된 곳을 막는다. */
async function stubDriveFiles(page: Page, files: StubFile[]) {
  await page.route((u) => u.pathname === '/api/v1/drive/spaces', (r) =>
    r.request().method() === 'GET' ? r.fulfill(json([personalSpace(), createSpace()])) : r.fallback())
  await page.route((u) => u.pathname === '/api/v1/drive/quota', (r) => r.fulfill(json({ usedBytes: 0, quotaBytes: 10737418240 })))
  await page.route((u) => u.pathname === `/api/v1/drive/spaces/${SPACE_ID}/items`, (r) =>
    r.fulfill(json({
      folders: [],
      files: files.map((f) => ({
        id: f.id, folderId: null, fileId: f.id + 1000, name: f.name, mimeType: f.mimeType,
        sizeBytes: Buffer.byteLength(f.body), category: 'TEXT', createdAt: '2026-01-01T00:00:00Z',
      })),
    })))
  for (const f of files) {
    await page.route((u) => u.pathname === `/api/v1/drive/files/${f.id}/content`, async (r) => {
      if (f.delayMs) await new Promise((res) => setTimeout(res, f.delayMs))
      await r.fulfill({ status: 200, contentType: f.mimeType, body: f.body }).catch(() => {})
    })
    await page.route((u) => u.pathname === `/api/v1/drive/files/${f.id}/download`, (r) =>
      r.fulfill({ status: 200, contentType: f.mimeType, body: f.body }))
    await page.route((u) => u.pathname === `/api/v1/drive/files/${f.id}/thumbnail`, (r) => r.fulfill({ status: 404 }))
    await page.route((u) => u.pathname === `/api/v1/drive/files/${f.id}/summary`, (r) =>
      typeof f.summary === 'number'
        ? r.fulfill({ status: f.summary, body: '' })
        : r.fulfill(json(f.summary ?? { summary: '핵심 요약입니다.', status: 'DONE' })))
    await page.route((u) => u.pathname === `/api/v1/drive/files/${f.id}/backlinks`, (r) => r.fulfill(json([])))
  }
}

/** 목록에서 파일명을 탭해 뷰어를 연다. */
async function openViewer(page: Page, name: string) {
  await page.goto(`/drive/spaces/${SPACE_ID}`)
  await page.getByRole('button', { name, exact: true }).tap()
  await expect(page.getByTestId('preview-body')).toBeVisible()
}

const IMG = (id: number, name = `사진${id}.png`): StubFile => ({ id, name, mimeType: 'image/png', body: solidPng(800, 600) })
const MD = (id: number, name = `메모${id}.md`, body = '# 제목\n\n본문'): StubFile => ({ id, name, mimeType: 'text/markdown', body })

test.describe('모바일 배치', () => {
  for (const width of [360, 390]) {
    test(`폭 ${width}px — 상단 바(✕·이름·순번·⋯)와 하단 4칸, 가로 넘침 없음`, async ({ authenticatedPage: page }) => {
      await page.setViewportSize({ width, height: 800 })
      await stubDriveFiles(page, [IMG(70), IMG(71), MD(72)])
      await openViewer(page, '사진70.png')
      const top = page.getByTestId('viewer-top-bar')
      await expect(top.getByRole('button', { name: '닫기' })).toBeVisible()
      await expect(page.getByTestId('preview-meta')).toHaveText('1 / 3')
      // 4칸 순서·폭 — 각 칸이 바 폭의 1/4.
      const bar = page.getByTestId('viewer-action-bar')
      const ids = await bar.locator('[data-slot-id]').evaluateAll((els) => els.map((e) => e.getAttribute('data-slot-id')))
      expect(ids).toEqual(['save', 'share', 'drive', 'summary'])
      for (const id of ids) {
        const b = (await bar.locator(`[data-slot-id="${id}"]`).boundingBox())!
        expect(Math.abs(b.width - width / 4)).toBeLessThan(2)
      }
      // 드라이브 파일은 ☁ 없음(빈칸), ✨ 있음.
      await expect(bar.locator('[data-slot-id="drive"]')).toHaveAttribute('data-state', 'empty')
      await expect(page.getByTestId('viewer-slot-summary')).toBeEnabled()
      // 모바일은 플로팅 확대 툴바가 없다(판정 R8).
      await expect(page.getByRole('button', { name: '확대' })).toHaveCount(0)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    })
  }

  test('가로 모드(844×390)도 넘침 없이 전체 화면', async ({ authenticatedPage: page }) => {
    await page.setViewportSize({ width: 844, height: 390 })
    await stubDriveFiles(page, [IMG(70)])
    await openViewer(page, '사진70.png')
    const box = (await page.getByTestId('attachment-viewer').boundingBox())!
    expect(Math.round(box.width)).toBe(844)
    expect(Math.round(box.height)).toBe(390)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  })

  test('넘겨도 하단 칸 위치가 변하지 않는다 — ✨ 가 없는 파일은 그 칸만 비운다', async ({ authenticatedPage: page }) => {
    await stubDriveFiles(page, [IMG(70), { ...IMG(71), summary: 403 }])
    await openViewer(page, '사진70.png')
    const bar = page.getByTestId('viewer-action-bar')
    await expect(page.getByTestId('viewer-slot-summary')).toBeVisible()
    const before = await Promise.all(['save', 'share', 'drive', 'summary'].map((id) => bar.locator(`[data-slot-id="${id}"]`).boundingBox()))
    await page.getByRole('button', { name: '다음 파일' }).tap()
    await expect(page.getByTestId('preview-meta')).toHaveText('2 / 2')
    await expect(bar.locator('[data-slot-id="summary"]')).toHaveAttribute('data-state', 'empty')
    const after = await Promise.all(['save', 'share', 'drive', 'summary'].map((id) => bar.locator(`[data-slot-id="${id}"]`).boundingBox()))
    for (let k = 0; k < 4; k++) {
      expect(after[k]!.x).toBeCloseTo(before[k]!.x, 0)
      expect(after[k]!.width).toBeCloseTo(before[k]!.width, 0)
    }
  })

  test('⬇ 저장은 파일을 내려받는다', async ({ authenticatedPage: page }) => {
    await stubDriveFiles(page, [MD(72, 'note.md')])
    await openViewer(page, 'note.md')
    const download = page.waitForEvent('download')
    await page.getByTestId('preview-download').tap()
    expect((await download).suggestedFilename()).toBe('note.md')
  })

  test('열린 동안 상태바(theme-color)는 검정, 닫으면 원래 색으로 돌아온다', async ({ authenticatedPage: page }) => {
    await stubDriveFiles(page, [IMG(70)])
    const color = () => page.locator('meta[name="theme-color"]').getAttribute('content')
    await page.goto(`/drive/spaces/${SPACE_ID}`)
    const original = await color()
    await page.getByRole('button', { name: '사진70.png', exact: true }).tap()
    await expect(page.getByTestId('preview-body')).toBeVisible()
    await expect.poll(color).toBe('#000000')
    await page.getByTestId('viewer-top-bar').getByRole('button', { name: '닫기' }).tap()
    await expect(page.getByTestId('attachment-viewer')).toHaveCount(0)
    await expect.poll(color).toBe(original)
  })
})
```

데스크톱 회귀 — `e2e/pages/drive/attachment-viewer.spec.ts` 끝에 추가:

```ts
test('데스크톱(마우스)은 모바일 하단 바 없이 헤더·확대 툴바를 그대로 쓴다', async ({ authenticatedPage: page }) => {
  await stubDriveFiles(page, [{ id: 90, name: 'desk.png', mimeType: 'image/png', sizeBytes: 100 }], { 90: solidPng(800, 600) })
  await openPreview(page, 'desk.png')
  await expect(page.getByTestId('viewer-action-bar')).toHaveCount(0)
  await expect(page.getByTestId('viewer-top-bar')).toHaveCount(0)
  await expect(page.getByRole('button', { name: '확대' })).toBeVisible()
  await expect(page.getByTestId('preview-download')).toBeVisible()
})
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm exec playwright test e2e/pages/mobile/attachment-viewer-mobile.spec.ts --project=mobile`
Expected: FAIL — `viewer-top-bar` 없음.

- [ ] **Step 3: theme-color 훅**

`src/hooks/useThemeColor.ts`:

```ts
// 열려 있는 동안 브라우저 크롬 색(meta theme-color)을 덮어쓰고, 닫히면 원래 값으로 돌린다.
// 왜: 모바일 몰입형 뷰어(WP-278)는 검정 화면인데 상태바가 앱 색(보라)으로 남으면 위쪽 띠가 떠 보인다(스펙 §4.2).
import { useEffect } from 'react'

/** active 인 동안 모든 theme-color 메타를 color 로 바꾸고, 꺼지거나 언마운트되면 각자의 원래 값으로 복원한다. */
export function useThemeColor(color: string, active: boolean): void {
  useEffect(() => {
    if (!active) return
    const metas = Array.from(document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]'))
    const prev = metas.map((m) => m.content)
    for (const m of metas) m.content = color
    return () => metas.forEach((m, k) => (m.content = prev[k]))
  }, [color, active])
}
```

- [ ] **Step 4: 모바일 바 컴포넌트**

`src/components/viewer/ViewerMobileBars.tsx`:

```tsx
import { Cloud, Download, type LucideIcon, Share2, Sparkles, X } from 'lucide-react'

import { cn } from '../../lib/utils'
import { Button } from '../ui/button'
import { DialogClose, DialogDescription, DialogTitle } from '../ui/dialog'
import type { ViewerItem } from './types'
import type { ActionSlot, ShareState, SlotId } from './viewerActions'
import { middleEllipsis } from './viewerNav'

/** 바 겹침 레이어 공통 — 본문 위에 반투명으로 뜨고, 숨김 시 inert·투명(탭으로 다시 표시, Task 6). */
// 좌우 안전영역도 직접 — absolute inset-x-0 은 루트의 padding(safe-area)을 무시하므로 가로 모드에서 ✕·⋯ 가 노치 아래로 들어간다(시안 M5).
const barClass =
  'absolute inset-x-0 z-20 bg-background/80 pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] backdrop-blur transition-opacity duration-200'

/**
 * 모바일 상단 바(WP-278, 스펙 §4.2·시안 M1) — ✕ · 파일명(가운데 말줄임)/순번·쪽 · ⋯.
 * 노치 아래로 내려오도록 safe-area-inset-top 만큼 위 여백을 둔다(뷰어는 포털이라 MobileShell 의 안전영역 처리 밖).
 */
export function ViewerMobileTopBar({
  item,
  meta,
  hidden,
  barRef,
  more,
}: {
  item: ViewerItem
  meta: string
  hidden: boolean
  barRef?: React.Ref<HTMLElement>
  /** ⋯ 메뉴(ViewerMoreMenu) — 항목이 없으면 null 이어도 제목이 가운데에 남도록 자리는 유지한다. */
  more: React.ReactNode
}) {
  return (
    <header
      ref={barRef}
      inert={hidden}
      data-testid="viewer-top-bar"
      className={cn(barClass, 'top-0 flex min-h-14 items-center gap-1 px-1 pt-[env(safe-area-inset-top)]', hidden && 'pointer-events-none opacity-0')}
    >
      <DialogClose asChild>
        <Button variant="ghost" size="icon" className="size-11" aria-label="닫기">
          <X />
        </Button>
      </DialogClose>
      <div className="min-w-0 flex-1 text-center">
        {/* 접근 이름은 전체 파일명 + "미리보기"(데스크톱과 동일) — 화면에는 가운데 말줄임만. */}
        <DialogTitle className="truncate text-sm font-medium" title={item.name}>
          <span aria-hidden>{middleEllipsis(item.name, 28)}</span>
          <span className="sr-only">{item.name} 미리보기</span>
        </DialogTitle>
        <DialogDescription className="truncate text-xs text-muted-foreground" data-testid="preview-meta">
          {meta}
        </DialogDescription>
      </div>
      <div className="flex size-11 shrink-0 items-center justify-center">{more}</div>
    </header>
  )
}

/** 칸별 표시 — 보이는 글자가 접근 이름에 포함되게(WCAG 2.5.3) 라벨을 고른다. testId 는 데스크톱 ⬇ 와 같은 preview-download 를 잇는다. */
const SLOT_META: Record<SlotId, { label: string; icon: LucideIcon; testId: string }> = {
  save: { label: '저장', icon: Download, testId: 'preview-download' },
  share: { label: '공유', icon: Share2, testId: 'viewer-slot-share' },
  drive: { label: '드라이브', icon: Cloud, testId: 'viewer-slot-drive' },
  summary: { label: '요약', icon: Sparkles, testId: 'viewer-slot-summary' },
}

/** 칸 접근 이름 — 공유는 비활성 사유(받는 중/불가)를 이름에 담아 화면낭독기가 왜 못 누르는지 알게 한다. */
function slotAriaLabel(id: SlotId, share: ShareState): string {
  if (id === 'share') return share === 'ready' ? '공유' : share === 'loading' ? '공유 (받는 중)' : '공유할 수 없음'
  if (id === 'drive') return '드라이브로 가져오기'
  if (id === 'summary') return 'AI 요약'
  return '저장'
}

/**
 * 모바일 하단 액션 바(WP-278, 스펙 §4.2) — 4칸 위치 고정. 빈칸은 같은 폭의 자리만 차지한다(넘겨도 버튼이 움직이지 않게).
 * children: 바 위에 얹는 얇은 띠(참조된 곳, 판정 R11).
 */
export function ViewerActionBar({
  slots,
  share,
  summaryOpen,
  hidden,
  barRef,
  onAction,
  children,
}: {
  slots: ActionSlot[]
  share: ShareState
  summaryOpen: boolean
  hidden: boolean
  barRef?: React.Ref<HTMLDivElement>
  onAction: (id: SlotId) => void
  children?: React.ReactNode
}) {
  return (
    <div
      ref={barRef}
      inert={hidden}
      data-testid="viewer-action-bar"
      className={cn(barClass, 'bottom-0 pb-[env(safe-area-inset-bottom)]', hidden && 'pointer-events-none opacity-0')}
    >
      {children}
      <div className="grid grid-cols-4">
        {slots.map((s) => {
          const m = SLOT_META[s.id]
          const Icon = m.icon
          return (
            <div key={s.id} data-slot-id={s.id} data-state={s.state} className="flex min-h-14 items-stretch justify-center">
              {s.state !== 'empty' && (
                <button
                  type="button"
                  disabled={s.state === 'disabled'}
                  aria-label={slotAriaLabel(s.id, share)}
                  aria-pressed={s.id === 'summary' ? summaryOpen : undefined}
                  onClick={() => onAction(s.id)}
                  data-testid={m.testId}
                  className="flex w-full flex-col items-center justify-center gap-0.5 text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
                >
                  <Icon className="size-5" aria-hidden />
                  <span aria-hidden>{m.label}</span>
                </button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
```

- [ ] **Step 5: `ViewerBody` 바 겹침 여백**

`ViewerBody` props 에 추가하고 루트 className 에 반영:

```tsx
  /**
   * 모바일 바가 본문 위에 겹쳐 뜰 때(WP-278) — 문서형(이미지 외)은 첫·끝 줄이 바에 가리지 않게 위·아래 여백을 둔다.
   * 이미지는 사진 앱처럼 화면 전체에 맞추고 반투명 바가 위에 겹친다.
   */
  chromeInset?: boolean
```

```tsx
      className={cn(
        'min-h-0 flex-1 overflow-auto',
        !fillsFrame && 'p-4',
        kind === 'IMAGE' && 'flex',
        zoomScroll && SCROLL_REGION_RING_INSET,
        chromeInset && kind !== 'IMAGE' && 'pt-[calc(3.5rem+env(safe-area-inset-top))] pb-[calc(4.5rem+env(safe-area-inset-bottom))]',
      )}
```
(함수 시그니처 구조분해에 `chromeInset` 추가.)

- [ ] **Step 6: `AttachmentViewer` 배치 분기**

1) import 추가: `useIsMobile`(기존 `getIsMobile` 옆), `useThemeColor`, `ViewerActionBar`·`ViewerMobileTopBar`, `actionSlots`·`type SlotId`.

2) 본문 시작부(기존 `const aiAware = …` 아래)에:

```tsx
  // 배치는 폭(모바일 셸 기준과 동일), 제스처는 coarse 포인터로 따로 판정한다(스펙 §3.2 — Task 5).
  const mobile = useIsMobile()
  // 모바일 몰입형 화면 — 열린 동안 상태바를 검정으로(스펙 §4.2, 판정 R15). 값은 CSS 가 아닌 브라우저 크롬 색이라 리터럴.
  useThemeColor('#000000', mobile)
  // 바 숨김(탭 토글·가로 모드) — Task 6 에서 상태로 바뀐다. 지금은 항상 보임.
  const barsHidden = false
```

3) `meta` 아래에 모바일 메타·슬롯·핸들러:

```tsx
  // 모바일 상단 2줄째는 순번·쪽만(시안 M1) — 크기는 데스크톱 헤더에만.
  const mobileMeta = [nav.label || null, pageLabel].filter(Boolean).join(' · ')
```

`canImport` 정의 아래에:

```tsx
  // 하단 4칸 — 공유는 Task 8 에서 blob 상태로 바뀐다(지금은 공유할 수 없음 비활성).
  const shareState = 'unavailable' as const
  const slots = actionSlots({
    unavailable: !!item.unavailable,
    share: shareState,
    importable: item.importFileId == null ? 'none' : canImport ? 'ready' : 'disabled',
    summary: summary === 'show',
  })
  /** 하단 칸 누름 — 저장은 기존 다운로드(감사 로그 경로), 드라이브는 ☁ 와 같은 가져오기, 요약은 패널(모바일은 시트) 토글. */
  const onSlot = (id: SlotId) => {
    if (id === 'save') void downloadViewerItem(item)
    else if (id === 'drive') startImport()
    else if (id === 'summary') togglePanel(!panelOpen)
  }
```

4) `DialogContent` className 에 모바일 높이·위치·좌우 안전영역과 `data-viewer-root` 를 단다:

```tsx
        className={cn(
          'dark fixed inset-0 top-0 left-0 flex h-[100dvh] w-auto max-w-none translate-x-0 translate-y-0 flex-col gap-0 rounded-none border-0 bg-background p-0 text-foreground sm:max-w-none',
          // 모바일: 포털이라 MobileShell 의 --vvh·안전영역 처리 밖 — 직접 적용(스펙 §4.2). 키보드가 없으면 변수 미설정 → 100dvh·0.
          mobile && 'top-[var(--vv-top,0px)] h-[var(--vvh,100dvh)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]',
          aiAware.contentClassName,
        )}
        data-viewer-root=""
```

5) 기존 `<header …>…</header>` 를 `{!mobile && (<header …>…</header>)}` 로 감싸고, 그 앞에 모바일 상단 바:

```tsx
        {mobile && (
          <ViewerMobileTopBar
            item={item}
            meta={mobileMeta}
            hidden={barsHidden}
            more={<ViewerMoreMenu item={item} onImport={canImport ? startImport : undefined} shareable={shareable} />}
          />
        )}
```

6) `<ViewerBody key={item.key} item={item} zoom={zoom} onPage={onPage} />` 에 `chromeInset={mobile}` 추가.

7) 플로팅 확대 툴바 조건 `{zoomable && (` → `{zoomable && !mobile && (` (판정 R8).

8) 참조된 곳 띠: 기존 블록 조건에 `!mobile &&` 를 붙이고, `importer.picker` 앞에 모바일 하단 바(띠는 children 으로):

```tsx
        {mobile && (
          <ViewerActionBar slots={slots} share={shareState} summaryOpen={showPanel} hidden={barsHidden} onAction={onSlot}>
            {(summary === 'hidden' || summary === 'none') && item.backlinksDriveFileId != null && (
              <div className="max-h-24 overflow-y-auto border-b border-border px-4 py-2">
                <ViewerBacklinks driveFileId={item.backlinksDriveFileId} />
              </div>
            )}
          </ViewerActionBar>
        )}
```

- [ ] **Step 7: ⋯ 트리거 터치 크기 + 키보드 열림 규칙 제외**

`ViewerMoreMenu.tsx` 트리거: `<Button variant="ghost" size="icon" className="pointer-coarse:size-11" aria-label="더 보기">`.

`AttachmentViewer.tsx` 데스크톱 헤더의 아이콘 `Button`(다운로드·☁·✨·닫기) 에도 `className="pointer-coarse:size-11"` 를 더한다(iPad 44px, 시안 iPad 주석).

`src/index.css` 의 `:root[data-keyboard-open] [data-slot="dialog-content"], …` 규칙 바로 아래에:

```css
/* 통합 뷰어(WP-278)는 가운데 정렬 다이얼로그가 아니라 전체 화면 레이어다 — 위 규칙(top: 가운데 + translate 전제)을 받으면
   AI 시트 입력 등으로 키보드가 열릴 때 화면 절반이 밖으로 밀린다. 보이는 영역 맨 위에 붙이고 높이는 컴포넌트의 --vvh 를 그대로 쓴다. */
:root[data-keyboard-open] [data-slot="dialog-content"][data-viewer-root] {
  top: var(--vv-top);
  max-height: none;
  overflow: hidden;
}
```

- [ ] **Step 8: 통과 확인**

Run:
```bash
pnpm exec playwright test e2e/pages/mobile/attachment-viewer-mobile.spec.ts e2e/pages/mobile/drive-preview-resize.spec.ts e2e/pages/mobile/back-drive.spec.ts --project=mobile
pnpm exec playwright test e2e/pages/drive/ --project=chromium
pnpm typecheck && npx tsc -p tsconfig.e2e.json --noEmit && pnpm lint
```
Expected: 모두 PASS. `back-drive.spec.ts` 의 Escape 닫기·뒤로가기 동작 유지.

- [ ] **Step 9: 커밋**

```bash
git add apps/workplace-web/src/components/viewer/ViewerMobileBars.tsx apps/workplace-web/src/hooks/useThemeColor.ts apps/workplace-web/src/components/viewer/AttachmentViewer.tsx apps/workplace-web/src/components/viewer/ViewerBody.tsx apps/workplace-web/src/components/viewer/ViewerMoreMenu.tsx apps/workplace-web/src/index.css apps/workplace-web/e2e/pages/mobile/attachment-viewer-mobile.spec.ts apps/workplace-web/e2e/pages/drive/attachment-viewer.spec.ts
git commit --no-verify -m "$(cat <<'EOF'
feat(web): 뷰어를 모바일에서 상단 바와 4칸 하단 바를 가진 전체 화면으로 그린다 (WP-278)

- WP-278
- 모바일 폭에서는 닫기·이름·순번·더보기 상단 바와 저장·공유·드라이브·요약 4칸 하단 바를 본문 위에 겹쳐 그리고 없는 기능은 칸만 비운다
- 포털이라 셸 밖인 뷰어에 보이는 높이와 노치 안전영역을 직접 적용하고, 키보드 열림 다이얼로그 규칙이 뷰어를 밀지 않게 제외한다
- 열린 동안 상태바 색을 검정으로 바꾸고 닫으면 원래 색으로 돌린다

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0118pvsRQTanEBAzhsKg7E1o
EOF
)"
```

---

### Task 4: AI 요약 바텀시트(반 높이·⤢ 펼치기)

**Files:**
- Modify: `apps/workplace-web/src/components/viewer/ViewerSidePanel.tsx`
- Modify: `apps/workplace-web/src/components/viewer/AttachmentViewer.tsx`
- Test: `apps/workplace-web/e2e/pages/mobile/attachment-viewer-mobile.spec.ts` (테스트 추가)

**Interfaces:**
- Consumes: Task 3 의 `mobile`, `onSlot('summary')`, `showPanel`, `togglePanel`
- Produces:
  - `ViewerPanelContent({ item }: { item: ViewerItem })` — 요약 카드 + 참조된 곳(데스크톱 패널·모바일 시트 공용)
  - `ViewerSummarySheet({ item, onClose }: { item: ViewerItem; onClose: () => void })` — testid `viewer-summary-sheet`, 펼치기 버튼 이름 `펼치기`/`접기`(`aria-expanded`), 닫기 버튼 이름 `요약 닫기`
  - `ViewerSidePanel` 시그니처 불변(testid `viewer-side-panel` 유지)

- [ ] **Step 1: 실패하는 E2E 추가**

spec 파일 끝에:

```ts
test.describe('AI 요약 시트', () => {
  test('✨ 요약 → 반 높이 다크 시트, ⤢ 펼치기로 거의 전체, 요약 닫기로 닫힘', async ({ authenticatedPage: page }) => {
    await stubDriveFiles(page, [MD(80, 'plan.md')])
    await openViewer(page, 'plan.md')
    // 모바일은 저장된 패널 상태와 무관하게 닫힌 채 연다(판정 R10).
    await expect(page.getByTestId('viewer-summary-sheet')).toHaveCount(0)
    await page.getByTestId('viewer-slot-summary').tap()
    const sheet = page.getByTestId('viewer-summary-sheet')
    await expect(sheet.getByTestId('drive-summary-card')).toContainText('핵심 요약입니다.')
    const vh = page.viewportSize()!.height
    const half = (await sheet.boundingBox())!.height
    expect(Math.abs(half - vh / 2)).toBeLessThan(vh * 0.08)
    const expand = sheet.getByRole('button', { name: '펼치기' })
    await expect(expand).toHaveAttribute('aria-expanded', 'false')
    await expand.tap()
    await expect(sheet.getByRole('button', { name: '접기' })).toHaveAttribute('aria-expanded', 'true')
    await expect.poll(async () => (await sheet.boundingBox())!.height).toBeGreaterThan(vh * 0.8)
    // 시트는 뷰어 다크 토큰 안에 있다(.dark 루트의 자손 — 하드코딩 색 없이 다크).
    expect(await sheet.evaluate((el) => el.closest('.dark') != null)).toBe(true)
    await sheet.getByRole('button', { name: '요약 닫기' }).tap()
    await expect(sheet).toHaveCount(0)
  })

  test('모바일에서 열고 닫은 상태는 저장하지 않는다 — 데스크톱 마지막 상태를 덮지 않음', async ({ authenticatedPage: page }) => {
    await stubDriveFiles(page, [MD(80, 'plan.md')])
    await page.addInitScript(() => localStorage.setItem('attachment-viewer:summary-panel', '1'))
    await openViewer(page, 'plan.md')
    await expect(page.getByTestId('viewer-summary-sheet')).toHaveCount(0)
    await page.getByTestId('viewer-slot-summary').tap()
    await page.getByTestId('viewer-summary-sheet').getByRole('button', { name: '요약 닫기' }).tap()
    expect(await page.evaluate(() => localStorage.getItem('attachment-viewer:summary-panel'))).toBe('1')
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm exec playwright test e2e/pages/mobile/attachment-viewer-mobile.spec.ts --project=mobile -g "AI 요약 시트"`
Expected: FAIL — 첫 테스트는 `viewer-summary-sheet` 없음, 둘째는 저장값 '1' 때문에 패널이 열린 채 시작.

- [ ] **Step 3: 시트 구현**

`ViewerSidePanel.tsx` — `SummaryCard` 는 그대로 두고, import 에 `useState`, `Maximize2`, `Minimize2`, `cn` 추가. `ViewerSidePanel` 을 아래로 교체하고 시트·공용 내용 추가:

```tsx
/** 패널·시트 공용 내용 — AI 요약 + 참조된 곳. */
export function ViewerPanelContent({ item }: { item: ViewerItem }) {
  return (
    <div className="space-y-4">
      {item.summaryDriveFileId != null && <SummaryCard driveFileId={item.summaryDriveFileId} />}
      {item.backlinksDriveFileId != null && <ViewerBacklinks driveFileId={item.backlinksDriveFileId} />}
    </div>
  )
}

/**
 * 뷰어 오른쪽 사이드 패널(WP-277) — AI 요약 + 참조된 곳.
 * lg 이상은 오른쪽 w-80 열, 그보다 좁은 데스크톱 배치(마우스 좁은 창)는 본문 아래에 쌓는다. 모바일 배치는 ViewerSummarySheet.
 */
export function ViewerSidePanel({ item, onClose }: { item: ViewerItem; onClose: () => void }) {
  return (
    <aside
      data-testid="viewer-side-panel"
      className="max-h-[45%] w-full shrink-0 overflow-y-auto border-t border-border p-4 lg:max-h-none lg:w-80 lg:border-t-0 lg:border-l"
    >
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-medium">AI 요약</h2>
        <Button variant="ghost" size="icon" aria-label="요약 닫기" onClick={onClose}>
          <X />
        </Button>
      </div>
      <ViewerPanelContent item={item} />
    </aside>
  )
}

/**
 * 모바일 AI 요약 바텀시트(WP-278, 스펙 §4.2·시안 M4) — 반 높이로 열리고 "펼치기" 버튼으로 상단 바 아래까지 늘린다.
 * 끌어 올리기 대신 버튼인 이유: 끌기만 되는 조작은 WCAG 2.5.7(끌기 동작 대안) 위반.
 * 뷰어 다이얼로그 안에 그려 포커스 트랩·다크 토큰을 그대로 받는다. 하단 액션 바 위(z-30)에 겹친다.
 */
export function ViewerSummarySheet({ item, onClose }: { item: ViewerItem; onClose: () => void }) {
  const [expanded, setExpanded] = useState(false)
  return (
    <section
      aria-label="AI 요약"
      data-testid="viewer-summary-sheet"
      className={cn(
        // 좌우 안전영역 — absolute 라 루트 padding 을 받지 못한다(가로 모드 노치).
        'absolute inset-x-0 bottom-0 z-30 flex flex-col rounded-t-xl border-t border-border bg-background pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] transition-[height] duration-200',
        expanded ? 'h-[calc(100%-3.5rem-env(safe-area-inset-top))]' : 'h-1/2',
      )}
    >
      <div className="flex items-center gap-1 px-4 pt-2">
        <h2 className="flex-1 text-sm font-medium">AI 요약</h2>
        <Button
          variant="ghost"
          size="sm"
          className="min-h-11"
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? <Minimize2 aria-hidden /> : <Maximize2 aria-hidden />}
          {expanded ? '접기' : '펼치기'}
        </Button>
        <Button variant="ghost" size="icon" className="size-11" aria-label="요약 닫기" onClick={onClose}>
          <X />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pt-2 pb-[calc(1rem+env(safe-area-inset-bottom))]">
        <ViewerPanelContent item={item} />
      </div>
    </section>
  )
}
```

- [ ] **Step 4: `AttachmentViewer` 연결 + 모바일 패널 상태 규칙(R10)**

패널 초기값·토글 교체:

```tsx
  // 사이드 패널 — 초기값 = 저장된 마지막 상태, 없으면 호출부 기본값(드라이브는 펼침). 묶음 안에서 넘겨도 유지된다.
  // 모바일 배치는 시트가 본문 절반을 가리므로 항상 닫힌 채 열고, 모바일에서 바꾼 상태는 저장하지 않는다(판정 R10 — 데스크톱 마지막 상태 보존).
  const [panelOpen, setPanelOpen] = useState(() => (getIsMobile() ? false : (readPanelPref() ?? !!defaultPanelOpen)))
  const togglePanel = (open: boolean) => {
    setPanelOpen(open)
    if (getIsMobile()) return
    try {
      localStorage.setItem(PANEL_STORAGE_KEY, open ? '1' : '0')
    } catch {
      // 저장 실패는 무시 — 이번 세션 상태만 유지.
    }
  }
```

본문 영역의 `{showPanel && <ViewerSidePanel … />}` 를 `{showPanel && !mobile && <ViewerSidePanel … />}` 로, 그리고 `ViewerActionBar` 블록 바로 뒤(같은 루트 자식)에:

```tsx
        {showPanel && mobile && <ViewerSummarySheet item={item} onClose={() => togglePanel(false)} />}
```
(import 에 `ViewerSummarySheet` 추가.)

- [ ] **Step 5: 통과 확인**

Run:
```bash
pnpm exec playwright test e2e/pages/mobile/attachment-viewer-mobile.spec.ts --project=mobile
pnpm exec playwright test e2e/pages/drive/attachment-viewer.spec.ts e2e/pages/drive/drive-preview-summary.spec.ts --project=chromium
pnpm typecheck && pnpm lint
```
Expected: PASS(데스크톱 패널 기본 펼침·저장 동작 그대로).

- [ ] **Step 6: 커밋**

```bash
git add apps/workplace-web/src/components/viewer/ViewerSidePanel.tsx apps/workplace-web/src/components/viewer/AttachmentViewer.tsx apps/workplace-web/e2e/pages/mobile/attachment-viewer-mobile.spec.ts
git commit --no-verify -m "$(cat <<'EOF'
feat(web): 모바일 뷰어의 AI 요약을 펼치기 버튼이 있는 반 높이 시트로 보인다 (WP-278)

- WP-278
- 모바일에서는 요약을 본문 아래 쌓는 대신 다크 바텀시트로 열고, 끌기 대신 펼치기·접기 버튼으로 높이를 바꾼다
- 모바일은 요약을 항상 닫힌 채 열고 그 상태를 저장하지 않아 데스크톱의 마지막 패널 상태를 덮지 않는다

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0118pvsRQTanEBAzhsKg7E1o
EOF
)"
```

---

### Task 5: 터치 무대 + 스와이프 넘김(러버밴드·가장자리·내용 우선) + CDP 터치 헬퍼

**Files:**
- Create: `apps/workplace-web/e2e/fixtures/touch.ts`
- Create: `apps/workplace-web/src/components/viewer/useViewerGestures.ts`
- Modify: `apps/workplace-web/src/components/viewer/AttachmentViewer.tsx`
- Modify: `apps/workplace-web/src/index.css` (무대 touch-action)
- Test: `apps/workplace-web/e2e/pages/mobile/attachment-viewer-mobile.spec.ts` (테스트 추가)

**Interfaces:**
- Consumes: `lockGesture`, `decideSwipe`, `dragOffset`, `releaseVelocity`, `type GestureLock`, `type Sample` (Task 1); `useIsCoarsePointer`(기존 `src/hooks/useIsCoarsePointer.ts`)
- Produces:
  - `useViewerGestures(stage: HTMLElement | null, opts: ViewerGestureOptions): void`
  - `interface ViewerGestureOptions { enabled: boolean; hasPrev: boolean; hasNext: boolean; zoom: number; onNav: (dir: -1 | 1) => void }` (Task 6·7 이 필드를 더한다)
  - `horizontalRoom(target: Element, stage: HTMLElement): { canPanLeft: boolean; canPanRight: boolean }`, `atScrollTop(target: Element, stage: HTMLElement): boolean`
  - `AttachmentViewer` 안: `go(dir: -1 | 1, opts?: { moveFocus?: boolean })`, `coarse`, 무대 요소 `stage`(testid `viewer-stage`, 속성 `data-viewer-stage="none" | "pan"`, `data-zoom`)
  - E2E 헬퍼: `touchDrag(page, from, to, opts?)`, `touchTap(page, p)`, `touchDoubleTap(page, p)`, `touchPinch(page, center, fromDist, toDist, steps?)`, `touchSwipeThenSecondFinger(page, from, dx)`, `centerOf(locator)`

- [ ] **Step 1: CDP 터치 헬퍼**

`e2e/fixtures/touch.ts`:

```ts
// 실제 손가락 터치 — CDP Input.dispatchTouchEvent 로 touchStart/Move/End 를 만든다(WP-278 뷰어 제스처).
// 왜 page.mouse 가 아닌가: 마우스는 pointerType 'mouse' 라 Touch Events·touch-action·passive 리스너 경로를 타지 않아
// 실기기에서 깨지는 제스처도 통과시킨다. CDP 터치는 브라우저가 터치·포인터·스크롤·click 을 실제 순서로 만든다.
import type { Locator, Page } from '@playwright/test'

export interface Pt {
  x: number
  y: number
}

/** 요소 중심 좌표. */
export async function centerOf(target: Locator): Promise<Pt> {
  const b = (await target.boundingBox())!
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 }
}

/**
 * 한 손가락 끌기 — from → to 를 steps 번에 나눠 움직인다.
 * stepDelayMs 를 주면 느린 끌기(플링 아님), 생략하면 빠른 끌기.
 */
export async function touchDrag(page: Page, from: Pt, to: Pt, opts: { steps?: number; stepDelayMs?: number } = {}) {
  const steps = opts.steps ?? 8
  const s = await page.context().newCDPSession(page)
  try {
    await s.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...from, id: 0 }] })
    for (let k = 1; k <= steps; k++) {
      const p = { x: from.x + ((to.x - from.x) * k) / steps, y: from.y + ((to.y - from.y) * k) / steps, id: 0 }
      await s.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [p] })
      // eslint-disable-next-line playwright/no-wait-for-timeout -- 느린 끌기 제스처 자체의 속도(손가락 이동 시간)라 조건 대기로 바꿀 수 없다
      if (opts.stepDelayMs) await page.waitForTimeout(opts.stepDelayMs)
    }
    await s.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  } finally {
    await s.detach()
  }
}

/** 한 번 탭. */
export async function touchTap(page: Page, p: Pt) {
  const s = await page.context().newCDPSession(page)
  try {
    await s.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...p, id: 0 }] })
    await s.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  } finally {
    await s.detach()
  }
}

/** 두 번 탭 — 지연 없이 연달아(300ms 판정 창 안). */
export async function touchDoubleTap(page: Page, p: Pt) {
  const s = await page.context().newCDPSession(page)
  try {
    for (let k = 0; k < 2; k++) {
      await s.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...p, id: 0 }] })
      await s.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    }
  } finally {
    await s.detach()
  }
}

/** 두 손가락 핀치 — center 를 중심으로 가로로 fromDist → toDist 만큼 벌리거나 모은다. */
export async function touchPinch(page: Page, center: Pt, fromDist: number, toDist: number, steps = 8) {
  const pts = (d: number) => [
    { x: center.x - d / 2, y: center.y, id: 0 },
    { x: center.x + d / 2, y: center.y, id: 1 },
  ]
  const s = await page.context().newCDPSession(page)
  try {
    await s.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pts(fromDist) })
    for (let k = 1; k <= steps; k++) {
      await s.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pts(fromDist + ((toDist - fromDist) * k) / steps) })
    }
    await s.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  } finally {
    await s.detach()
  }
}

/**
 * 한 손가락으로 dx 만큼 끈 뒤 두 번째 손가락을 얹고 둘 다 뗀다 — "스와이프 도중 두 번째 손가락" 재현.
 */
export async function touchSwipeThenSecondFinger(page: Page, from: Pt, dx: number) {
  const s = await page.context().newCDPSession(page)
  try {
    await s.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...from, id: 0 }] })
    for (let k = 1; k <= 6; k++) {
      await s.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: from.x + (dx * k) / 6, y: from.y, id: 0 }] })
    }
    const a = { x: from.x + dx, y: from.y, id: 0 }
    await s.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [a, { x: a.x, y: a.y + 120, id: 1 }] })
    await s.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  } finally {
    await s.detach()
  }
}
```

- [ ] **Step 2: 실패하는 E2E 추가 (판정 R2 검증 포함)**

spec 상단 import 에 추가: `import { centerOf, touchDrag, touchSwipeThenSecondFinger } from '../../fixtures/touch'`. 파일 끝에:

```ts
const LONG_MD = `# 긴 문서\n\n${Array.from({ length: 120 }, (_, k) => `${k + 1}번째 줄 내용입니다.`).join('\n\n')}`
/** 열이 많은 CSV — 390px 에서 가로로 넘친다. */
const WIDE_CSV = [
  Array.from({ length: 14 }, (_, k) => `열${k + 1}`).join(','),
  ...Array.from({ length: 6 }, (_, r) => Array.from({ length: 14 }, (_, k) => `값${r}-${k}`).join(',')),
].join('\n')

test.describe('스와이프 넘김', () => {
  test('왼쪽으로 폭 25% 넘게 밀면 다음, 오른쪽이면 이전', async ({ authenticatedPage: page }) => {
    await stubDriveFiles(page, [IMG(70), IMG(71), IMG(72)])
    await openViewer(page, '사진70.png')
    const c = await centerOf(page.getByTestId('viewer-stage'))
    await touchDrag(page, c, { x: c.x - 180, y: c.y })
    await expect(page.getByTestId('preview-meta')).toHaveText('2 / 3')
    await touchDrag(page, c, { x: c.x + 180, y: c.y })
    await expect(page.getByTestId('preview-meta')).toHaveText('1 / 3')
  })

  test('짧고 느린 끌기는 제자리 — 무대도 원위치', async ({ authenticatedPage: page }) => {
    await stubDriveFiles(page, [IMG(70), IMG(71)])
    await openViewer(page, '사진70.png')
    const c = await centerOf(page.getByTestId('viewer-stage'))
    await touchDrag(page, c, { x: c.x - 60, y: c.y }, { steps: 6, stepDelayMs: 40 })
    await expect.poll(() => page.getByTestId('viewer-stage').evaluate((el) => getComputedStyle(el).transform)).toBe('none')
    await expect(page.getByTestId('preview-meta')).toHaveText('1 / 2')
  })

  test('처음에서 오른쪽으로 밀어도 넘어가지 않는다(러버밴드, 순환 없음)', async ({ authenticatedPage: page }) => {
    await stubDriveFiles(page, [IMG(70), IMG(71)])
    await openViewer(page, '사진70.png')
    const c = await centerOf(page.getByTestId('viewer-stage'))
    await touchDrag(page, c, { x: c.x + 250, y: c.y })
    await expect(page.getByTestId('preview-meta')).toHaveText('1 / 2')
    await expect.poll(() => page.getByTestId('viewer-stage').evaluate((el) => getComputedStyle(el).transform)).toBe('none')
  })

  test('화면 가장자리 20px 안에서 시작한 스와이프는 무시(iOS 뒤로가기 보호)', async ({ authenticatedPage: page }) => {
    await stubDriveFiles(page, [IMG(70), IMG(71)])
    await openViewer(page, '사진70.png')
    const vw = page.viewportSize()!.width
    const y = (await centerOf(page.getByTestId('viewer-stage'))).y
    await touchDrag(page, { x: vw - 8, y }, { x: vw - 250, y })
    await expect(page.getByTestId('preview-meta')).toHaveText('1 / 2')
  })

  test('넓은 표는 내용이 먼저 — 가장자리에 닿은 뒤 다시 밀어야 다음 파일', async ({ authenticatedPage: page }) => {
    await stubDriveFiles(page, [{ id: 75, name: 'wide.csv', mimeType: 'text/csv', body: WIDE_CSV }, IMG(76)])
    await openViewer(page, 'wide.csv')
    const table = page.getByTestId('csv-table')
    await expect(table).toBeVisible()
    const c = await centerOf(table)
    await touchDrag(page, { x: c.x + 100, y: c.y }, { x: c.x - 100, y: c.y })
    await expect(page.getByTestId('preview-meta')).toHaveText('1 / 2')
    // 오른쪽 끝까지 스크롤된 상태에서 다시 밀면 넘어간다.
    await table.evaluate((el) => (el.scrollLeft = el.scrollWidth))
    await touchDrag(page, { x: c.x + 100, y: c.y }, { x: c.x - 100, y: c.y })
    await expect(page.getByTestId('preview-meta')).toHaveText('2 / 2')
  })

  test('세로 끌기는 문서 스크롤(네이티브) — 넘기지 않는다, 가로 스와이프는 스크롤을 건드리지 않는다', async ({ authenticatedPage: page }) => {
    await stubDriveFiles(page, [MD(77, 'long.md', LONG_MD), IMG(78)])
    await openViewer(page, 'long.md')
    const body = page.getByTestId('preview-body')
    await expect(body).toContainText('1번째 줄')
    const c = await centerOf(body)
    await touchDrag(page, { x: c.x, y: c.y + 150 }, { x: c.x, y: c.y - 150 })
    await expect.poll(() => body.evaluate((el) => el.scrollTop)).toBeGreaterThan(0)
    await expect(page.getByTestId('preview-meta')).toHaveText('1 / 2')
    // 스크롤된 문서 위에서도 가로 스와이프는 넘김(가로 스크롤 영역이 없으므로).
    await touchDrag(page, c, { x: c.x - 180, y: c.y })
    await expect(page.getByTestId('preview-meta')).toHaveText('2 / 2')
  })

  test('본문 안 버튼(다시 시도) 위에서 시작한 스와이프는 넘기지 않는다', async ({ authenticatedPage: page }) => {
    await stubDriveFiles(page, [IMG(70), IMG(71)])
    await page.route((u) => u.pathname === '/api/v1/drive/files/70/content', (r) => r.fulfill({ status: 500, body: '' }))
    await openViewer(page, '사진70.png')
    const retry = page.getByRole('button', { name: '다시 시도' })
    await expect(retry).toBeVisible()
    const c = await centerOf(retry)
    await touchDrag(page, c, { x: c.x - 200, y: c.y })
    await expect(page.getByTestId('preview-meta')).toHaveText('1 / 2')
  })

  test('스와이프 도중 두 번째 손가락이 닿으면 넘기지 않는다', async ({ authenticatedPage: page }) => {
    await stubDriveFiles(page, [MD(72), IMG(73)])
    await openViewer(page, '메모72.md')
    const c = await centerOf(page.getByTestId('viewer-stage'))
    await touchSwipeThenSecondFinger(page, c, -180)
    await expect(page.getByTestId('preview-meta')).toHaveText('1 / 2')
    await expect.poll(() => page.getByTestId('viewer-stage').evaluate((el) => getComputedStyle(el).transform)).toBe('none')
  })

  test('iPad 가로(1180px, 터치) — 데스크톱 배치에서도 스와이프가 동작한다', async ({ authenticatedPage: page }) => {
    await page.setViewportSize({ width: 1180, height: 820 })
    await stubDriveFiles(page, [IMG(70), IMG(71)])
    await openViewer(page, '사진70.png')
    // 데스크톱 배치 — 하단 바 없음, 헤더 다운로드 있음.
    await expect(page.getByTestId('viewer-action-bar')).toHaveCount(0)
    await expect(page.getByTestId('preview-download')).toBeVisible()
    const c = await centerOf(page.getByTestId('viewer-stage'))
    await touchDrag(page, c, { x: c.x - 400, y: c.y })
    await expect(page.getByTestId('preview-meta')).toContainText('2 / 2')
  })
})
```

참고: 데스크톱 배치 `preview-meta` 는 `크기 · 2 / 2` 라 `toContainText`.

- [ ] **Step 3: 실패 확인**

Run: `pnpm exec playwright test e2e/pages/mobile/attachment-viewer-mobile.spec.ts --project=mobile -g "스와이프 넘김"`
Expected: FAIL — `viewer-stage` 없음.

- [ ] **Step 4: 제스처 훅(스와이프)**

`src/components/viewer/useViewerGestures.ts`:

```ts
// 통합 뷰어 터치 제스처 배선(WP-278) — 본문을 감싼 무대(stage)에 Touch Events 를 직접 건다.
// 왜 Pointer Events 가 아닌가(판정 R2): 브라우저가 스크롤을 가져가면 pointercancel 로 제스처를 잃는다.
// "넓은 표는 내용 먼저, 가장자리에선 넘김"·"문서는 맨 위에서 당길 때만 닫기"처럼 네이티브 스크롤과 제스처를 나누려면
// 첫 이동에서 판정(lockGesture)해 우리 것일 때만 preventDefault 해야 하고, 그러려면 passive:false touchmove 가 필요하다
// (React onTouchMove 는 passive 로 등록돼 preventDefault 가 무시된다).
// 터치 이벤트는 손가락에서만 오므로 iPad 에 트랙패드·마우스를 붙여도 이 제스처는 발동하지 않는다.
// 끌기 중 이동은 React 상태가 아니라 무대 style 에 직접 쓴다 — 프레임마다 뷰어 전체가 다시 그려지지 않게.
import { useEffect, useRef } from 'react'

import { decideSwipe, dragOffset, type GestureLock, lockGesture, releaseVelocity, type Sample } from './viewerGestures'

export interface ViewerGestureOptions {
  /** 터치 제스처 사용 — coarse 포인터일 때만(스펙 §3.2: 폭이 아니라 pointer: coarse). */
  enabled: boolean
  hasPrev: boolean
  hasNext: boolean
  /** 현재 확대 배율(1 = 맞춤) — 확대 중엔 아래로 닫기 대신 팬. */
  zoom: number
  /** 스와이프로 확정된 넘김. */
  onNav: (dir: -1 | 1) => void
}

/** 한 손가락 추적 상태 — 시작 시점의 스크롤 여유를 함께 들고 있어 첫 이동 판정에 쓴다. */
interface OneFinger {
  kind: 'one'
  lock: GestureLock
  startX: number
  startY: number
  samples: Sample[]
  canPanLeft: boolean
  canPanRight: boolean
  atTop: boolean
}
/** ignore = 이번 터치 묶음은 손을 모두 뗄 때까지 무시(버튼 위 시작·두 번째 손가락 등). */
type Track = OneFinger | { kind: 'ignore' } | null

/** 제스처를 받지 않는 대상 — 본문 안 버튼·링크·입력(마크다운 링크·다시 시도 등)은 그 요소의 탭·스크롤에 맡긴다. */
const INTERACTIVE = 'button, a[href], input, textarea, select, [role="button"], [contenteditable="true"]'
/** 표본 보관 개수 — 속도는 최근 100ms 만 보므로 이만큼이면 충분. */
const MAX_SAMPLES = 20

/** 그 축으로 실제 스크롤되는 요소인가(overflow auto/scroll + 넘침, ±1px 허용). */
function scrollable(el: Element, axis: 'x' | 'y'): el is HTMLElement {
  if (!(el instanceof HTMLElement)) return false
  const s = getComputedStyle(el)
  const ov = axis === 'x' ? s.overflowX : s.overflowY
  if (ov !== 'auto' && ov !== 'scroll') return false
  return axis === 'x' ? el.scrollWidth > el.clientWidth + 1 : el.scrollHeight > el.clientHeight + 1
}

/** 손가락 아래에서 무대까지 올라가며 그 축의 첫 스크롤 영역(판정 R4). 없으면 null. */
function nearestScroller(target: Element, stage: HTMLElement, axis: 'x' | 'y'): HTMLElement | null {
  for (let el: Element | null = target; el; el = el.parentElement) {
    if (scrollable(el, axis)) return el
    if (el === stage) break
  }
  return null
}

/** 손가락 아래 가로 스크롤 영역의 남은 여유 — 없으면 둘 다 false(어느 방향이든 넘김). */
export function horizontalRoom(target: Element, stage: HTMLElement): { canPanLeft: boolean; canPanRight: boolean } {
  const el = nearestScroller(target, stage, 'x')
  if (!el) return { canPanLeft: false, canPanRight: false }
  return { canPanLeft: el.scrollLeft > 1, canPanRight: el.scrollLeft < el.scrollWidth - el.clientWidth - 1 }
}

/** 손가락 아래 세로 스크롤 영역이 맨 위인가 — 세로 스크롤 영역이 없으면(맞춤 이미지 등) 참. */
export function atScrollTop(target: Element, stage: HTMLElement): boolean {
  const el = nearestScroller(target, stage, 'y')
  return !el || el.scrollTop <= 1
}

/**
 * 무대에 터치 제스처를 건다. 옵션은 최신값 ref 로 읽어 리스너를 매 렌더 다시 달지 않는다(stage·enabled 가 바뀔 때만).
 */
export function useViewerGestures(stage: HTMLElement | null, opts: ViewerGestureOptions): void {
  const latest = useRef(opts)
  useEffect(() => {
    latest.current = opts
  })
  const { enabled } = opts
  useEffect(() => {
    if (!stage || !enabled) return
    let track: Track = null
    /** 끌기 중 위치 — 전환 없이 즉시. */
    const paint = (x: number, y: number) => {
      stage.style.transition = ''
      stage.style.transform = x || y ? `translate3d(${x}px, ${y}px, 0)` : ''
    }
    /** 제자리로 부드럽게 돌아간다(넘김 취소). */
    const settle = () => {
      stage.style.transition = 'transform 200ms ease-out'
      stage.style.transform = ''
    }
    const onStart = (e: TouchEvent) => {
      const target = e.target as Element
      if (e.touches.length !== 1 || target.closest(INTERACTIVE)) {
        // 두 번째 손가락이 닿으면 진행 중이던 넘김을 원위치하고 이번 묶음은 무시한다(Review Focus 3).
        if (track?.kind === 'one' && track.lock === 'swipe') settle()
        track = { kind: 'ignore' }
        return
      }
      const t = e.touches[0]
      track = {
        kind: 'one',
        lock: 'pending',
        startX: t.clientX,
        startY: t.clientY,
        samples: [{ t: e.timeStamp, x: t.clientX, y: t.clientY }],
        ...horizontalRoom(target, stage),
        atTop: atScrollTop(target, stage),
      }
    }
    const onMove = (e: TouchEvent) => {
      if (track?.kind !== 'one' || e.touches.length !== 1) return
      const o = latest.current
      const t = e.touches[0]
      const dx = t.clientX - track.startX
      const dy = t.clientY - track.startY
      track.samples.push({ t: e.timeStamp, x: t.clientX, y: t.clientY })
      if (track.samples.length > MAX_SAMPLES) track.samples.shift()
      if (track.lock === 'pending') {
        track.lock = lockGesture({
          dx,
          dy,
          startX: track.startX,
          viewportWidth: window.innerWidth,
          canPanLeft: track.canPanLeft,
          canPanRight: track.canPanRight,
          atTop: track.atTop,
          zoom: o.zoom,
        })
      }
      if (track.lock === 'swipe') {
        // 우리 제스처 — 브라우저 스크롤·뒤로가기 제스처를 막고 무대를 손가락에 붙인다(끝이면 러버밴드).
        if (e.cancelable) e.preventDefault()
        paint(dragOffset(dx, stage.clientWidth, o.hasPrev, o.hasNext), 0)
      }
    }
    const onEnd = (e: TouchEvent) => {
      const cur = track
      if (e.touches.length === 0) track = null
      if (cur?.kind !== 'one') return
      const o = latest.current
      const t = e.changedTouches[0]
      if (cur.lock === 'swipe') {
        const dx = t.clientX - cur.startX
        const { vx } = releaseVelocity([...cur.samples, { t: e.timeStamp, x: t.clientX, y: t.clientY }])
        const d = decideSwipe({ dx, vx, width: stage.clientWidth, hasPrev: o.hasPrev, hasNext: o.hasNext })
        if (d === 'stay') settle()
        else {
          paint(0, 0)
          o.onNav(d === 'next' ? 1 : -1)
        }
      }
    }
    const onCancel = () => {
      if (track?.kind === 'one' && track.lock === 'swipe') settle()
      track = null
    }
    stage.addEventListener('touchstart', onStart, { passive: true })
    stage.addEventListener('touchmove', onMove, { passive: false })
    stage.addEventListener('touchend', onEnd)
    stage.addEventListener('touchcancel', onCancel)
    return () => {
      stage.removeEventListener('touchstart', onStart)
      stage.removeEventListener('touchmove', onMove)
      stage.removeEventListener('touchend', onEnd)
      stage.removeEventListener('touchcancel', onCancel)
      stage.style.transform = ''
      stage.style.transition = ''
    }
  }, [stage, enabled])
}
```

> **린트 주의:** React Compiler/`react-hooks` 규칙이 "훅 인자(`stage`) 변경"으로 `stage.style.*` 쓰기를 지적하면 규칙을 끄지 말고, 콜백 ref state(`stage`)는 이펙트 의존성으로만 쓰고 실제 style 쓰기는 `const el = useRef<HTMLElement | null>(null); el.current = stage` 로 비춘 ref 를 통해 한다.

- [ ] **Step 5: 무대 touch-action CSS**

`src/index.css` 끝(또는 Task 3 에서 넣은 뷰어 규칙 아래)에:

```css
/* 통합 뷰어 무대 터치 동작(WP-278, 판정 R2). 스크롤 컨테이너마다 touch-action 이 따로 계산되므로 무대 자손 전체에 같은 값을 건다.
   none = 맞춤 이미지(스크롤할 것이 없어 스와이프·닫기·핀치를 전부 JS 가 받는다).
   pan  = 그 외(가로·세로 네이티브 스크롤은 유지하고 브라우저 핀치 확대·두 번 탭 확대만 끈다 — 확대는 뷰어 배율로).
   overscroll-behavior 는 문서 맨 위에서 당길 때 Android 당겨서 새로고침·스크롤 체이닝이 페이지로 새지 않게. */
[data-viewer-stage="none"],
[data-viewer-stage="none"] * {
  touch-action: none;
}
[data-viewer-stage="pan"],
[data-viewer-stage="pan"] * {
  touch-action: pan-x pan-y;
}
[data-viewer-stage] * {
  overscroll-behavior: contain;
}
```

- [ ] **Step 6: `AttachmentViewer` 연결**

1) import: `useIsCoarsePointer` from `'../../hooks/useIsCoarsePointer'`, `useViewerGestures` from `'./useViewerGestures'`.

2) `mobile` 아래에:

```tsx
  // 제스처는 폭이 아니라 coarse 포인터 기준 — iPad 가로(≥1024px)는 데스크톱 배치 + 터치 제스처(스펙 §3.2·시안 iPad).
  const coarse = useIsCoarsePointer()
  // 무대(본문 감싸기) — 제스처 리스너·끌기 transform 대상. 콜백 ref 로 state 에 담아 훅이 붙을 시점을 안다.
  const [stage, setStage] = useState<HTMLDivElement | null>(null)
```

3) `go` 시그니처 교체(판정 R7):

```tsx
  /**
   * 이전/다음으로 이동 — 끝에서는 아무것도 하지 않는다(순환 없음).
   * moveFocus=false(제스처 넘김)면 끝에 닿아도 반대쪽 ‹ › 로 포커스를 옮기지 않는다 —
   * 숨김 대상인 ‹ › 안에 포커스가 생기면 다음 탭이 바를 숨기지 못한다(판정 R7). 키보드·버튼 넘김은 기존 규칙(WCAG 2.4.3).
   */
  const go = (dir: -1 | 1, opts?: { moveFocus?: boolean }) => {
    const pend = pendingKey.current != null ? items.findIndex((i) => i.key === pendingKey.current) : -1
    const next = (pend >= 0 ? pend : idx) + dir
    if (next < 0 || next >= items.length) return
    pendingKey.current = items[next].key
    focusEdge.current = opts?.moveFocus === false ? null : dir
    onIndexChange(next)
  }
```

4) 제스처 훅 호출(`go` 정의 아래):

```tsx
  // 연타 보호(pendingKey)를 그대로 타도록 넘김은 go 로 보낸다.
  useViewerGestures(stage, {
    enabled: coarse,
    hasPrev: nav.hasPrev,
    hasNext: nav.hasNext,
    zoom,
    onNav: (dir) => go(dir, { moveFocus: false }),
  })
  // 맞춤 이미지는 스크롤할 것이 없어 터치를 전부 받고(none), 그 외는 네이티브 스크롤을 남긴다(pan) — 판정 R2.
  const stageTouch = !coarse ? undefined : kind === 'IMAGE' && zoom === 1 ? 'none' : 'pan'
```

5) `<ViewerBody … />` 를 무대로 감싼다:

```tsx
            {/* 무대 — 터치 제스처·끌기 이동·핀치 미리보기의 대상. 바·‹ ›·시트는 무대 밖이라 그 위의 터치는 제스처가 아니다. */}
            <div
              ref={setStage}
              data-testid="viewer-stage"
              data-viewer-stage={stageTouch}
              data-zoom={zoom}
              className="flex min-h-0 min-w-0 flex-1 flex-col"
            >
              <ViewerBody key={item.key} item={item} zoom={zoom} onPage={onPage} chromeInset={mobile} />
            </div>
```

- [ ] **Step 7: 판정 R2 성립 확인(먼저) → 전체 통과 확인**

먼저 R2 의 핵심 두 테스트만 돌린다:
Run: `pnpm exec playwright test e2e/pages/mobile/attachment-viewer-mobile.spec.ts --project=mobile -g "세로 끌기는 문서 스크롤|넓은 표는 내용이 먼저"`
Expected: PASS. **실패 시 판단 규칙:** (a) 세로 끌기 후 `scrollTop` 이 0 이면 CDP 터치가 네이티브 스크롤을 일으키지 못하는 것인지 먼저 확인(훅을 끈 `enabled: false` 로 같은 테스트) — 훅을 꺼도 0 이면 환경 한계이므로 그 단언 한 줄만 제거하고 보고서에 기록, 훅을 켰을 때만 0 이면 `preventDefault` 가 과하게 걸린 버그이므로 수정. (b) 가로 스와이프가 넘어가지 않으면 `touchmove` 의 `e.cancelable`·잠금 판정을 로그로 확인. 그래도 Touch Events 모델이 chromium 에서 성립하지 않으면 **BLOCKED 로 보고**하고 임의로 Pointer Events 로 바꾸지 않는다.

이어서 전체:
```bash
pnpm exec playwright test e2e/pages/mobile/attachment-viewer-mobile.spec.ts e2e/pages/mobile/back-drive.spec.ts e2e/pages/mobile/drive-preview-resize.spec.ts --project=mobile
pnpm exec playwright test e2e/pages/drive/ --project=chromium
pnpm typecheck && npx tsc -p tsconfig.e2e.json --noEmit && pnpm lint
```
Expected: 모두 PASS(데스크톱은 coarse 가 아니라 무대에 `data-viewer-stage` 가 없고 동작 불변).

- [ ] **Step 8: 커밋**

```bash
git add apps/workplace-web/e2e/fixtures/touch.ts apps/workplace-web/src/components/viewer/useViewerGestures.ts apps/workplace-web/src/components/viewer/AttachmentViewer.tsx apps/workplace-web/src/index.css apps/workplace-web/e2e/pages/mobile/attachment-viewer-mobile.spec.ts
git commit --no-verify -m "$(cat <<'EOF'
feat(web): 터치 기기에서 뷰어를 좌우로 밀어 같은 묶음의 첨부를 넘긴다 (WP-278)

- WP-278
- 폭 25% 초과나 플링이면 넘기고 처음과 끝에서는 러버밴드로 버티며, 화면 가장자리 20px 에서 시작한 스와이프는 OS 뒤로가기에 양보한다
- 넓은 표처럼 내용이 더 갈 수 있으면 내용이 먼저 움직이고 가장자리에 닿은 뒤 다시 밀어야 넘어간다
- 스크롤과 제스처를 첫 이동에서 나누려고 터치 이벤트를 직접 걸며, 판정은 폭이 아닌 coarse 포인터 기준이라 iPad 가로에서도 동작한다
- E2E 는 마우스가 아닌 CDP 터치로 실제 손가락 경로를 검증한다

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0118pvsRQTanEBAzhsKg7E1o
EOF
)"
```

---

### Task 6: 아래로 쓸어 닫기 + 탭으로 바 토글(inert·포커스 보호) + 가로 모드 기본 숨김

**Files:**
- Modify: `apps/workplace-web/src/components/viewer/useViewerGestures.ts`
- Modify: `apps/workplace-web/src/components/viewer/AttachmentViewer.tsx`
- Modify: `apps/workplace-web/src/lib/mobile/mediaQueryStore.ts`
- Create: `apps/workplace-web/src/hooks/useIsLandscape.ts`
- Test: `apps/workplace-web/e2e/pages/mobile/attachment-viewer-mobile.spec.ts` (테스트 추가)

**Interfaces:**
- Consumes: `decideDismiss`, `DOUBLE_TAP_MS`, `TAP_*` 없음(탭은 `lock === 'pending'` 으로 끝난 터치) (Task 1); Task 5 의 훅·`go`·`stage`
- Produces:
  - `ViewerGestureOptions` 에 추가: `backdrop?: HTMLElement | null`, `onDismiss: () => void`, `onTap?: () => void`
  - `landscapeStore`(mediaQueryStore), `useIsLandscape(): boolean`
  - `AttachmentViewer` 안: `barsHidden: boolean`(상태), `toggleBars()`, 배경 레이어 testid `viewer-backdrop`
  - 훅 내부 `handleTap(s: Sample)` — Task 7 이 두 번 탭 분기를 더한다

- [ ] **Step 1: 실패하는 E2E 추가**

spec import 에 `touchTap` 추가. 파일 끝에:

```ts
test.describe('아래로 닫기·탭 바 토글', () => {
  test('원래 크기 이미지에서 아래로 쓸면 닫히고 URL 의 preview 도 사라진다', async ({ authenticatedPage: page }) => {
    await stubDriveFiles(page, [IMG(70)])
    await openViewer(page, '사진70.png')
    const c = await centerOf(page.getByTestId('viewer-stage'))
    await touchDrag(page, { x: c.x, y: c.y - 100 }, { x: c.x, y: c.y + 250 })
    await expect(page.getByTestId('attachment-viewer')).toHaveCount(0)
    await expect(page).toHaveURL(new RegExp(`/drive/spaces/${SPACE_ID}$`))
  })

  test('문서는 맨 위에서 당길 때만 닫힌다 — 중간이면 스크롤', async ({ authenticatedPage: page }) => {
    await stubDriveFiles(page, [MD(77, 'long.md', LONG_MD)])
    await openViewer(page, 'long.md')
    const body = page.getByTestId('preview-body')
    await expect(body).toContainText('1번째 줄')
    await body.evaluate((el) => (el.scrollTop = 600))
    const c = await centerOf(body)
    await touchDrag(page, { x: c.x, y: c.y - 120 }, { x: c.x, y: c.y + 120 })
    await expect(page.getByTestId('attachment-viewer')).toBeVisible()
    await body.evaluate((el) => (el.scrollTop = 0))
    await touchDrag(page, { x: c.x, y: c.y - 120 }, { x: c.x, y: c.y + 220 })
    await expect(page.getByTestId('attachment-viewer')).toHaveCount(0)
  })

  test('탭하면 상·하단 바와 ‹ › 가 숨고(inert) 다시 탭하면 돌아온다', async ({ authenticatedPage: page }) => {
    await stubDriveFiles(page, [IMG(70), IMG(71)])
    await openViewer(page, '사진70.png')
    const c = await centerOf(page.getByTestId('viewer-stage'))
    await touchTap(page, c)
    await expect(page.getByTestId('viewer-top-bar')).toHaveAttribute('inert', '')
    await expect(page.getByTestId('viewer-action-bar')).toHaveAttribute('inert', '')
    // ‹ › 도 바와 함께 숨는다(inert — 접근성 트리·탭 순서에서 빠짐).
    await expect(page.locator('button[aria-label="다음 파일"]')).toHaveAttribute('inert', '')
    await touchTap(page, c)
    await expect(page.getByTestId('viewer-top-bar')).not.toHaveAttribute('inert', '')
    await expect(page.locator('button[aria-label="다음 파일"]')).not.toHaveAttribute('inert', '')
  })

  test('숨긴 바에는 Tab 이 들어가지 않는다', async ({ authenticatedPage: page }) => {
    await stubDriveFiles(page, [IMG(70), IMG(71)])
    await openViewer(page, '사진70.png')
    await touchTap(page, await centerOf(page.getByTestId('viewer-stage')))
    await expect(page.getByTestId('viewer-top-bar')).toHaveAttribute('inert', '')
    for (let k = 0; k < 6; k++) {
      await page.keyboard.press('Tab')
      const inBars = await page.evaluate(() =>
        !!document.activeElement?.closest('[data-testid="viewer-top-bar"], [data-testid="viewer-action-bar"]'))
      expect(inBars).toBe(false)
    }
  })

  // 참고: 탭의 click 이 포커스를 본문·다이얼로그로 옮기므로 이 테스트는 R7 없이도 통과할 수 있다 — R7 은 방어적 규칙(블루투스 키보드·스크린리더 경로)이고 회귀 신호로만 둔다.
  test('끝까지 스와이프한 뒤에도 탭이 바를 숨긴다(제스처 넘김은 ‹ › 로 포커스를 옮기지 않음)', async ({ authenticatedPage: page }) => {
    await stubDriveFiles(page, [IMG(70), IMG(71)])
    await openViewer(page, '사진70.png')
    const c = await centerOf(page.getByTestId('viewer-stage'))
    await touchDrag(page, c, { x: c.x - 180, y: c.y })
    await expect(page.getByTestId('preview-meta')).toHaveText('2 / 2')
    await touchTap(page, c)
    await expect(page.getByTestId('viewer-top-bar')).toHaveAttribute('inert', '')
  })

  test('요약 시트 위 탭은 바를 숨기지 않는다', async ({ authenticatedPage: page }) => {
    await stubDriveFiles(page, [MD(80, 'plan.md')])
    await openViewer(page, 'plan.md')
    await page.getByTestId('viewer-slot-summary').tap()
    const sheet = page.getByTestId('viewer-summary-sheet')
    await expect(sheet.getByTestId('drive-summary-card')).toBeVisible()
    await touchTap(page, await centerOf(sheet.getByTestId('drive-summary-card')))
    // eslint-disable-next-line playwright/no-wait-for-timeout -- "탭 판정 지연(300ms) 동안 바가 숨지 않음" 부재 확인이라 조건 대기로 바꿀 수 없다
    await page.waitForTimeout(400)
    await expect(page.getByTestId('viewer-top-bar')).not.toHaveAttribute('inert', '')
  })

  test('가로 모드는 바가 기본 숨김, 탭하면 표시 — 세로로 돌리면 다시 보이고 넘침 없음', async ({ authenticatedPage: page }) => {
    await page.setViewportSize({ width: 844, height: 390 })
    await stubDriveFiles(page, [IMG(70), IMG(71)])
    await openViewer(page, '사진70.png')
    await expect(page.getByTestId('viewer-top-bar')).toHaveAttribute('inert', '')
    await touchTap(page, await centerOf(page.getByTestId('viewer-stage')))
    await expect(page.getByTestId('viewer-top-bar')).not.toHaveAttribute('inert', '')
    await page.setViewportSize({ width: 390, height: 844 })
    await expect(page.getByTestId('viewer-top-bar')).not.toHaveAttribute('inert', '')
    await page.setViewportSize({ width: 844, height: 390 })
    await expect(page.getByTestId('viewer-top-bar')).toHaveAttribute('inert', '')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm exec playwright test e2e/pages/mobile/attachment-viewer-mobile.spec.ts --project=mobile -g "아래로 닫기"`
Expected: FAIL — 닫히지 않음·`inert` 없음.

- [ ] **Step 3: 가로 방향 스토어·훅**

`src/lib/mobile/mediaQueryStore.ts` 끝에:

```ts
/** 가로 방향인가 — 모바일 뷰어는 가로에서 바를 기본 숨긴다(WP-278, 사진·영상 면적 우선). */
export const landscapeStore = createMediaQueryStore('(orientation: landscape)')
```

`src/hooks/useIsLandscape.ts`:

```ts
// 화면이 가로 방향인지 구독하는 훅 — 회전 즉시 반영(WP-278 모바일 뷰어의 바 기본 숨김).
import { useSyncExternalStore } from 'react'

import { landscapeStore } from '@/lib/mobile/mediaQueryStore'

/** 가로 방향 여부. 초기 스냅샷이 없는 환경에선 세로(false)로 본다. */
export function useIsLandscape(): boolean {
  return useSyncExternalStore(landscapeStore.subscribe, landscapeStore.get, () => false)
}
```

- [ ] **Step 4: 훅에 닫기·탭 추가**

`useViewerGestures.ts`:

1) import 에 `decideDismiss`, `DOUBLE_TAP_MS` 추가.

2) `ViewerGestureOptions` 에 필드 추가:

```ts
  /** 아래로 닫기 중 옅어질 배경 레이어(없으면 무대만 움직인다). */
  backdrop?: HTMLElement | null
  /** 아래로 쓸어 닫기 확정. */
  onDismiss: () => void
  /** 단일 탭(움직임 없는 터치) — 모바일 배치에서 바 토글(판정 R5). 없으면 탭은 무시. */
  onTap?: () => void
```

3) 효과 본문 안, `paint` 위에 배경·탭 상태:

```ts
    const backdrop = latest.current.backdrop ?? null
    /** 단일 탭 지연 타이머 — 두 번 탭과 구분하고, 탭으로 옮겨간 포커스를 본 뒤 바를 토글하려고 기다린다(판정 R6). */
    let tapTimer: ReturnType<typeof setTimeout> | undefined
    /** 움직임 없이 끝난 터치 — 지연 뒤 onTap. (Task 7 이 두 번 탭 분기를 이 함수 맨 앞에 더한다.) */
    const handleTap = (s: Sample) => {
      void s
      clearTimeout(tapTimer)
      tapTimer = setTimeout(() => latest.current.onTap?.(), DOUBLE_TAP_MS)
    }
```

`paint`·`settle` 을 배경 투명도까지 다루도록 교체:

```ts
    /** 끌기 중 위치 — 전환 없이 즉시. 아래로 끌면 배경이 옅어진다(시안 M2). */
    const paint = (x: number, y: number) => {
      stage.style.transition = ''
      stage.style.transform = x || y ? `translate3d(${x}px, ${y}px, 0)` : ''
      if (backdrop) backdrop.style.opacity = y > 0 ? String(Math.max(0.2, 1 - y / stage.clientHeight)) : ''
    }
    /** 제자리로 부드럽게 돌아간다(넘김·닫기 취소). */
    const settle = () => {
      stage.style.transition = 'transform 200ms ease-out'
      stage.style.transform = ''
      if (backdrop) backdrop.style.opacity = ''
    }
```

4) `onMove` 의 `if (track.lock === 'swipe') {…}` 뒤에:

```ts
      else if (track.lock === 'dismiss') {
        // 아래로 닫기 — 당겨서 새로고침·스크롤 바운스를 막고 무대를 손가락에 붙인다(위로는 따라가지 않음).
        if (e.cancelable) e.preventDefault()
        paint(0, Math.max(0, dy))
      }
```

5) `onEnd` 의 swipe 분기 뒤에:

```ts
      else if (cur.lock === 'dismiss') {
        const dy = t.clientY - cur.startY
        const { vy } = releaseVelocity([...cur.samples, { t: e.timeStamp, x: t.clientX, y: t.clientY }])
        if (decideDismiss({ dy, vy, height: stage.clientHeight })) o.onDismiss()
        else settle()
      } else if (cur.lock === 'pending' && e.touches.length === 0) {
        // 판정 임계(6px) 안에서 끝난 터치 = 탭.
        handleTap({ t: e.timeStamp, x: t.clientX, y: t.clientY })
      }
```

6) cleanup 에 `clearTimeout(tapTimer)` 와 `if (backdrop) backdrop.style.opacity = ''` 추가, 효과 의존성을 `[stage, enabled, opts.backdrop]` 로(배경 레이어가 마운트된 뒤 다시 붙도록 — 구조분해 `const { enabled, backdrop: backdropEl } = opts` 후 `[stage, enabled, backdropEl]`, 본문에서 `const backdrop = backdropEl ?? null`).

- [ ] **Step 5: `AttachmentViewer` — 배경 레이어·바 상태·inert**

1) import: `useIsLandscape`.

2) Task 3 의 `const barsHidden = false` 를 교체:

```tsx
  // 바 숨김 — 가로 모드는 기본 숨김(시안 M5), 탭으로 토글(모바일 배치만, 판정 R5).
  // 회전할 때마다 그 방향의 기본값으로 되돌린다 — 렌더 중 상태 갱신(useViewerBundle 의 스냅숏과 같은 수렴 패턴, 이펙트 setState 아님).
  // 주의: "저장된 방향과 다를 때만 기본값" 식의 파생으로 두면 가로→(탭으로 표시)→세로→가로 에서 낡은 '표시'가 되살아난다(Review Focus 4).
  const landscape = useIsLandscape()
  const [bars, setBars] = useState({ landscape, hidden: landscape })
  if (bars.landscape !== landscape) setBars({ landscape, hidden: landscape })
  // 갱신이 반영되는 재렌더 전 한 번은 새 방향 기본값으로 본다.
  const barsHidden = mobile && (bars.landscape === landscape ? bars.hidden : landscape)
  const topBarRef = useRef<HTMLElement>(null)
  const bottomBarRef = useRef<HTMLDivElement>(null)
  /** 탭 = 바 토글. 포커스가 바(‹ › 포함) 안이면 숨기지 않는다(스펙 §5.1) — inert 로 빠질 요소 안에 포커스가 갇히지 않게. */
  const toggleBars = () => {
    const a = document.activeElement
    const inBars = [topBarRef.current, bottomBarRef.current, prevBtn.current, nextBtn.current].some((el) => el?.contains(a))
    if (!barsHidden && inBars) return
    setBars({ landscape, hidden: !barsHidden })
  }
  // 아래로 닫기 때 옅어지는 배경 — 루트 배경을 이 레이어로 옮겨 투명도만 바꾼다(하드코딩 색 없이 토큰 유지).
  const [backdrop, setBackdrop] = useState<HTMLDivElement | null>(null)
```

3) 제스처 훅 옵션 추가:

```tsx
    backdrop,
    onDismiss: onClose,
    onTap: mobile ? toggleBars : undefined,
```

4) `DialogContent` className 의 `bg-background` → `bg-transparent`, 루트 첫 자식으로 배경 레이어:

```tsx
        <div ref={setBackdrop} aria-hidden data-testid="viewer-backdrop" className="pointer-events-none absolute inset-0 -z-10 bg-background" />
```

5) `ViewerMobileTopBar`·`ViewerActionBar` 에 `barRef={topBarRef}` / `barRef={bottomBarRef}` 전달.

6) ‹ › 버튼 두 개에 숨김 반영:

```tsx
              <button
                ref={prevBtn}
                type="button"
                aria-label="이전 파일"
                inert={barsHidden}
                onClick={() => go(-1)}
                className={cn(edgeBtnClass, 'left-3', barsHidden && 'pointer-events-none opacity-0')}
              >
```
(다음 파일 버튼도 같은 방식.)

- [ ] **Step 6: 통과 확인**

Run:
```bash
pnpm exec playwright test e2e/pages/mobile/attachment-viewer-mobile.spec.ts e2e/pages/mobile/back-drive.spec.ts --project=mobile
pnpm exec playwright test e2e/pages/drive/ --project=chromium
pnpm typecheck && npx tsc -p tsconfig.e2e.json --noEmit && pnpm lint
```
Expected: 모두 PASS. 데스크톱은 `barsHidden` 이 항상 false(`mobile` 거짓)라 ‹ › 동작·포커스 규칙 불변.

- [ ] **Step 7: 커밋**

```bash
git add apps/workplace-web/src/components/viewer/useViewerGestures.ts apps/workplace-web/src/components/viewer/AttachmentViewer.tsx apps/workplace-web/src/lib/mobile/mediaQueryStore.ts apps/workplace-web/src/hooks/useIsLandscape.ts apps/workplace-web/e2e/pages/mobile/attachment-viewer-mobile.spec.ts
git commit --no-verify -m "$(cat <<'EOF'
feat(web): 뷰어를 아래로 쓸어 닫고 탭으로 바를 숨기며 가로 모드는 바 없이 연다 (WP-278)

- WP-278
- 원래 크기에서 아래로 쓸면 배경이 옅어지며 닫히고, 문서는 맨 위에서 당길 때만 닫혀 스크롤과 겹치지 않는다
- 탭하면 상단·하단 바와 넘김 버튼을 숨기고 inert 로 빼며, 포커스가 바 안이면 숨기지 않아 키보드 사용자가 길을 잃지 않는다
- 가로 모드는 사진 면적을 위해 바를 기본으로 숨기고 회전하면 그 방향의 기본값으로 돌아간다

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0118pvsRQTanEBAzhsKg7E1o
EOF
)"
```

---

### Task 7: 핀치·두 번 탭 확대(이미지·PDF, 기준점 유지)

**Files:**
- Modify: `apps/workplace-web/src/components/viewer/useViewerGestures.ts`
- Modify: `apps/workplace-web/src/components/viewer/AttachmentViewer.tsx`
- Test: `apps/workplace-web/e2e/pages/mobile/attachment-viewer-mobile.spec.ts` (테스트 추가)

**Interfaces:**
- Consumes: `pinchZoom`, `doubleTapTarget`, `isDoubleTap`, `anchorScroll`, `TOUCH_ZOOM_MIN/MAX` (Task 1); Task 5·6 의 훅·`handleTap`·무대·`data-zoom`
- Produces:
  - `ViewerGestureOptions` 에 추가: `zoomable: boolean`, `onZoom: (next: number, focus: { x: number; y: number }) => void` — `focus` 는 확대 스크롤 영역(`[data-hscroll]`) 왼쪽 위 기준 px
  - `AttachmentViewer` 안: `zoomAt(next: number, focus: { x: number; y: number })`

- [ ] **Step 1: 실패하는 E2E 추가**

spec import 에 `touchDoubleTap`, `touchPinch` 추가. 파일 끝에:

```ts
test.describe('핀치·두 번 탭 확대', () => {
  test('이미지 두 번 탭 = 2배(탭 지점 기준), 다시 두 번 탭 = 맞춤 — 바는 토글되지 않는다', async ({ authenticatedPage: page }) => {
    await stubDriveFiles(page, [IMG(70)])
    await openViewer(page, '사진70.png')
    const stage = page.getByTestId('viewer-stage')
    const img = page.getByRole('img', { name: '사진70.png' })
    await expect(img).toBeVisible()
    const w1 = (await img.boundingBox())!.width
    const b = (await stage.boundingBox())!
    await touchDoubleTap(page, { x: b.x + b.width * 0.8, y: b.y + b.height / 2 })
    await expect(stage).toHaveAttribute('data-zoom', '2')
    await expect.poll(async () => (await img.boundingBox())!.width).toBeGreaterThan(w1 * 1.8)
    // 오른쪽을 두 번 탭했으니 그 지점이 제자리에 남도록 오른쪽으로 스크롤돼 있다.
    await expect.poll(() => page.getByTestId('preview-body').evaluate((el) => el.scrollLeft)).toBeGreaterThan(0)
    // eslint-disable-next-line playwright/no-wait-for-timeout -- "두 번 탭 뒤 단일 탭 판정 지연(300ms) 동안 바가 토글되지 않음" 부재 확인
    await page.waitForTimeout(400)
    await expect(page.getByTestId('viewer-top-bar')).not.toHaveAttribute('inert', '')
    await touchDoubleTap(page, { x: b.x + b.width / 2, y: b.y + b.height / 2 })
    await expect(stage).toHaveAttribute('data-zoom', '1')
  })

  test('이미지 핀치로 벌리면 확대(최대 3배), 모으면 맞춤 아래로 내려가지 않는다', async ({ authenticatedPage: page }) => {
    await stubDriveFiles(page, [IMG(70)])
    await openViewer(page, '사진70.png')
    const stage = page.getByTestId('viewer-stage')
    await expect(page.getByRole('img', { name: '사진70.png' })).toBeVisible()
    const c = await centerOf(stage)
    await touchPinch(page, c, 80, 200)
    await expect.poll(async () => Number(await stage.getAttribute('data-zoom'))).toBeGreaterThan(1.5)
    await touchPinch(page, c, 60, 600)
    await expect(stage).toHaveAttribute('data-zoom', '3')
    await touchPinch(page, c, 300, 40)
    await expect(stage).toHaveAttribute('data-zoom', '1')
    await expect.poll(() => stage.evaluate((el) => getComputedStyle(el).transform)).toBe('none')
  })

  test('확대한 이미지는 가로 끌기가 넘김이 아니라 팬', async ({ authenticatedPage: page }) => {
    await stubDriveFiles(page, [IMG(70), IMG(71)])
    await openViewer(page, '사진70.png')
    const stage = page.getByTestId('viewer-stage')
    await expect(page.getByRole('img', { name: '사진70.png' })).toBeVisible()
    const c = await centerOf(stage)
    await touchDoubleTap(page, c)
    await expect(stage).toHaveAttribute('data-zoom', '2')
    await touchDrag(page, c, { x: c.x - 120, y: c.y })
    await expect(page.getByTestId('preview-meta')).toHaveText('1 / 2')
  })

  test('PDF 핀치 확대는 페이지를 그 배율로 다시 그린다(1~3배), 두 번 탭은 2배', async ({ authenticatedPage: page }) => {
    await stubDriveFiles(page, [{ id: 74, name: 'doc.pdf', mimeType: 'application/pdf', body: PDF }])
    await openViewer(page, 'doc.pdf')
    const page1 = page.getByTestId('pdf-page-1')
    await expect(page1).toBeVisible()
    const stage = page.getByTestId('viewer-stage')
    const w1 = (await page1.boundingBox())!.width
    // 맞춤 상태의 캔버스 백킹 폭(= CSS 폭 × DPR) — 렌더가 끝날 때까지 기다린 뒤 잰다.
    await expect.poll(() => page1.evaluate((el: HTMLCanvasElement) => el.width)).toBeGreaterThan(0)
    const backing1 = await page1.evaluate((el: HTMLCanvasElement) => el.width)
    const c = await centerOf(stage)
    await touchPinch(page, c, 80, 200)
    await expect.poll(async () => Number(await stage.getAttribute('data-zoom'))).toBeGreaterThan(1.5)
    await expect.poll(async () => (await page1.boundingBox())!.width).toBeGreaterThan(w1 * 1.5)
    // 캔버스 백킹 해상도도 커졌다(CSS 확대가 아니라 그 배율로 재렌더 — 글자 선명).
    await expect.poll(() => page1.evaluate((el: HTMLCanvasElement) => el.width)).toBeGreaterThan(backing1 * 1.3)
    await touchDoubleTap(page, c)
    await expect(stage).toHaveAttribute('data-zoom', '1')
    await touchDoubleTap(page, c)
    await expect(stage).toHaveAttribute('data-zoom', '2')
  })

  test('PDF 축소(3배 → 맞춤 쪽)에서도 보던 위치가 비례해 유지된다', async ({ authenticatedPage: page }) => {
    await stubDriveFiles(page, [{ id: 74, name: 'doc.pdf', mimeType: 'application/pdf', body: PDF }])
    await openViewer(page, 'doc.pdf')
    await expect(page.getByTestId('pdf-page-1')).toBeVisible()
    const stage = page.getByTestId('viewer-stage')
    const doc = page.getByTestId('pdf-document')
    const c = await centerOf(stage)
    await touchPinch(page, c, 60, 600)
    await expect(stage).toHaveAttribute('data-zoom', '3')
    // 문서 중간쯤으로 스크롤해 둔 뒤(최대값 근처가 아닌 위치) 반쯤 모은다.
    await doc.evaluate((el) => (el.scrollTop = Math.round(el.scrollHeight * 0.4)))
    const ratioBefore = await doc.evaluate((el) => el.scrollTop / el.scrollHeight)
    await touchPinch(page, c, 300, 200)
    await expect.poll(async () => Number(await stage.getAttribute('data-zoom'))).toBeLessThan(3)
    // 축소 뒤 스크롤 비율이 크게 어긋나지 않는다(브라우저가 잘라 낸 값을 기준으로 쓰면 맨 끝/맨 앞으로 튄다).
    await expect.poll(async () => Math.abs((await doc.evaluate((el) => el.scrollTop / el.scrollHeight)) - ratioBefore)).toBeLessThan(0.08)
  })

  test('확대 대상이 아닌 문서(마크다운)는 핀치·두 번 탭에 반응하지 않는다', async ({ authenticatedPage: page }) => {
    await stubDriveFiles(page, [MD(72)])
    await openViewer(page, '메모72.md')
    const stage = page.getByTestId('viewer-stage')
    await touchPinch(page, await centerOf(stage), 80, 240)
    await expect(stage).toHaveAttribute('data-zoom', '1')
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm exec playwright test e2e/pages/mobile/attachment-viewer-mobile.spec.ts --project=mobile -g "핀치·두 번 탭"`
Expected: FAIL — `data-zoom` 이 1 에서 바뀌지 않음.

- [ ] **Step 3: 훅에 핀치·두 번 탭 추가**

`useViewerGestures.ts`:

1) import 에 `doubleTapTarget`, `isDoubleTap`, `pinchZoom` 추가.

2) 옵션 필드:

```ts
  /** 핀치·두 번 탭 확대 대상 형식인가(이미지·PDF, 사용 가능 항목). */
  zoomable: boolean
  /** 확대 확정 — focus 는 확대 스크롤 영역([data-hscroll]) 왼쪽 위 기준 좌표(px). 이 점이 제자리에 남게 호출부가 스크롤을 맞춘다. */
  onZoom: (next: number, focus: { x: number; y: number }) => void
```

3) `Track` 에 핀치 추가:

```ts
/** 두 손가락 핀치 — 시작 거리·배율·중점(화면 좌표). 진행 중엔 무대 scale 미리보기만(판정 R1). */
interface Pinch {
  kind: 'pinch'
  startDist: number
  startZoom: number
  midX: number
  midY: number
  scale: number
}
type Track = OneFinger | Pinch | { kind: 'ignore' } | null
```

4) 효과 본문에 도우미:

```ts
    /** 두 손가락 거리·중점. */
    const twoFinger = (e: TouchEvent) => {
      const [a, b] = [e.touches[0], e.touches[1]]
      return { dist: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), midX: (a.clientX + b.clientX) / 2, midY: (a.clientY + b.clientY) / 2 }
    }
    /** 화면 좌표 → 확대 스크롤 영역 기준 좌표(없으면 무대 기준). */
    const toScrollerPoint = (x: number, y: number) => {
      const el = stage.querySelector<HTMLElement>('[data-hscroll]') ?? stage
      const r = el.getBoundingClientRect()
      return { x: x - r.left, y: y - r.top }
    }
    let lastTap: Sample | null = null
```

5) `handleTap` 교체(두 번 탭 분기를 앞에):

```ts
    const handleTap = (s: Sample) => {
      const o = latest.current
      if (o.zoomable && isDoubleTap(lastTap, s)) {
        // 두 번 탭 — 대기 중인 단일 탭(바 토글)을 취소하고 1× ↔ 2×(탭 지점 기준).
        clearTimeout(tapTimer)
        lastTap = null
        o.onZoom(doubleTapTarget(o.zoom), toScrollerPoint(s.x, s.y))
        return
      }
      lastTap = s
      clearTimeout(tapTimer)
      tapTimer = setTimeout(() => {
        lastTap = null
        latest.current.onTap?.()
      }, DOUBLE_TAP_MS)
    }
```

6) `onStart` 맨 앞을 교체 — 두 손가락이면 핀치로:

```ts
    const onStart = (e: TouchEvent) => {
      const target = e.target as Element
      const o = latest.current
      if (e.touches.length === 2 && o.zoomable && !target.closest(INTERACTIVE)) {
        // 스와이프 중 두 번째 손가락이 닿았으면 넘김을 원위치하고 핀치로 이어간다(Review Focus 3).
        if (track?.kind === 'one' && track.lock === 'swipe') paint(0, 0)
        const f = twoFinger(e)
        track = { kind: 'pinch', startDist: f.dist, startZoom: o.zoom, midX: f.midX, midY: f.midY, scale: 1 }
        return
      }
      if (e.touches.length !== 1 || target.closest(INTERACTIVE)) {
        if (track?.kind === 'one' && track.lock === 'swipe') settle()
        track = { kind: 'ignore' }
        return
      }
      // …(이하 Task 5 의 한 손가락 시작 그대로)
```

7) `onMove` 맨 앞에:

```ts
      if (track?.kind === 'pinch') {
        if (e.touches.length !== 2) return
        // 브라우저 페이지 확대를 막고 무대에 scale 미리보기만 건다 — PDF 캔버스는 손을 뗄 때 한 번만 다시 그린다(판정 R1).
        if (e.cancelable) e.preventDefault()
        const f = twoFinger(e)
        track.scale = pinchZoom(track.startZoom, track.startDist, f.dist) / track.startZoom
        const r = stage.getBoundingClientRect()
        stage.style.transition = ''
        stage.style.transformOrigin = `${track.midX - r.left}px ${track.midY - r.top}px`
        stage.style.transform = `scale(${track.scale})`
        return
      }
```

8) `onEnd` 맨 앞(`const cur = track` 다음)에:

```ts
      if (cur?.kind === 'pinch') {
        // 한 손가락이라도 떼면 확정 — 남은 손가락은 다 뗄 때까지 무시(팬·넘김으로 튀지 않게).
        track = e.touches.length === 0 ? null : { kind: 'ignore' }
        stage.style.transform = ''
        stage.style.transformOrigin = ''
        const next = +(cur.startZoom * cur.scale).toFixed(2)
        if (next !== cur.startZoom) latest.current.onZoom(next, toScrollerPoint(cur.midX, cur.midY))
        return
      }
```

9) cleanup 에 `stage.style.transformOrigin = ''` 추가.

- [ ] **Step 4: `AttachmentViewer` — 확대 확정 + 기준점 스크롤**

1) import 에 `useLayoutEffect`, `anchorScroll`.

2) `zoomReset` 아래에:

```tsx
  // 터치 확대 기준점 — 커밋 직후(레이아웃 반영 뒤) 그 점이 제자리에 남도록 스크롤을 맞춘다(판정 R1).
  const zoomAnchor = useRef<{ from: number; to: number; focus: { x: number; y: number }; left: number; top: number } | null>(null)
  /**
   * 핀치·두 번 탭 확정 — 배율을 바꾸고 기준점과 "바뀌기 전" 스크롤 위치를 기억한다.
   * 왜 전 위치를 미리 재나: 축소하면 내용이 먼저 줄어 브라우저가 scrollLeft/Top 을 새 최대값으로 잘라 버려, 레이아웃 뒤에 읽으면 틀린 기준이 된다.
   */
  const zoomAt = (next: number, focus: { x: number; y: number }) => {
    if (next === zoom) return
    const el = stage?.querySelector<HTMLElement>('[data-hscroll]')
    zoomAnchor.current = { from: zoom, to: next, focus, left: el?.scrollLeft ?? 0, top: el?.scrollTop ?? 0 }
    setZoom(() => next)
  }
  useLayoutEffect(() => {
    const a = zoomAnchor.current
    if (!a || a.to !== zoom || !stage) return
    zoomAnchor.current = null
    // 이미지 = 본문 자신, PDF = pdf-document — 둘 다 확대 스크롤 영역 표식(data-hscroll)을 단다(판정 R4).
    const el = stage.querySelector<HTMLElement>('[data-hscroll]')
    if (!el) return
    const s = anchorScroll({ scrollLeft: a.left, scrollTop: a.top, focusX: a.focus.x, focusY: a.focus.y, from: a.from, to: a.to })
    el.scrollLeft = s.left
    el.scrollTop = s.top
  }, [zoom, stage])
```

3) 제스처 훅 옵션에 `zoomable, onZoom: zoomAt` 추가.

- [ ] **Step 5: 통과 확인**

Run:
```bash
pnpm exec playwright test e2e/pages/mobile/attachment-viewer-mobile.spec.ts --project=mobile
pnpm exec playwright test e2e/pages/drive/ --project=chromium
pnpm typecheck && npx tsc -p tsconfig.e2e.json --noEmit && pnpm lint
```
Expected: 모두 PASS. 데스크톱 ＋/－/0·Ctrl+휠 확대 회귀 없음(`attachment-viewer.spec.ts` 의 zoom.pdf 케이스).

- [ ] **Step 6: 커밋**

```bash
git add apps/workplace-web/src/components/viewer/useViewerGestures.ts apps/workplace-web/src/components/viewer/AttachmentViewer.tsx apps/workplace-web/e2e/pages/mobile/attachment-viewer-mobile.spec.ts
git commit --no-verify -m "$(cat <<'EOF'
feat(web): 터치로 이미지와 PDF 를 핀치·두 번 탭으로 확대한다 (WP-278)

- WP-278
- 핀치 중에는 화면 배율 미리보기만 하고 손을 뗄 때 기존 확대 배율에 한 번 반영해 PDF 페이지를 그 배율로 선명하게 다시 그린다
- 두 번 탭은 맞춤과 2배를 오가고, 두 손가락 중점이나 탭 지점이 제자리에 남도록 스크롤을 맞춘다
- 새 의존성 없이 기존 레이아웃 확대 모델 위에 얹어 키보드 확대·가로 스크롤 양보 규칙과 그대로 맞물린다

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0118pvsRQTanEBAzhsKg7E1o
EOF
)"
```

---

### Task 8: ⤴ 공유·⬇ iOS 저장 — 본문 blob 끌어올리기

**Files:**
- Create: `apps/workplace-web/src/components/viewer/viewerShare.ts`
- Modify: `apps/workplace-web/src/components/viewer/ViewerBody.tsx` (`onSource`)
- Modify: `apps/workplace-web/src/components/viewer/AttachmentViewer.tsx`
- Test: `apps/workplace-web/e2e/pages/mobile/attachment-viewer-mobile.spec.ts` (테스트 추가)

**Interfaces:**
- Consumes: `resolveShareState`, `resolveSaveMethod`, `actionSlots` (Task 2); `isIOSDevice`, `isStandaloneDisplay` (Task 2 `lib/platform`); Task 3 의 `onSlot`·`shareState`
- Produces:
  - `canShareApi(): boolean`, `canShareFile(file: File): boolean`, `shareFile(file: File): Promise<void>` (`viewerShare.ts`)
  - `ViewerBody` 새 prop `onSource?: (s: { key: string; blob: Blob | null; fetches: boolean }) => void`

- [ ] **Step 1: 실패하는 E2E 추가**

spec 파일 끝에:

```ts
/** Web Share 를 흉내 낸다 — 호출된 파일을 window.__shared 에 기록. mode='abort' 면 사용자가 취소한 것처럼 AbortError. */
async function stubWebShare(page: Page, mode: 'ok' | 'abort' = 'ok', opts: { standalone?: boolean } = {}) {
  await page.addInitScript(
    ([m, standalone]) => {
      const w = window as unknown as { __shared: { name: string; type: string; size: number }[] }
      w.__shared = []
      Object.defineProperty(navigator, 'canShare', { configurable: true, value: (d?: { files?: File[] }) => !!d?.files?.length })
      Object.defineProperty(navigator, 'share', {
        configurable: true,
        value: async (d: { files: File[] }) => {
          w.__shared.push(...d.files.map((f) => ({ name: f.name, type: f.type, size: f.size })))
          if (m === 'abort') throw new DOMException('cancel', 'AbortError')
        },
      })
      if (standalone) Object.defineProperty(navigator, 'standalone', { configurable: true, value: true })
    },
    [mode, !!opts.standalone] as const,
  )
}
const shared = (page: Page) => page.evaluate(() => (window as unknown as { __shared: unknown[] }).__shared)

test.describe('공유·저장', () => {
  test('blob 이 오기 전엔 "받는 중" 비활성, 오면 공유 시트에 그 파일을 넘긴다', async ({ authenticatedPage: page }) => {
    await stubWebShare(page)
    await stubDriveFiles(page, [{ ...IMG(70, 'site.png'), delayMs: 1500 }])
    await page.goto(`/drive/spaces/${SPACE_ID}`)
    await page.getByRole('button', { name: 'site.png', exact: true }).tap()
    const share = page.getByTestId('viewer-slot-share')
    await expect(share).toBeDisabled()
    await expect(share).toHaveAccessibleName('공유 (받는 중)')
    await expect(share).toBeEnabled({ timeout: 10_000 })
    await share.tap()
    await expect.poll(() => shared(page)).toEqual([{ name: 'site.png', type: 'image/png', size: solidPng(800, 600).length }])
  })

  test('공유 시트를 취소해도 오류 토스트가 뜨지 않는다', async ({ authenticatedPage: page }) => {
    await stubWebShare(page, 'abort')
    await stubDriveFiles(page, [IMG(70)])
    await openViewer(page, '사진70.png')
    await page.getByTestId('viewer-slot-share').tap()
    await expect.poll(async () => (await shared(page)).length).toBe(1)
    // eslint-disable-next-line playwright/no-wait-for-timeout -- 취소 뒤 토스트가 "뜨지 않음" 부재 확인이라 조건 대기로 바꿀 수 없다
    await page.waitForTimeout(500)
    await expect(page.getByText('공유하지 못했습니다')).toHaveCount(0)
  })

  test('blob 을 받지 않는 형식(미지원 zip)은 받는 중이 아니라 "공유할 수 없음"', async ({ authenticatedPage: page }) => {
    await stubWebShare(page)
    await stubDriveFiles(page, [{ id: 79, name: 'pack.zip', mimeType: 'application/zip', body: 'PK' }])
    await page.goto(`/drive/spaces/${SPACE_ID}`)
    await page.getByRole('button', { name: 'pack.zip', exact: true }).tap()
    await expect(page.getByTestId('preview-unsupported')).toBeVisible()
    await expect(page.getByTestId('viewer-slot-share')).toHaveAccessibleName('공유할 수 없음')
    await expect(page.getByTestId('viewer-slot-share')).toBeDisabled()
  })

  test('iOS 홈 화면 앱은 ⬇ 저장이 공유 시트로 간다(blob 이 있을 때)', async ({ authenticatedPage: page }) => {
    await stubWebShare(page, 'ok', { standalone: true })
    await stubDriveFiles(page, [MD(72, 'note.md')])
    await openViewer(page, 'note.md')
    await expect(page.getByTestId('preview-body')).toContainText('본문')
    await page.getByTestId('preview-download').tap()
    await expect.poll(() => shared(page)).toEqual([expect.objectContaining({ name: 'note.md' })])
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm exec playwright test e2e/pages/mobile/attachment-viewer-mobile.spec.ts --project=mobile -g "공유·저장"`
Expected: FAIL — 공유 칸이 계속 `공유할 수 없음`(Task 3 의 임시 상태).

- [ ] **Step 3: 공유 도우미**

`src/components/viewer/viewerShare.ts`:

```ts
// Web Share 로 파일 공유(WP-278, 스펙 §5.4). 판정은 viewerActions(순수), 여기는 브라우저 API 호출만.
import { toast } from 'sonner'

/** 파일 공유 API 가 있는가(share + canShare). 데스크톱 Firefox 등은 없다. */
export function canShareApi(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.share === 'function' && typeof navigator.canShare === 'function'
}

/** 이 파일을 공유할 수 있는가 — 플랫폼이 형식을 거부하면(Android 의 docx·xlsx 등) 거짓. 예외는 거짓으로. */
export function canShareFile(file: File): boolean {
  try {
    return canShareApi() && navigator.canShare({ files: [file] })
  } catch {
    return false
  }
}

/**
 * 공유 시트를 연다. 반드시 사용자 제스처(클릭) 핸들러 안에서 await 없이 바로 부른다 — await 뒤 호출은 NotAllowedError.
 * 사용자가 시트를 닫은 취소(AbortError)는 정상 흐름이라 조용히 끝낸다.
 */
export async function shareFile(file: File): Promise<void> {
  try {
    await navigator.share({ files: [file] })
  } catch (e) {
    if ((e as DOMException)?.name === 'AbortError') return
    toast.error('공유하지 못했습니다')
  }
}
```

- [ ] **Step 4: `ViewerBody` blob 상태 보고**

props 에 추가:

```tsx
  /**
   * 원본 blob 상태 보고(WP-278) — 모바일 ⤴ 공유는 제스처 직후 동기 호출이 필요해 뷰어가 blob 을 미리 들고 있어야 한다.
   * fetches = 이 항목이 지금 blob 을 받는(받을) 상태인가 — 미지원·사용 불가·10MB 동의 대기·오류면 거짓.
   */
  onSource?: (s: { key: string; blob: Blob | null; fetches: boolean }) => void
```

본문(`const error = …` 아래)에:

```tsx
  // 부모(뷰어)에 blob 상태를 알린다 — 콜백은 최신값 ref 로 읽어 이펙트가 콜백 정체성에 흔들리지 않게.
  const onSourceRef = useRef(onSource)
  useEffect(() => {
    onSourceRef.current = onSource
  })
  const fetches = renderable && !item.unavailable && confirmSize == null && !error
  useEffect(() => {
    onSourceRef.current?.({ key: item.key, blob, fetches })
  }, [item.key, blob, fetches])
```
(import 에 `useRef` 추가.)

- [ ] **Step 5: `AttachmentViewer` 공유·저장 연결**

1) import: `useMemo`, `canShareApi`·`canShareFile`·`shareFile`, `resolveSaveMethod`·`resolveShareState`, `isIOSDevice`·`isStandaloneDisplay` from `'../../lib/platform'`.

2) Task 3 의 `const shareState = 'unavailable' as const` 를 교체:

```tsx
  // 현재 항목 blob — 항목 key 와 함께 들어 다른 항목으로 넘기면 자동으로 무시된다(zoomState 와 같은 방식).
  const [source, setSource] = useState<{ key: string; blob: Blob | null; fetches: boolean } | null>(null)
  const cur = source?.key === itemKey ? source : null
  const blob = cur?.blob ?? null
  // 공유할 File — blob 이 바뀔 때만 만든다(canShare 판정·공유 호출에 같은 객체를 쓴다).
  const file = useMemo(
    () => (blob ? new File([blob], item.name, { type: item.mimeType || blob.type }) : null),
    [blob, item.name, item.mimeType],
  )
  const fileShareable = file != null && canShareFile(file)
  const shareState = resolveShareState({ supported: canShareApi(), fetches: cur?.fetches ?? true, blobReady: file != null, canShareFile: fileShareable })
```
(`cur` 가 아직 없으면 = ViewerBody 첫 보고 전 → `fetches: true` 로 "받는 중" 표시. 미지원 형식은 첫 이펙트에서 곧바로 `fetches:false` 가 와서 "공유할 수 없음"이 된다.)

3) `onSlot` 교체:

```tsx
  /**
   * 하단 칸 누름. 공유·iOS 저장은 클릭 핸들러 안에서 await 없이 바로 공유 시트를 연다(제스처 직후 호출 규칙, 스펙 §5.4).
   * 저장 기본은 downloadPath(드라이브 = 감사 로그 경로)로 다시 받는다 — iOS 홈 화면 앱만 메모리 blob 을 공유 시트로(판정 R13).
   */
  const onSlot = (id: SlotId) => {
    if (id === 'share') {
      if (file && fileShareable) void shareFile(file)
    } else if (id === 'save') {
      const method = resolveSaveMethod({ iosStandalone: isIOSDevice() && isStandaloneDisplay(), blobReady: file != null, canShareFile: fileShareable })
      if (method === 'share' && file) void shareFile(file)
      else void downloadViewerItem(item)
    } else if (id === 'drive') startImport()
    else if (id === 'summary') togglePanel(!panelOpen)
  }
```

4) `<ViewerBody …>` 에 `onSource={setSource}` 추가.

- [ ] **Step 6: 통과 확인**

Run:
```bash
pnpm exec playwright test e2e/pages/mobile/attachment-viewer-mobile.spec.ts --project=mobile
pnpm exec playwright test e2e/pages/drive/ e2e/pages/projects/attachments.spec.ts --project=chromium
pnpm test && pnpm typecheck && npx tsc -p tsconfig.e2e.json --noEmit && pnpm lint
```
Expected: 모두 PASS. Task 3 의 "⬇ 저장은 파일을 내려받는다"(iPhone UA, standalone 아님)는 여전히 download 이벤트.

- [ ] **Step 7: 커밋**

```bash
git add apps/workplace-web/src/components/viewer/viewerShare.ts apps/workplace-web/src/components/viewer/ViewerBody.tsx apps/workplace-web/src/components/viewer/AttachmentViewer.tsx apps/workplace-web/e2e/pages/mobile/attachment-viewer-mobile.spec.ts
git commit --no-verify -m "$(cat <<'EOF'
feat(web): 모바일 뷰어에서 받은 파일을 공유 시트로 공유하고 iOS 홈 화면 앱은 공유로 저장한다 (WP-278)

- WP-278
- 공유는 제스처 직후에만 호출할 수 있어 본문이 받은 blob 을 뷰어로 올려 두고, 도착 전에는 받는 중으로 비활성화한다
- blob 을 받지 않는 형식이나 플랫폼이 거부하는 형식은 공유할 수 없음으로 구분하고, 사용자가 시트를 닫은 취소는 오류로 알리지 않는다
- iOS 홈 화면 앱은 다운로드 링크가 불안정해 저장을 공유 시트로 보내고, 그 외는 감사 로그가 남는 기존 다운로드를 쓴다

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0118pvsRQTanEBAzhsKg7E1o
EOF
)"
```

---

## 최종 검증 (모든 Task 후)

- [ ] 전체 회귀:
```bash
cd /Users/bluleo78/git/smart-workplace/.claude/worktrees/wp-278-viewer-mobile/apps/workplace-web
pnpm test && pnpm typecheck && npx tsc -p tsconfig.e2e.json --noEmit && pnpm lint
E2E_SERVER=preview pnpm exec playwright test --project=mobile
E2E_SERVER=preview pnpm exec playwright test e2e/pages/drive e2e/pages/projects --project=chromium
```
- [ ] 시안 대비 실제 스크린샷(`test-results/exploratory/viewer-mobile/<timestamp>/screenshots/`): 390 세로 이미지·PDF(M1), 아래로 끌기 중(M2), 요약 시트 반/펼침(M4), 844 가로 바 숨김·표시(M5), iPad 1180 가로. 시안 `revised-viewer.html` 과 나란히 비교.
- [ ] 실기기 점검표(스펙 §8.4 중 이 PR 분 — chromium 이 에뮬레이트하지 못하는 항목):
  - iOS Safari·iOS 홈 화면 앱: 노치·홈 인디케이터 여백(safe-area), 상태바 검정·닫으면 복원, 가장자리 뒤로가기와 스와이프 공존, 문서 맨 위 당기기 = 닫기(스크롤 바운스와 겹침 없음), 핀치가 페이지 확대가 아니라 뷰어 확대, ⬇ 저장(홈 화면 앱 = 공유 시트 "파일에 저장"), ⤴ 공유, PDF 확대 후 선명함.
  - Android Chrome: 뒤로가기 = 뷰어만 닫힘, 맨 위 당기기에서 당겨서 새로고침이 일어나지 않음, docx/xlsx 공유 불가 시 ⤴ "공유할 수 없음".
  - iPad 가로: 데스크톱 배치 + 스와이프·핀치·두 번 탭·아래로 닫기, 버튼 44px, 탭해도 헤더가 숨지 않음(R5).

## 위험·알려진 한계

- **R2 의 iOS 동작은 chromium 으로 검증되지 않는다** — iOS 는 첫 touchmove 이후 스크롤이 시작되면 `preventDefault` 를 무시한다. `LOCK_SLOP_PX=6` 이 iOS 스크롤 시작 임계보다 작다는 가정에 기대므로 실기기에서 문서 위 가로 스와이프·맨 위 당기기를 꼭 본다. 어긋나면 `LOCK_SLOP_PX` 를 줄이는 것이 1차 조정점.
- **HTML·DOCX(iframe) 위에서는 제스처가 없다**(R16) — ‹ › 로 넘긴다. 후속으로 iframe 위 투명 무대가 필요할 수 있다.
- **iOS 홈 화면 앱의 ⬇ 공유 저장은 드라이브 다운로드 감사 로그를 남기지 않는다**(R13, 미리보기 blob 사용).
- 미지원 형식(zip 등)은 미리보기 blob 을 받지 않으므로 ⤴ 는 항상 "공유할 수 없음"(⬇ 는 가능). 공유가 필요해지면 모바일에서만 미지원 형식도 미리 받는 후속을 검토.
- `useViewerGestures` 는 끌기 중 무대 style 을 직접 쓴다 — React 가 같은 요소의 `style` prop 을 관리하지 않게(무대에 `style` prop 금지) 유지해야 한다.
