import { FolderKanban } from 'lucide-react'

import { Skeleton } from '@/components/ui/skeleton'
import { useProjectMembers } from '@/hooks/queries/useProjectMembers'
import { useProject } from '@/hooks/queries/useProjects'

import { WidgetError } from './WidgetError'
import { WidgetFrame } from './WidgetFrame'

/**
 * #460: 프로젝트 상세 위젯 — show_project 지시를 받아 단일 프로젝트 상세와 멤버를 표시한다.
 * params.projectKey 누락/빈 문자열 시 재시도 없는 안내 메시지(정적 파라미터 오류, 재시도 무의미).
 * fetch 실패 시에는 WidgetError(onRetry) 로 재시도 허용.
 */
export default function ProjectWidget({ params }: { params?: Record<string, unknown> }) {
  const projectKey =
    typeof params?.projectKey === 'string' && params.projectKey.trim() !== ''
      ? params.projectKey.trim()
      : null

  // projectKey 누락 — 정적 파라미터 오류: 재시도 버튼 없이 안내 메시지만 표시.
  if (projectKey === null) {
    return (
      <WidgetFrame title="프로젝트 상세">
        <div
          className="flex flex-col items-center gap-2 px-4 py-8 text-center"
          data-testid="project-error"
        >
          <FolderKanban className="h-8 w-8 text-muted-foreground" />
          <p className="text-sm font-semibold">프로젝트 키가 없습니다</p>
          <p className="max-w-xs text-xs text-muted-foreground">
            프로젝트 키를 지정하여 다시 요청해 보세요.
          </p>
        </div>
      </WidgetFrame>
    )
  }

  // projectKey 존재 — ProjectDetailContent 에서 훅을 호출(early return 이후 조건부 훅 금지 우회).
  return <ProjectDetailContent projectKey={projectKey} />
}

/** projectKey 가 확정된 경우의 데이터 로드·렌더 분리 컴포넌트(훅 규칙 준수). */
function ProjectDetailContent({ projectKey }: { projectKey: string }) {
  const project = useProject(projectKey)
  const members = useProjectMembers(projectKey)

  if (project.isLoading || members.isLoading) {
    return (
      <WidgetFrame title="프로젝트 상세">
        <Skeleton className="h-24 w-full" />
      </WidgetFrame>
    )
  }
  if (project.isError) {
    return (
      <WidgetFrame title="프로젝트 상세">
        <WidgetError onRetry={() => project.refetch()} testId="project-error" />
      </WidgetFrame>
    )
  }
  if (members.isError) {
    return (
      <WidgetFrame title="프로젝트 상세">
        <WidgetError onRetry={() => members.refetch()} testId="project-error" />
      </WidgetFrame>
    )
  }

  const detail = project.data
  if (!detail) return null

  const memberList = members.data ?? []

  return (
    <WidgetFrame title="프로젝트 상세">
      <div className="flex flex-col gap-3 p-1" data-testid="project-detail">
        {/* 프로젝트명 + 키 */}
        <div className="flex items-center gap-2">
          <FolderKanban className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="font-medium text-sm">{detail.name}</span>
          <span className="text-xs text-muted-foreground">({detail.key})</span>
        </div>
        {/* 설명 */}
        {detail.description && (
          <p className="line-clamp-3 text-xs text-muted-foreground">{detail.description}</p>
        )}
        {/* 멤버 목록 */}
        {memberList.length > 0 && (
          <div className="flex flex-col gap-1">
            <p className="text-xs font-medium text-muted-foreground">멤버 {memberList.length}명</p>
            <ul className="divide-y">
              {memberList.map((m) => (
                <li key={m.userId} className="flex items-center gap-2 py-1">
                  {/* 멤버명 */}
                  <span className="text-xs font-medium">{m.name}</span>
                  {/* 역할 */}
                  <span className="text-xs text-muted-foreground">
                    {m.role === 'OWNER' ? '소유자' : '멤버'}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </WidgetFrame>
  )
}
