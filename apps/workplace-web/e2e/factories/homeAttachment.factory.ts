// 테스트용 홈(메인 AI 채팅) 세션 첨부 팩토리 — 백엔드 HomeAttachment 응답과 1:1 (WP-234).
import type { HomeAttachment } from '../../src/types/home'

export function createHomeAttachment(overrides: Partial<HomeAttachment> = {}): HomeAttachment {
  return {
    fileId: 7001,
    messageId: 1,
    originalName: 'spec.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 2048,
    extraction: { status: 'READY', totalChars: 1200, truncated: false, reasonCode: null, reason: null },
    ...overrides,
  }
}
