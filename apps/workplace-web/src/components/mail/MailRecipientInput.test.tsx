// 메일 받는사람에 조직·내 그룹 넣기(WP-1060) — 화면 테스트(renderScreen).
// 쓰는 조각에 맞는 부서·내 그룹이 사람 후보 아래 인원 수·꼬리표와 함께 보이고, 고르면 그때의 구성원 주소가 칩으로 풀린다
// (이 칸에 이미 있는 주소는 빼고, 내 그룹의 외부 연락처도 넣고, 주소가 없는 사람은 넣지 않고 토스트로 알린다).
// 수신인 칩 메뉴(WP-2150) — 칩 이름을 누르면 다른 칸으로 옮기기·주소 복사·빼기 메뉴가 열리고, × 단추는 그대로 바로 뺀다.
import { DndContext } from '@dnd-kit/core'
import { act, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse, type RequestHandler } from 'msw'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { moveRecipient, type RecipientField, type RecipientFieldRest, type RecipientFields, removeRecipient } from '@/lib/mailRecipientSuggest'
import { server } from '@/test/msw/server'
import { renderScreen } from '@/test/renderScreen'
import type { UserGroupMemberHit } from '@/types/userGroup'

import { external, member, page as contactPage } from '../../../e2e/factories/contacts.factory'
import { personalNode, sharedNode } from '../../../e2e/factories/userGroups.factory'
import { MailRecipientInput } from './MailRecipientInput'

const API = '/api/v1'

/** 테스트용 DndContext — 메뉴·삭제 동작만 확인할 때 끌기 센서 없이 쓴다. */
function withDnd(node: ReactNode) {
  return <DndContext sensors={[]}>{node}</DndContext>
}

function hit(over: Partial<UserGroupMemberHit> & Pick<UserGroupMemberHit, 'targetId' | 'name'>): UserGroupMemberHit {
  return { targetType: 'MEMBER', email: null, title: null, organization: null, groupId: 0, groupPath: [], ...over }
}

/** 조직도: 경영지원본부(1) › 개발팀(2) › 플랫폼파트(3), 디자인팀(4). 내 그룹: 개발 주간회의(20). */
const TREE = {
  shared: [
    sharedNode({
      id: 1,
      name: '경영지원본부',
      children: [
        sharedNode({ id: 2, name: '개발팀', parentId: 1, children: [sharedNode({ id: 3, name: '플랫폼파트', parentId: 2 })] }),
        sharedNode({ id: 4, name: '디자인팀', parentId: 1 }),
      ],
    }),
  ],
  personal: [personalNode({ id: 20, name: '개발 주간회의' })],
}

/** 그룹 id → 하위 그룹까지 모은 구성원(서버 「하위 조직 포함 구성원 찾기」 응답). */
const MEMBERS: Record<number, UserGroupMemberHit[]> = {
  2: [
    hit({ targetId: 11, name: '김개발', email: 'kim@iacloud.kr' }),
    hit({ targetId: 12, name: '이개발', email: 'lee@iacloud.kr', groupPath: ['플랫폼파트'] }),
    hit({ targetId: 13, name: '박서버', email: 'park@iacloud.kr' }),
    hit({ targetId: 14, name: '정AI', email: null }),
  ],
  20: [
    hit({ targetId: 11, name: '김개발', email: 'kim@iacloud.kr' }),
    hit({ targetType: 'EXTERNAL', targetId: 100, name: 'David Han', email: 'dhan@partner.co.kr' }),
    hit({ targetType: 'EXTERNAL', targetId: 101, name: 'Erin', email: 'erin@partner.co.kr' }),
  ],
}

/**
 * 기본 응답. read 는 그룹 id → 지금 구성원 — 인원 수(member-counts)와 고를 때의 구성원 찾기가 같은 데이터에서 나온다(서버와 같은 규칙: 같은 사람 한 번).
 * memberSearches 는 구성원 찾기를 부른 그룹, countRequests 는 인원 수 요청마다의 ids(WP-1135 — 글자를 칠 때는 구성원 찾기가 돌지 않는다).
 */
function handlers(read: (id: number) => UserGroupMemberHit[] = (id) => MEMBERS[id] ?? []) {
  const memberSearches: number[] = []
  const countRequests: string[] = []
  return {
    memberSearches,
    countRequests,
    list: [
      http.get(`${API}/mail/recent-recipients`, () => HttpResponse.json([])),
      // 사람 후보 — 「개발」로 시작하는 구성원 한 명(조직·그룹 섹션과 함께 보인다).
      http.get(`${API}/contacts`, () =>
        HttpResponse.json(contactPage([member({ id: 50, name: '개발자 김', email: 'dev.kim@iacloud.kr' }), external({ id: 51, name: 'x', email: null })])),
      ),
      http.get(`${API}/user-groups`, () => HttpResponse.json(TREE)),
      http.get(`${API}/user-groups/member-counts`, ({ request }) => {
        const ids = new URL(request.url).searchParams.get('ids') ?? ''
        countRequests.push(ids)
        return HttpResponse.json(
          ids.split(',').map(Number).map((groupId) => {
            const people = [...new Map(read(groupId).map((m) => [`${m.targetType}:${m.targetId}`, m])).values()]
            return { groupId, total: people.length, external: people.filter((m) => m.targetType === 'EXTERNAL').length }
          }),
        )
      }),
      http.get(`${API}/user-groups/:id/members/search`, ({ params, request }) => {
        const id = Number(params.id)
        memberSearches.push(id)
        expect(new URL(request.url).searchParams.get('q')).toBe('')
        return HttpResponse.json(read(id))
      }),
    ],
  }
}

/** 칸 셋(받는 사람·참조)을 바깥 상태와 함께 — 바뀐 한 줄을 화면에 내보여 발송 값도 본다. 끌기 연결은 아직 없어 DndContext 만 둘러싼다. */
function Harness({ initialTo = '', initialCc = '', mobile = false }: { initialTo?: string; initialCc?: string; mobile?: boolean }) {
  const [to, setTo] = useState(initialTo)
  const [cc, setCc] = useState(initialCc)
  return withDnd(
    <div>
      <MailRecipientInput label="받는 사람" mobile={mobile} testId="mail-compose-to" field="to" value={to} onChange={setTo} chipOpSeq={0} />
      <MailRecipientInput label="참조" mobile={mobile} testId="mail-compose-cc" field="cc" value={cc} onChange={setCc} chipOpSeq={0} />
      <output data-testid="to-value">{to}</output>
      <output data-testid="cc-value">{cc}</output>
    </div>,
  )
}

const chipValues = (testId: string) => screen.queryAllByTestId(`${testId}-chip`).map((c) => c.getAttribute('data-value'))

/** 그룹 줄마다 「이름|인원|둘째 줄|꼬리표」. */
function groupRows() {
  return screen.getAllByTestId('mail-recipient-group-suggestion').map((row) => {
    const [main, sub] = row.querySelectorAll(':scope > span:nth-child(2) > span')
    return [main?.textContent, sub?.textContent ?? '', row.lastElementChild?.textContent].join('|')
  })
}

