// 「일 맡기기」 창 오류 경계(WP-1768 코드 리뷰) — 창 묶음 로드 실패만 토스트로 바꾸고, 창 안 렌더 오류는 삼키지 않고 위 경계로 넘긴다.
// 렌더 오류를 「새로고침해 주세요」 토스트로 덮으면 새로고침으로 낫지 않는 버그가 가려지고 입력도 버려진다.
// vi.mock 이 파일 전체에 걸려 로드 실패 테스트(personCardAssignHostLoadError)와 파일을 나눈다.
import { screen } from '@testing-library/react'
import { Component, type ReactNode } from 'react'
import { toast } from 'sonner'
import { expect, test, vi } from 'vitest'

import { usePersonCardAssign } from '@/components/users/personCard/PersonCardAssignContext'
import { renderScreen } from '@/test/renderScreen'

import { PersonCardAssignHost } from './PersonCardAssignHost'

// 창 모듈은 불러와지지만 그릴 때 던진다 — 창 안 렌더 오류 흉내.
vi.mock('./IssueCreateDialog', () => ({
  IssueCreateDialog: () => {
    throw new Error('창 렌더 오류')
  },
}))

vi.mock('sonner', async (importOriginal) => ({
  ...(await importOriginal<typeof import('sonner')>()),
  toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }),
}))

/** 위 경계 흉내 — 넘어온 오류 문구를 그린다. */
class OuterBoundary extends Component<{ children: ReactNode }, { message: string | null }> {
  state = { message: null as string | null }
  static getDerivedStateFromError(error: Error) {
    return { message: error.message }
  }
  render() {
    return this.state.message ? <p>바깥 경계: {this.state.message}</p> : this.props.children
  }
}

/** 카드 대신 처리기를 바로 부르는 단추 — 「일 맡기기」만 흉내 낸다. */
function AssignButton() {
  const assign = usePersonCardAssign()
  return <button type="button" onClick={() => assign?.(9)}>맡기기</button>
}

test('창 안 렌더 오류는 토스트로 덮지 않고 위 경계로 넘긴다', async () => {
  // React 가 경계에서 잡은 오류를 콘솔에 남긴다 — 기대한 오류라 출력만 막는다.
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
  const view = renderScreen(
    <OuterBoundary>
      <PersonCardAssignHost>
        <AssignButton />
      </PersonCardAssignHost>
    </OuterBoundary>,
  )
  await view.user.click(screen.getByRole('button', { name: '맡기기' }))
  expect(await screen.findByText('바깥 경계: 창 렌더 오류')).toBeInTheDocument()
  expect(toast.error).not.toHaveBeenCalled()
  consoleError.mockRestore()
})
