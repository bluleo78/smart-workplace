// 모바일 헤더 공용 치수 — 탭 루트 큰 제목 헤더(MobileListHeader)와 모바일 PageHeader(탭 루트)가 같은 규격을 쓰게 한다(U1-3).
// 우측 클러스터 순서: [주 액션] [⋯] [☰] [🔔]. 계정 아바타는 앱(/apps) 헤더에만 둔다(결정 사항 — 다른 탭 루트엔 넣지 않음).
// 좌 16px(제목 시작) · 우 4px(44px 아이콘 버튼의 글리프가 우측 약 16px 선에 맞도록) · 높이 56px.
export const mobileRootHeaderClass = 'flex h-14 shrink-0 items-center gap-1 pl-4 pr-1'
/** 탭 루트 제목 — 22px bold. */
export const mobileRootTitleClass = 'min-w-0 flex-1 truncate text-[22px] font-bold tracking-tight'
/** 상세(병합) 헤더 제목 — 17px semibold 한 줄 말줄임. */
export const mobileDetailTitleClass = 'min-w-0 flex-1 truncate text-[17px] font-semibold'
/** 상세 헤더 바 컨테이너 — [‹] [제목] [액션] 한 줄 56px. 병합 상세 헤더(MobileDetailBar)와 이슈 채팅 드로워 헤더가 같은 규격을 쓴다. */
export const mobileDetailBarClass = 'flex h-14 shrink-0 items-center gap-0.5 border-b px-1'
/** 상세 헤더의 ‹ 버튼 — 44px 터치 타깃, 브랜드 색 글리프(ChevronLeft h-6 w-6). */
export const mobileBackButtonClass = 'flex h-11 w-11 shrink-0 items-center justify-center text-primary'
