import { useWikiCreateSpaceDialog } from '@/components/wiki/useWikiCreateSpaceDialog'
import { WikiNoSpaces } from '@/components/wiki/WikiNoSpaces'

import { useWikiIndexRedirect } from '../../hooks/useWikiIndexRedirect'

/**
 * /wiki 진입 처리(데스크톱) — 앱 레일·홈 위젯 등 노트 앱의 모든 진입점이 거친다.
 * 마지막으로 본 페이지 복원 → 없으면 첫 스페이스로 이동(useWikiIndexRedirect).
 * 스페이스가 하나도 없으면 빈 상태 + [공간 만들기] — 이동할 곳이 없어 "준비 중…"에 멈추던 문제(WP-143).
 * 모바일은 /wiki 가 목록 화면이라 이 컴포넌트 대신 WikiModuleLayout 이 같은 훅으로 스페이스 목록에 보낸다(WP-178).
 */
export function WikiIndexRedirect() {
  const { spaces, isLoading, restorePending } = useWikiIndexRedirect({ enabled: true, target: 'page' })
  // 공간 0개 빈 상태의 [공간 만들기] — 생성 후 새 스페이스로 이동한다.
  const { openCreateSpace, dialog: createSpaceDialog } = useWikiCreateSpaceDialog()

  if (isLoading || restorePending) return <div className="p-6 text-sm text-muted-foreground">불러오는 중…</div>
  if (spaces?.length === 0) {
    return (
      <>
        <WikiNoSpaces className="h-full" onCreate={openCreateSpace} />
        {createSpaceDialog}
      </>
    )
  }
  return <div className="p-6 text-sm text-muted-foreground">노트 공간을 준비 중…</div>
}
