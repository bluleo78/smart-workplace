// 프로젝트 개요 탭(WP-1477) — 지금은 자리 표시 빈 상태만. 위젯(진행·마일스톤·활동 등)은 WP-1478 이 채운다.
import { LayoutDashboard } from 'lucide-react'

import { Page } from '@/components/layout/Page'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'

import { useProjectTabs } from './ProjectTabsContext'

/** 개요 탭 본문 — 준비 중 안내. 탭 제목은 다른 탭과 같은 「개요 · {프로젝트}」. */
export default function ProjectOverviewTab() {
  const { project } = useProjectTabs()
  useDocumentTitle(['개요', project.name])
  return (
    <Page.Body data-testid="project-overview">
      <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
        <LayoutDashboard className="size-8 text-muted-foreground" aria-hidden />
        <p className="text-sm text-muted-foreground">프로젝트 개요는 준비 중입니다</p>
      </div>
    </Page.Body>
  )
}
