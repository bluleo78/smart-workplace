// 이름 바꾸기 대화상자 — 실패 안내가 role=alert 로 읽히는지 본다(WP-1901).
import { screen } from '@testing-library/react'
import { describe, expect, test } from 'vitest'

import { renderScreen } from '@/test/renderScreen'

import { RenameDialog } from './rename-dialog'

describe('RenameDialog 실패 안내 (WP-1901)', () => {
  test('이름 바꾸기 실패 안내는 alert 로 읽히고, 값을 고치면 사라진다', async () => {
    const { user } = renderScreen(
      <RenameDialog
        open
        title="이름 변경"
        initialValue="기존"
        onConfirm={() => Promise.reject(new Error('중복'))}
        onClose={() => {}}
        extractError={() => '이미 같은 이름이 있습니다.'}
      />,
    )
    expect(screen.queryByRole('alert')).toBeNull()
    await user.click(await screen.findByRole('button', { name: '확인' }))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('이미 같은 이름이 있습니다.')
    expect(alert).toBe(screen.getByTestId('rename-dialog-error'))
    // 고치면 빈 alert 가 남지 않는다
    await user.type(screen.getByTestId('rename-dialog-input'), 'X')
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
