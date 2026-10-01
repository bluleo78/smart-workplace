// 탭 루트 안의 "로컬 상세"(메일 본문·연락처 상세) 목록 복귀 바.
// 이 상세들은 URL 이 탭 루트 그대로라 MobileBackBar 가 없고 탭바만 숨는다(useHideTabBar) → AI 진입점이 사라지므로
// 모바일에선 ‹ 목록 옆에 ✦ 를 함께 둔다. 데스크톱(≥lg)은 기존 버튼 마크업(lg:hidden) 그대로 — DOM 불변.
import { useIsMobile } from '@/hooks/useIsMobile'

import { DetailAiButton } from './DetailAiButton'

const legacyClass = 'flex items-center gap-1 border-b px-4 py-2 text-sm text-primary lg:hidden'

export function ListBackRow({ onBack, 'data-testid': testId }: { onBack: () => void; 'data-testid': string }) {
  const isMobile = useIsMobile()
  if (!isMobile) {
    return (
      <button type="button" data-testid={testId} onClick={onBack} className={legacyClass}>
        ‹ 목록
      </button>
    )
  }
  return (
    <div className="flex shrink-0 items-center border-b">
      <button type="button" data-testid={testId} onClick={onBack} className="flex min-h-11 flex-1 items-center gap-1 px-4 text-sm text-primary">
        ‹ 목록
      </button>
      <DetailAiButton data-testid="mobile-detail-ai" />
    </div>
  )
}
