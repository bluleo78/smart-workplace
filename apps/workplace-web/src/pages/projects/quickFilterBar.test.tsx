// 이슈 목록 빠른 필터 칩 줄(WP-1020) — 화면 테스트. 필터 바(IssueFilterBar)만 띄운다.
// 칩 한 번 → 값 목록(바로 적용·팝오버 유지), 걸린 칩 요약·×·「필터 지우기」, 담당자 「나」·「미지정」, 검색칸,
// 「더 보기」의 덜 쓰는 facet·칩 고정/숨김과 그 기억(localStorage, 저장소가 막혀도 기본 칩으로 동작)을 본다.
import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, describe, expect, test, vi } from 'vitest'

import { IssueFilterBar } from '@/pages/projects/components/IssueFilterBar'
import { openQuickFacet } from '@/test/kits/projects/quickFilter'
import { renderScreen } from '@/test/renderScreen'

import { createMember } from '../../../e2e/factories/project.factory'
import { seedStatuses } from '../../../e2e/factories/projectStatus.factory'

const API = '/api/v1/projects/WP'
const STORAGE_KEY = 'quick-filter-chips:project-issues:1'

/** 필터 바만 띄운다 — 로그인 사용자(id 1)는 멤버라 담당자 목록 맨 위에 「나」로 보인다. */
function renderBar(path = '/projects/WP') {
  return renderScreen(<IssueFilterBar projectKey="WP" />, {
    path,
    handlers: [
      http.get(`${API}/statuses`, () => HttpResponse.json(seedStatuses())),
      http.get(`${API}/members`, () =>
        HttpResponse.json([
          createMember({ userId: 2, username: 'kim', name: '김서준' }),
          createMember({ userId: 1, username: 'testuser', name: '테스트 사용자' }),
          createMember({ userId: 3, username: 'lee', name: '이지아' }),
        ]),
      ),
      ...['labels', 'types', 'cycles', 'components', 'versions'].map((sub) => http.get(`${API}/${sub}`, () => HttpResponse.json([]))),
    ],
  })
}

/** 지금 칩 줄의 칩 key 순서(「더 보기」 제외). */
function chipKeys() {
  return within(screen.getByTestId('quick-filter-bar'))
    .getAllByTestId(/^quick-filter-[A-Za-z]+-trigger$/)
    .map((el) => el.dataset.testid!.replace(/^quick-filter-/, '').replace(/-trigger$/, ''))
}

const query = (location: () => string) => new URLSearchParams(location().split('?')[1] ?? '')

afterEach(() => {
  vi.restoreAllMocks()
})

