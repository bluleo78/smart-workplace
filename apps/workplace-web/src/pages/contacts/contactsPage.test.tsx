// 연락처 화면(통합 목록·사이드바 필터·상세·외부 연락처 CRUD·즐겨찾기) — 화면 테스트(WP-971, WP-995, WP-966).
// 필터·검색 → 목록 쿼리, 선택 표시 클래스·aria, 빈 상태 문구, 404 안내, 별 토글 payload, 외부 연락처 생성·편집·삭제·중복 강행·
// 유효성 문구·저장 뒤 목록/상세 갱신은 브라우저 없이 판정되므로 e2e/pages/contacts/contacts.spec.ts·contacts-favorites.spec.ts·
// contacts-external-crud.spec.ts 에서 옮겼다. 라우트 → 목록 API → 상세 배선(@wiring), 한글 IME 연속 입력(@input),
// 좁은 폭에서 목록이 숨는 2단 배치(@layout)는 contacts.spec.ts 의 E2E 가 지킨다.
// App 전체 대신 모듈 레이아웃(사이드바) + ContactsPage 만 renderScreen 으로 띄운다(testkit-b8).
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { expect, test } from 'vitest'

import { emptyTree, record, type Recorded, renderContacts } from '@/test/kits/contacts/testkit-b8'

import {
  external,
  externalDetail,
  member,
  memberDetail,
  page as makePage,
} from '../../../e2e/factories/contacts.factory'
import type { ContactSummary } from '../../types/contact'

/** 목록 요청 기록 + search·type·favorite·organization·title 로 거르는 목록 GET(E2E stubList 와 같은 규칙). 첫 멤버는 즐겨찾기. */
function listHandler(lists: Recorded[], base: () => ContactSummary[] = () => [member({ isFavorite: true }), external()]) {
  return http.get('/api/v1/contacts', async ({ request }) => {
    await record(lists, request)
    const u = new URL(request.url)
    const type = u.searchParams.get('type')
    const q = (u.searchParams.get('search') ?? '').toLowerCase()
    let items = base()
    if (type === 'MEMBER' || type === 'EXTERNAL') items = items.filter((c) => c.type === type)
    if (q) items = items.filter((c) => c.name.toLowerCase().includes(q) || (c.email ?? '').toLowerCase().includes(q))
    if (u.searchParams.get('favorite') === 'true') items = items.filter((c) => c.isFavorite)
    const org = u.searchParams.get('organization')
    const title = u.searchParams.get('title')
    if (org) items = items.filter((c) => c.organization === org)
    if (title) items = items.filter((c) => c.title === title)
    return HttpResponse.json(makePage(items))
  })
}

/** 마지막 목록 요청의 쿼리 하나. */
const lastParam = (lists: Recorded[], key: string) => lists.at(-1)?.url.searchParams.get(key) ?? null

/** 외부 탭이 부르는 조직·직책 후보. */
const facetsHandler = () =>
  http.get('/api/v1/contacts/facets', () => HttpResponse.json({ organizations: ['Corp', 'Globex'], titles: ['대표'] }))

const memberDetailHandler = () => http.get('/api/v1/contacts/members/1', () => HttpResponse.json(memberDetail()))

// ── 목록·필터·선택 ─────────────────────────────────────────────

// 타입 필터는 type 쿼리로, 검색은 300ms 디바운스 뒤 search 쿼리로 나가고 결과만 행으로 보인다(wiring E2E 에서 덜어 냄).
test('타입 필터·검색이 목록 쿼리(type·search)로 나가고 결과 행만 보인다', async () => {
  const lists: Recorded[] = []
  const { user, location } = renderContacts('/contacts', { handlers: [emptyTree(), facetsHandler(), listHandler(lists)] })
  expect(await screen.findByTestId('contact-row-MEMBER-1')).toBeInTheDocument()
  expect(screen.getByTestId('contact-row-EXTERNAL-100')).toBeInTheDocument()

  await user.click(screen.getByTestId('contact-filter-EXTERNAL'))
  await waitFor(() => expect(lastParam(lists, 'type')).toBe('EXTERNAL'))
  expect(await screen.findByTestId('contact-row-EXTERNAL-100')).toBeInTheDocument()
  expect(screen.queryByTestId('contact-row-MEMBER-1')).not.toBeInTheDocument()
  expect(location()).toContain('type=EXTERNAL')

  await user.click(screen.getByTestId('contact-filter-ALL'))
  expect(await screen.findByTestId('contact-row-MEMBER-1')).toBeInTheDocument()
  // 값만 채우면 되므로 change 한 번 — 디바운스 뒤 search 가 실린다.
  fireEvent.change(screen.getByTestId('contact-search'), { target: { value: '박외부' } })
  await waitFor(() => expect(lastParam(lists, 'search')).toBe('박외부'))
  expect(await screen.findByTestId('contact-row-EXTERNAL-100')).toBeInTheDocument()
  expect(screen.queryByTestId('contact-row-MEMBER-1')).not.toBeInTheDocument()
})

