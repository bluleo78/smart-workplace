import { Plus, Star } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { useRegisterAiScreenContext } from '@/components/ai/screen-context/useAiScreenContext'
import { PageHeader } from '@/components/layout/PageHeader'
import { HeaderIconAction } from '@/components/mobile/HeaderIconAction'
import { useHideTabBar } from '@/components/mobile/MobileChromeContext'
import { MobileDetailBar } from '@/components/mobile/MobileDetailBar'
import { Button } from '@/components/ui/button'
import { LoadMoreFooter } from '@/components/ui/load-more-footer'
import { useHistoryParam } from '@/hooks/useHistoryParam'
import { useIsMobile } from '@/hooks/useIsMobile'
import { buildContactsContext } from '@/lib/aiScreenContext/builders/contacts'
import { decodeContactParam, encodeContactParam } from '@/lib/contactParam'
import { cn } from '@/lib/utils'

import { ContactDetailPanel } from '../../components/contacts/ContactDetailPanel'
import { ExternalContactFormDialog } from '../../components/contacts/ExternalContactFormDialog'
import { GroupContactView } from '../../components/contacts/GroupContactView'
import { findNode, parseGroupId } from '../../components/contacts/groupTree.helpers'
import type { ContactSelection } from '../../hooks/queries/useContactDetail'
import { useContactDetail } from '../../hooks/queries/useContactDetail'
import { useContacts } from '../../hooks/queries/useContacts'
import { useToggleFavorite } from '../../hooks/queries/useFavoriteMutations'
import { useUserGroups } from '../../hooks/queries/useUserGroups'
import type { ContactSummary, ContactTypeFilter } from '../../types/contact'

// 한 줄 목록 항목 — 멤버/외부 배지 + 이름·보조정보 + 호버 시 즐겨찾기 별 버튼.
// 중첩 button 방지를 위해 행 컨테이너는 div, 선택 클릭은 inner button, 별은 형제 button.
function ContactRow({
  c,
  active,
  onSelect,
}: {
  c: ContactSummary
  active: boolean
  onSelect: () => void
}) {
  const toggle = useToggleFavorite()
  return (
    <div
      data-testid={`contact-row-${c.type}-${c.id}`}
      className={cn(
        'group flex w-full items-center gap-3 border-b px-4 py-3 text-left transition-colors',
        active ? 'bg-accent' : 'hover:bg-accent/50',
      )}
    >
      <button type="button" onClick={onSelect} className="flex min-w-0 flex-1 items-center gap-3 text-left">
        <span
          className={cn(
            'shrink-0 rounded px-1.5 py-0.5 text-xs font-medium',
            c.type === 'MEMBER' ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground',
          )}
        >
          {c.type === 'MEMBER' ? '멤버' : '외부'}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{c.name}</span>
          <span className="block truncate text-xs text-muted-foreground">
            {c.email || c.organization || c.title || ''}
          </span>
        </span>
      </button>
      {/* 즐겨찾기 토글 — hover 시 표시, 이미 즐겨찾기면 항상 표시 */}
      <button
        type="button"
        data-testid={`contact-fav-${c.type}-${c.id}`}
        aria-label={c.isFavorite ? '즐겨찾기 해제' : '즐겨찾기 추가'}
        aria-pressed={c.isFavorite}
        onClick={() => toggle.mutate({ targetType: c.type, targetId: c.id, isFavorite: c.isFavorite })}
        className={cn(
          'shrink-0 rounded p-1 transition-opacity',
          c.isFavorite ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
        )}
      >
        <Star className={cn('h-4 w-4', c.isFavorite && 'fill-yellow-400 text-yellow-400')} />
      </button>
    </div>
  )
}