/**
 * 이번 테스트에서 사람 후보를 찾은 조각들(`/contacts?search=`) — 요청은 디바운스(150ms)가 지나 후보가 그 조각을 기준으로 바뀐 뒤에 나간다.
 * 테스트가 바꾼 핸들러(늦게 답하는 `/contacts` 등)에서도 모이게 MSW 요청 시작 이벤트로 듣는다.
 */
const searched = new Set<string>()
const onRequestStart = ({ request }: { request: Request }) => {
  const url = new URL(request.url)
  if (url.pathname === `${API}/contacts`) searched.add(url.searchParams.get('search') ?? '')
}
beforeEach(() => {
  searched.clear()
  server.events.on('request:start', onRequestStart)
})
afterEach(() => {
  server.events.removeListener('request:start', onRequestStart)
  // 클립보드 가짜(navigator) 등 이 테스트가 바꾼 전역을 되돌린다.
  vi.unstubAllGlobals()
})

/**
 * 그룹 줄이 지금 쓴 조각으로 찾아지고 인원 수까지 받아 고를 수 있게 될 때까지(WP-1232).
 * 줄 수만 보면 부하 중 글자 사이에 디바운스가 먼저 끝나 앞 조각(「주간」의 「주」)으로 찾은 같은 줄을 기다린 것이 되어,
 * 후보가 쓴 글자 기준이 아니라(fresh 아님) ↓·Enter 가 그룹 대신 쓴 글자를 칩으로 굳힌다 — 초점 칸의 조각을 찾았는지도 함께 본다.
 * 같은 조각을 다시 치면 캐시(10초)를 써 요청이 나가지 않으므로 「한 번이라도 찾았는지」로 본다.
 */
async function waitGroupsReady(count: number) {
  await waitFor(() => {
    expect(searched).toContain((document.activeElement as HTMLInputElement).value.trim())
    const rows = screen.getAllByTestId('mail-recipient-group-suggestion')
    expect(rows).toHaveLength(count)
    for (const r of rows) expect(r).not.toHaveAttribute('aria-disabled')
  })
}

