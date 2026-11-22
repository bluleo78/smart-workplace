import { Plus, SearchX, Star, Users, X } from 'lucide-react'
import { memo, useCallback, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { useRegisterAiScreenContext } from '@/components/ai/screen-context/useAiScreenContext'
import { FilterLine } from '@/components/filter/FilterLine'
import { ListEmptyState } from '@/components/issue/ListEmptyState'
import { Breadcrumb, type BreadcrumbItem } from '@/components/layout/Breadcrumb'
import { Page } from '@/components/layout/Page'
import { LoadErrorState } from '@/components/LoadErrorState'
import { HeaderIconAction } from '@/components/mobile/HeaderIconAction'
import { useHideTabBar } from '@/components/mobile/MobileChromeContext'
import { MobileDetailBar } from '@/components/mobile/MobileDetailBar'
import { MobileSidebarSheetTrigger } from '@/components/mobile/MobileSidebarSheetTrigger'
import { useMobileBack } from '@/components/mobile/useMobileBack'
import { ResultStatus } from '@/components/ResultStatus'
import { Button } from '@/components/ui/button'
import { FilterInput } from '@/components/ui/filter-input'
import { LoadMoreFooter } from '@/components/ui/load-more-footer'
import { useUserGroupDetail } from '@/hooks/queries/useUserGroupDetail'
import { useHistoryParam } from '@/hooks/useHistoryParam'
import { useIsMobile } from '@/hooks/useIsMobile'
import { useLatest } from '@/hooks/useLatest'
import { useSearchDraft } from '@/hooks/useSearchDraft'
import { buildContactsContext } from '@/lib/aiScreenContext/builders/contacts'
import { decodeContactParam, encodeContactParam } from '@/lib/contactParam'
import { contactResultAnnouncement } from '@/lib/contactResultAnnouncement'
import { failedWithoutData } from '@/lib/queryFailure'
import { SELECTED_SURFACE_CLASS } from '@/lib/selectionStyles'
import { andParticle, cn } from '@/lib/utils'

import { ContactDetailPanel } from '../../components/contacts/ContactDetailPanel'
import { ExternalContactFormDialog } from '../../components/contacts/ExternalContactFormDialog'
import { GroupContactView } from '../../components/contacts/GroupContactView'
import { findGroupPath, findNode, parseGroupId } from '../../components/contacts/groupTree.helpers'
import type { ContactSelection } from '../../hooks/queries/useContactDetail'
import { useContactDetail } from '../../hooks/queries/useContactDetail'
import { useContacts } from '../../hooks/queries/useContacts'
import { useToggleFavorite } from '../../hooks/queries/useFavoriteMutations'
import { useGroupMemberSearch } from '../../hooks/queries/useGroupMemberSearch'
import { useUserGroups } from '../../hooks/queries/useUserGroups'
import type { ContactSummary, ContactTypeFilter } from '../../types/contact'

// 한 줄 목록 항목 — 멤버/외부 배지 + 이름·보조정보 + 호버 시 즐겨찾기 별 버튼.
// 중첩 button 방지를 위해 행 컨테이너는 div, 선택 클릭은 inner button, 별은 형제 button.
// WP-1948: memo + 안정된 onSelect(행이 자기 type·id 로 호출)라 props(c·active)가 안 바뀐 행은 다시 그리지 않는다.
// 행 컨테이너의 content-visibility:auto 는 화면 밖 행의 스타일·레이아웃·페인트를 브라우저가 건너뛰게 한다(DOM 은 그대로).
const ContactRow = memo(function ContactRow({
  c,
  active,
  onSelect,
}: {
  c: ContactSummary
  active: boolean
  onSelect: (sel: ContactSelection) => void
}) {
  const toggle = useToggleFavorite()
  return (
    <div
      data-testid={`contact-row-${c.type}-${c.id}`}
      className={cn(
        'group flex w-full items-center gap-3 border-b px-4 py-3 text-left transition-colors',
        // 화면 밖 행의 스타일·레이아웃·페인트 생략(React 렌더·DOM 은 그대로) + 건너뛴 행의 추정 높이(두 줄 행 61px — py-3 + 두 줄 글자). auto 라 한 번 그린 행은 실제 높이를 기억해 스크롤바 튐을 줄인다.
        '[content-visibility:auto] [contain-intrinsic-size:auto_61px]',
        // 목록 안 보조 줄(이메일 등)까지 굵어지지 않게 막대+배경만 쓴다(이름은 이미 font-medium).
        active ? SELECTED_SURFACE_CLASS : 'hover:bg-accent/50',
      )}
    >
      <button
        type="button"
        onClick={() => onSelect({ type: c.type, id: c.id })}
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
})

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
  // 그룹 이름은 목록 필터 줄의 범위 칩 문구로 재사용한다(트리 탐색을 한 번만).
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
 * 검색 범위 칩 — 그룹 보기에서 키워드 필터 칸 뒤에 「재경팀 ×」로 지금 어디 안에서 거르는지 보인다(WP-976, §B-1 「범위」).
 * 누르면(× 포함) 그룹 범위를 풀고 같은 검색어로 전체 연락처를 찾는다. 긴 그룹 이름은 말줄임해 필터 칸 폭을 지킨다.
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

/**
 * 결과 건수를 스크린리더에 알리는 안내(WP-1943, SC 4.1.3).
 * 그룹 조회 훅을 여기서 호출해 조회 상태 변화로 페이지 전체가 아니라 이 컴포넌트만 다시 그린다.
 * 그룹 검색·상세는 GroupContactView 와 같은 쿼리 키라 캐시를 공유한다(검색어가 비면 꺼짐).
 * 상세가 실패하면 화면에 오류가 보이므로 검색이 성공해도 안내하지 않는다.
 * 그룹 보기는 검색어가 없으면 안내할 결과가 없어 ready 가 거짓이다.
 */
function ContactResultStatus({
  groupId,
  search,
  shownQuery,
  type,
  organization,
  title,
  searching,
  itemCount,
  hasNextPage,
  listReady,
}: {
  groupId: number | null
  search: string
  shownQuery: string
  type: ContactTypeFilter
  organization: string
  title: string
  searching: boolean
  itemCount: number
  hasNextPage: boolean
  listReady: boolean
}) {
  const groupFound = useGroupMemberSearch(groupId ?? 0, groupId != null ? search : '')
  const groupDetail = useUserGroupDetail(groupId)
  const { key, ready, text } =
    groupId != null
      ? {
          key: `group|${groupId}|${shownQuery}`,
          ready: shownQuery !== '' && groupDetail.isSuccess && groupFound.isSuccess && !groupFound.isFetching && !groupFound.isPlaceholderData,
          text: contactResultAnnouncement({ mode: 'group', count: groupFound.data?.length ?? 0 }),
        }
      : {
          key: `list|${shownQuery}|${type}|${organization}|${title}`,
          ready: listReady,
          text: contactResultAnnouncement({ mode: 'list', count: itemCount, more: hasNextPage, searching, favorite: type === 'FAVORITE' }),
        }
  return <ResultStatus conditionKey={key} ready={ready} text={text} testId="contact-result-status" />
}

/**
 * 검색 입력칸 — draft(타이핑 중 값) 상태를 페이지 밖 이 컴포넌트에 둔다(WP-1948).
 * draft 가 페이지에 있으면 키 입력마다 페이지 전체(행 수백 개)가 다시 그려진다. 여기 두면 키 입력은 이 입력칸만 다시 그린다.
 * 타이핑은 즉시 반영되되 URL(q)은 300ms debounce 뒤에만 쓴다 — q 가 URL 에 직접 묶이면 한글 IME 조합이 끊긴다(WP-974).
 * 내가 쓴 q 가 되돌아올 때 draft 를 덮지 않는 것(WP-999)·바깥 변경(지우기·뒤로 가기)에 맞추는 것은 useSearchDraft 가 맡는다.
 */
function ContactSearchInput({
  search,
  groupId,
  scopeName,
  onWrite,
  cancelKey,
}: {
  search: string
  groupId: number | null
  scopeName: string
  onWrite: (q: string) => void
  cancelKey: unknown
}) {
  const { draft, setDraft } = useSearchDraft(search, onWrite, 300, cancelKey)
  return (
    <FilterInput
      placeholder="이름·이메일"
      value={draft}
      onChange={setDraft}
      // 그룹 보기 검색은 하위 조직까지 찾는다(WP-1000) — 범위 안내는 placeholder 가 아니라 접근성 이름으로 둔다.
      aria-label={groupId != null ? `${scopeName}${andParticle(scopeName)} 하위 조직에서 검색` : '연락처 검색'}
      inputTestId="contact-search"
    />
  )
}

/** 통합 연락처 목록 + 마스터-디테일. 보기(type·group)는 ContactSidebar 와 URL searchParams 로 공유하고, 검색(q)은 목록 위 키워드 필터 줄이 쓴다(WP-976, WP-1355). */
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
  // 행을 고르는 순간 남은 검색 debounce 를 접는 신호(WP-1948) — 300ms 안에 고르면 예약돼 있던 q 쓰기가
  // writeQuery 로 방금 연 상세(?contact)를 지운다. 접으면 입력칸 draft 도 URL q 로 되돌아간다.
  const [searchCancel, setSearchCancel] = useState(0)
  const selectContact = (sel: ContactSelection) => {
    setSearchCancel((n) => n + 1)
    contactParam.open(encodeContactParam(sel))
  }
  // 행에 넘기는 안정된 선택 콜백(WP-1948) — 렌더마다 새 함수를 주면 ContactRow memo 가 무력해진다.
  // 최신 selectContact 는 useLatest 의 ref 로 들고, 콜백 자체는 한 번만 만든다.
  const selectContactRef = useLatest(selectContact)
  const selectRow = useCallback((sel: ContactSelection) => selectContactRef.current(sel), [selectContactRef])
  // 모바일: 상세가 열려 있으면 하단 탭바를 숨긴다(WP-125).
  useHideTabBar(selected != null)
  const [createOpen, setCreateOpen] = useState(false)
  const isMobile = useIsMobile()
  // 모바일에서 상세가 열리면 목록 헤더("연락처"·＋·☰·🔔) 대신 상세 헤더 한 줄만 둔다(U1-1).
  const showListChrome = !(isMobile && selected != null)

  // q 갱신 — 통합 목록은 바뀐 목록에 없는 상세가 남지 않게 열린 상세(?contact)도 같은 항목에서 닫는다(WP-206).
  // 그룹 보기는 검색어가 바뀌어도 상세를 그대로 둔다(WP-999) — 그 검색은 서버가 그 그룹과 하위 조직에서 다시 찾는데(WP-1000),
  // 보던 사람이 새 결과에서 빠져도 그 사람을 두고 같은 조직의 다른 사람을 찾을 수 있게. 그룹 여부는 렌더 시점 값이 아닌 prev 로 본다(같은 틱의 범위 해제와 경합하지 않게).
  // 공백만 친 입력을 빈 검색어로 보는 것·q 가 그대로면 쓰지 않는 것은 useSearchDraft 가 맡는다.
  const writeQuery = (q: string) =>
    setParams(
      (prev) => {
        const sp = new URLSearchParams(prev)
        if (parseGroupId(sp.get('group')) == null) sp.delete('contact')
        if (q) sp.set('q', q)
        else sp.delete('q')
        return sp
      },
      { replace: true },
    )
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

  // 검색어 지우기 — URL 의 q 만 writeQuery 로 지운다(통합 목록이라 열린 상세도 같은 항목에서 닫힌다, WP-1869).
  // 입력칸 draft 는 ContactSearchInput 안의 useSearchDraft 가 바깥 변경(내가 쓴 값이 아님)으로 보고 바로 비운다(WP-1948).
  const clearSearch = (): void => writeQuery('')

  // 필터 초기화 — 조직·직책 조건만 풀고(타입·검색어는 유지) 열린 상세도 닫는다(WP-1869).
  const resetFilters = (): void =>
    setParams(
      (prev) => {
        const sp = new URLSearchParams(prev)
        sp.delete('organization')
        sp.delete('title')
        sp.delete('contact')
        return sp
      },
      { replace: true },
    )

  // 그룹 보기의 검색은 GroupContactView 가 소속 멤버 안에서 거른다 — 통합 목록 조회는 쓰지 않으니 끈다.
  const contactsQuery = useContacts(search, type, organization, title, { enabled: groupId == null })
  // 오류 화면은 첫 페이지 실패만(failedWithoutData) — LoadMoreFooter 참조. 다시 시도 중(pending)에도 안내를 남긴다(WP-1820).
  const { data, isLoading, hasNextPage } = contactsQuery
  // 목록 스크롤 요소 — 무한 스크롤 sentinel 의 root(WP-182). 콜백 ref 라 마운트 후 재부착된다.
  const [listScrollEl, setListScrollEl] = useState<HTMLDivElement | null>(null)

  const items = data?.pages.flatMap((p) => p.items) ?? []
  // 0건일 때 검색·조직·직책 조건이 하나라도 있으면 「검색 결과 없음」, 없으면 진짜 빈 목록(WP-1869).
  // 검색어 앞뒤 공백은 보이는 문구·판정에서 뺀다(useSearchDraft 는 q 의 앞뒤 공백을 그대로 둔다 — 그룹 보기 문구와 같게).
  const shownQuery = search.trim()
  const searching = shownQuery !== '' || organization !== '' || title !== ''
  // 복구 버튼 — 걸린 조건에 해당하는 것만 둔다. 둘 다면 검색어 지우기가 앞, 필터 초기화가 옆(WP-1869).
  const clearAction = shownQuery !== '' ? { label: '검색어 지우기', onClick: clearSearch, testId: 'contact-empty-clear-search' } : undefined
  const resetAction =
    organization !== '' || title !== '' ? { label: '필터 초기화', onClick: resetFilters, testId: 'contact-empty-reset-filters' } : undefined

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

  // 범위 칩·검색 안내에 쓰는 그룹 이름 — 트리를 받기 전에는 「그룹」.
  const scopeName = groupName ?? '그룹'

  return (
    <>
      <Page>
        {/* 전폭 헤더 — 연락처 제목 + 새 외부 연락처 버튼(그룹·일반 공통). 모바일 상세가 열리면 숨김 — 상세 헤더 한 줄만(U1-1) */}
        {showListChrome && isMobile && groupId != null ? (
          // 모바일 그룹 보기 — 「‹ 그룹 이름」 한 줄(경로 전체는 넣지 않는다, §B-1). 우측은 목록 헤더와 같은 ＋·☰.
          <MobileDetailBar
            data-testid="contact-group-header"
            title={groupName ?? '그룹'}
            onBack={groupBack}
            // /contacts 는 탭 루트라 하단 탭바의 ✦ 가 남는다 — 헤더에 또 그리지 않는다.
            showAi={false}
            trailing={
              <>
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
                {/* 헤더 주 액션 — size 미지정(default). 04-components §E 규정(#744/#747). */}
                <Button data-testid="contact-create" onClick={() => setCreateOpen(true)}>
                  새 외부 연락처
                </Button>
              </>
            }
            // 모바일: ＋ 를 인라인 아이콘으로(⋯ 없음) — testid 를 공유하므로 actions 는 모바일에서 렌더되지 않게 null.
            mobilePrimaryAction={
              <>
                <HeaderIconAction label="새 외부 연락처" data-testid="contact-create" onClick={() => setCreateOpen(true)}><Plus /></HeaderIconAction>
              </>
            }
            mobileActions={null}
          />
        )}
        {/* 본문 — 목록·상세 마스터-디테일이라 스크롤·여백은 각 칸이 소유(padded=false), 행은 px-4 페이지 여백. */}
        <Page.Body padded={false}>
          {/* 결과 안내(WP-1943, SC 4.1.3) — live region 은 바뀌기 전에 이미 있어야 읽히므로 분기 밖에 늘 두고,
              좁은 화면에서 display:none 이 되는 목록 칸이 아닌 Body 직속에 둔다. */}
          <ContactResultStatus
            groupId={groupId}
            search={search}
            shownQuery={shownQuery}
            type={type}
            organization={organization}
            title={title}
            searching={searching}
            itemCount={items.length}
            hasNextPage={!!hasNextPage}
            listReady={contactsQuery.isSuccess && !contactsQuery.isFetching}
          />
          {/* 목록 (마스터) — 좁은 화면 + 선택 시 숨김 */}
          <div
            className={cn(
              // 우측 구분선은 목록·상세가 나란히 있는 데스크톱(lg+)에서만 — 모바일 전체폭 목록 끝에 선이 남지 않게(U3-R14).
              'flex min-w-0 flex-1 flex-col lg:border-r',
              selected != null && 'hidden lg:flex',
            )}
            data-testid="contact-list"
          >
            {/* 스크린리더 헤딩 탐색용 숨은 구역 제목(WP-1889) — 목록 칸을 h2 로 알린다(보이는 제목은 따로 없음). */}
            <h2 className="sr-only">연락처 목록</h2>
            {/* 목록 위 필터 줄(WP-1355) — 키워드(→ q) 다음에 그룹 범위 칩. 데스크톱·모바일 같은 줄이 폭에 맞춰 한 줄/두 줄로 바뀐다(돋보기 없음).
                자리표시는 통합 목록이 찾는 기준(이름·이메일)만 쓴다 — 소속(organization)은 통합 검색 대상이 아니다. */}
            {/* 모바일에서 상세가 열려도 필터 줄은 내리지 않는다(WP-1948) — 목록 칸 전체가 hidden 이라 보이지 않고,
                내리면 검색 draft 가 사라져 상세를 열기 직전 친 글자가 입력칸에서 증발한다. 행을 고르면 남은 debounce 를
                접어(searchCancel) 예약된 q 쓰기가 방금 연 상세를 닫지 않게 한다. */}
            <FilterLine
              data-testid="contact-filter-line"
              className="border-b px-4 py-2"
              keyword={
                <ContactSearchInput search={search} groupId={groupId} scopeName={scopeName} onWrite={writeQuery} cancelKey={searchCancel} />
              }
              chips={groupId != null ? <SearchScopeChip name={scopeName} onClear={leaveGroup} className="max-w-48" /> : undefined}
            />
            {groupId != null ? (
              <GroupContactView
                groupId={groupId}
                selected={selected}
                onSelect={selectContact}
                search={search}
                onSearchAll={leaveGroup}
              />
            ) : failedWithoutData(contactsQuery) ? (
              // 실패 먼저 — 다시 시도하면 status 가 pending 으로 돌아가 안내·초점을 잃는다(WP-881·WP-1820, lib/queryFailure).
              <LoadErrorState variant="inline" title="연락처를 불러오지 못했습니다" queries={[contactsQuery]} testId="contact-list-error" className="m-4" />
            ) : isLoading ? (
              <div className="p-6 text-sm text-muted-foreground">불러오는 중…</div>
            ) : items.length === 0 ? (
              // 빈 상태 — 검색·조직·직책 조건이 있으면 「검색 결과 없음」(연락처가 사라진 것처럼 읽히던 문제, WP-1869),
              // 없으면 첫 사용 빈 목록(즐겨찾기 모드는 전용 문구). design.md 2.2·2.5(empty vs no results).
              // 이 분기는 그룹 보기가 아닐 때만 렌더되므로 그룹 조건은 보지 않는다.
              // 목록 칸은 좌우 여백이 없어(Page.Body padded=false) 긴 검색어·버튼이 칸 끝에 붙지 않게 px-4 를 준다.
              <ListEmptyState
                icon={searching ? SearchX : type === 'FAVORITE' ? Star : Users}
                title={searching ? '검색 결과가 없습니다' : type === 'FAVORITE' ? '즐겨찾기한 연락처가 없습니다' : '연락처가 없습니다'}
                description={
                  !searching
                    ? undefined
                    : shownQuery
                      ? `「${shownQuery}」에 맞는 연락처가 없습니다`
                      : '선택한 조직·직책 조건에 맞는 연락처가 없습니다'
                }
                action={clearAction ?? resetAction}
                secondaryAction={clearAction && resetAction}
                testId="contact-empty"
                className="px-4"
              />
            ) : (
              <div ref={setListScrollEl} className="flex-1 overflow-y-auto">
                {items.map((c) => (
                  <ContactRow
                    key={`${c.type}-${c.id}`}
                    c={c}
                    active={selected?.type === c.type && selected?.id === c.id}
                    onSelect={selectRow}
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