// WP-368 — 고른 연락처 행만 선택 표시(막대 + bg-selected)·aria-current, 사이드바 타입 필터도 활성 항목만 표시되고 바꾸면 옮겨 간다.
test('연락처 행·타입 필터 선택 표시 (WP-368)', async () => {
  const { user } = renderContacts('/contacts', { handlers: [emptyTree(), facetsHandler(), listHandler([]), memberDetailHandler()] })
  const picked = await screen.findByTestId('contact-row-MEMBER-1')
  const other = screen.getByTestId('contact-row-EXTERNAL-100')
  expect(picked).not.toHaveClass('bg-selected')
  await user.click(within(picked).getAllByRole('button')[0])
  expect(await screen.findByTestId('contact-detail-member')).toBeInTheDocument()
  expect(picked).toHaveClass('bg-selected', 'selection-bar')
  expect(other).not.toHaveClass('bg-selected')
  expect(other).not.toHaveClass('selection-bar')
  // 보조기기용 선택 정보는 행 안의 고르기 버튼이 갖는다.
  expect(within(picked).getAllByRole('button')[0]).toHaveAttribute('aria-current', 'true')
  expect(within(other).getAllByRole('button')[0]).not.toHaveAttribute('aria-current')

  const all = screen.getByTestId('contact-filter-ALL')
  const ext = screen.getByTestId('contact-filter-EXTERNAL')
  expect(all).toHaveClass('bg-selected', 'selection-bar')
  expect(all).toHaveAttribute('aria-current', 'page')
  expect(ext).not.toHaveClass('bg-selected')
  await user.click(ext)
  await waitFor(() => expect(ext).toHaveClass('bg-selected', 'selection-bar'))
  expect(ext).toHaveAttribute('aria-current', 'page')
  expect(all).not.toHaveClass('bg-selected')
  expect(all).not.toHaveAttribute('aria-current')
})

// #113 그룹 뷰에서도 공통 헤더의 「새 외부 연락처」가 보이고, #98 사이드바는 레일과 같은 「연락처」 타이틀 헤더를 갖는다.
test('그룹 뷰에서도 헤더 새 외부 연락처 버튼과 사이드바 타이틀이 보인다', async () => {
  renderContacts('/contacts?group=1', {
    handlers: [
      emptyTree(),
      listHandler([]),
      http.get('/api/v1/user-groups/1', () =>
        HttpResponse.json({ id: 1, code: null, name: '그룹1', parentId: null, ownerId: 1, visibility: 'PERSONAL', sortOrder: 0, members: [] }),
      ),
    ],
  })
  expect(await screen.findByTestId('group-contact-view')).toBeInTheDocument()
  expect(screen.getByTestId('page-header')).toHaveTextContent('연락처')
  expect(screen.getByTestId('contact-create')).toHaveTextContent('새 외부 연락처')
  expect(within(screen.getByTestId('contact-sidebar')).getByText('연락처', { exact: true })).toBeInTheDocument()
})

// #327/#94 즐겨찾기 필터 — favorite=true 로 조회해 즐겨찾기 항목만 보이고, 없으면 전용 빈 상태 문구.
test('즐겨찾기 필터 — favorite=true 로 조회해 즐겨찾기만 보이고, 없으면 전용 빈 상태', async () => {
  const lists: Recorded[] = []
  const { user } = renderContacts('/contacts', { handlers: [emptyTree(), listHandler(lists)] })
  expect(await screen.findByTestId('contact-row-EXTERNAL-100')).toBeInTheDocument()
  await user.click(screen.getByTestId('contact-filter-FAVORITE'))
  await waitFor(() => expect(lastParam(lists, 'favorite')).toBe('true'))
  expect(lastParam(lists, 'type')).toBeNull()
  expect(await screen.findByTestId('contact-row-MEMBER-1')).toBeInTheDocument()
  expect(screen.queryByTestId('contact-row-EXTERNAL-100')).not.toBeInTheDocument()
})