describe('메일 받는사람 — 조직·내 그룹(WP-1060)', () => {
  it('쓰는 조각에 맞는 부서·내 그룹이 사람 후보 아래 인원 수·경로·꼬리표와 함께 보인다', async () => {
    const h = handlers()
    const { user } = renderScreen(<Harness />, { handlers: h.list })
    await user.click(screen.getByTestId('mail-compose-to'))
    await user.type(screen.getByTestId('mail-compose-to'), '개발')
    await waitGroupsReady(2)
    // 사람 후보는 그대로 위에, 그 아래 조직·그룹 섹션.
    const list = screen.getByTestId('mail-compose-to-suggestions')
    expect(within(list).getAllByTestId('mail-recipient-suggestion')).toHaveLength(1)
    expect(within(list).getByText('조직·그룹 — 고르면 구성원 주소로 풀어 넣습니다')).toBeInTheDocument()
    expect(groupRows()).toEqual([
      '개발팀 · 4명|경영지원본부 › 개발팀 (하위 부서 포함)|조직',
      '개발 주간회의 · 3명|외부 연락처 2명 포함|내 그룹',
    ])
    // 이름에 조각이 없는 부서(경로에만 있는 플랫폼파트·디자인팀)는 보이지 않는다 — 인원은 찾은 두 그룹을 한 요청으로 센다.
    expect(h.countRequests.at(-1)).toBe('2,20')
    // 글자를 치는 동안 그룹마다 구성원 전체를 받지 않는다(WP-1135) — 구성원 찾기는 고를 때만 돈다.
    expect(h.memberSearches).toEqual([])
  })

  it('조각을 바꿔 쳐도 구성원 전체 조회는 돌지 않고, 인원 수 요청은 찾은 그룹 묶음마다 한 번이다(WP-1135)', async () => {
    const h = handlers()
    const { user } = renderScreen(<Harness />, { handlers: h.list })
    const to = screen.getByTestId('mail-compose-to')
    await user.click(to)
    await user.type(to, '개발')
    await waitGroupsReady(2)
    await user.clear(to)
    await user.type(to, '디자인')
    await waitGroupsReady(1)
    await user.clear(to)
    await user.type(to, '개발')
    await waitGroupsReady(2)
    expect(h.memberSearches).toEqual([])
    // 「개발」 묶음은 캐시(1분)를 다시 써 두 번째에는 요청하지 않는다.
    expect(h.countRequests).toEqual(['2,20', '4'])
    // 고르면 그때 그 그룹만 구성원을 받는다.
    await user.click(screen.getAllByTestId('mail-recipient-group-suggestion')[0])
    await waitFor(() => expect(h.memberSearches).toEqual([2]))
  })

  it('부서를 고르면 구성원 주소가 칩으로 풀리고, 이미 있는 주소는 빼고, 주소 없는 사람은 넣지 않고 알린다', async () => {
    const h = handlers()
    const { user } = renderScreen(<Harness initialTo="이개발 <LEE@iacloud.kr>" />, { handlers: h.list })
    await user.click(screen.getByTestId('mail-compose-to'))
    await user.type(screen.getByTestId('mail-compose-to'), '개발팀')
    await waitGroupsReady(1)
    await user.click(screen.getByTestId('mail-recipient-group-suggestion'))

    expect(
      await screen.findByText('개발팀에서 2명을 넣었습니다. 이미 들어 있는 1명은 빼고, 메일 주소가 없는 1명(정AI)은 넣지 못했습니다.'),
    ).toBeInTheDocument()
    expect(chipValues('mail-compose-to')).toEqual(['이개발 <LEE@iacloud.kr>', '김개발 <kim@iacloud.kr>', '박서버 <park@iacloud.kr>'])
    expect(screen.getByTestId('to-value')).toHaveTextContent('이개발 <LEE@iacloud.kr>, 김개발 <kim@iacloud.kr>, 박서버 <park@iacloud.kr>')
    expect(screen.getByTestId('mail-compose-to')).toHaveValue('')

    // 풀린 주소는 보통 칩이라 하나씩 뺄 수 있다.
    await user.click(screen.getByRole('button', { name: '박서버 빼기' }))
    expect(chipValues('mail-compose-to')).toEqual(['이개발 <LEE@iacloud.kr>', '김개발 <kim@iacloud.kr>'])
  })

  it('내 그룹은 외부 연락처 주소까지 넣고, ↓ 로 그룹 줄을 짚어 Enter 로도 고른다(참조 칸)', async () => {
    const h = handlers()
    const { user } = renderScreen(<Harness initialCc="kim@iacloud.kr" />, { handlers: h.list })
    const cc = screen.getByTestId('mail-compose-cc')
    await user.click(cc)
    await user.type(cc, '주간')
    await waitGroupsReady(1)
    // 사람 후보가 없어도 그룹 줄은 저절로 강조되지 않는다 — ↓ 로 짚어야 Enter 가 고른다.
    expect(screen.queryAllByTestId('mail-recipient-suggestion')).toHaveLength(0)
    expect(screen.getByTestId('mail-recipient-group-suggestion')).toHaveAttribute('aria-selected', 'false')
    await user.keyboard('{ArrowDown}')
    expect(screen.getByTestId('mail-recipient-group-suggestion')).toHaveAttribute('aria-selected', 'true')
    await user.keyboard('{Enter}')

    expect(await screen.findByText('개발 주간회의에서 2명을 넣었습니다. 이미 들어 있는 1명은 뺐습니다.')).toBeInTheDocument()
    expect(chipValues('mail-compose-cc')).toEqual(['kim@iacloud.kr', 'David Han <dhan@partner.co.kr>', 'Erin <erin@partner.co.kr>'])
    expect(chipValues('mail-compose-to')).toEqual([])
  })

  it('그룹 줄은 Enter·Tab 의 기본 후보가 아니다 — 짚지 않고 Enter 면 첫 사람 후보, 사람이 없으면 쓴 글자를 굳힌다', async () => {
    const h = handlers()
    const { user } = renderScreen(<Harness />, { handlers: h.list })
    const to = screen.getByTestId('mail-compose-to')
    await user.click(to)
    await user.type(to, '개발')
    await waitGroupsReady(2)
    // 사람 후보가 있으면 Enter 는 그 사람(그룹은 풀리지 않는다).
    await user.keyboard('{Enter}')
    expect(chipValues('mail-compose-to')).toEqual(['개발자 김 <dev.kim@iacloud.kr>'])

    // 사람 후보가 없으면 그룹 줄이 있어도 Enter 는 쓴 글자를 굳힐 뿐이다.
    await user.type(to, '주간')
    await waitGroupsReady(1)
    await user.keyboard('{Enter}')
    expect(chipValues('mail-compose-to')).toEqual(['개발자 김 <dev.kim@iacloud.kr>', '주간'])
    expect(screen.queryByText(/에서 \d+명을 넣었습니다/)).not.toBeInTheDocument()
  })

  it('마우스를 올려 둔 그룹 줄도 Enter 로는 고르지 않는다 — 누르기나 ↑↓ 로만', async () => {
    const h = handlers()
    const { user } = renderScreen(<Harness />, { handlers: h.list })
    const to = screen.getByTestId('mail-compose-to')
    await user.click(to)
    await user.type(to, '주간')
    await waitGroupsReady(1)
    await user.hover(screen.getByTestId('mail-recipient-group-suggestion'))
    await user.keyboard('{Enter}')
    expect(chipValues('mail-compose-to')).toEqual(['주간'])
    expect(screen.queryByText(/에서 \d+명을 넣었습니다/)).not.toBeInTheDocument()
  })

  it('↓ 로 사람 후보를 지나 그룹 줄로 가 Enter 로 고른다(모바일 칸도 같다)', async () => {
    const h = handlers()
    const { user } = renderScreen(<Harness mobile />, { handlers: h.list })
    const to = screen.getByTestId('mail-compose-to')
    await user.click(to)
    await user.type(to, '개발')
    await waitGroupsReady(2)
    // 첫 줄은 사람 → ↓ 한 번이면 개발팀.
    await user.keyboard('{ArrowDown}')
    expect(screen.getAllByTestId('mail-recipient-group-suggestion')[0]).toHaveAttribute('aria-selected', 'true')
    await user.keyboard('{Enter}')
    expect(await screen.findByText('개발팀에서 3명을 넣었습니다. 메일 주소가 없는 1명(정AI)은 넣지 못했습니다.')).toBeInTheDocument()
    expect(chipValues('mail-compose-to')).toEqual(['김개발 <kim@iacloud.kr>', '이개발 <lee@iacloud.kr>', '박서버 <park@iacloud.kr>'])
  })

  it('인원을 세기 전에는 그룹 줄을 고를 수 없다 — ↓ 로 짚어도 Enter 는 쓴 글자를 굳힌다(글자가 칸에 묶이지 않는다)', async () => {
    const h = handlers()
    let release: () => void = () => {}
    const gate = new Promise<void>((r) => (release = r))
    const { user } = renderScreen(<Harness />, {
      handlers: [
        http.get(`${API}/user-groups/member-counts`, async () => {
          await gate
          return HttpResponse.json([{ groupId: 2, total: 4, external: 0 }])
        }),
        ...h.list,
      ],
    })
    const to = screen.getByTestId('mail-compose-to')
    await user.click(to)
    await user.type(to, '개발팀')
    const row = await screen.findByTestId('mail-recipient-group-suggestion')
    expect(row).toHaveAttribute('aria-disabled', 'true')
    expect(within(row).getByTestId('mail-recipient-group-count')).toHaveTextContent('인원 세는 중')
    await user.keyboard('{ArrowDown}')
    await user.keyboard('{Enter}')
    expect(chipValues('mail-compose-to')).toEqual(['개발팀'])
    expect(to).toHaveValue('')
    release()
  })

  it('인원을 못 센 그룹 줄은 바로 「불러오지 못했습니다」— 고르면 구성원을 새로 받아 풀어 넣는다', async () => {
    const h = handlers()
    const { user } = renderScreen(<Harness />, {
      handlers: [
        http.get(`${API}/user-groups/member-counts`, () => HttpResponse.json({}, { status: 500 })),
        ...h.list,
      ],
    })
    const to = screen.getByTestId('mail-compose-to')
    await user.click(to)
    await user.type(to, '개발팀')
    const row = await screen.findByTestId('mail-recipient-group-suggestion')
    await waitFor(() => expect(within(row).getByTestId('mail-recipient-group-count')).toHaveTextContent('인원을 불러오지 못했습니다'))
    // 실패한 줄도 고를 수 있다(눌러도 아무 일이 없으면 사용자가 할 수 있는 일이 없다).
    expect(row).not.toHaveAttribute('aria-disabled')
    await user.keyboard('{ArrowDown}')
    await user.keyboard('{Enter}')
    expect(await screen.findByText('개발팀에서 3명을 넣었습니다. 메일 주소가 없는 1명(정AI)은 넣지 못했습니다.')).toBeInTheDocument()
    expect(chipValues('mail-compose-to')).toEqual(['김개발 <kim@iacloud.kr>', '이개발 <lee@iacloud.kr>', '박서버 <park@iacloud.kr>'])
  })

  it('↓ 로 짚은 사람 줄이 늦게 온 후보에서 빠지면 짚지 않은 상태로 돌아가 Enter 에 그 자리의 부서가 풀리지 않는다', async () => {
    const h = handlers()
    const person = (n: number) => member({ id: 60 + n, name: `개발팀 사람${n}`, email: `p${n}@iacloud.kr` })
    let release: () => void = () => {}
    const gate = new Promise<void>((r) => (release = r))
    const { user } = renderScreen(<Harness />, {
      handlers: [
        http.get(`${API}/contacts`, async ({ request }) => {
          const q = new URL(request.url).searchParams.get('search') ?? ''
          // 「개발」은 바로 다섯 명, 「개발팀」은 늦게 세 명 — 그 사이 앞 조각의 다섯 명이 그대로 보인다(keepPreviousData).
          if (q === '개발팀') {
            await gate
            return HttpResponse.json(contactPage([1, 2, 3].map(person)))
          }
          return HttpResponse.json(contactPage([1, 2, 3, 4, 5].map(person)))
        }),
        ...h.list,
      ],
    })
    const to = screen.getByTestId('mail-compose-to')
    await user.click(to)
    await user.type(to, '개발')
    await waitFor(() => expect(screen.getAllByTestId('mail-recipient-suggestion')).toHaveLength(5))
    await user.type(to, '팀')
    // 그룹은 브라우저에서 바로 걸러져 「개발팀」 하나만 남고, 사람은 앞 조각의 다섯 명이 보이는 동안.
    await waitGroupsReady(1)
    expect(screen.getAllByTestId('mail-recipient-suggestion')).toHaveLength(5)
    // 다섯째 사람(순번 4)까지 ↓ 로 짚는다.
    for (let i = 0; i < 4; i++) await user.keyboard('{ArrowDown}')
    expect(screen.getAllByTestId('mail-recipient-suggestion')[4]).toHaveAttribute('aria-selected', 'true')
    // 새 응답은 세 명 — 순번 4 자리는 이제 부서 줄이다.
    release()
    await waitFor(() => expect(screen.getAllByTestId('mail-recipient-suggestion')).toHaveLength(3))
    expect(screen.getByTestId('mail-recipient-group-suggestion')).toHaveAttribute('aria-selected', 'false')
    await user.keyboard('{Enter}')
    // 짚은 사람이 사라졌으니 기본 후보(첫 사람)가 들어가고, 부서는 풀리지 않는다.
    expect(chipValues('mail-compose-to')).toEqual(['개발팀 사람1 <p1@iacloud.kr>'])
    expect(screen.queryByText(/개발팀에서 .*명을 넣었습니다/)).not.toBeInTheDocument()
  })

  it('구성원을 받는 사이 바깥에서 값을 통째로 바꾸면(답장 채우기) 받은 그룹 주소를 새 값에 붙이지 않는다', async () => {
    const h = handlers()
    let release: () => void = () => {}
    let gated = false
    const gate = new Promise<void>((r) => (release = r))
    function Replacer() {
      const [to, setTo] = useState('')
      return withDnd(
        <div>
          <MailRecipientInput label="받는 사람" mobile={false} testId="mail-compose-to" field="to" value={to} onChange={setTo} chipOpSeq={0} />
          <button type="button" onClick={() => setTo('reply@iacloud.kr')}>답장 채우기</button>
          <output data-testid="to-value">{to}</output>
        </div>,
      )
    }
    const { user } = renderScreen(<Replacer />, {
      handlers: [
        http.get(`${API}/user-groups/:id/members/search`, async () => {
          if (gated) await gate
          return HttpResponse.json(MEMBERS[20])
        }),
        ...h.list,
      ],
    })
    const to = screen.getByTestId('mail-compose-to')
    await user.click(to)
    await user.type(to, '주간')
    await waitGroupsReady(1)
    gated = true
    await user.click(screen.getByTestId('mail-recipient-group-suggestion'))
    await user.click(screen.getByRole('button', { name: '답장 채우기' }))
    release()
    // 받기가 끝날 시간을 준 뒤에도 답장 값만 남는다.
    await new Promise((r) => setTimeout(r, 50))
    expect(chipValues('mail-compose-to')).toEqual(['reply@iacloud.kr'])
    expect(screen.getByTestId('to-value')).toHaveTextContent(/^reply@iacloud\.kr$/)
    expect(screen.queryByText(/개발 주간회의에서/)).not.toBeInTheDocument()
  })

  it('고르는 순간의 구성원으로 푼다 — 인원을 센 뒤 들어온 사람도 넣는다', async () => {
    let current = MEMBERS[20].slice(0, 1)
    const h = handlers(() => current)
    const { user } = renderScreen(<Harness />, { handlers: h.list })
    const to = screen.getByTestId('mail-compose-to')
    await user.click(to)
    await user.type(to, '주간')
    await waitGroupsReady(1)
    expect(screen.getByTestId('mail-recipient-group-count')).toHaveTextContent('1명')
    // 줄이 1명이라고 보인 뒤 서버에서 두 사람이 더 들어왔다.
    current = MEMBERS[20]
    await user.click(screen.getByTestId('mail-recipient-group-suggestion'))
    expect(await screen.findByText('개발 주간회의에서 3명을 넣었습니다.')).toBeInTheDocument()
    expect(chipValues('mail-compose-to')).toEqual([
      '김개발 <kim@iacloud.kr>',
      'David Han <dhan@partner.co.kr>',
      'Erin <erin@partner.co.kr>',
    ])
  })

  it('고르는 순간 구성원을 받지 못하면 아무 주소도 넣지 않고 오류를 알린다', async () => {
    const h = handlers()
    let fail = false
    const { user } = renderScreen(<Harness />, {
      handlers: [
        http.get(`${API}/user-groups/:id/members/search`, () => (fail ? HttpResponse.json({}, { status: 500 }) : HttpResponse.json(MEMBERS[20]))),
        ...h.list,
      ],
    })
    const to = screen.getByTestId('mail-compose-to')
    await user.click(to)
    await user.type(to, '주간')
    await waitGroupsReady(1)
    fail = true
    await user.click(screen.getByTestId('mail-recipient-group-suggestion'))
    expect(
      await screen.findByText('개발 주간회의 구성원을 불러오지 못해 아무 주소도 넣지 않았습니다. 잠시 후 다시 골라 주세요.'),
    ).toBeInTheDocument()
    expect(chipValues('mail-compose-to')).toEqual([])
    expect(screen.getByTestId('to-value')).toHaveTextContent('')
  })
})

