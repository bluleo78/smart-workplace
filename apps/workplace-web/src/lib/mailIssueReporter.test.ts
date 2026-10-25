import { describe, expect, it } from 'vitest'

import type { MailIssueDraft } from '../types/mailMessage'
import { mailReporterChoice } from './mailIssueReporter'

const base: MailIssueDraft = {
  title: 't',
  body: 'b',
  priority: 'MID',
  suggestedProjectKey: null,
  candidateProjects: [
    { key: 'OPEN', name: '오픈', senderSelectable: true, senderDefault: true },
    { key: 'READ', name: '관리자만 봄', senderSelectable: true, senderDefault: false },
    { key: 'TEAM', name: '팀', senderSelectable: false, senderDefault: false },
  ],
  sender: { address: 'kim@corp.example', name: '김보냄', member: true, self: false },
}

describe('mailReporterChoice', () => {
  it('보낸 사람이 멤버이거나 OPEN 이면 기본이 보낸 사람, 볼 수만 있으면 고를 수 있되 기본은 나', () => {
    expect(mailReporterChoice(base, 'OPEN')).toMatchObject({ senderSelectable: true, defaultReporter: 'SENDER' })
    expect(mailReporterChoice(base, 'READ')).toMatchObject({ senderSelectable: true, defaultReporter: 'ME' })
  })

  it('프로젝트를 볼 수 없거나 외부·내가 보낸 메일이면 고를 수 없고 이유를 준다', () => {
    expect(mailReporterChoice(base, 'TEAM')).toMatchObject({ senderSelectable: false, defaultReporter: 'ME', reason: '보낸 사람이 이 프로젝트를 볼 수 없어 고를 수 없어요' })
    const external = { ...base, sender: { address: 'x@out.example', name: null, member: false, self: false } }
    expect(mailReporterChoice(external, 'OPEN').reason).toBe('보낸 사람이 워크스페이스 구성원이 아니라 고를 수 없어요')
    const self = { ...base, sender: { address: 'me@corp.example', name: null, member: false, self: true } }
    expect(mailReporterChoice(self, 'OPEN').reason).toBe('내가 보낸 메일이에요')
  })

  it('구버전 서버(sender 없음)·초안 전에는 보고자 줄을 숨긴다', () => {
    expect(mailReporterChoice({ ...base, sender: undefined }, 'OPEN').visible).toBe(false)
    expect(mailReporterChoice(null, 'OPEN').visible).toBe(false)
  })
})
