// 상단 검색 트리거(WP-1353) — 30px 원형 🔍 버튼과 그것이 여는 가운데 팔레트를 한 덩어리로 둔다.
// 버튼 크기는 TopCenterSlot 의 108px 계산(칩 반폭 70 + 간격 8 + 이 아이콘 30)과 맞물리므로 바꾸면 그쪽도 고친다.
// 팔레트는 Radix 포털로 뜨므로 이 틀의 크기·위치에 영향이 없다.
import { Search } from 'lucide-react'

import { SearchPalette } from './SearchPalette'
import { useSearchPalette } from './useSearchPalette'

export function SearchTrigger() {
  const { open, setOpen } = useSearchPalette()
  return (
    <>
      <button
        type="button"
        data-testid="global-search-toggle"
        aria-label="검색 (/)"
        title="검색 (/)"
        // 열린 채 다시 눌러도 팔레트의 「바깥 누름」으로 닫혔다가 click 으로 다시 열리지 않게(깜빡임·검색어 초기화) 누름 단계에서 막는다.
        // 팔레트의 바깥 누름 감지는 document 의 pointerdown 이라 전파를 끊어야 닿지 않는다.
        onPointerDown={(e) => {
          if (open) e.stopPropagation()
        }}
        onClick={() => setOpen(true)}
        className="inline-flex h-[30px] w-[30px] items-center justify-center rounded-full border bg-card/90 text-muted-foreground shadow-md backdrop-blur hover:text-foreground"
      >
        <Search className="h-4 w-4" aria-hidden />
      </button>
      <SearchPalette open={open} onOpenChange={setOpen} />
    </>
  )
}
