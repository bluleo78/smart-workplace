import { Layers } from 'lucide-react'
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
