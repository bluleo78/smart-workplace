// 「일 맡기기」 창 오류 경계(WP-1768 코드 리뷰) — 창 안에서 난 오류가 앱 셸 전체를 오류 화면으로 바꾸지 않고 이 자리에서 멈춘다.
// - 청크 실패 모양(ChunkLoadError·브라우저의 동적 import 실패 문구) → 「새로고침」 토스트(새 배포 묶음을 받아야 낫는다)
// - 그 밖의 렌더 오류 → 창만 닫고 「다시 열어 주세요」 토스트, console.error 로 원인을 남긴다
// vi.mock 이 파일 전체에 걸려 import 자체가 실패하는 테스트(personCardAssignHostLoadError)와 파일을 나눈다.
import { screen } from '@testing-library/react'
import { toast } from 'sonner'
import { beforeEach, expect, test, vi } from 'vitest'

import { usePersonCardAssign } from '@/components/users/personCard/PersonCardAssignContext'
import { renderScreen } from '@/test/renderScreen'

import { PersonCardAssignHost } from './PersonCardAssignHost'

// 창 모듈은 불러와지지만 그릴 때 thrown.error 를 던진다 — 테스트마다 오류 모양을 바꾼다.
const thrown = vi.hoisted(() => ({ error: new Error('창 렌더 오류') as Error }))
vi.mock('./IssueCreateDialog', () => ({
  IssueCreateDialog: () => {
    throw thrown.error
  },
}))

vi.mock('sonner', async (importOriginal) => ({
  ...(await importOriginal<typeof import('sonner')>()),
  toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }),
}))

beforeEach(() => {
  vi.mocked(toast.error).mockClear()
})

/** 카드 대신 처리기를 바로 부르는 단추 — 「일 맡기기」만 흉내 낸다. */
function AssignButton() {
  const assign = usePersonCardAssign()
  return <button type="button" onClick={() => assign?.(9)}>맡기기</button>
}

function renderHost() {
  return renderScreen(
    <PersonCardAssignHost>
      <p>본문 내용</p>
      <AssignButton />
    </PersonCardAssignHost>,
  )
}

test('창 렌더 중 청크 실패 모양의 오류는 「새로고침」 토스트로 알리고 앱 셸은 그대로다', async () => {
  // React 가 경계에서 잡은 오류를 콘솔에 남긴다 — 기대한 오류라 출력만 막는다.
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
  const chunk = new Error('Importing a module script failed.')
  chunk.name = 'ChunkLoadError'
  thrown.error = chunk
  const view = renderHost()
  await view.user.click(screen.getByRole('button', { name: '맡기기' }))
  await vi.waitFor(() => expect(toast.error).toHaveBeenCalledWith('새 이슈 창을 열지 못했습니다 — 새로고침해 주세요'))
  expect(toast.error).toHaveBeenCalledTimes(1)
  expect(screen.getByText('본문 내용')).toBeInTheDocument()
  consoleError.mockRestore()
})

test('그 밖의 창 렌더 오류는 창만 닫고 「다시 열어 주세요」 토스트·console.error — 앱 셸은 그대로이고 다시 열 수 있다', async () => {
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
  thrown.error = new Error('창 렌더 오류')
  const view = renderHost()
  await view.user.click(screen.getByRole('button', { name: '맡기기' }))
  await vi.waitFor(() => expect(toast.error).toHaveBeenCalledWith('새 이슈 창에 문제가 생겨 닫았습니다 — 다시 열어 주세요'))
  expect(toast.error).not.toHaveBeenCalledWith('새 이슈 창을 열지 못했습니다 — 새로고침해 주세요')
  expect(consoleError).toHaveBeenCalledWith('새 이슈 창 렌더 오류', thrown.error)
  // 앱 셸(여기서는 호스트의 children)은 남고 창은 없다.
  expect(screen.getByText('본문 내용')).toBeInTheDocument()
  expect(screen.queryByRole('dialog')).toBeNull()
  // 경계가 걷혀 있어 다시 누르면 다시 그리고(또 실패하면) 또 알린다.
  await view.user.click(screen.getByRole('button', { name: '맡기기' }))
  await vi.waitFor(() => expect(toast.error).toHaveBeenCalledTimes(2))
  consoleError.mockRestore()
})
