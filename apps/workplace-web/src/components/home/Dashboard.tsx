// 홈 대시보드 — 위젯 그리드 + 편집 모드.
// synthesis/quick_actions 같은 합성·액션 위젯도 다른 시스템 위젯과 동일하게 그리드 항목으로 렌더된다(고정
// 풀폭 레이어 아님). wide 로 표시된 위젯만 lg:col-span-3(전체 폭)으로 넓게 렌더한다.
// 편집 모드는 그리드 전체에 적용: 표시/숨김·순서 이동·항목 수·설정(카탈로그)·삭제(카탈로그)·되돌리기 → 저장/취소.
// 위젯은 두 종류다 — 시스템 위젯(싱글턴, count 기반)과 카탈로그 위젯(다중 인스턴스, params 기반,
// chatWidgetRegistry 컴포넌트를 그대로 재사용).
// 구성(WP-161): 이 파일은 머리·편집 배너·위젯 추가 모달만 그린다. 편집 초안·액션은 useDashboardEditDraft,
// 목록 골격(dnd·카드 ref)은 DashboardWidgetList, 카드들은 dashboard/ 아래 각 파일이 맡는다.
import { Home, Pencil, Plus, Undo2 } from 'lucide-react'
import { useMemo } from 'react'

import { useRegisterAiScreenContext } from '@/components/ai/screen-context/useAiScreenContext'
import { Page } from '@/components/layout/Page'
import { HeaderIconAction } from '@/components/mobile/HeaderIconAction'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useDashboardLayout, useIsCollapseSaving } from '@/hooks/queries/useDashboard'
import { useIsMobile } from '@/hooks/useIsMobile'
import { buildHomeContext } from '@/lib/aiScreenContext/builders/mobileLists'
import type { DashboardDevice } from '@/types/dashboard'

import { DashboardWidgetList } from './dashboard/DashboardWidgetList'
import { entryTitle, MAX_WIDGETS, type ResolvedEntry, resolveEntries } from './dashboard/resolvedEntry'
import { useDashboardEditDraft } from './dashboard/useDashboardEditDraft'
import { AddWidgetModal } from './widgets/AddWidgetModal'
import { allCatalogWidgets } from './widgets/catalogRegistry'
import { allDashboardWidgets, getDashboardWidget } from './widgets/registry'

/** 레이아웃 로딩 중 스켈레톤 그리드(단일 lg 분기). */
function DashboardSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3" data-testid="dashboard-skeleton">
      {Array.from({ length: 5 }).map((_, i) => (
        <Skeleton key={i} className="h-40 w-full" />
      ))}
    </div>
  )
}