describe('메일 수신인 칩 메뉴(WP-2150)', () => {
  it('칩 이름을 누르면 메뉴가 열리고 다른 두 칸으로 옮기기와 빼기가 보인다', async () => {
    const onMove = vi.fn()
    const onRemove = vi.fn()
    const { user } = renderScreen(
      withDnd(
        <MailRecipientInput
          label="받는사람"
          mobile={false}
          testId="mail-compose-to"
          field="to"
          value="hong@x.test"
          onChange={vi.fn()}
          onMove={onMove}
          onRemove={onRemove}
          chipOpSeq={0}
        />,
      ),
      // 옮긴 뒤 초점이 입력 칸으로 돌아오면 후보 조회가 나가므로 핸들러를 깐다.
      { handlers: handlers().list },
    )
    await user.click(screen.getByTestId('mail-compose-to-chip-menu'))
    expect(screen.getByRole('menuitem', { name: '참조로 옮기기' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: '숨은참조로 옮기기' })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: '받는사람으로 옮기기' })).toBeNull() // 자기 칸은 없다
    await user.click(screen.getByRole('menuitem', { name: '참조로 옮기기' }))
    expect(onMove).toHaveBeenCalledWith(0, 'cc')
  })

  // 완료 기준 6 — 칩 이름 단추는 키보드(Enter·Space)로도 열린다. Radix 가 메뉴 단추 keydown 을 위임하므로 그 경로를 고정해 둔다.
  it('칩 이름 단추에 Enter 를 눌러도 메뉴가 열린다(WP-2150 완료 기준 6)', async () => {
    const onMove = vi.fn()
    const { user } = renderScreen(
      withDnd(
        <MailRecipientInput label="받는사람" mobile={false} testId="mail-compose-to" field="to" value="hong@x.test" onChange={vi.fn()} onMove={onMove} chipOpSeq={0} />,
      ),
      { handlers: handlers().list },
    )
    screen.getByTestId('mail-compose-to-chip-menu').focus()
    await user.keyboard('{Enter}')
    expect(screen.getByRole('menuitem', { name: '참조로 옮기기' })).toBeInTheDocument()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
  })

  it('메뉴 「빼기」 는 × 단추와 같은 자리(index)를 준다', async () => {
    const onRemove = vi.fn()
    const { user } = renderScreen(
      withDnd(
        <MailRecipientInput label="받는사람" mobile={false} testId="mail-compose-to" field="to" value="hong@x.test" onChange={vi.fn()} onRemove={onRemove} chipOpSeq={0} />,
      ),
      // 뺀 뒤 초점이 입력 칸으로 돌아오면 후보 조회가 나가므로 핸들러를 깐다.
      { handlers: handlers().list },
    )
    await user.click(screen.getByTestId('mail-compose-to-chip-menu'))
    await user.click(screen.getByRole('menuitem', { name: '빼기' }))
    expect(onRemove).toHaveBeenCalledWith(0)
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
  })

  it('「주소 복사」 는 클립보드에 주소를 넣는다', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    const { user } = renderScreen(
      withDnd(
        <MailRecipientInput label="받는사람" mobile={false} testId="mail-compose-to" field="to" value="홍 <hong@x.test>" onChange={vi.fn()} chipOpSeq={0} />,
      ),
    )
    // jsdom 에 클립보드가 없어 navigator.clipboard 만 가짜로 잇는다(나머지 navigator 는 그대로).
    // userEvent.setup() 이 클립보드 속성을 다시 정의하므로 렌더 뒤에 붙인다.
    vi.stubGlobal('navigator', Object.create(navigator, { clipboard: { value: { writeText } } }))
    await user.click(screen.getByTestId('mail-compose-to-chip-menu'))
    await user.click(screen.getByRole('menuitem', { name: '주소 복사' }))
    // 칩에 보이는 짧은 이름이 아니라 저장·발송에 쓰는 전체 표기(라벨)를 복사한다.
    expect(writeText).toHaveBeenCalledWith('홍 <hong@x.test>')
    expect(await screen.findByText('주소를 복사했습니다')).toBeInTheDocument()
  })

  it('× 단추는 메뉴를 열지 않고 바로 뺀다', async () => {
    const onRemove = vi.fn()
    const { user } = renderScreen(
      withDnd(
        <MailRecipientInput label="받는사람" mobile={false} testId="mail-compose-to" field="to" value="hong@x.test" onChange={vi.fn()} onRemove={onRemove} chipOpSeq={0} />,
      ),
      // 뺀 뒤 초점이 입력 칸으로 돌아오면 후보 조회가 나가므로 핸들러를 깐다.
      { handlers: handlers().list },
    )
    await user.click(screen.getByRole('button', { name: 'hong@x.test 빼기' }))
    expect(onRemove).toHaveBeenCalledWith(0)
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
  })

  // 칩을 빼는 주체를 바깥(부모)에 두는 받는 사람 칩 — 실제로도 MailComposeDock 가 onRemove 를 넘긴다.
  // 안에서 빼는 removeAt 경로는 초점을 되돌리는데, 바깥으로 위임하면 그 복원이 사라져 × 를 누른 칩이 없어지면 초점이 body 로 흩어진다.
  function removingHarness(initial: string) {
    function Inner() {
      const [value, setValue] = useState(initial)
      // 실제로도 MailComposeDock 가 칸 안에서 값을 고칠 때마다 chipOpSeq 를 함께 올린다(없으면 값이 통째로 바뀐 것으로 오해).
      const [chipOpSeq, setChipOpSeq] = useState(0)
      const onRemove = (index: number) => {
        setValue((v) => v.split(', ').filter((_, i) => i !== index).join(', '))
        setChipOpSeq((n) => n + 1)
      }
      return (
        <MailRecipientInput
          label="받는사람"
          mobile={false}
          testId="mail-compose-to"
          field="to"
          value={value}
          onChange={setValue}
          onRemove={onRemove}
          chipOpSeq={chipOpSeq}
        />
      )
    }
    return withDnd(<Inner />)
  }

  it('× 단추로 칩을 빼면 초점이 받는 사람 입력 칸에 남는다 — 지금처럼 동작 변경 없음(WP-2150)', async () => {
    const { user } = renderScreen(removingHarness('hong@x.test, kim@x.test'), { handlers: handlers().list })
    await user.click(screen.getByRole('button', { name: 'hong@x.test 빼기' }))
    expect(chipValues('mail-compose-to')).toEqual(['kim@x.test'])
    await waitFor(() => expect(screen.getByTestId('mail-compose-to')).toHaveFocus())
  })

  it('메뉴 「빼기」 로도 초점이 받는 사람 입력 칸에 남는다(WP-2150)', async () => {
    const { user } = renderScreen(removingHarness('hong@x.test, kim@x.test'), { handlers: handlers().list })
    await user.click(screen.getAllByTestId('mail-compose-to-chip-menu')[0])
    await user.click(screen.getByRole('menuitem', { name: '빼기' }))
    expect(chipValues('mail-compose-to')).toEqual(['kim@x.test'])
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
    await waitFor(() => expect(screen.getByTestId('mail-compose-to')).toHaveFocus())
  })

  // 칩을 옮기는 주체도 바깥(부모)에 둔다 — 실제로도 MailComposeDock 가 onMove 를 넘긴다.
  function movingHarness(initial: string) {
    function Inner() {
      const [value, setValue] = useState(initial)
      // 실제로도 MailComposeDock 가 칸 안에서 값을 고칠 때마다 chipOpSeq 를 함께 올린다(없으면 값이 통째로 바뀐 것으로 오해).
      const [chipOpSeq, setChipOpSeq] = useState(0)
      const onMove = (index: number) => {
        setValue((v) => v.split(', ').filter((_, i) => i !== index).join(', '))
        setChipOpSeq((n) => n + 1)
      }
      return (
        <MailRecipientInput
          label="받는사람"
          mobile={false}
          testId="mail-compose-to"
          field="to"
          value={value}
          onChange={setValue}
          onMove={onMove}
          chipOpSeq={chipOpSeq}
        />
      )
    }
    return withDnd(<Inner />)
  }

  it('메뉴 「참조로 옮기기」 로도 초점이 받는 사람 입력 칸에 남는다(WP-2150 리뷰)', async () => {
    const { user } = renderScreen(movingHarness('hong@x.test, kim@x.test'), { handlers: handlers().list })
    await user.click(screen.getAllByTestId('mail-compose-to-chip-menu')[0])
    await user.click(screen.getByRole('menuitem', { name: '참조로 옮기기' }))
    // 뺀 칩과 달리 옮긴 칩은 그 자리에서 없어져 메뉴를 닫는 Radix 가 되돌릴 트리거를 잃는다 — 원래 칸 입력으로 되돌린다.
    expect(chipValues('mail-compose-to')).toEqual(['kim@x.test'])
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
    await waitFor(() => expect(screen.getByTestId('mail-compose-to')).toHaveFocus())
  })
})

