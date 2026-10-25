// 받은편지함 E2E 모킹 픽스처 — 계정 + 메시지 목록/상세.
import type { MailAccountResponse } from '../../src/types/mailAccount'
import type { MailDraftDetail } from '../../src/types/mailDraft'
import type { MailServerFolder } from '../../src/types/mailFolder'
import type {
  EmailMessageDetail,
  EmailMessageSummary,
} from '../../src/types/mailMessage'

/** 연결된 메일 계정 1건. */
export function mailAccount(overrides?: Partial<MailAccountResponse>): MailAccountResponse {
  return {
    id: 1,
    provider: 'IMAP', // #499 — provider 필드 추가
    emailAddress: 'me@example.com',
    displayName: '내 계정',
    imapHost: 'imap.example.com',
    imapPort: 993,
    imapSecurity: 'SSL_TLS',
    imapUsername: 'me@example.com',
    smtpHost: 'smtp.example.com',
    smtpPort: 587,
    smtpSecurity: 'STARTTLS',
    smtpUsername: 'me@example.com',
    aiEnabled: false,
    lastTestedAt: '2026-06-03T00:00:00Z',
    lastSyncedAt: null,
    createdAt: '2026-06-03T00:00:00Z',
    updatedAt: '2026-06-03T00:00:00Z',
    ...overrides,
  }
}

/** 목록 요약 행. */
export function summary(overrides?: Partial<EmailMessageSummary>): EmailMessageSummary {
  return {
    id: 10,
    accountId: 1,
    threadId: 'root@example.com',
    fromAddress: 'alice@example.com',
    fromName: '앨리스',
    subject: '프로젝트 회의 안내',
    snippet: '내일 오후 2시에 회의를 진행합니다',
    receivedAt: '2026-06-03T01:00:00Z',
    seen: false,
    hasAttachment: true,
    aiCategory: null,
    aiNeedsReply: null,
    categoryPending: false,
    ...overrides,
  }
}

/** 본문 상세(첨부 1건). */
export function detail(overrides?: Partial<EmailMessageDetail>): EmailMessageDetail {
  return {
    id: 10,
    threadId: 'root@example.com',
    messageId: 'root@example.com',
    fromAddress: 'alice@example.com',
    fromName: '앨리스',
    toAddresses: 'me@example.com',
    ccAddresses: null,
    bccAddresses: null,
    subject: '프로젝트 회의 안내',
    sentAt: '2026-06-03T01:00:00Z',
    receivedAt: '2026-06-03T01:00:00Z',
    seen: false,
    bodyText: '내일 오후 2시에 회의를 진행합니다. 참석 부탁드립니다.',
    bodyHtml: null,
    attachments: [
      { id: 1, filename: '안건.pdf', contentType: 'application/pdf', sizeBytes: 1024, contentId: null },
    ],
    ...overrides,
  }
}

/** 임시저장 상세 한 건(WP-577) — 받는사람·본문 등은 덮어쓴다. */
export function draftDetail(overrides: Partial<MailDraftDetail> = {}): MailDraftDetail {
  return {
    id: 7,
    accountId: 1,
    mode: 'new',
    to: ['rcpt@test.local'],
    cc: [],
    bcc: [],
    subject: '쓰다 만 메일',
    bodyHtml: '<p>쓰다 만 본문</p>',
    sourceMessageId: null,
    quoteRemoved: false,
    attachments: [],
    version: 1,
    updatedAt: '2026-10-21T01:00:00Z',
    ...overrides,
  }
}

/** 서버 메일함 한 개(WP-961) — 기본: 열 수 있는 USER 최상위, 아직 안 가져옴. */
export function mailServerFolder(overrides: Partial<MailServerFolder> & { id: number }): MailServerFolder {
  return {
    displayName: `메일함${overrides.id}`,
    parentId: null,
    role: 'USER',
    selectable: true,
    unreadCount: 0,
    totalCount: 0,
    syncedSince: null,
    folderSyncedAt: null,
    ...overrides,
  }
}
