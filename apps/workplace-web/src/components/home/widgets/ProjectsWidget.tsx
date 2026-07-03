import { FolderKanban } from 'lucide-react'
import { Link } from 'react-router-dom'

import { Skeleton } from '@/components/ui/skeleton'
import { useProjects } from '@/hooks/queries/useProjects'
import type { ProjectResponse } from '@/types/project'

import { WidgetError } from './WidgetError'
import { WidgetFrame } from './WidgetFrame'

/**
 * #460: 프로젝트 목록 위젯 — show_projects 지시를 받아 프로젝트 목록을 표시한다.
 * params: {} (필터 없음, 첫 페이지 최대 20개).
 * 각 항목 클릭 시 /projects/:key 로 이동.
 */
export default function ProjectsWidget({
  previewData,
}: {
  params?: Record<string, unknown>
  previewData?: ProjectResponse[]
}) {
  const { data: queryData, isLoading, isError, refetch } = useProjects(0, 20, { enabled: !previewData })
  const data = previewData ? { content: previewData } : queryData

  if (!previewData && isLoading) {
    return (
      <WidgetFrame title="프로젝트">
        <Skeleton className="h-24 w-full" />
      </WidgetFrame>
    )
  }
  if (!previewData && isError) {
    return (
      <WidgetFrame title="프로젝트">
        <WidgetError onRetry={() => refetch()} testId="projects-error" />
      </WidgetFrame>
    )
  }

  // PageResponse.content 배열에서 최대 20개 추출.
  const items = (data?.content ?? []).slice(0, 20)

  return (
    <WidgetFrame title="프로젝트">
      {items.length > 0 ? (
        <ul className="divide-y" data-testid="projects-items">
          {items.map((project) => (
            <ProjectItem key={project.key} project={project} />
          ))}
        </ul>
      ) : (
        <div
          className="flex flex-col items-center gap-2 px-4 py-8 text-center"
          data-testid="projects-empty"
        >
          <FolderKanban className="h-8 w-8 text-muted-foreground" />
          <p className="text-sm font-semibold">프로젝트가 없어요</p>
          <p className="max-w-xs text-xs text-muted-foreground">
            아직 참여 중인 프로젝트가 없습니다.
          </p>
        </div>
      )}
    </WidgetFrame>
  )
}

/** 단일 프로젝트 행 — N+1 방지를 위해 멤버 수 조회 없이 프로젝트명·키만 표시한다. */
function ProjectItem({ project }: { project: ProjectResponse }) {
  return (
    <li>
      {/* 프로젝트 상세 페이지(/projects/:key)로 딥링크. */}
      <Link
        to={`/projects/${project.key}`}
        aria-label={`프로젝트: ${project.name}`}
        className="flex items-center gap-2 py-2 text-sm hover:text-ai-accent"
      >
        <FolderKanban className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        {/* 프로젝트명 */}
        <span className="flex-1 truncate font-medium">{project.name}</span>
        {/* 프로젝트 키 */}
        <span className="shrink-0 text-xs text-muted-foreground">{project.key}</span>
      </Link>
    </li>
  )
}
