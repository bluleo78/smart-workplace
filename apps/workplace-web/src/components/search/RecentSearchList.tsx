// 빈 입력일 때 보이는 「최근 검색」(WP-1353) — 이 브라우저에 저장된 최대 5개. 누르면 입력에 들어가 바로 조회된다.
// 글자가 있는데 아직 검색할 만큼 길지 않으면(한 글자) 안내만 보인다.
import { useState } from 'react'

import { clearRecent, loadRecent } from './recentSearches'

export function RecentSearchList({ hasInput, onPick }: { hasInput: boolean; onPick: (q: string) => void }) {
  const [recent, setRecent] = useState(loadRecent)
  if (hasInput) {
    return <p className="px-3 py-6 text-center text-xs text-muted-foreground">두 글자 이상 입력하면 찾아요</p>
  }
  if (recent.length === 0) {
    return <p className="px-3 py-6 text-center text-xs text-muted-foreground">대화·메일·작업·드라이브·노트·연락처를 한 번에 찾아요</p>
  }
  return (
    <div className="p-2" data-testid="global-search-recent">
      <div className="flex items-center justify-between px-1 pb-1">
        <h3 className="text-xs font-medium text-muted-foreground">최근 검색</h3>
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            clearRecent()
            setRecent([])
          }}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          지우기
        </button>
      </div>
      <ul>
        {recent.map((r, i) => (
          <li key={r}>
            <button
              type="button"
              data-testid={`global-search-recent-${i}`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onPick(r)}
              className="w-full truncate rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
            >
              {r}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
