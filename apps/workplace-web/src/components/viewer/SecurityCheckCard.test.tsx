// WP-1262: AI 패널 「보안 점검」 카드 — 완료(근거·꼬리 문구)·진행 중·실패 표시.
import { screen, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'

import { server } from '../../test/msw/server'
import { renderWithProviders } from '../../test/renderWithProviders'
import type { SecurityCheckView } from '../../types/securityCheck'
import { SecurityCheckCard } from './SecurityCheckCard'

const PATH = '/api/v1/drive/files/9/security-check'
const view = (p: Partial<SecurityCheckView>): SecurityCheckView => ({
  status: null, risk: null, headline: null, evidence: [], checkedAt: null, reason: null, ...p,
})
const serve = (v: SecurityCheckView, status = 200) =>
  server.use(http.get('*/drive/files/9/security-check', () => HttpResponse.json(v, { status })))

describe('SecurityCheckCard', () => {
  it('showsChipHeadlineEvidenceAndFooter_whenDoneHigh', async () => {
    serve(view({
      status: 'DONE', risk: 'HIGH', headline: '외부로 값을 보내요', checkedAt: '2026-11-01T01:02:03Z',
      evidence: [{ kind: 'EXTERNAL_REQUEST', detail: 'evil.example' }, { kind: 'CREDENTIAL_INPUT', detail: '비밀번호 입력창' }],
    }))
    renderWithProviders(<SecurityCheckCard path={PATH} />)
    const card = await screen.findByTestId('security-check-card')
    expect(await within(card).findByText('높음')).toBeInTheDocument()
    expect(within(card).getByText('외부로 값을 보내요')).toBeInTheDocument()
    expect(within(card).getByText('바깥 요청: evil.example')).toBeInTheDocument()
    expect(within(card).getByText('로그인 흉내 입력창: 비밀번호 입력창')).toBeInTheDocument()
    expect(card).toHaveTextContent('AI 판단이라 틀릴 수 있어요 · ')
    expect(card).not.toHaveTextContent('· -')
  })

  it('showsProgressText_whenChecking', async () => {
    serve(view({ status: 'CHECKING' }))
    renderWithProviders(<SecurityCheckCard path={PATH} />)
    expect(await screen.findByText('AI 가 점검하는 중…')).toBeInTheDocument()
  })

  it('showsFailureText_whenFailed', async () => {
    serve(view({ status: 'FAILED' }))
    renderWithProviders(<SecurityCheckCard path={PATH} />)
    expect(await screen.findByText('보안 점검을 하지 못했어요')).toBeInTheDocument()
  })
})