describe('빠른 필터 칩 — 기본 칩과 값 고르기', () => {
  test('팀 목록은 담당자·상태·유형·라벨·우선순위 칩을 바로 보이고, 걸린 것이 없으면 「필터 지우기」는 없다', async () => {
    renderBar()
    await screen.findByTestId('quick-filter-bar')
    expect(chipKeys()).toEqual(['assignee', 'statusId', 'type', 'label', 'priority'])
    expect(screen.getByTestId('quick-filter-more')).toHaveTextContent('더 보기')
    expect(screen.queryByTestId('add-filter-trigger')).not.toBeInTheDocument()
    expect(screen.queryByTestId('quick-filter-clear-all')).not.toBeInTheDocument()
  })

  test('담당자 칩 — 맨 위 「나」·「미지정」, 체크하면 바로 URL 에 실리고 팝오버는 열린 채, 칩은 파랗게 요약된다', async () => {
    const { user, location } = renderBar()
    await openQuickFacet(user, 'assignee')
    const panel = screen.getByTestId('quick-filter-panel-assignee')
    // 「나 (이름)」·「미지정」이 맨 위, 나머지 멤버는 목록 순서 — 「나」는 아래에 다시 나오지 않는다.
    await waitFor(() => expect(within(panel).getAllByRole('checkbox').map((c) => c.getAttribute('aria-label'))).toEqual(['나 (테스트 사용자)', '미지정', '김서준', '이지아']))

    await user.click(within(panel).getByRole('checkbox', { name: '미지정' }))
    await waitFor(() => expect(query(location).get('assignee')).toBe('null'))
    // 바로 적용 — 팝오버는 열린 채 다음 값을 고를 수 있다.
    expect(screen.getByTestId('quick-filter-panel-assignee')).toBeInTheDocument()
    await user.click(within(panel).getByRole('checkbox', { name: '나 (테스트 사용자)' }))
    await waitFor(() => expect(query(location).get('assignee')).toBe('1,null'))
    expect(screen.getByTestId('quick-filter-panel-assignee')).toHaveTextContent('1명 · 미지정 선택')

    const chip = screen.getByTestId('quick-filter-assignee')
    expect(chip).toHaveAttribute('data-active', 'true')
    expect(chip).toHaveTextContent('담당자: 나 (테스트 사용자)+1')
    expect(screen.getByTestId('quick-filter-clear-all')).toHaveTextContent('필터 지우기')
  })

  test('URL 의 미지정(assignee=null)은 담당자 칩 「미지정」으로 열리고, × 로 그 칩만 비운다', async () => {
    const { user, location } = renderBar('/projects/WP?assignee=null&priority=HIGH')
    const chip = await screen.findByTestId('quick-filter-assignee')
    await waitFor(() => expect(chip).toHaveTextContent('담당자: 미지정'))
    await user.click(screen.getByTestId('quick-filter-assignee-remove'))
    await waitFor(() => expect(query(location).has('assignee')).toBe(false))
    expect(query(location).get('priority')).toBe('HIGH')
    expect(screen.getByTestId('quick-filter-assignee')).not.toHaveAttribute('data-active')
    expect(screen.getByTestId('quick-filter-priority')).toHaveAttribute('data-active', 'true')
  })

  test('「필터 지우기」는 걸린 필터와 검색어를 다 지우고 보기(group) 는 남긴다', async () => {
    const { user, location } = renderBar('/projects/WP?assignee=2&priority=HIGH&q=abc&group=none')
    await user.click(await screen.findByTestId('quick-filter-clear-all'))
    await waitFor(() => expect(location()).toBe('/projects/WP?group=none'))
  })

  test('검색칸에 입력하면 이름이 맞는 값만 남고, 없으면 「일치하는 항목이 없습니다」', async () => {
    const { user } = renderBar()
    await openQuickFacet(user, 'assignee')
    await screen.findByRole('checkbox', { name: '김서준' })
    await user.type(screen.getByTestId('quick-filter-search-assignee'), '이지')
    const panel = screen.getByTestId('quick-filter-panel-assignee')
    expect(within(panel).getAllByRole('checkbox').map((c) => c.getAttribute('aria-label'))).toEqual(['이지아'])
    await user.clear(screen.getByTestId('quick-filter-search-assignee'))
    await user.type(screen.getByTestId('quick-filter-search-assignee'), 'zzz')
    expect(screen.getByTestId('facet-value-assignee-no-match')).toHaveTextContent('일치하는 항목이 없습니다')
  })
})

