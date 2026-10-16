// 프로젝트 컬러 배지(WP-426) — 키 첫 글자를 key 해시 색 위에 얹는다. 사이드바 프로젝트 항목과 AI 위임 작업 프로젝트 머리가 함께 쓴다.
import { projectColor, projectInitial } from '@/lib/project-color'
import { cn } from '@/lib/utils'

/** 백엔드에 색상 필드가 없어 key 해시로 결정적 컬러를 만든다(아이콘 일관성). 장식이라 스크린리더에서는 숨긴다. */
export function ProjectBadge({ projectKey, className }: { projectKey: string; className?: string }) {
  const c = projectColor(projectKey)
  return (
    <span
      aria-hidden="true"
      data-testid={`project-badge-${projectKey}`}
      className={cn('flex h-5 w-5 shrink-0 items-center justify-center rounded text-xs font-bold', className)}
      style={{ backgroundColor: c.bg, color: c.fg }}
    >
      {projectInitial(projectKey)}
    </span>
  )
}
