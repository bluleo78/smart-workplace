// 메일→이슈 보고자 선택(WP-954) — 「나」/「보낸 사람」 중 보낸 사람을 고를 수 있는지, 기본으로 무엇을 고를지, 못 고르면 왜인지.
// 서버 초안(MailIssueDraft.sender·candidateProjects)의 판정을 프로젝트별로 읽기만 한다 — 모달이 프로젝트를 바꿀 때마다 같은 규칙을 쓴다.
import type { MailIssueDraft } from '../types/mailMessage'

export type MailIssueReporter = 'ME' | 'SENDER'

export interface MailReporterChoice {
  /** 「보낸 사람」 선택지를 보일지 — 구버전 서버(sender 없음)면 보고자 줄째 숨긴다. */
  visible: boolean
  /** 「보낸 사람」을 고를 수 있는지. */
  senderSelectable: boolean
  /** 이 프로젝트의 기본값 — 보낸 사람이 프로젝트 멤버이거나 OPEN 이면 SENDER. */
  defaultReporter: MailIssueReporter
  /** 고를 수 없을 때 이유(사용자 문구). */
  reason: string | null
}

/** 선택된 프로젝트에서의 보고자 선택 상태. */
export function mailReporterChoice(draft: MailIssueDraft | null, projectKey: string): MailReporterChoice {
  const sender = draft?.sender
  if (!draft || !sender) return { visible: false, senderSelectable: false, defaultReporter: 'ME', reason: null }
  if (sender.self) return { visible: true, senderSelectable: false, defaultReporter: 'ME', reason: '내가 보낸 메일이에요' }
  if (!sender.member) {
    return { visible: true, senderSelectable: false, defaultReporter: 'ME', reason: '보낸 사람이 워크스페이스 구성원이 아니라 고를 수 없어요' }
  }
  const project = draft.candidateProjects.find((p) => p.key === projectKey)
  if (!project?.senderSelectable) {
    return { visible: true, senderSelectable: false, defaultReporter: 'ME', reason: '보낸 사람이 이 프로젝트를 볼 수 없어 고를 수 없어요' }
  }
  return { visible: true, senderSelectable: true, defaultReporter: project.senderDefault ? 'SENDER' : 'ME', reason: null }
}