// WP-54: 연락처 화면 컨텍스트 등록 — 목록 필터 + 선택 연락처. 컨텍스트는 직렬화 키로 중복 제거되므로 useMemo 없이 매 렌더 만든다.
// 미로드 데이터는 보내지 않는다: 건수·hasMore 는 통합 목록 조회가 끝난 뒤(그룹 뷰에서는 통합 목록이 화면에 없어 생략)에만,
// 구성원 username 은 상세 쿼리가 끝난 뒤에만 싣는다(그 전에는 refs 비움 — 틀린 id 미전송).
function useContactsScreenContext(input: {
  q: string
  type: ContactTypeFilter
  organization: string
  title: string
  groupId: number | null
  selected: ContactSelection | null
  items: ContactSummary[]
  listLoaded: boolean
  hasMore: boolean
}) {
  const { q, type, organization, title, groupId, selected, items, listLoaded, hasMore } = input
  const detail = useContactDetail(selected).data
  const tree = useUserGroups().data
  // 그룹 트리 전체 탐색은 트리·그룹이 바뀔 때만 — 목록 로드·선택 변경 렌더마다 반복하지 않는다.
  const groupName = useMemo(
    () => (groupId != null && tree ? (findNode([...tree.shared, ...tree.personal], groupId)?.name ?? null) : null),
    [tree, groupId],
  )
  const row = selected ? items.find((c) => c.type === selected.type && c.id === selected.id) : undefined
  // 그룹 뷰에서는 통합 목록 행이 없으므로 상세 응답으로 이름·부가정보를 채운다. 둘 다 없으면 focus 를 만들지 않는다.
  const ext = selected?.type === 'EXTERNAL' ? (detail as { organization?: string | null } | undefined) : undefined
  const name = row?.name ?? detail?.name
  const showCount = groupId == null && listLoaded
  const ctx = buildContactsContext({
    q,
    type,
    organization: organization || null,
    title: title || null,
    groupId,
    groupName,
    count: showCount ? items.length : undefined,
    hasMore: showCount ? hasMore : undefined,
    selected:
      selected && name
        ? {
            type: selected.type,
            id: selected.id,
            name,
            username: selected.type === 'MEMBER' ? ((detail as { username?: string } | undefined)?.username ?? null) : null,
            organization: row?.organization ?? ext?.organization ?? null,
            title: row?.title ?? detail?.title ?? null,
            email: row?.email ?? detail?.email ?? null,
          }
        : null,
  })
  useRegisterAiScreenContext(ctx)
  // 열린 연락처 이름(목록 행 → 상세 응답 순) — 페이지가 모바일 상세 헤더 제목으로 재사용한다.
  return name
}

