// 「본문 바로가기」 링크(WP-815) — 데스크톱 셸의 첫 Tab 위치. 평소엔 숨어 있다가 키보드 포커스를 받으면 왼쪽 위에 보이고,
// 누르면 본문(<main>)으로 포커스를 옮긴다. 없을 땐 화면을 열 때마다 레일·상단 버튼 13개를 지나야 본문에 닿았다(WCAG 2.4.1).
// 모바일 셸은 본문이 탭바보다 앞이라 두지 않는다.

/** 본문 영역 id — AppLayout 의 <main> 이 같은 값을 쓴다. */
export const MAIN_CONTENT_ID = 'main-content'

export function SkipToMainLink() {
  return (
    <a
      href={`#${MAIN_CONTENT_ID}`}
      data-testid="skip-to-main"
      // 해시 이동 대신 직접 포커스 — 주소에 #main-content 가 붙지 않게 하고, 스크롤 컨테이너 안에서도 확실히 옮긴다.
      onClick={(e) => {
        e.preventDefault()
        document.getElementById(MAIN_CONTENT_ID)?.focus()
      }}
      className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[100] focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-foreground focus:shadow-md focus:outline-none focus:ring-2 focus:ring-ring"
    >
      본문 바로가기
    </a>
  )
}
