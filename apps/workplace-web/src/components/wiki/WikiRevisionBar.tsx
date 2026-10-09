import { History } from 'lucide-react'
import { useId } from 'react'

import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'

/**
 * 버전 미리보기 상단 바(WP-282) — "{M월 D일 HH:mm} 버전 미리보기 — 읽기 전용" + 변경 표시 토글 + 닫기 + 이 버전으로 복원.
 * 편집 화면이 아니라는 것을 바 하나로 알린다 — 주의(warning) subtle 배경. 아이콘·문구만 대비가 충분한 warning-text(5.6:1)를 쓰고,
 * 버튼·토글 글자는 각자 색을 쓴다(바 전체에 글자 색을 주면 outline 버튼 "닫기"까지 경고 색을 물려받는다).
 * 복원 버튼은 onRestore 가 있을 때만(편집 권한) 보인다.
 */
export function WikiRevisionBar({
  label,
  showDiff,
  onShowDiffChange,
  onClose,
  onRestore,
  restoring,
}: {
  /** 바 문구 — 판 메타가 아직 없으면 null(문구 없이 컨트롤만). */
  label: string | null
  showDiff: boolean
  onShowDiffChange: (next: boolean) => void
  onClose: () => void
  /** 없으면 복원 버튼을 그리지 않는다(뷰어). */
  onRestore?: () => void
  restoring?: boolean
}) {
  const switchId = useId()
  return (
    <div
      data-testid="wiki-revision-bar"
      role="region"
      aria-label="버전 미리보기"
      className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b bg-warning-subtle px-4 py-2 text-sm"
    >
      <History className="h-4 w-4 shrink-0 text-warning-text" aria-hidden="true" />
      {/* 좁은 노트 칸(1024px + 패널)에선 문구를 자르지 않고 컨트롤이 다음 줄로 내려간다 — 시각이 잘리면 어느 판인지 모른다. */}
      <span data-testid="wiki-revision-bar-label" className="min-w-48 flex-1 font-medium text-warning-text">
        {label}
      </span>
      <div className="flex shrink-0 items-center gap-2">
        <Switch
          id={switchId}
          size="sm"
          checked={showDiff}
          onCheckedChange={onShowDiffChange}
          data-testid="wiki-revision-diff-toggle"
        />
        <Label htmlFor={switchId} className="cursor-pointer text-sm font-normal text-foreground">
          변경 표시
        </Label>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onClose} data-testid="wiki-revision-close">
          닫기
        </Button>
        {onRestore && (
          <Button type="button" size="sm" onClick={onRestore} disabled={restoring} data-testid="wiki-revision-restore">
            이 버전으로 복원
          </Button>
        )}
      </div>
    </div>
  )
}