/** 홈 대시보드 — 위젯 그리드(저장 레이아웃 기반) + 편집. */
export function Dashboard() {
  // 기기 판단은 셸과 같은 기준(lg 미만 = 모바일). 폭이 lg 경계를 넘으면 그 기기 레이아웃을 새로 조회한다(WP-142).
  const isMobile = useIsMobile()
  const device: DashboardDevice = isMobile ? 'mobile' : 'desktop'
  const { data, isLoading } = useDashboardLayout(device)
  // 접기 저장 중엔 편집 진입을 막는다 — 늦게 도착한 접기 PUT 이 편집 저장을 덮어쓰지 않게(데스크톱은 접기가 없어 항상 false).
  const collapseSaving = useIsCollapseSaving()
  // 편집 초안·액션 — 편집은 시작한 기기에 묶인다(editing = 시작 기기 === 현재 기기, 저장도 시작 기기로).
  const edit = useDashboardEditDraft({ device, savedWidgets: data?.widgets, collapseSaving })
  const { editing, draft } = edit

  // 저장된 레이아웃 → 알려진 위젯만 해석(알 수 없는 타입은 조용히 스킵).
  const savedEntries = useMemo<ResolvedEntry[]>(() => resolveEntries(data?.widgets ?? []), [data])

  // WP-191: 모바일 홈은 탭 루트 — 위젯 제목으로 화면 컨텍스트를 등록한다(데스크톱 홈은 기존대로 미등록).
  const homeCtx = useMemo(
    () => (isMobile ? buildHomeContext({ widgets: savedEntries.map(entryTitle) }) : null),
    [isMobile, savedEntries],
  )
  useRegisterAiScreenContext(homeCtx)

  const homeIcon = <Home className="h-5 w-5 text-muted-foreground" />

  if (isLoading)
    return (
      <Page>
        <Page.Header data-testid="canvas-header" title="홈" icon={homeIcon} />
        <Page.Body>
          <DashboardSkeleton />
        </Page.Body>
      </Page>
    )

  // 시스템 위젯 갤러리 — draft 에 아예 없는 시스템 타입만(싱글턴 재추가 경로). 카탈로그는 갤러리에 항상 전부 노출.
  const draftSystemTypes = new Set(draft.filter((w) => getDashboardWidget(w.type)).map((w) => w.type))
  const absentSystemWidgets = allDashboardWidgets().filter((w) => !draftSystemTypes.has(w.type))

  return (
    <Page>
      <Page.Header
        data-testid="canvas-header"
        title="홈"
        icon={homeIcon}
        actions={
          !editing ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              data-testid="dashboard-edit-toggle"
              disabled={collapseSaving}
              onClick={edit.enterEdit}
            >
              <Pencil className="h-4 w-4" />
              편집
            </Button>
          ) : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              data-testid="dashboard-add-widget-open"
              disabled={draft.length >= MAX_WIDGETS}
              onClick={() => edit.setAddModalOpen(true)}
            >
              <Plus className="h-4 w-4" />
              위젯 추가
            </Button>
          )
        }
        // 모바일: [편집]/[위젯 추가] 텍스트 버튼 대신 같은 testid 의 아이콘 액션 하나(⋯ 없음, U1-2·U1-3).
        // 홈 아이콘(homeIcon)은 장식이라 모바일 헤더에선 생략된다(Page.Header 는 모바일에서 icon 을 그리지 않음).
        mobilePrimaryAction={
          !editing ? (
            <HeaderIconAction
              label="홈 편집"
              data-testid="dashboard-edit-toggle"
              disabled={collapseSaving}
              onClick={edit.enterEdit}
            >
              <Pencil />
            </HeaderIconAction>
          ) : (
            <HeaderIconAction
              label="위젯 추가"
              data-testid="dashboard-add-widget-open"
              disabled={draft.length >= MAX_WIDGETS}
              onClick={() => edit.setAddModalOpen(true)}
            >
              <Plus />
            </HeaderIconAction>
          )
        }
        mobileActions={null}
      />
      {/* 본문 — 표준 스크롤·여백(Page.Body). 편집 배너·위젯 그리드 사이 간격만 space-y-4. */}
      <Page.Body className="space-y-4">
        {editing && (
          <div
            className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-ai-accent/40 bg-ai-accent/5 px-4 py-2"
            data-testid="dashboard-edit-banner"
          >
            <span className="text-sm font-medium text-ai-accent">편집 중</span>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                data-testid="dashboard-edit-undo"
                disabled={!edit.canUndo}
                onClick={edit.undo}
              >
                <Undo2 className="h-4 w-4" />
                되돌리기
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                data-testid="dashboard-edit-cancel"
                onClick={edit.cancelEdit}
              >
                취소
              </Button>
              <Button
                type="button"
                size="sm"
                data-testid="dashboard-edit-save"
                disabled={edit.isSaving}
                onClick={edit.saveEdit}
              >
                {edit.isSaving ? '저장 중…' : '저장'}
              </Button>
            </div>
          </div>
        )}

        <div className="sr-only" aria-live="polite" data-testid="dashboard-edit-live">
          {edit.liveMsg}
        </div>

        <DashboardWidgetList isMobile={isMobile} savedEntries={savedEntries} edit={edit} />

        {editing && (
          <AddWidgetModal
            open={edit.addModalOpen}
            onOpenChange={edit.setAddModalOpen}
            systemWidgets={absentSystemWidgets}
            catalogWidgets={allCatalogWidgets()}
            disabled={draft.length >= MAX_WIDGETS}
            onAdd={edit.addWidget}
            mobile={isMobile}
          />
        )}
      </Page.Body>
    </Page>
  )
}