/** 통합 연락처 목록 + 마스터-디테일. 검색·타입은 URL searchParams 와 공유(ContactSidebar). */
export function ContactsPage() {
  const [params, setParams] = useSearchParams()
  const search = params.get('q') ?? ''
  const type = ((params.get('type') as ContactTypeFilter) ?? 'ALL') as ContactTypeFilter
  const organization = params.get('organization') ?? ''
  const title = params.get('title') ?? ''
  const groupParam = params.get('group')
  const groupId = parseGroupId(groupParam)

  // 열린 연락처 = URL ?contact(상태의 단일 원천, WP-206). 행 클릭은 push → 시스템 뒤로가기가 상세만 닫는다.
  // 필터(q·type·조직·직책·그룹) 변경은 그 navigate(ContactSidebar.patch·clearGroupSelection)가 contact 를 함께 지운다 —
  // 같은 히스토리 항목에서 처리해 리셋 이펙트 경합·이중 항목이 없다.
  const contactParam = useHistoryParam('contact')
  const selected = decodeContactParam(contactParam.value)
  const selectContact = (sel: ContactSelection) => contactParam.open(encodeContactParam(sel))
  // 모바일: 상세가 열려 있으면 하단 탭바를 숨긴다(WP-125).
  useHideTabBar(selected != null)
  const [createOpen, setCreateOpen] = useState(false)
  const isMobile = useIsMobile()
  // 모바일에서 상세가 열리면 목록 헤더("연락처"·＋·☰·🔔) 대신 상세 헤더 한 줄만 둔다(U1-1).
  const showListChrome = !(isMobile && selected != null)

  // 보던 조직도 그룹이 삭제되면 URL group 파라미터 제거 → 통합 목록 복귀(열린 상세도 함께 닫는다).
  const clearGroupSelection = () => {
    const next = new URLSearchParams(params)
    next.delete('group')
    next.delete('contact')
    setParams(next, { replace: true })
  }
  const contactsQuery = useContacts(search, type, organization, title)
  // 오류 화면은 첫 페이지 실패만(isLoadingError) — LoadMoreFooter 참조
  const { data, isLoading, isLoadingError, refetch, hasNextPage } = contactsQuery
  // 목록 스크롤 요소 — 무한 스크롤 sentinel 의 root(WP-182). 콜백 ref 라 마운트 후 재부착된다.
  const [listScrollEl, setListScrollEl] = useState<HTMLDivElement | null>(null)

  const items = data?.pages.flatMap((p) => p.items) ?? []

  // 모바일 상세 헤더 제목 = 열린 연락처 이름(채팅·노트와 같은 "‹ 항목 이름" 규칙).
  const detailName = useContactsScreenContext({
    q: search,
    type,
    organization,
    title,
    groupId,
    selected,
    items,
    listLoaded: data != null,
    hasMore: !!hasNextPage,
  })

  return (
    <>
      <div className="flex h-full flex-col overflow-hidden">
        {/* 전폭 헤더 — 연락처 제목 + 새 외부 연락처 버튼(그룹·일반 공통). 모바일 상세가 열리면 숨김 — 상세 헤더 한 줄만(U1-1) */}
        {showListChrome && (
          <PageHeader
            title="연락처"
            actions={
              /* 헤더 주 액션 — size 미지정(default). 04-components §E 규정(#744/#747). */
              <Button data-testid="contact-create" onClick={() => setCreateOpen(true)}>
                새 외부 연락처
              </Button>
            }
            // 모바일: 같은 액션을 ＋ 아이콘으로 인라인(⋯ 없음) — testid 를 공유하므로 actions 는 모바일에서 렌더되지 않게 null.
            mobilePrimaryAction={
              <HeaderIconAction label="새 외부 연락처" data-testid="contact-create" onClick={() => setCreateOpen(true)}><Plus /></HeaderIconAction>
            }
            mobileActions={null}
          />
        )}
        <div className="flex min-h-0 flex-1">
          {/* 목록 (마스터) — 좁은 화면 + 선택 시 숨김 */}
          <div
            className={cn(
              // 우측 구분선은 목록·상세가 나란히 있는 데스크톱(lg+)에서만 — 모바일 전체폭 목록 끝에 선이 남지 않게(U3-R14).
              'flex min-w-0 flex-1 flex-col lg:border-r',
              selected != null && 'hidden lg:flex',
            )}
            data-testid="contact-list"
          >
            {groupId != null ? (
              <GroupContactView
                groupId={groupId}
                selected={selected}
                onSelect={selectContact}
                onGroupDeleted={clearGroupSelection}
              />
            ) : isLoading ? (
              <div className="p-6 text-sm text-muted-foreground">불러오는 중…</div>
            ) : isLoadingError ? (
              <div className="p-6 text-center">
                <p className="text-sm text-destructive mb-2">목록을 불러오지 못했습니다</p>
                <Button variant="outline" size="sm" onClick={() => refetch()}>다시 시도</Button>
              </div>
            ) : items.length === 0 ? (
              // 빈 상태 — 즐겨찾기 모드일 때 전용 메시지, 그 외 기본 메시지
              <div data-testid="contact-empty" className="p-8 text-center text-sm text-muted-foreground">
                {type === 'FAVORITE' ? '즐겨찾기한 연락처가 없습니다' : '연락처가 없습니다'}
              </div>
            ) : (
              <div ref={setListScrollEl} className="flex-1 overflow-y-auto">
                {items.map((c) => (
                  <ContactRow
                    key={`${c.type}-${c.id}`}
                    c={c}
                    active={selected?.type === c.type && selected?.id === c.id}
                    onSelect={() => selectContact({ type: c.type, id: c.id })}
                  />
                ))}
                {/* WP-182: 끝에 닿으면 자동 로드 — 실패했을 때만 다시 시도 버튼 */}
                <LoadMoreFooter query={contactsQuery} root={listScrollEl} data-testid="contact-load-more" />
              </div>
            )}
          </div>

          {/* 상세 (디테일) — 좁은 화면은 선택 시 전체폭 */}
          <div
            className={cn(
              'min-w-0 flex-1',
              selected == null ? 'hidden lg:block' : 'flex flex-col lg:block',
            )}
            data-testid="contact-detail"
          >
            {/* 모바일 상세 헤더 — ‹·연락처 이름·✦ 한 줄(탭바가 숨으므로 ✦ 포함). URL 이 탭 루트라 레이아웃 상세 분기 대신 직접 그린다. */}
            {isMobile && <MobileDetailBar data-testid="contact-back" title={detailName} onBack={contactParam.close} />}
            <ContactDetailPanel selected={selected} onDeleted={contactParam.close} />
          </div>
        </div>
      </div>

      {/* 새 외부 연락처 생성 모달 */}
      <ExternalContactFormDialog open={createOpen} onOpenChange={setCreateOpen} contact={null} />
    </>
  )
}
