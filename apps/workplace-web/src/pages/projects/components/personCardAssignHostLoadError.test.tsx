// 「일 맡기기」 창 묶음 로드 실패(WP-1768 코드 리뷰) — 배포 뒤 옛 hash 처럼 지연 import 가 실패해도 앱 셸이 통째로 바뀌지 않고,
// 토스트로 새로고침을 권하며, 다음 클릭에서 다시 불러온다. vi.mock 이 파일 전체에 걸려 정상 흐름 테스트(personCardAssignProject)와 파일을 나눈다.
import { screen } from '@testing-library/react'
import { toast } from 'sonner'
import { beforeEach, expect, test, vi } from 'vitest'

import { usePersonCardAssign } from '@/components/users/personCard/PersonCardAssignContext'
import { renderScreen } from '@/test/renderScreen'

import { PersonCardAssignHost } from './PersonCardAssignHost'

// 창 모듈 import 를 늘 실패시킨다 — 지연 import(Promise)가 거절된다.
vi.mock('./IssueCreateDialog', () => {
  throw new Error('Failed to fetch dynamically imported module')
})

vi.mock('sonner', async (importOriginal) => ({
  ...(await importOriginal<typeof import('sonner')>()),
  toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }),
}))

beforeEach(() => {
  vi.mocked(toast.error).mockClear()
})

/** 카드 대신 처리기를 바로 부르는 단추 — 카드·프로필 요청 없이 「일 맡기기」만 흉내 낸다. */
function AssignButton() {
  const assign = usePersonCardAssign()
  return <button type="button" onClick={() => assign?.(9)}>맡기기</button>
}

test('창 묶음을 못 불러오면 화면은 그대로 두고 토스트로 알리며, 다음 클릭에서 다시 시도한다', async () => {
  // React 가 경계에서 잡은 오류를 콘솔에 남긴다 — 기대한 오류라 출력만 막는다.
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
  const view = renderScreen(
    <PersonCardAssignHost>
      <p>본문 내용</p>
      <AssignButton />
    </PersonCardAssignHost>,
  )
  await view.user.click(screen.getByRole('button', { name: '맡기기' }))
  await vi.waitFor(() => expect(toast.error).toHaveBeenCalledWith('새 이슈 창을 열지 못했습니다 — 새로고침해 주세요'))
  // 앱 셸(여기서는 호스트의 children)은 그대로 남고 창은 없다.
  expect(screen.getByText('본문 내용')).toBeInTheDocument()
  expect(screen.queryByRole('dialog')).toBeNull()

  // 다시 누르면 열림 상태가 초기화돼 있어 다시 불러오고, 또 실패하면 또 알린다(경계에 갇혀 조용히 무시되지 않는다).
  await view.user.click(screen.getByRole('button', { name: '맡기기' }))
  await vi.waitFor(() => expect(toast.error).toHaveBeenCalledTimes(2))
  expect(screen.getByText('본문 내용')).toBeInTheDocument()
  consoleError.mockRestore()
})