describe('메일 수신인 칩 끌기 연결(WP-2150)', () => {
  /** 끌기 연결을 넣은 칩 입력 하나 — dnd 는 부모(MailComposeDock) 가 넘기는 값 그대로다. */
  function dragHarness(dnd: { dragDisabled: boolean; dragging: boolean; lastDragEndedAt: () => number }, value = 'hong@x.test') {
    return withDnd(
      <MailRecipientInput label="받는사람" mobile={false} testId="mail-compose-to" field="to" value={value} onChange={vi.fn()} dnd={dnd} chipOpSeq={0} />,
    )
  }

  it('끌기가 끝난 직후의 클릭은 메뉴를 열지 않는다 — 끌기와 메뉴가 같은 단추라 겹치면 안 된다', async () => {
    const { user } = renderScreen(dragHarness({ dragDisabled: false, dragging: false, lastDragEndedAt: () => performance.now() }))
    await user.click(screen.getByTestId('mail-compose-to-chip-menu'))
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('끌기가 없던 때의 클릭은 그대로 메뉴를 연다', async () => {
    const { user } = renderScreen(dragHarness({ dragDisabled: false, dragging: false, lastDragEndedAt: () => 0 }))
    await user.click(screen.getByTestId('mail-compose-to-chip-menu'))
    expect(screen.getByRole('menuitem', { name: '참조로 옮기기' })).toBeInTheDocument()
  })

  it('드래그 중에는 칸 루트에 data-field·점선(공용 DROP_TARGET_CLASS)·칸 이름 라벨이 보인다', () => {
    renderScreen(dragHarness({ dragDisabled: false, dragging: true, lastDragEndedAt: () => 0 }))
    const root = screen.getByTestId('mail-compose-to').closest('[data-field="to"]')
    expect(root).not.toBeNull()
    // 점선은 저장소 공용 규칙(dndDropClass)의 allowed — 이슈·드라이브와 같은 시각 언어(WP-2150 최종 리뷰).
    expect(root).toHaveClass('outline-dashed')
    // 평소 데스크톱에는 칸 이름이 없고 끌기 중에만 칸 이름 라벨이 뜬다.
    expect(screen.getByTestId('mail-compose-to-drop-label')).toHaveTextContent('받는사람')
  })

  it('칩 이름 단추는 한국어 역할 설명(옮길 수 있는 수신인)을 읽힌다(완료 기준 9)', () => {
    renderScreen(dragHarness({ dragDisabled: false, dragging: false, lastDragEndedAt: () => 0 }))
    // dnd-kit 의 roleDescription 가 단추에 실제로 붙는다 — 저장소 다른 dnd(이슈 목록·홈 대시보드)와 같은 고정 단언.
    expect(screen.getByTestId('mail-compose-to-chip-menu')).toHaveAttribute('aria-roledescription', '옮길 수 있는 수신인')
  })

  // 조각을 친 채 끌면 후보 팝업(z-50)이 그대로 떠 「참조로 옮기기」 강조·칸 이름 라벨을 덮는다 — 눈으로 놓을 칸을 확인할 수 없다.
  // blur 로 닫으면 조각이 굳어 반려 ①이 되살아나므로, 초점을 건드리지 않고 끌기 여부만으로 닫아야 한다(2차 리뷰 Important).
  it('조각을 친 채 끌기 시작하면 후보 팝업이 닫혀 놓을 칸 표시를 가리지 않는다(WP-2150 2차 리뷰)', async () => {
    const ctl: { startDrag: () => void } = { startDrag: () => {} }
    function Inner() {
      const [dragging, setDragging] = useState(false)
      // 칸이 넘긴 한 줄을 받는 쪽(작성 도크)처럼 값 상태를 들고 있어야 한다 — 비워 두면 칸이 "바깥이 값을 통째로 바꿨다" 로
      // 오해해 치던 조각을 지운다(실제 도크는 onChange 로 값을 받으므로 글자가 남는다).
      const [value, setValue] = useState('hong@x.test')
      // 끌기 시작을 테스트가 부르도록 — 렌더 중 바깥 값을 고치지 못하게 하는 규칙(react-hooks/immutability) 때문에 이펙트에서 건넌다.
      useEffect(() => {
        ctl.startDrag = () => setDragging(true)
        return () => {
          ctl.startDrag = () => {}
        }
      }, [])
      return withDnd(
        <MailRecipientInput
          label="받는사람"
          mobile={false}
          testId="mail-compose-to"
          field="to"
          value={value}
          onChange={setValue}
          dnd={{ dragDisabled: false, dragging, lastDragEndedAt: () => 0 }}
          chipOpSeq={0}
        />,
      )
    }
    const { user } = renderScreen(<Inner />, { handlers: handlers().list })
    const to = screen.getByTestId('mail-compose-to')
    await user.click(to)
    await user.type(to, '개발')
    await waitFor(() => expect(screen.getAllByTestId('mail-recipient-suggestion').length).toBeGreaterThan(0))

    act(() => ctl.startDrag())

    expect(screen.queryAllByTestId('mail-recipient-suggestion')).toHaveLength(0)
    // 입력에 쓰던 조각은 그대로 남고(굳지 않았다), 끌기 중 표시만 남는다.
    expect(to).toHaveValue('개발')
    expect(screen.getByTestId('mail-compose-to-drop-label')).toBeInTheDocument()
  })

  it('메뉴가 열려 있는 동안에는 끌기가 꺼진다', async () => {
    const { user } = renderScreen(dragHarness({ dragDisabled: false, dragging: false, lastDragEndedAt: () => 0 }))
    await user.click(screen.getByTestId('mail-compose-to-chip-menu'))
    expect(screen.getByRole('menuitem', { name: '참조로 옮기기' })).toBeInTheDocument()
    // 열려 있는 동안 칩 단추는 끌기 활성화 노드가 아니다(aria-disabled 로 표시).
    expect(screen.getByTestId('mail-compose-to-chip-menu')).toHaveAttribute('aria-disabled', 'true')
  })
})

describe('메일 수신인 — 치던 글자를 지키는 옮기기·빼기(WP-2150 반려)', () => {
  /**
   * 작성 도크와 같은 배선 — 칸 상태는 moveRecipient·removeRecipient 로 바꾸고, 지금 쓰는 조각은 입력이 알려 주는
   * 대로 ref 로 함께 넘긴다(MailComposeDock 의 moveChip·removeChip 과 같은 경로). 칸 안 조작으로 값을 고칠 때마다
   * chipOpSeq 도 함께 올린다 — 실제로도 MailComposeDock 가 그렇게 한다(WP-2150 2차 반려 ①).
   *
   * 조작은 초점이 칸 안(입력·× 단추·메뉴)에 있는 동안 하는 것으로 본다 — 조각은 칸을 떠날 때만 굳으므로,
   * 그 사이에 칩을 빼거나 옮겨도 글자가 먼저 칩으로 굳지 않는다(WP-2150 반려 ②).
   */
  function dockWired(initial: RecipientFields, extraHandlers: RequestHandler[] = []) {
    const ctl: {
      move: (index: number, target: RecipientField) => void;
      remove: (index: number) => void;
      /** 바깥이 값을 통째로 바꾼다(답장 채우기) — 칸 안 조작이 아니므로 chipOpSeq 를 올리지 않는다. */
      replace: (field: RecipientField, value: string) => void;
    } = {
      move: () => {},
      remove: () => {},
      replace: () => {},
    }
    function Inner() {
      const [fields, setFields] = useState(initial)
      const [chipOpSeq, setChipOpSeq] = useState(0)
      const rest = useRef<RecipientFieldRest>({})
      const onRestChange = (field: RecipientField, value: string) => {
        rest.current[field] = value
      }
      // 칸 안 조작으로 값을 고칠 때마다 — 같은 틱에 칸 상태와 함께 올린다(실제 도크와 같은 배치).
      const bumpChipOp = () => setChipOpSeq((n) => n + 1)
      useEffect(() => {
        ctl.move = (index, target) => {
          setFields((prev) => moveRecipient(prev, 'to', index, target, rest.current))
          bumpChipOp()
        }
        ctl.remove = (index) => {
          setFields((prev) => removeRecipient(prev, 'to', index, rest.current))
          bumpChipOp()
        }
        ctl.replace = (field, value) => setFields((prev) => ({ ...prev, [field]: value }))
      })
      const edit = (field: RecipientField) => (value: string) => setFields((prev) => ({ ...prev, [field]: value }))
      // 칸마다 그 칸의 옮기기·빼기를 넘긴다 — 실제로도 MailComposeDock 가 칸 이름을 넘겨 같은 함수를 부른다(조각은 누를 때 읽는다).
      const moveTo = (index: number, target: RecipientField) => {
        const restNow = rest.current
        setFields((prev) => moveRecipient(prev, 'to', index, target, restNow))
        bumpChipOp()
      }
      const removeFrom = (index: number) => {
        const restNow = rest.current
        setFields((prev) => removeRecipient(prev, 'to', index, restNow))
        bumpChipOp()
      }
      const moveToCc = (index: number, target: RecipientField) => {
        const restNow = rest.current
        setFields((prev) => moveRecipient(prev, 'cc', index, target, restNow))
        bumpChipOp()
      }
      const removeFromCc = (index: number) => {
        const restNow = rest.current
        setFields((prev) => removeRecipient(prev, 'cc', index, restNow))
        bumpChipOp()
      }
      return withDnd(
        <div>
          <MailRecipientInput
            label="받는사람"
            mobile={false}
            testId="mail-compose-to"
            field="to"
            value={fields.to}
            onChange={edit('to')}
            onRestChange={onRestChange}
            onMove={moveTo}
            onRemove={removeFrom}
            chipOpSeq={chipOpSeq}
          />
          <MailRecipientInput
            label="참조"
            mobile={false}
            testId="mail-compose-cc"
            field="cc"
            value={fields.cc}
            onChange={edit('cc')}
            onRestChange={onRestChange}
            onMove={moveToCc}
            onRemove={removeFromCc}
            chipOpSeq={chipOpSeq}
          />
          <output data-testid="to-value">{fields.to}</output>
          <output data-testid="cc-value">{fields.cc}</output>
        </div>,
      )
    }
    return { ctl, node: <Inner />, extraHandlers }
  }

  it('받는사람에 치던 글자가 남은 채로 칩을 옮기면 그 글자가 입력에 그대로다', async () => {
    const { ctl, node } = dockWired({ to: 'hong@x.test', cc: '', bcc: '' })
    const { user } = renderScreen(node, { handlers: handlers().list })
    const to = screen.getByTestId('mail-compose-to')
    await user.click(to)
    await user.type(to, 'kim@x')

    act(() => ctl.move(0, 'cc'))

    // 칩은 참조로 빠지고, 받는사람에는 치던 글자만 남는다 — 조각까지 칩이 되면 빨간 칩으로 입력이 비다.
    expect(chipValues('mail-compose-to')).toEqual([])
    expect(to).toHaveValue('kim@x')
    expect(screen.getByTestId('to-value')).toHaveTextContent(/^kim@x$/)
    expect(chipValues('mail-compose-cc')).toEqual(['hong@x.test'])
    expect(screen.getByTestId('mail-compose-cc')).toHaveValue('')
  })

  it('놓을 칸에 치던 글자가 있으면 옮긴 칩 뒤에 그대로 남는다 — 조각이 앞에 끼어 빨간 칩이 되지 않는다', async () => {
    const { ctl, node } = dockWired({ to: 'hong@x.test', cc: '', bcc: '' })
    const { user } = renderScreen(node, { handlers: handlers().list })
    const cc = screen.getByTestId('mail-compose-cc')
    await user.click(cc)
    await user.type(cc, 'par')

    act(() => ctl.move(0, 'cc'))

    expect(chipValues('mail-compose-cc')).toEqual(['hong@x.test'])
    expect(cc).toHaveValue('par')
    expect(screen.getByTestId('cc-value')).toHaveTextContent(/^hong@x\.test, par$/)
    expect(chipValues('mail-compose-to')).toEqual([])
    expect(screen.getByTestId('mail-compose-to')).toHaveValue('')
  })

  it('치던 글자가 있는 칸에서 칩을 빼면 글자는 그대로 남는다', async () => {
    const { ctl, node } = dockWired({ to: 'hong@x.test, lee@x.test', cc: '', bcc: '' })
    const { user } = renderScreen(node, { handlers: handlers().list })
    const to = screen.getByTestId('mail-compose-to')
    await user.click(to)
    await user.type(to, 'kim@x')

    act(() => ctl.remove(0))

    // 앞 칩만 빠지고, 치던 글자는 남는다 — 안의 removeAt 이 지키던 것을 밖으로 위임해도 같다(WP-2150 반려).
    expect(chipValues('mail-compose-to')).toEqual(['lee@x.test'])
    expect(to).toHaveValue('kim@x')
    expect(screen.getByTestId('to-value')).toHaveTextContent(/^lee@x\.test, kim@x$/)
  })

  it('× 단추로 빼는 동안 치던 글자가 칩으로 미리 굳지 않는다(WP-2150 반려 ②)', async () => {
    const { node } = dockWired({ to: 'hong@x.test, lee@x.test', cc: '', bcc: '' })
    const { user } = renderScreen(node, { handlers: handlers().list })
    const to = screen.getByTestId('mail-compose-to')
    await user.click(to)
    await user.type(to, 'kim')

    await user.click(screen.getByRole('button', { name: 'hong@x.test 빼기' }))

    // × 로 초점이 옮아도 칸 안이므로 아직 조작 중이다 — 그때 굳히면 빨간 칩 하나가 남는다.
    expect(chipValues('mail-compose-to')).toEqual(['lee@x.test'])
    expect(to).toHaveValue('kim')
    expect(screen.getByTestId('to-value')).toHaveTextContent(/^lee@x\.test, kim$/)
  })

  it('칩 메뉴 「빼기」 도 글자가 굳지 않는다 — 메뉴로 초점이 옮는 순간은 커밋하지 않는다(WP-2150 반려 ②)', async () => {
    const { node } = dockWired({ to: 'hong@x.test, lee@x.test', cc: '', bcc: '' })
    const { user } = renderScreen(node, { handlers: handlers().list })
    const to = screen.getByTestId('mail-compose-to')
    await user.click(to)
    await user.type(to, 'kim')

    await user.click(screen.getAllByTestId('mail-compose-to-chip-menu')[0])
    await user.click(screen.getByRole('menuitem', { name: '빼기' }))

    expect(chipValues('mail-compose-to')).toEqual(['lee@x.test'])
    expect(to).toHaveValue('kim')
    expect(screen.getByTestId('to-value')).toHaveTextContent(/^lee@x\.test, kim$/)
  })

  it('칸을 떠나면(메뉴가 아닌 다른 칸으로) 지금처럼 칩으로 굳는다(WP-2150 반려 ②)', async () => {
    const { node } = dockWired({ to: 'hong@x.test, lee@x.test', cc: '', bcc: '' })
    const { user } = renderScreen(node, { handlers: handlers().list })
    const to = screen.getByTestId('mail-compose-to')
    await user.click(to)
    await user.type(to, 'kim')

    // 다른 칸(참조)으로 초점이 떠난다 — 칸 밖이므로 조각을 굳힌다.
    await user.click(screen.getByTestId('mail-compose-cc'))

    expect(chipValues('mail-compose-to')).toEqual(['hong@x.test', 'lee@x.test', 'kim'])
    expect(to).toHaveValue('')
  })

  it('메뉴로 떠났다가 메뉴를 닫고 다시 다른 칸으로 떠나도 굳는다 — 조각이 영구히 남지 않는다(WP-2150 반려 ②)', async () => {
    const { node } = dockWired({ to: 'hong@x.test, lee@x.test', cc: '', bcc: '' })
    const { user } = renderScreen(node, { handlers: handlers().list })
    const to = screen.getByTestId('mail-compose-to')
    await user.click(to)
    await user.type(to, 'kim')

    await user.click(screen.getAllByTestId('mail-compose-to-chip-menu')[0])
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
    await user.click(screen.getByTestId('mail-compose-cc'))

    expect(chipValues('mail-compose-to')).toEqual(['hong@x.test', 'lee@x.test', 'kim'])
    expect(to).toHaveValue('')
  })

  it('구성원을 받는 사이 칸 안에서 칩을 빼면 값을 통째로 바꾼 게 아니여서 그룹 넣기가 그만두지 않는다(WP-2150 2차 반려 ①)', async () => {
    const h = handlers()
    let release: () => void = () => {}
    let gated = false
    const gate = new Promise<void>((r) => (release = r))
    // 받기가 끝나기 전에 칸 안에서 칩을 뺀다 — 그 빼기가 resets 를 올려 받기를 취소하면(값 교체로 오해) 토스트 없이 끝난다.
    const { node, extraHandlers } = dockWired({ to: 'hong@x.test', cc: '', bcc: '' }, [
      http.get(`${API}/user-groups/:id/members/search`, async () => {
        if (gated) await gate
        return HttpResponse.json(MEMBERS[20])
      }),
    ])
    const { user } = renderScreen(node, { handlers: [...extraHandlers, ...h.list] })
    const to = screen.getByTestId('mail-compose-to')
    await user.click(to)
    await user.type(to, '주간')
    await waitGroupsReady(1)
    gated = true
    await user.click(screen.getByTestId('mail-recipient-group-suggestion'))
    // 받는 도중에 칸 안에서 앞 칩을 뺀다 — 작성 도크가 칸 상태를 고친 것이다(바깥이 값을 통째로 바꾼 게 아니다).
    await user.click(screen.getByRole('button', { name: 'hong@x.test 빼기' }))
    release()
    // 토스트가 뜰 때까지 기다린 뒤 그룹 주소가 들어왔는지 본다(고정 지연은 느린 기계에서 들쭉날쭉하다).
    expect(await screen.findByText('개발 주간회의에서 3명을 넣었습니다.')).toBeInTheDocument()
    expect(chipValues('mail-compose-to')).toEqual(['김개발 <kim@iacloud.kr>', 'David Han <dhan@partner.co.kr>', 'Erin <erin@partner.co.kr>'])
  })

  // 칸 안 조작이 **값을 바꾸지 않을 때**도(놓을 칸에 같은 주소가 있어 대상이 그대로) 조작 횟수는 따라잡아야 한다 —
  // 남겨 두면 그 뒤의 바깥 값 교체가 "옛 칸 조작의 일부"로 보여 받는 중이던 그룹 넣기가 끊기지 않는다(반대 방향의 결함).
  it('칸 안 조작이 값을 바꾸지 않아도 다음 바깥 값 교체는 바깥 교체로 받아들인다(WP-2150 2차 반려 ①)', async () => {
    const h = handlers()
    let release: () => void = () => {}
    let gated = false
    let settled = false
    const gate = new Promise<void>((r) => (release = r))
    const { ctl, node, extraHandlers } = dockWired({ to: 'hong@x.test', cc: 'hong@x.test', bcc: '' }, [
      http.get(`${API}/user-groups/:id/members/search`, async () => {
        if (gated) await gate
        settled = true
        return HttpResponse.json(MEMBERS[20])
      }),
    ])
    const { user } = renderScreen(node, { handlers: [...extraHandlers, ...h.list] })
    const cc = screen.getByTestId('mail-compose-cc')
    await user.click(cc)
    await user.type(cc, '주간')
    await waitGroupsReady(1)
    gated = true
    await user.click(screen.getByTestId('mail-recipient-group-suggestion'))

    // 받는사람의 같은 주소를 참조로 옮긴다 — 참조에 이미 있어 값은 그대로지만(칸 안 조작) chipOpSeq 는 올랐다.
    act(() => ctl.move(0, 'cc'))
    expect(screen.getByTestId('cc-value')).toHaveTextContent(/^hong@x\.test$/)

    // 이제 바깥이 참조 값을 통째로 바꾼다(답장 채우기) — 칸 안 조작이 아니므로 받는 중이던 넣기는 끊겨야 한다.
    act(() => ctl.replace('cc', 'reply@iacloud.kr'))
    release()
    await waitFor(() => expect(settled).toBe(true))
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50))
    })
    expect(screen.queryByText(/개발 주간회의에서/)).not.toBeInTheDocument()
    expect(chipValues('mail-compose-cc')).toEqual(['reply@iacloud.kr'])
    expect(screen.getByTestId('cc-value')).toHaveTextContent(/^reply@iacloud\.kr$/)
  })

  it('칩 셋 가운데를 다른 칸으로 옮기면 나머지 두 칩의 순서는 그대로다(WP-2150)', async () => {
    const { ctl, node } = dockWired({ to: 'a@x.test, b@x.test, c@x.test', cc: '', bcc: '' })
    renderScreen(node, { handlers: handlers().list })

    act(() => ctl.move(1, 'cc'))

    expect(chipValues('mail-compose-to')).toEqual(['a@x.test', 'c@x.test'])
    expect(chipValues('mail-compose-cc')).toEqual(['b@x.test'])
    expect(screen.getByTestId('to-value')).toHaveTextContent(/^a@x\.test, c@x\.test$/)
    expect(screen.getByTestId('cc-value')).toHaveTextContent(/^b@x\.test$/)
  })
})
