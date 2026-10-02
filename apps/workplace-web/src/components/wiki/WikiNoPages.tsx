import { FileText } from 'lucide-react'

import { AiLabel } from '@/components/ai/AiLabel'
import { MobileEmptyState } from '@/components/mobile/MobileEmptyState'
import { Button } from '@/components/ui/button'

/**
 * 모바일 노트 목록에서 공간에 페이지가 하나도 없을 때의 빈 상태(WP-179) — 안내 + [새 페이지 만들기]·[AI 초안으로 시작].
 * 모바일은 공간 화면이 목록(페이지 트리)이라 데스크톱 본문 빈 상태(WikiPageView)가 보이지 않으므로, 같은 두 진입점을 여기서 준다.
 * 생성·이동은 호출부가 useCreateWikiPageAndOpen 으로 소유하고 onCreate 로 넘긴다.
 */
export function WikiNoPages({
  className,
  onCreate,
  pending,
}: {
  className?: string
  onCreate: (withAiDraft: boolean) => void
  pending: boolean
}) {
  return (
    <MobileEmptyState
      data-testid="wiki-no-pages"
      className={className}
      icon={FileText}
      title="아직 페이지가 없습니다"
      description="새 페이지를 만들거나 AI 초안으로 시작해 보세요."
      action={
        <div className="flex w-56 flex-col gap-2">
          <Button className="h-11 w-full" onClick={() => onCreate(false)} disabled={pending} data-testid="wiki-no-pages-create">
            새 페이지 만들기
          </Button>
          <Button
            variant="outline"
            className="h-11 w-full"
            onClick={() => onCreate(true)}
            disabled={pending}
            data-testid="wiki-no-pages-ai-draft"
          >
            <AiLabel>AI 초안으로 시작</AiLabel>
          </Button>
        </div>
      }
    />
  )
}
