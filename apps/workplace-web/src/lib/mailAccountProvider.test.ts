// 메일 계정 공급자 라벨 단위 테스트(WP-412) — 이전 E2E profile/mail-accounts(M365_GRAPH 행에 Outlook 라벨)를 대체.
import { describe, expect, it } from 'vitest'

import { mailAccountProviderLabel } from './mailAccountProvider'

describe('mailAccountProviderLabel', () => {
  it('M365_GRAPH 는 Outlook 라벨(IMAP 호스트가 비어 있어도)', () => {
    expect(mailAccountProviderLabel({ provider: 'M365_GRAPH', imapHost: '' })).toBe('Outlook (Microsoft 365)')
  })
  it('IMAP 은 호스트, 호스트가 없으면 IMAP', () => {
    expect(mailAccountProviderLabel({ provider: 'IMAP', imapHost: 'imap.gmail.com' })).toBe('imap.gmail.com')
    expect(mailAccountProviderLabel({ provider: 'IMAP', imapHost: '' })).toBe('IMAP')
  })
})