test('즐겨찾기 필터 — 즐겨찾기가 없으면 「즐겨찾기한 연락처가 없습니다」', async () => {
  const { user } = renderContacts('/contacts', {
    handlers: [emptyTree(), listHandler([], () => [member(), external()])],
  })
  await screen.findByTestId('contact-row-MEMBER-1')
  await user.click(screen.getByTestId('contact-filter-FAVORITE'))
  expect(await screen.findByTestId('contact-empty')).toHaveTextContent('즐겨찾기한 연락처가 없습니다')
})

// #329 외부 고급 필터 — 외부 탭에서만 보이고, 조직·직책 고르기는 쿼리로 나가며, 초기화·다른 탭 전환이 URL 파라미터를 지운다.
test('외부 고급 필터(조직·직책) — 노출 조건·쿼리·초기화·탭 이탈 정리', async () => {
  const lists: Recorded[] = []
  const { user, location } = renderContacts('/contacts', {
    handlers: [
      emptyTree(),
      listHandler(lists),
      facetsHandler(),
    ],
  })
  await screen.findByTestId('contact-row-EXTERNAL-100')
  expect(screen.queryByTestId('contact-advanced-filter')).not.toBeInTheDocument()

  await user.click(screen.getByTestId('contact-filter-EXTERNAL'))
  expect(await screen.findByTestId('contact-advanced-filter')).toBeInTheDocument()

  // 조직=Globex → organization 쿼리. external() 의 조직은 Corp 이라 0건 → 빈 상태.
  await user.click(screen.getByTestId('contact-filter-org'))
  await user.click(await screen.findByTestId('contact-filter-org-Globex'))
  expect(await screen.findByTestId('contact-empty')).toBeInTheDocument()
  expect(lastParam(lists, 'organization')).toBe('Globex')

  await user.click(screen.getByTestId('contact-filter-reset'))
  expect(await screen.findByTestId('contact-row-EXTERNAL-100')).toBeInTheDocument()
  expect(screen.queryByTestId('contact-filter-reset')).not.toBeInTheDocument()
  expect(location()).not.toContain('organization=')

  // 직책=대표 → title 쿼리. external() 의 title=null 이라 0건.
  await user.click(screen.getByTestId('contact-filter-title'))
  await user.click(await screen.findByTestId('contact-filter-title-대표'))
  expect(await screen.findByTestId('contact-empty')).toBeInTheDocument()
  expect(lastParam(lists, 'title')).toBe('대표')
  await user.click(screen.getByTestId('contact-filter-reset'))
  expect(await screen.findByTestId('contact-row-EXTERNAL-100')).toBeInTheDocument()

  // 조직을 다시 고른 채 다른 탭으로 가면 고급 필터가 숨고 organization 도 URL 에서 빠진다.
  await user.click(screen.getByTestId('contact-filter-org'))
  await user.click(await screen.findByTestId('contact-filter-org-Corp'))
  await waitFor(() => expect(location()).toContain('organization=Corp'))
  await user.click(screen.getByTestId('contact-filter-ALL'))
  await waitFor(() => expect(screen.queryByTestId('contact-advanced-filter')).not.toBeInTheDocument())
  expect(location()).not.toContain('organization=')
})

// WP-555: 없거나 볼 수 없는 연락처(404)를 주소로 열면 「다시 시도」 대신 안내 + 목록으로만 보인다(데스크톱 2단). 모바일은 backContacts.test.tsx.
test('404 연락처 주소 — 찾을 수 없음 안내와 목록으로(데스크톱)', async () => {
  const { user, location } = renderContacts('/contacts?contact=external:999', {
    handlers: [
      emptyTree(),
      listHandler([]),
      http.get('/api/v1/contacts/external/999', () =>
        HttpResponse.json({ status: 404, message: '연락처를 찾을 수 없습니다' }, { status: 404 }),
      ),
    ],
  })
  const notFound = await screen.findByTestId('contact-detail-not-found')
  expect(notFound).toHaveTextContent('연락처를 찾을 수 없거나 볼 수 없습니다')
  expect(screen.queryByRole('button', { name: '다시 시도' })).not.toBeInTheDocument()
  await user.click(screen.getByTestId('contact-detail-back-to-list'))
  await waitFor(() => expect(location()).not.toContain('contact='))
  expect(screen.queryByTestId('contact-detail-not-found')).not.toBeInTheDocument()
  expect(screen.getByTestId('contact-detail-empty')).toBeInTheDocument()
})