describe('빠른 필터 칩 — 더 보기·고정/숨김', () => {
  test('「더 보기」엔 덜 쓰는 facet 만 — 데이터가 없는 사이클·구성요소·버전은 없고, 고르면 그 facet 이 칩으로 나온다', async () => {
    const { user, location } = renderBar()
    await user.click(await screen.findByTestId('quick-filter-more'))
    expect(await screen.findByTestId('quick-filter-more-facet-status')).toHaveTextContent('상태 범주')
    expect(screen.getByTestId('quick-filter-more-facet-closedIn')).toHaveTextContent('완료일')
    for (const key of ['cycle', 'component', 'fixVersion', 'affectsVersion', 'assignee']) {
      expect(screen.queryByTestId(`quick-filter-more-facet-${key}`)).not.toBeInTheDocument()
    }
    await user.click(screen.getByTestId('quick-filter-more-facet-status'))
    await user.click(await screen.findByRole('checkbox', { name: '진행 중' }))
    await waitFor(() => expect(query(location).get('status')).toBe('IN_PROGRESS'))
    // 「더 보기」 팝오버는 열린 채, 칩 줄 끝에 걸린 상태 범주 칩이 생긴다.
    expect(screen.getByTestId('quick-filter-panel-status')).toBeInTheDocument()
    expect(chipKeys()).toEqual(['assignee', 'statusId', 'type', 'label', 'priority', 'status'])
    expect(screen.getByTestId('quick-filter-status')).toHaveTextContent('상태 범주: 진행 중')
  })

  test('칩 고정·숨김은 바로 칩 줄에 반영되고 화면·사용자별로 기억된다', async () => {
    const first = renderBar()
    const { user } = first
    await user.click(await screen.findByTestId('quick-filter-more'))
    const pins = await screen.findByTestId('quick-filter-pins')
    await user.click(within(pins).getByRole('checkbox', { name: '상태 범주 칩으로 보이기' }))
    await user.click(within(pins).getByRole('checkbox', { name: '유형 칩으로 보이기' }))
    expect(chipKeys()).toEqual(['assignee', 'statusId', 'label', 'priority', 'status'])
    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY)!)).toEqual({ pinned: ['status'], hidden: ['type'] })
    first.unmount()

    // 다시 열어도 같은 칩 — 숨긴 유형도 값이 걸려 오면 칩으로 나온다(걸린 필터는 늘 보인다).
    renderBar('/projects/WP?type=5')
    await screen.findByTestId('quick-filter-bar')
    expect(chipKeys()).toEqual(['assignee', 'statusId', 'label', 'priority', 'status', 'type'])
  })

  test('숨긴 칩이 값 때문에만 보일 때, 마지막 값을 풀어도 팝오버는 열린 채 다른 값을 고를 수 있다', async () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ pinned: [], hidden: ['priority'] }))
    const { user, location } = renderBar('/projects/WP?priority=HIGH')
    await screen.findByTestId('quick-filter-bar')
    await user.click(screen.getByTestId('quick-filter-priority-trigger'))
    const panel = await screen.findByTestId('quick-filter-panel-priority')
    const boxes = within(panel).getAllByRole('checkbox')
    const checked = boxes.find((c) => c.getAttribute('aria-checked') === 'true')!
    await user.click(checked)
    await waitFor(() => expect(query(location).has('priority')).toBe(false))
    // 값이 모두 풀려도 팝오버가 남아 다른 값을 고를 수 있고, 닫으면 칩이 빠진다.
    expect(screen.getByTestId('quick-filter-panel-priority')).toBeInTheDocument()
    await user.click(within(screen.getByTestId('quick-filter-panel-priority')).getAllByRole('checkbox').find((c) => c !== checked)!)
    await waitFor(() => expect(query(location).has('priority')).toBe(true))
    await user.keyboard('{Escape}')
    await user.click(screen.getByTestId('quick-filter-priority-remove'))
    await waitFor(() => expect(screen.queryByTestId('quick-filter-priority')).not.toBeInTheDocument())
  })

  test('저장소가 막힌 환경에서도 기본 칩으로 열리고 고정은 이번 화면에서만 유지된다', async () => {
    vi.spyOn(window.localStorage, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    const { user } = renderBar()
    await screen.findByTestId('quick-filter-bar')
    expect(chipKeys()).toEqual(['assignee', 'statusId', 'type', 'label', 'priority'])
    await user.click(screen.getByTestId('quick-filter-more'))
    await user.click(within(await screen.findByTestId('quick-filter-pins')).getByRole('checkbox', { name: '완료일 칩으로 보이기' }))
    expect(chipKeys()).toContain('closedIn')
  })
})
