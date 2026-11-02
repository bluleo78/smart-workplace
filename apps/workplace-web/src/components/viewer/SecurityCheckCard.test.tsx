// WP-1262: AI 패널 「보안 점검」 카드 — 완료(근거·꼬리 문구)·진행 중·실패 표시.
import { screen, waitFor, within } from '@testing-library/react'
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
    expect(within(card).getByText('위협 근거')).toBeInTheDocument()
    expect(within(card).queryByText('참고 정보')).not.toBeInTheDocument()
  })

  // WP-1283: 「낮음」의 근거는 위협 근거가 아니라 참고 정보로 보인다.
  it('showsEvidenceAsReference_whenLow', async () => {
    serve(view({
      status: 'DONE', risk: 'LOW', headline: '문서 안에서만 움직여요', checkedAt: '2026-11-01T01:02:03Z',
      evidence: [{ kind: 'EXTERNAL_REQUEST', detail: '글꼴 CSS' }],
    }))
    renderWithProviders(<SecurityCheckCard path={PATH} />)
    const card = await screen.findByTestId('security-check-card')
    expect(await within(card).findByText('참고 정보')).toBeInTheDocument()
    expect(within(card).queryByText('위협 근거')).not.toBeInTheDocument()
    expect(within(card).getByText('바깥 요청: 글꼴 CSS')).toBeInTheDocument()
  })

  // WP-1283: 지난 판정 기준의 결과면 안내와 「다시 점검」이 보이고, 누르면 점검을 요청한다.
  it('offersRecheck_whenOutdated', async () => {
    let posts = 0
    serve(view({ status: 'DONE', risk: 'CAUTION', headline: 'h', checkedAt: '2026-11-01T01:02:03Z', outdated: true }))
    server.use(http.post('*/drive/files/9/security-check', () => { posts++; return HttpResponse.json(view({ status: 'PENDING' })) }))
    renderWithProviders(<SecurityCheckCard path={PATH} />)
    const card = await screen.findByTestId('security-check-card')
    expect(await within(card).findByText('점검 기준이 바뀌었어요. 다시 점검하면 새 기준으로 봐요')).toBeInTheDocument()
    within(card).getByRole('button', { name: '다시 점검' }).click()
    await waitFor(() => expect(posts).toBe(1))
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