// ── 즐겨찾기 토글 ─────────────────────────────────────────────

/** 즐겨찾기 POST 기록. */
const favoriteHandler = (posts: Recorded[]) =>
  http.post('/api/v1/contacts/favorites', async ({ request }) => {
    await record(posts, request)
    return new HttpResponse(null, { status: 204 })
  })

// WP-923: 행마다 반복되는 별 버튼은 이름에 연락처 이름이 들어가고, 누르면 그 연락처로 추가 요청이 나간다.
test('목록 행 별 토글 — 이름이 구분되고 추가 요청 payload 가 그 연락처다', async () => {
  const posts: Recorded[] = []
  const { user } = renderContacts('/contacts', {
    handlers: [emptyTree(), listHandler([], () => [member(), external()]), favoriteHandler(posts)],
  })
  const ext = await screen.findByTestId('contact-fav-EXTERNAL-100')
  expect(ext).toHaveAccessibleName('박외부 즐겨찾기 추가')
  expect(screen.getByTestId('contact-fav-MEMBER-1')).toHaveAccessibleName('김멤버 즐겨찾기 추가')
  await user.click(ext)
  await waitFor(() => expect(posts).toHaveLength(1))
  expect(posts[0].body).toMatchObject({ targetType: 'EXTERNAL', targetId: 100 })
})

test('상세 패널 별 토글 — 추가 요청', async () => {
  const posts: Recorded[] = []
  const { user } = renderContacts('/contacts?contact=external:100', {
    handlers: [
      emptyTree(),
      listHandler([], () => [external()]),
      http.get('/api/v1/contacts/external/100', () => HttpResponse.json(externalDetail({ isFavorite: false }))),
      favoriteHandler(posts),
    ],
  })
  await screen.findByTestId('contact-detail-external')
  await user.click(screen.getByTestId('contact-detail-fav'))
  await waitFor(() => expect(posts).toHaveLength(1))
  expect(posts[0].body).toMatchObject({ targetType: 'EXTERNAL', targetId: 100 })
})

// ── 외부 연락처 CRUD ─────────────────────────────────────────────

/** 「새 외부 연락처」 대화상자를 연다. */
async function openCreate(user: ReturnType<typeof renderContacts>['user']) {
  await user.click(await screen.findByTestId('contact-create'))
  return screen.findByTestId('external-contact-dialog')
}

/** 입력칸 값을 채운다(키 하나하나는 의미 없음). */
const fill = (testId: string, value: string) => fireEvent.change(screen.getByTestId(testId), { target: { value } })

// 입력 → POST payload(기본 공개 범위 PERSONAL) → 대화상자 닫힘 → 목록 무효화로 새 행이 보인다.
test('외부 연락처 생성 — payload·닫힘·목록 갱신', async () => {
  const posts: Recorded[] = []
  const { user } = renderContacts('/contacts', {
    handlers: [
      emptyTree(),
      listHandler([], () => (posts.length ? [external(), external({ id: 200, name: '신규연락처' })] : [external()])),
      http.post('/api/v1/contacts/external', async ({ request }) => {
        await record(posts, request)
        return HttpResponse.json(externalDetail({ id: 200, name: '신규연락처' }), { status: 201 })
      }),
    ],
  })
  await screen.findByTestId('contact-row-EXTERNAL-100')
  await openCreate(user)
  fill('c-name', '신규연락처')
  fill('c-email', 'new@corp.com')
  await user.click(screen.getByTestId('c-save'))
  await waitFor(() => expect(screen.queryByTestId('external-contact-dialog')).not.toBeInTheDocument())
  expect(posts[0].body).toMatchObject({ name: '신규연락처', email: 'new@corp.com', visibility: 'PERSONAL' })
  expect(await screen.findByTestId('contact-row-EXTERNAL-200')).toBeInTheDocument()
})

