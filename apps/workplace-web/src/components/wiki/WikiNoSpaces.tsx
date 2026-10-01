import { BookOpen } from 'lucide-react'

import { MobileEmptyState } from '@/components/mobile/MobileEmptyState'
import { Button } from '@/components/ui/button'

/**
 * 노트 스페이스가 하나도 없을 때의 빈 상태(WP-143) — 안내 + [공간 만들기].
 * 모바일 노트 목록(사이드바 자리)과 데스크톱 /wiki 본문이 함께 쓴다. 빈 선택 상자만 보이거나
 * "노트 공간을 준비 중…"에 머무는 대신, 다음 행동(공간 생성)을 바로 제공한다.
 * 생성 다이얼로그는 호출부가 useWikiCreateSpaceDialog 로 소유하고 onCreate 로 연다.
 */
export function WikiNoSpaces({ className, onCreate }: { className?: string; onCreate: () => void }) {
  return (
    <MobileEmptyState
      data-testid="wiki-no-spaces"
      className={className}
      icon={BookOpen}
      title="노트 공간이 없습니다"
      description="공간을 만들면 페이지를 작성하고 팀과 공유할 수 있어요."
      action={
        <Button className="h-11 px-5" onClick={onCreate} data-testid="wiki-no-spaces-create">
          공간 만들기
        </Button>
      }
    />
  )
}
