// 상단 🔍 트리거가 없는 셸(모바일)에서 통합 검색 팔레트를 그리는 호스트(WP-1356).
// 데스크톱은 SearchTrigger 가 버튼과 팔레트를 함께 그리고, 모바일은 아직 헤더 돋보기(WP-1354)가 없어 팔레트를 그릴 곳이 없다 —
// 그래서 다른 화면이 openSearchPalette({ q, app }) 로 연 팔레트(예: 드라이브 「드라이브 전체에서 찾기」)를 여기서 그린다.
// 「/」 단축키는 걸지 않는다(트리거 쪽 몫). 데스크톱과 같은 스토어를 보므로 두 셸에서 동시에 그리지 않는다(AppLayout 이 하나만 둔다).
import { SearchPalette } from './SearchPalette'
import { closeSearchPalette } from './searchPaletteStore'
import { useSearchPaletteSession } from './useSearchPalette'

export function SearchPaletteHost() {
  const session = useSearchPaletteSession()
  return (
    <SearchPalette
      open={session != null}
      onOpenChange={(next) => {
        if (!next) closeSearchPalette()
      }}
      session={session}
    />
  )
}