// WP-636: 전화 칸은 휴대폰 전화 키패드용 type=tel 이고, 입력한 번호가 그대로 payload 로 간다.
test('외부 연락처 생성 — 전화 칸은 type=tel 이고 번호를 그대로 저장한다', async () => {
  const posts: Recorded[] = []
  const { user } = renderContacts('/contacts', {
    handlers: [
      emptyTree(),
      listHandler([], () => [external()]),
      http.post('/api/v1/contacts/external', async ({ request }) => {
        await record(posts, request)
        return HttpResponse.json(externalDetail({ id: 201, name: '전화연락처' }), { status: 201 })
      }),
    ],
  })
  await openCreate(user)
  expect(screen.getByTestId('c-phone')).toHaveAttribute('type', 'tel')
  fill('c-name', '전화연락처')
  fill('c-phone', '010-1234-5678')
  await user.click(screen.getByTestId('c-save'))
  await waitFor(() => expect(posts).toHaveLength(1))
  expect(posts[0].body).toMatchObject({ name: '전화연락처', phone: '010-1234-5678' })
})

// WP-546: 메모 2000자 상한 — 메모 칸 아래 안내가 보이고 저장 요청은 나가지 않는다.
test('외부 연락처 생성 — 메모 2000자를 넘으면 안내가 보이고 저장하지 않는다', async () => {
  let posts = 0
  const { user } = renderContacts('/contacts', {
    handlers: [
      emptyTree(),
      listHandler([], () => [external()]),
      http.post('/api/v1/contacts/external', () => {
        posts++
        return HttpResponse.json(externalDetail(), { status: 201 })
      }),
    ],
  })
  await openCreate(user)
  fill('c-name', '남궁민수')
  fill('c-notes', '가'.repeat(2001))
  await user.click(screen.getByTestId('c-save'))
  expect(await screen.findByText('메모는 2000자 이하여야 합니다')).toBeInTheDocument()
  expect(screen.getByTestId('external-contact-dialog')).toBeInTheDocument()
  expect(posts).toBe(0)
})

// WP-546: 이미 저장된 아주 긴 메모는 상세에서 앞 2000자 + 말줄임만 보인다.
test('외부 연락처 상세 — 2000자를 넘는 기존 메모는 앞부분만 줄여 보인다', async () => {
  renderContacts('/contacts?contact=external:100', {
    handlers: [
      emptyTree(),
      listHandler([], () => [external()]),
      http.get('/api/v1/contacts/external/100', () =>
        HttpResponse.json(externalDetail({ notes: '가'.repeat(2000) + '나'.repeat(50_000) })),
      ),
    ],
  })
  await screen.findByTestId('contact-detail-external')
  expect(screen.getByText('가'.repeat(2000) + '…', { exact: true })).toBeInTheDocument()
  expect(screen.queryByText(/나나나나나/)).not.toBeInTheDocument()
})

// 편집 → PATCH 본문 → 상세 무효화로 수정된 이름이 보인다.
test('외부 연락처 편집 — PATCH 본문과 상세 갱신', async () => {
  const patches: Recorded[] = []
  const { user } = renderContacts('/contacts?contact=external:100', {
    handlers: [
      emptyTree(),
      listHandler([], () => [external()]),
      http.get('/api/v1/contacts/external/100', () =>
        HttpResponse.json(externalDetail(patches.length ? { name: '수정됨' } : {})),
      ),
      http.patch('/api/v1/contacts/external/100', async ({ request }) => {
        await record(patches, request)
        return HttpResponse.json(externalDetail({ name: '수정됨' }))
      }),
    ],
  })
  expect(await screen.findByTestId('contact-detail-external')).toHaveTextContent('박외부')
  await user.click(screen.getByTestId('contact-edit'))
  await screen.findByTestId('external-contact-dialog')
  await waitFor(() => expect(screen.getByTestId('c-name')).toHaveValue('박외부'))
  fill('c-name', '수정됨')
  await user.click(screen.getByTestId('c-save'))
  await waitFor(() => expect(patches).toHaveLength(1))
  expect(patches[0].body).toMatchObject({ name: '수정됨' })
  await waitFor(() => expect(screen.getByTestId('contact-detail-external')).toHaveTextContent('수정됨'))
})

