// 「조회 실패 뒤 다시 시도」 화면 테스트 공용 도우미(WP-1788) — 6개 목록 화면 테스트가 같은 순서를 되풀이해 한곳으로 모았다.
// TanStack Query 는 데이터 없이 실패한 쿼리를 다시 부르면 status 를 pending 으로 돌린다 — 그 동안에도 오류 안내·초점이 남는지 본다.
import { screen, waitFor, within } from '@testing-library/react'
import type userEvent from '@testing-library/user-event'
import { expect } from 'vitest'

/**
 * MSW 핸들러에서 응답을 붙잡아 두는 문. 핸들러가 `await promise` 로 멈추고, 테스트가 `release()` 로 푼다.
 * 다시 부르는 동안(pending)의 화면 상태를 응답 전에 단언하려고 쓴다.
 */
export function gate(): { promise: Promise<void>; release: () => void } {
  let release!: () => void
  const promise = new Promise<void>((resolve) => {
    release = resolve
  })
  return { promise, release }
}

/**
 * 오류 안내의 「다시 시도」를 누르고, 응답 전(다시 부르는 중)에도 안내·초점이 남는지 단언한다.
 * 순서: 안내 찾기 → 단추 클릭 → 호출 수 2(다시 부르기 시작) → 단추 aria-busy → 안내 보임·「불러오는 중…」 없음·초점이 단추.
 * @param errorTestId 오류 안내(LoadErrorState)의 testId
 * @param calls 지금까지의 API 호출 수를 돌려주는 함수 — 두 번째 호출이 시작될 때까지 기다린다
 * @returns 눌렀던 「다시 시도」 단추 — 호출한 테스트가 응답 뒤 상태를 더 단언할 수 있게
 */
export async function clickRetryAndExpectErrorKept(
  user: ReturnType<typeof userEvent.setup>,
  errorTestId: string,
  calls: () => number,
): Promise<HTMLElement> {
  const error = await screen.findByTestId(errorTestId)
  const retry = within(error).getByRole('button', { name: /다시 시도/ })
  await user.click(retry)
  await waitFor(() => expect(calls()).toBe(2))
  await waitFor(() => expect(retry).toHaveAttribute('aria-busy', 'true'))
  expect(screen.getByTestId(errorTestId)).toBeInTheDocument()
  expect(screen.queryByText('불러오는 중…')).toBeNull()
  expect(document.activeElement).toBe(retry)
  return retry
}
