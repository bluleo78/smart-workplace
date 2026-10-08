import { describe, expect, it } from 'vitest'

import { planClose, planOpen } from '@/lib/historyParam'

import { MAIL_DETAIL_PARAM } from './mailHistory'

describe('MAIL_DETAIL_PARAM', () => {
  it('다른 메일로 바꾸면 첨부 뷰어 키(?preview)를 지운다 — 다른 쿼리는 둔다', () => {
    const plan = planOpen({ search: '?folder=sent&messageId=10&preview=mail%3A7', state: null, idx: 2 }, 'messageId', '11', MAIL_DETAIL_PARAM)
    expect(plan).toMatchObject({ kind: 'replace' })
    expect(plan.kind !== 'none' && plan.kind !== 'go' ? new URLSearchParams(plan.search).toString() : null).toBe('folder=sent&messageId=11')
  })

  it('메일 없이 남은 ?preview 도 메일을 열면 지운다', () => {
    const plan = planOpen({ search: '?preview=mail%3A7', state: null, idx: 1 }, 'messageId', '10', MAIL_DETAIL_PARAM)
    expect(plan).toMatchObject({ kind: 'push' })
    expect(plan.kind === 'push' ? plan.search : null).toBe('?messageId=10')
  })

  it('콜드 진입에서 메일을 닫으면 ?preview 도 함께 지운다', () => {
    const plan = planClose({ search: '?messageId=10&preview=mail%3A7', state: null, idx: 0 }, 'messageId', MAIL_DETAIL_PARAM)
    expect(plan).toMatchObject({ kind: 'replace', search: '' })
  })
})
