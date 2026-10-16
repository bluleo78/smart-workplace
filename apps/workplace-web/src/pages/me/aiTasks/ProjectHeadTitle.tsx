import { Link } from 'react-router-dom'

import { ProjectBadge } from '@/components/ProjectBadge'

import type { ProjectRun } from './aiTaskGroups'

/** 프로젝트 구간 머리 내용(WP-426) — 컬러 배지 + 이름(프로젝트로 이동) + 키 · 건수. 표 머리 줄과 모바일 머리가 함께 쓴다.
 *  건수는 불러온 행 수가 아니라 서버가 준 프로젝트 전체 건수(run.size) — 무한 스크롤 중에도 안 흔들리게. */
export function ProjectHeadTitle({ run, tid }: { run: ProjectRun; tid: string }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <ProjectBadge projectKey={run.key} className="text-[10px]" />
      <Link to={`/projects/${run.key}`} className="min-w-0 truncate text-sm font-semibold hover:underline" data-testid={`${tid}-name`}>
        {run.name}
      </Link>
      <span className="shrink-0 text-xs text-muted-foreground" data-testid={`${tid}-count`}>{run.key} · {run.size}</span>
    </div>
  )
}
