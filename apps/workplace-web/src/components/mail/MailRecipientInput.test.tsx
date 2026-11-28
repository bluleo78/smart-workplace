// 메일 받는사람에 조직·내 그룹 넣기(WP-1060) — 화면 테스트(renderScreen).
// 쓰는 조각에 맞는 부서·내 그룹이 사람 후보 아래 인원 수·꼬리표와 함께 보이고, 고르면 그때의 구성원 주소가 칩으로 풀린다
// (이 칸에 이미 있는 주소는 빼고, 내 그룹의 외부 연락처도 넣고, 주소가 없는 사람은 넣지 않고 토스트로 알린다).
import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { server } from '@/test/msw/server'
import { renderScreen } from '@/test/renderScreen'
import type { UserGroupMemberHit } from '@/types/userGroup'

import { external, member, page as contactPage } from '../../../e2e/factories/contacts.factory'
import { personalNode, sharedNode } from '../../../e2e/factories/userGroups.factory'
import { MailRecipientInput } from './MailRecipientInput'

const API = '/api/v1'

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

/** 칸 셋(받는 사람·참조)을 바깥 상태와 함께 — 바뀐 한 줄을 화면에 내보여 발송 값도 본다. */
function Harness({ initialTo = '', initialCc = '', mobile = false }: { initialTo?: string; initialCc?: string; mobile?: boolean }) {
  const [to, setTo] = useState(initialTo)
  const [cc, setCc] = useState(initialCc)
  return (
    <div>
      <MailRecipientInput label="받는 사람" mobile={mobile} testId="mail-compose-to" value={to} onChange={setTo} />
      <MailRecipientInput label="참조" mobile={mobile} testId="mail-compose-cc" value={cc} onChange={setCc} />
      <output data-testid="to-value">{to}</output>
      <output data-testid="cc-value">{cc}</output>
    </div>
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
      return (
        <div>
          <MailRecipientInput label="받는 사람" mobile={false} testId="mail-compose-to" value={to} onChange={setTo} />
          <button type="button" onClick={() => setTo('reply@iacloud.kr')}>답장 채우기</button>
          <output data-testid="to-value">{to}</output>
        </div>
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