// 삭제 확인 → DELETE → 선택 해제(빈 상세 안내) → 목록 무효화로 행이 사라진다.
test('외부 연락처 삭제 — 확인 뒤 DELETE, 빈 상세와 목록 갱신', async () => {
  let deletes = 0
  const { user, location } = renderContacts('/contacts', {
    handlers: [
      emptyTree(),
      listHandler([], () => (deletes ? [] : [external()])),
      http.get('/api/v1/contacts/external/100', () => HttpResponse.json(externalDetail())),
      http.delete('/api/v1/contacts/external/100', () => {
        deletes++
        return new HttpResponse(null, { status: 204 })
      }),
    ],
  })
  const row = await screen.findByTestId('contact-row-EXTERNAL-100')
  await user.click(within(row).getAllByRole('button')[0])
  await user.click(await screen.findByTestId('contact-delete'))
  const confirm = await screen.findByRole('alertdialog')
  await user.click(within(confirm).getByRole('button', { name: '삭제' }))
  await waitFor(() => expect(deletes).toBe(1))
  const empty = await screen.findByTestId('contact-detail-empty')
  expect(empty).toHaveTextContent('연락처를 선택하세요')
  expect(location()).not.toContain('contact=')
  await waitFor(() => expect(screen.queryByTestId('contact-row-EXTERNAL-100')).not.toBeInTheDocument())
})

// #790: 이름+이메일 중복은 409 소프트 경고 — 확인 창을 띄우고(생성 창 유지), 강행하면 force=true 로 다시 보내 저장한다.
test('외부 연락처 생성 — 중복 409 면 확인 창 뒤 force=true 로 강행 저장한다', async () => {
  const posts: Recorded[] = []
  const { user } = renderContacts('/contacts', {
    handlers: [
      emptyTree(),
      listHandler([], () => (posts.length >= 2 ? [external(), external({ id: 201, name: '김민수' })] : [external()])),
      http.post('/api/v1/contacts/external', async ({ request }) => {
        await record(posts, request)
        if (new URL(request.url).searchParams.get('force') !== 'true') {
          return HttpResponse.json(
            { status: 409, error: 'Conflict', message: '이미 존재하는 연락처입니다: 김민수', errors: null, path: '/api/v1/contacts/external' },
            { status: 409 },
          )
        }
        return HttpResponse.json(externalDetail({ id: 201, name: '김민수' }), { status: 201 })
      }),
    ],
  })
  await screen.findByTestId('contact-row-EXTERNAL-100')
  await openCreate(user)
  fill('c-name', '김민수')
  fill('c-email', 'kim@test.com')
  await user.click(screen.getByTestId('c-save'))
  expect(await screen.findByTestId('contact-duplicate-dialog')).toBeInTheDocument()
  expect(screen.getByTestId('external-contact-dialog')).toBeInTheDocument()

  await user.click(screen.getByTestId('contact-duplicate-confirm'))
  await waitFor(() => expect(posts).toHaveLength(2))
  expect(posts.map((p) => p.url.searchParams.get('force') === 'true')).toEqual([false, true])
  expect(posts[1].body).toMatchObject({ name: '김민수' })
  await waitFor(() => expect(screen.queryByTestId('external-contact-dialog')).not.toBeInTheDocument())
  expect(screen.queryByTestId('contact-duplicate-dialog')).not.toBeInTheDocument()
  expect(await screen.findByTestId('contact-row-EXTERNAL-201')).toBeInTheDocument()
})

// 편집 권한이 없는(editable=false) 외부 연락처는 수정·삭제 버튼이 없다.
test('editable=false 면 수정/삭제 미노출', async () => {
  renderContacts('/contacts?contact=external:100', {
    handlers: [
      emptyTree(),
      listHandler([], () => [external()]),
      http.get('/api/v1/contacts/external/100', () => HttpResponse.json(externalDetail({ editable: false }))),
    ],
  })
  expect(await screen.findByTestId('contact-detail-external')).toHaveTextContent('박외부')
  expect(screen.queryByTestId('contact-edit')).not.toBeInTheDocument()
  expect(screen.queryByTestId('contact-delete')).not.toBeInTheDocument()
})
