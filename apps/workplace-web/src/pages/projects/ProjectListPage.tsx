// 내가 멤버인 프로젝트 목록 — 모니터링 리스트(배지·진행률·멤버·즐겨찾기).
import { FolderOpen } from 'lucide-react'
import { useMemo, useState } from 'react'

import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useProjectFavorites } from '@/hooks/useProjectFavorites'

import { useProjects } from '../../hooks/queries/useProjects'
import { ProjectCreateDialog } from './components/ProjectCreateDialog'
import { ProjectListRow } from './components/ProjectListRow'

type SortKey = 'recent' | 'name'

// 내가 멤버인 프로젝트 목록 (ADMIN 은 전체). 우상단 "+ 새 프로젝트" 로 생성 모달.
export default function ProjectListPage() {
  const [open, setOpen] = useState(false)
  const [sort, setSort] = useState<SortKey>('recent')
  // isError/refetch 구조분해 — API 실패 시 오류 상태와 재시도 버튼 표시
  const { data, isLoading, isError, refetch } = useProjects()
  const { favs, isFav, toggle } = useProjectFavorites()

  // 정렬: 즐겨찾기 핀 우선 → 선택 정렬(최근 활동순/이름순). 현재 페이지 범위 내 정렬(YAGNI).
  const sorted = useMemo(() => {
    const items = [...(data?.content ?? [])]
    const cmp = (a: typeof items[number], b: typeof items[number]) =>
      sort === 'name'
        ? a.name.localeCompare(b.name, 'ko')
        : new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    items.sort(cmp)
    const pinned = items.filter((p) => isFav(p.key))
    const rest = items.filter((p) => !isFav(p.key))
    return { pinned, rest }
  }, [data, sort, favs])

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <PageHeader
        title="프로젝트"
        actions={<Button onClick={() => setOpen(true)}>+ 새 프로젝트</Button>}
      />
      <div className="flex-1 overflow-y-auto">
        <div className="container mx-auto space-y-4 p-6">
          {isLoading ? (
            // 로딩 중 — 스켈레톤 카드 3개로 레이아웃 시프트 최소화
            <div className="space-y-2" data-testid="projects-loading">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-14 w-full rounded-lg" />
              ))}
            </div>
          ) : isError ? (
            <div className="p-6 text-center">
              <p className="mb-2 text-sm text-destructive">프로젝트 목록을 불러오지 못했습니다.</p>
              <Button variant="outline" size="sm" onClick={() => refetch()}>다시 시도</Button>
            </div>
          ) : data && data.content.length === 0 ? (
            // 빈 상태 — 디자인 시스템 §2.5: 아이콘 + 제목 + 설명 + CTA 4요소
            <div className="flex flex-col items-center gap-3 py-16 text-center" data-testid="projects-empty">
              <FolderOpen className="h-10 w-10 text-muted-foreground" />
              <p className="text-sm font-semibold">아직 프로젝트가 없어요</p>
              <p className="text-xs text-muted-foreground">팀원과 함께 작업할 프로젝트를 만들어 보세요.</p>
              <Button onClick={() => setOpen(true)}>새 프로젝트 만들기</Button>
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border bg-card" role="list" aria-label="프로젝트 목록">
              {/* 헤더 — 정렬 토글 */}
              <div className="flex items-center justify-between border-b bg-muted/40 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <span>프로젝트</span>
                <button
                  type="button"
                  data-testid="project-sort-toggle"
                  className="font-normal normal-case hover:text-foreground"
                  onClick={() => setSort((s) => (s === 'recent' ? 'name' : 'recent'))}
                >
                  정렬: {sort === 'recent' ? '최근 활동순' : '이름순'} ▾
                </button>
              </div>

              {/* 즐겨찾기 핀 그룹 */}
              {sorted.pinned.length > 0 && (
                <>
                  <div data-testid="fav-group" className="px-4 pt-2 text-xs font-bold text-muted-foreground">★ 즐겨찾기</div>
                  {sorted.pinned.map((p) => (
                    <ProjectListRow key={p.id} project={p} fav onToggleFav={toggle} />
                  ))}
                  <div className="px-4 pt-2 text-xs font-bold text-muted-foreground">전체</div>
                </>
              )}
              {sorted.rest.map((p) => (
                <ProjectListRow key={p.id} project={p} fav={isFav(p.key)} onToggleFav={toggle} />
              ))}
            </div>
          )}
        </div>
      </div>
      <ProjectCreateDialog open={open} onOpenChange={setOpen} />
    </div>
  )
}
