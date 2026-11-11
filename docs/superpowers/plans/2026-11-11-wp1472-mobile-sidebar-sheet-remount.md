# WP-1472 MobileSidebarSheet — lg 경계에서 본문 재마운트 막기 — 구현 계획(최종)

## 문제
`components/mobile/MobileSidebarSheet.tsx` 는 isMobile 에 따라 루트 요소 종류가 달랐다(데스크톱: Fragment, 모바일: MobileSidebarSheetCtx.Provider).
그래서 폭이 lg(1024px) 경계를 넘으면 children(본문)이 다시 마운트돼 메일·연락처·캘린더에서 열린 창·미저장 입력이 사라졌다.
캘린더는 본문 안에서도 GridView 를 모바일에서만 `calendar-swipe-area` div 로 감싸 따로 재마운트됐다.

## 최종 설계
1. MobileSidebarSheet: 공급자를 늘 최상위에 두고 첫 자식만 바꾼다 — `{isMobile ? <Sheet…/> : <ResizableSidebar…/>}{children}`.
   children 은 같은 부모의 같은 자리라 그대로 마운트돼 있다(WP-1468 의 PageHost·NodeSlot 같은 DOM 옮기기는 필요 없음).
   Sheet 는 자기 DOM 이 없고 내용은 포털이라 부모 flex 배치는 그대로다.
   - 값: 모바일이면 시트 값, 데스크톱이면 바깥 컨텍스트 값을 그대로 통과(보통 null → ☰ 없음, 예전과 같다).
   - 경계를 넘으면 렌더 중 이전 값 비교로 시트를 닫는다(연 채 데스크톱 갔다 돌아왔을 때 시트가 본문을 덮지 않게).
2. CalendarPage: GridView 래퍼 div 를 늘 렌더 — 데스크톱은 `contents`(display: contents)·핸들러·testid 없음, 모바일은 기존 그대로.

## 테스트
- vitest MobileSidebarSheet.test.tsx: 경계 왕복에도 본문 입력 유지, ☰ 는 모바일만, 왕복 뒤 시트 닫힘, 데스크톱은 바깥 컨텍스트 통과.
- @layout E2E: 연락처(새 연락처 창 입력 유지 + 실제 matchMedia 로 왕복 뒤 시트 닫힘), 캘린더(주간 격자 DOM 유지).
- 범위 밖: 사이드바 자체 로컬 상태(데스크톱 인라인 vs 모바일 시트라 경계에서 재마운트).
