// 메일 목록 내부/외부 구분(WP-1325) — 화면 테스트(WP-971).
// 서버가 판정한 externalSender 가 참인 행에만 「외부」 태그를 붙이고(내부·판정 없음은 표시하지 않음), 행 이름에도 (외부)를 더한다.
// 조건부 렌더·accessible name 이라 브라우저 없이 판정된다.
import { screen, within } from '@testing-library/react'
import { expect, test } from 'vitest'

import { renderMail } from '@/test/kits/mail/testkit-b4'

import { summary } from '../../../e2e/factories/mail.factory'

const rows = () => [
  summary({ id: 10, fromName: '김동료', fromAddress: 'kim@corp.test', subject: '주간 회의', externalSender: false }),
  summary({ id: 11, fromName: 'Acme Sales', fromAddress: 'sales@acme.test', subject: '견적서', externalSender: true }),
  summary({ id: 12, fromName: null, fromAddress: null, subject: '보낸 사람 없음', externalSender: null }),
]

test('외부 메일 행에만 「외부」 태그가 붙고, 내부·판정 없음 행에는 붙지 않는다', async () => {
  renderMail('/mail/1', { messages: rows() })
  const external = await screen.findByTestId('mail-row-11')
  expect(within(external).getByTestId('mail-external-11')).toHaveTextContent('외부')
  expect(screen.queryByTestId('mail-external-10')).not.toBeInTheDocument()
  expect(screen.queryByTestId('mail-external-12')).not.toBeInTheDocument()
})

test('외부 메일 행 이름에는 (외부)가 들어가고 내부 메일 행 이름은 그대로다', async () => {
  renderMail('/mail/1', { messages: rows() })
  expect(await screen.findByTestId('mail-row-11')).toHaveAccessibleName('Acme Sales (외부) 견적서')
  expect(screen.getByTestId('mail-row-10')).toHaveAccessibleName('김동료 주간 회의')
})
