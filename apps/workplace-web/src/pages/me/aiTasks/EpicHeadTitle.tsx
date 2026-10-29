import { Layers, Minus } from 'lucide-react'
import { Link } from 'react-router-dom'

import { ChildProgress } from '@/components/issues/ChildProgress'
import { labelFg } from '@/lib/labelColors'
import { cn } from '@/lib/utils'

import type { EpicHead } from './aiTaskGroups'

/** 에픽 묶음 머리의 제목 조각 「Layers 아이콘 · 키 · 제목 링크 · └ n/m」 — 표 머리 줄과 모바일 머리가 함께 쓴다(부모가 flex 줄을 제공). */
export function EpicHeadTitle({ epic, tid }: { epic: EpicHead; tid: string }) {
  return (
    <>
      <Layers className={cn('size-4 shrink-0', labelFg(epic.type?.colorToken))} aria-hidden="true" />
      <span className="shrink-0 font-mono text-xs text-muted-foreground">{epic.projectKey}-{epic.number}</span>
      <Link to={`/projects/${epic.projectKey}/issues/${epic.number}`} className="min-w-0 truncate font-semibold hover:underline" title={epic.title}>
        {epic.title}
      </Link>
      <ChildProgress done={epic.childDoneCount} total={epic.childCount} testId={`${tid}-child-progress`} />
    </>
  )
}

/** 「에픽 없음」 묶음 머리의 제목 조각 「회색 대시 · 에픽 없음 · n건」(WP-1211) — 에픽이 없어 링크·하위 진행 없이 필터 적용 후 건수만. */
export function NoEpicHeadTitle({ size, tid }: { size: number; tid: string }) {
  return (
    <>
      <Minus className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className="min-w-0 truncate font-semibold text-muted-foreground">에픽 없음</span>
      <span className="shrink-0 text-xs text-muted-foreground" data-testid={`${tid}-count`}>{size}건</span>
    </>
  )
}
