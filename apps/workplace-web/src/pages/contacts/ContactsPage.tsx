import { Plus, Search, Star, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { useRegisterAiScreenContext } from '@/components/ai/screen-context/useAiScreenContext'
import { Breadcrumb, type BreadcrumbItem } from '@/components/layout/Breadcrumb'
import { Page } from '@/components/layout/Page'
import { mobileRootHeaderClass } from '@/components/mobile/headerClass'
import { HeaderIconAction } from '@/components/mobile/HeaderIconAction'
import { useHideTabBar } from '@/components/mobile/MobileChromeContext'
import { MobileDetailBar } from '@/components/mobile/MobileDetailBar'
import { MobileSidebarSheetTrigger } from '@/components/mobile/MobileSidebarSheetTrigger'
import { useMobileBack } from '@/components/mobile/useMobileBack'
import { Button } from '@/components/ui/button'
import { LoadMoreFooter } from '@/components/ui/load-more-footer'
import { SearchInput } from '@/components/ui/search-input'
import { useDebounceValue } from '@/hooks/useDebounceValue'
import { useHistoryParam } from '@/hooks/useHistoryParam'
import { useIsMobile } from '@/hooks/useIsMobile'
import { buildContactsContext } from '@/lib/aiScreenContext/builders/contacts'
import { decodeContactParam, encodeContactParam } from '@/lib/contactParam'
import { SELECTED_SURFACE_CLASS } from '@/lib/selectionStyles'
import { cn } from '@/lib/utils'

import { ContactDetailPanel } from '../../components/contacts/ContactDetailPanel'
import { ExternalContactFormDialog } from '../../components/contacts/ExternalContactFormDialog'
import { GroupContactView } from '../../components/contacts/GroupContactView'
import { findGroupPath, findNode, parseGroupId } from '../../components/contacts/groupTree.helpers'
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
        // 목록 안 보조 줄(이메일 등)까지 굵어지지 않게 막대+배경만 쓴다(이름은 이미 font-medium).
        active ? SELECTED_SURFACE_CLASS : 'hover:bg-accent/50',
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        aria-current={active ? 'true' : undefined}
        className="flex min-w-0 flex-1 items-center gap-3 text-left"
      >
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
      {/* 즐겨찾기 토글 — hover·키보드 초점 시 표시, 이미 즐겨찾기면 항상 표시.
          WP-237: 터치 기기(coarse)에선 hover 가 없어 안 보이는 ★ 가 오터치로 즐겨찾기될 수 있어 탭을 막는다(추가는 상세 패널 ★ 로). */}
      <button
        type="button"
        data-testid={`contact-fav-${c.type}-${c.id}`}
        // 행마다 반복되는 버튼이라 연락처 이름을 넣는다(WP-923). 상태는 aria-pressed 와 문구가 함께 전한다.
        aria-label={`${c.name} ${c.isFavorite ? '즐겨찾기 해제' : '즐겨찾기 추가'}`}
        aria-pressed={c.isFavorite}
        onClick={() => toggle.mutate({ targetType: c.type, targetId: c.id, isFavorite: c.isFavorite })}
        className={cn(
          'shrink-0 rounded p-1 transition-opacity',
          // 행 안 키보드 초점(group-kbd)에서도 보인다 — 투명한 채 초점만 가 있으면 어디 있는지 알 수 없다(WP-844). 그룹 트리와 같은 규칙.
          c.isFavorite ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 group-kbd:opacity-100 pointer-coarse:pointer-events-none',
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
  // 그룹 이름은 검색창 범위 칩 문구로 재사용한다(트리 탐색을 한 번만).
  return { name, groupName }
}

/**
 * 그룹 보기의 위치 — 시작점(조직도·내 그룹)과 최상위 조상부터 현재 그룹까지의 경로, 각 단계로 가는 주소(WP-977, §B-1 「브레드크럼」).
 * 단계 주소는 지금 쿼리에서 group 만 바꾸고 열린 상세(contact)는 닫는다 — 검색어(q)는 보기를 바꿔도 이어 간다(WP-976).
 * 트리가 아직 없거나 그룹을 찾지 못하면 path 는 null 이고, 호출부는 예전 「연락처」 제목으로 둔다.
 */
function useGroupLocation(groupId: number | null, params: URLSearchParams) {
  const tree = useUserGroups().data
  const groupUrl = (id: number | null) => {
    const sp = new URLSearchParams(params)
    sp.delete('contact')
    if (id == null) sp.delete('group')
    else sp.set('group', String(id))
    const qs = sp.toString()
    return qs ? `/contacts?${qs}` : '/contacts'
  }
  if (groupId == null || !tree) return { items: null, parentUrl: groupUrl(null) }
  const shared = findGroupPath(tree.shared, groupId)
  const path = shared ?? findGroupPath(tree.personal, groupId)
  if (!path) return { items: null, parentUrl: groupUrl(null) }
  // 시작점은 조직 루트 — 공유 트리면 「조직도」, 개인 트리면 「내 그룹」. 둘 다 따로 열리는 화면이 없어 링크가 아닌 글자로 둔다(내가 정한 것).
  const items: BreadcrumbItem[] = [
    { key: 'root', label: shared ? '조직도' : '내 그룹', testId: 'contact-breadcrumb-root' },
    ...path.map((n) => ({ key: n.id, label: n.name, title: n.name, to: groupUrl(n.id), testId: `contact-breadcrumb-${n.id}` })),
  ]
  // 모바일 ‹ 가 돌아갈 기록이 없을 때 갈 곳 — 상위 조직, 최상위 그룹이면 그룹 보기를 푼 연락처 목록.
  const parentUrl = groupUrl(path.length >= 2 ? path[path.length - 2].id : null)
  return { items, parentUrl }
}

/**
 * 검색 범위 칩 — 그룹 보기에서 검색창 앞에 「재경팀 ×」로 지금 어디 안에서 거르는지 보인다(WP-976, §B-1 「범위」).
 * 누르면(× 포함) 그룹 범위를 풀고 같은 검색어로 전체 연락처를 찾는다. 긴 그룹 이름은 말줄임해 입력칸 폭을 지킨다.
 */
function SearchScopeChip({ name, onClear, className }: { name: string; onClear: () => void; className?: string }) {
  return (
    <button
      type="button"
      data-testid="contact-search-scope"
      aria-label={`${name} 범위 해제 — 전체에서 찾기`}
      title={name}
      onClick={onClear}
      className={cn(
        'inline-flex h-7 min-w-0 shrink-0 items-center gap-1 rounded-full border bg-muted pl-2.5 pr-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent',
        className,
      )}
    >
      <span className="truncate">{name}</span>
      <X className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
    </button>
  )
}

/** 통합 연락처 목록 + 마스터-디테일. 보기(type·group)는 ContactSidebar 와 URL searchParams 로 공유하고, 검색(q)은 이 페이지 헤더가 쓴다(WP-976). */
export function ContactsPage() {
  const [params, setParams] = useSearchParams()
  const search = params.get('q') ?? ''
  const type = ((params.get('type') as ContactTypeFilter) ?? 'ALL') as ContactTypeFilter
  const organization = params.get('organization') ?? ''
  const title = params.get('title') ?? ''
  const groupParam = params.get('group')
  const groupId = parseGroupId(groupParam)

  // 열린 연락처 = URL ?contact(상태의 단일 원천, WP-206). 행 클릭은 push → 시스템 뒤로가기가 상세만 닫는다.
  // 필터(q·type·조직·직책·그룹) 변경은 그 navigate(ContactSidebar.patch·writeQuery·leaveGroup)가 contact 를 함께 지운다 —
  // 같은 히스토리 항목에서 처리해 리셋 이펙트 경합·이중 항목이 없다. 그룹 보기의 검색어 변경만 예외로 상세를 둔다(WP-999 — writeQuery).
  const contactParam = useHistoryParam('contact')
  const selected = decodeContactParam(contactParam.value)
  const selectContact = (sel: ContactSelection) => contactParam.open(encodeContactParam(sel))
  // 모바일: 상세가 열려 있으면 하단 탭바를 숨긴다(WP-125).
  useHideTabBar(selected != null)
  const [createOpen, setCreateOpen] = useState(false)
  const isMobile = useIsMobile()
  // 모바일에서 상세가 열리면 목록 헤더("연락처"·＋·☰·🔔) 대신 상세 헤더 한 줄만 둔다(U1-1).
  const showListChrome = !(isMobile && selected != null)

  // 검색 입력 draft — 타이핑은 즉시 반영하되 URL(q)은 300ms debounce 후에만 갱신한다(history replace).
  // q 가 URL 에 직접 묶여 있으면 키 입력마다 라우터 이동을 거쳐 값이 되돌아오며 한글 IME 조합이 끊긴다(WP-974).
  // 검색창이 사이드바에서 헤더로 옮겨 오며(WP-976) 이 로직도 함께 옮겼다 — q 를 쓰는 곳은 여기 한 곳뿐이다.
  const [qDraft, setQDraft] = useState(search)
  // 이 페이지가 마지막으로 URL 에 쓴 q — 그 값이 search 로 되돌아올 때는 draft 를 덮지 않는다(WP-999).
  // URL 을 쓴 순간부터 다시 렌더되기까지 더 친 글자가 있으면, 되돌아온 옛 q 로 덮어 그 글자가 지워졌다.
  const writtenQ = useRef<string | null>(null)
  useEffect(() => {
    // 내 쓰기의 메아리는 한 번만 건너뛴다(그 뒤 바깥에서 같은 값으로 바뀌면 다시 맞춘다).
    const isEcho = writtenQ.current === search
    writtenQ.current = null
    // 바깥(뒤로 가기·앱 레일 이동 등)에서 q 가 바뀌면 draft 를 맞춘다.
    if (!isEcho) setQDraft(search)
  }, [search])
  const debouncedQDraft = useDebounceValue(qDraft, 300)
  // q 갱신 — 통합 목록은 바뀐 목록에 없는 상세가 남지 않게 열린 상세(?contact)도 같은 항목에서 닫는다(WP-206).
  // 그룹 보기는 소속 멤버를 화면에서 거를 뿐이라, 검색어에서 빠진 사람이어도 상세를 그대로 둔다(WP-999) —
  // 보던 사람을 두고 다른 사람을 찾을 수 있게. 그룹 여부는 렌더 시점 값이 아닌 prev 로 본다(같은 틱의 범위 해제와 경합하지 않게).
  const writeQuery = (value: string) => {
    setParams(
      (prev) => {
        const sp = new URLSearchParams(prev)
        // q 가 실제로 바뀔 때만 메아리를 기다린다 — 안 바뀌면 search 가 그대로라 기록이 소비되지 않고 남는다.
        if ((sp.get('q') ?? '') !== value) writtenQ.current = value
        if (parseGroupId(sp.get('group')) == null) sp.delete('contact')
        if (value) sp.set('q', value)
        else sp.delete('q')
        return sp
      },
      { replace: true },
    )
  }
  useEffect(() => {
    if (debouncedQDraft === search) return
    writeQuery(debouncedQDraft)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedQDraft])

  // 모바일 검색 펼침 — 헤더 🔍 로 연다. 검색어가 남아 있으면(링크·뒤로 가기로 ?q 진입) 숨은 필터가 없게 늘 펼친다.
  // ?q 로 펼친 것도 「열림」으로 기록해야 입력칸 X 로 지웠을 때 줄이 사라지며 키보드가 닫히지 않는다.
  const [mobileSearchOpen, setMobileSearchOpen] = useState(() => search !== '')
  useEffect(() => {
    if (search !== '') setMobileSearchOpen(true)
  }, [search])
  const mobileSearchVisible = mobileSearchOpen || qDraft !== ''
  const mobileSearchRef = useRef<HTMLDivElement>(null)
  // 🔍 로 연 때만 초점을 준다 — ?q 진입으로 펼칠 때 키보드가 저절로 올라오지 않게.
  const focusMobileSearch = useRef(false)
  const openMobileSearch = () => {
    focusMobileSearch.current = true
    setMobileSearchOpen(true)
  }
  useEffect(() => {
    if (!mobileSearchOpen || !focusMobileSearch.current) return
    focusMobileSearch.current = false
    mobileSearchRef.current?.querySelector('input')?.focus()
  }, [mobileSearchOpen])
  // 「취소」 — 검색어를 비우고 접는다(debounce 를 기다리지 않고 바로 URL 에서도 지운다).
  const cancelMobileSearch = () => {
    setQDraft('')
    writeQuery('')
    setMobileSearchOpen(false)
  }

  // 그룹 보기 떠나기 — 범위 칩 ×·「전체에서 찾기」(그룹만 풀고 검색어는 남겨 전체에서 같은 말로 찾는다)와
  // 보던 그룹(또는 조상)이 삭제됐을 때 통합 목록 복귀가 같은 동작이다. 열린 상세도 함께 닫는다.
  const leaveGroup = () =>
    setParams(
      (prev) => {
        const sp = new URLSearchParams(prev)
        sp.delete('group')
        sp.delete('contact')
        return sp
      },
      { replace: true },
    )

  // 그룹 보기의 검색은 GroupContactView 가 소속 멤버 안에서 거른다 — 통합 목록 조회는 쓰지 않으니 끈다.
  const contactsQuery = useContacts(search, type, organization, title, { enabled: groupId == null })
  // 오류 화면은 첫 페이지 실패만(isLoadingError) — LoadMoreFooter 참조
  const { data, isLoading, isLoadingError, refetch, hasNextPage } = contactsQuery
  // 목록 스크롤 요소 — 무한 스크롤 sentinel 의 root(WP-182). 콜백 ref 라 마운트 후 재부착된다.
  const [listScrollEl, setListScrollEl] = useState<HTMLDivElement | null>(null)

  const items = data?.pages.flatMap((p) => p.items) ?? []

  // 그룹 보기의 위치 — 데스크톱 헤더 브레드크럼, 모바일 「‹ 그룹 이름」 헤더의 ‹ 대체 경로(WP-977).
  const groupLocation = useGroupLocation(groupId, params)
  // ‹ = 기록상 뒤로(시스템 뒤로와 같은 곳). 링크로 바로 들어와 기록이 없을 때만 상위 조직으로(§B-1 「모바일 헤더와 ‹」).
  const groupBack = useMobileBack(groupLocation.parentUrl)

  // 모바일 상세 헤더 제목 = 열린 연락처 이름(채팅·노트와 같은 "‹ 항목 이름" 규칙).
  const { name: detailName, groupName } = useContactsScreenContext({
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

  // 검색 칸 — [그룹 범위 칩] [입력]. 데스크톱 헤더 actions 와 모바일 펼친 줄이 폭만 달리해 같이 쓴다.
  const searchField = ({ chipClass, inputClass }: { chipClass: string; inputClass: string }) => (
    <>
      {groupId != null && <SearchScopeChip name={groupName ?? '그룹'} onClear={leaveGroup} className={chipClass} />}
      <SearchInput
        value={qDraft}
        onChange={setQDraft}
        placeholder={groupId != null ? '이 그룹에서 검색' : '이름·이메일 검색'}
        aria-label="연락처 검색"
        inputTestId="contact-search"
        className={inputClass}
      />
    </>
  )

  return (
    <>
      <Page>
        {/* 전폭 헤더 — 연락처 제목 + 새 외부 연락처 버튼(그룹·일반 공통). 모바일 상세가 열리면 숨김 — 상세 헤더 한 줄만(U1-1) */}
        {showListChrome && isMobile && mobileSearchVisible ? (
          // 모바일 검색 펼침 — 헤더 자리를 [범위 칩][입력][취소] 한 줄로 바꾼다(§B-1 「모바일」: ⋯·☰ 안에 넣지 않는다).
          <div ref={mobileSearchRef} data-testid="contact-mobile-search" className={cn('relative z-[45] bg-background', mobileRootHeaderClass, 'gap-2 pr-2')}>
            {searchField({ chipClass: 'max-w-[10rem]', inputClass: 'min-w-0 max-w-none' })}
            <Button type="button" variant="ghost" size="sm" data-testid="contact-search-cancel" onClick={cancelMobileSearch} className="shrink-0 px-2">
              취소
            </Button>
          </div>
        ) : showListChrome && isMobile && groupId != null ? (
          // 모바일 그룹 보기 — 「‹ 그룹 이름」 한 줄(경로 전체는 넣지 않는다, §B-1). 우측은 목록 헤더와 같은 🔍·＋·☰.
          <MobileDetailBar
            data-testid="contact-group-header"
            title={groupName ?? '그룹'}
            onBack={groupBack}
            // /contacts 는 탭 루트라 하단 탭바의 ✦ 가 남는다 — 헤더에 또 그리지 않는다.
            showAi={false}
            trailing={
              <>
                <HeaderIconAction label="검색" tone="default" data-testid="contact-search-open" onClick={openMobileSearch}><Search /></HeaderIconAction>
                <HeaderIconAction label="새 외부 연락처" data-testid="contact-create" onClick={() => setCreateOpen(true)}><Plus /></HeaderIconAction>
                <MobileSidebarSheetTrigger />
              </>
            }
          />
        ) : showListChrome && (
          <Page.Header
            // 그룹 보기면 경로가 곧 제목 — 제목 자리(leading)에 브레드크럼을 두고 title 은 비운다(§B-1). 경로를 아직 모르면 예전 제목.
            title={groupLocation.items ? undefined : '연락처'}
            srTitle={groupName ?? undefined}
            leadingGrow
            leading={groupLocation.items && <Breadcrumb items={groupLocation.items} aria-label="조직 경로" data-testid="contact-breadcrumb" />}
            actions={
              <>
                {/* 검색 — 지금 보는 목록을 거르므로 헤더 오른쪽(§B-1 「검색창」). 그룹 보기면 범위 칩을 앞에 둔다. */}
                <div className="flex min-w-0 items-center gap-2">
                  {searchField({ chipClass: 'max-w-48', inputClass: 'w-64 flex-none' })}
                </div>
                {/* 헤더 주 액션 — size 미지정(default). 04-components §E 규정(#744/#747). */}
                <Button data-testid="contact-create" onClick={() => setCreateOpen(true)}>
                  새 외부 연락처
                </Button>
              </>
            }
            // 모바일: 🔍(검색 펼침)과 ＋ 를 인라인 아이콘으로(⋯ 없음) — testid 를 공유하므로 actions 는 모바일에서 렌더되지 않게 null.
            mobilePrimaryAction={
              <>
                <HeaderIconAction label="검색" tone="default" data-testid="contact-search-open" onClick={openMobileSearch}><Search /></HeaderIconAction>
                <HeaderIconAction label="새 외부 연락처" data-testid="contact-create" onClick={() => setCreateOpen(true)}><Plus /></HeaderIconAction>
              </>
            }
            mobileActions={null}
          />
        )}
        {/* 본문 — 목록·상세 마스터-디테일이라 스크롤·여백은 각 칸이 소유(padded=false), 행은 px-4 페이지 여백. */}
        <Page.Body padded={false}>
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
                search={search}
                onSearchAll={leaveGroup}
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
            {/* 상세가 열렸을 때만 그린다 — 숨긴 채 늘 두면 그룹 보기 헤더의 ‹(mobile-back)와 testid 가 겹친다(WP-977). */}
            {isMobile && selected != null && <MobileDetailBar data-testid="contact-back" title={detailName} onBack={contactParam.close} />}
            <ContactDetailPanel selected={selected} onDeleted={contactParam.close} onClose={contactParam.close} />
          </div>
        </Page.Body>
      </Page>

      {/* 새 외부 연락처 생성 모달 */}
      <ExternalContactFormDialog open={createOpen} onOpenChange={setCreateOpen} contact={null} />
    </>
  )
}
