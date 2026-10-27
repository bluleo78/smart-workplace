// 에픽 색 고르기(WP-1017) — 컴포넌트 테스트(WP-971).
// 지금 색 표시(이름·접근 이름)·고른 색 payload(PUT epic-color)·같은 색 재선택은 요청 없음·권한 없으면 비활성·서버 거절(400) 오류 문구는
// 브라우저 없이 판정되므로 실제 훅 + MSW 로 지킨다.
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, test } from 'vitest'

import { server } from '@/test/msw/server'
import { renderWithProviders } from '@/test/renderWithProviders'

import { EpicColorField } from './EpicColorField'

const KEY = 'WP'
const NUMBER = 7

/** PUT 본문을 쌓고, status 를 주면 그 상태·메시지로 거절한다. */
function epicColorApi(status = 200) {
  const bodies: unknown[] = []
  server.use(
    http.put(`/api/v1/projects/${KEY}/issues/${NUMBER}/epic-color`, async ({ request }) => {
      const body = (await request.json()) as { colorToken: string }
      bodies.push(body)
      if (status !== 200) return HttpResponse.json({ status, message: '에픽에만 색을 정할 수 있습니다' }, { status })
      return HttpResponse.json({ colorToken: body.colorToken })
    }),
  )
  return { bodies }
}

describe('에픽 색 고르기 (WP-1017)', () => {
  test('지금 색을 이름으로 보이고, 견본을 고르면 그 토큰으로 저장한다', async () => {
    const api = epicColorApi()
    renderWithProviders(<EpicColorField projectKey={KEY} issueNumber={NUMBER} epicColor="ORANGE" fallbackColor="PURPLE" />)

    const trigger = screen.getByTestId('epic-color-trigger')
    expect(trigger).toHaveTextContent('주황')
    expect(trigger).toHaveAccessibleName(/에픽 색 선택.*주황/)

    fireEvent.click(trigger)
    const popover = await screen.findByTestId('epic-color-popover')
    // 12색 견본 — 한국어 이름으로 읽히고, 지금 색만 눌림 상태.
    const group = within(popover).getByRole('group', { name: '에픽 색' })
    expect(within(group).getAllByRole('button')).toHaveLength(12)
    expect(within(group).getByRole('button', { name: '주황' })).toHaveAttribute('aria-pressed', 'true')
    expect(within(group).getByRole('button', { name: '파랑' })).toHaveAttribute('aria-pressed', 'false')

    fireEvent.click(within(group).getByRole('button', { name: '청록' }))
    await waitFor(() => expect(api.bodies).toEqual([{ colorToken: 'TEAL' }]))
    // 고르면 팝오버가 닫힌다(단일 선택).
    await waitFor(() => expect(screen.queryByTestId('epic-color-popover')).not.toBeInTheDocument())
  })

  test('같은 색을 다시 고르면 요청하지 않는다', async () => {
    const api = epicColorApi()
    renderWithProviders(<EpicColorField projectKey={KEY} issueNumber={NUMBER} epicColor="BLUE" />)
    fireEvent.click(screen.getByTestId('epic-color-trigger'))
    fireEvent.click(await screen.findByTestId('epic-color-option-BLUE'))
    await waitFor(() => expect(screen.queryByTestId('epic-color-popover')).not.toBeInTheDocument())
    expect(api.bodies).toEqual([])
  })

  test('에픽 색이 아직 없으면 유형 색을 대신 보이고, 회색(GRAY)도 고를 수 있다', async () => {
    const api = epicColorApi()
    renderWithProviders(<EpicColorField projectKey={KEY} issueNumber={NUMBER} epicColor={null} fallbackColor="PURPLE" />)
    expect(screen.getByTestId('epic-color-trigger')).toHaveTextContent('보라')

    fireEvent.click(screen.getByTestId('epic-color-trigger'))
    fireEvent.click(await screen.findByTestId('epic-color-option-GRAY'))
    await waitFor(() => expect(api.bodies).toEqual([{ colorToken: 'GRAY' }]))
  })

  test('바꿀 권한이 없으면 값만 보이고 누를 수 없다', () => {
    renderWithProviders(<EpicColorField projectKey={KEY} issueNumber={NUMBER} epicColor="RED" disabled />)
    expect(screen.getByTestId('epic-color-trigger')).toBeDisabled()
    expect(screen.getByTestId('epic-color-trigger')).toHaveTextContent('빨강')
  })

  test('서버가 거절하면(400) 그 문구를 오류 토스트로 알린다', async () => {
    epicColorApi(400)
    const { Toaster } = await import('sonner')
    renderWithProviders(
      <>
        <EpicColorField projectKey={KEY} issueNumber={NUMBER} epicColor="RED" />
        <Toaster />
      </>,
    )
    fireEvent.click(screen.getByTestId('epic-color-trigger'))
    fireEvent.click(await screen.findByTestId('epic-color-option-PINK'))
    expect(await screen.findByText('에픽에만 색을 정할 수 있습니다')).toBeInTheDocument()
  })
})
