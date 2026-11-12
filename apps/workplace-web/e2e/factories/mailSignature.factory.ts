// 메일 서명 mock 팩토리(WP-1517) — /api/v1/mail/signature 응답. 기본값은 서버가 아직 저장한 적 없는 사용자에게 주는 값
// (빈 서명·새 메일 켬·답장·전달 끔)과 같다. 화면 테스트·E2E·공통 기본 스텁이 같은 값을 쓴다.
import type { MailSignature } from '../../src/types/mailSignature'

export function createMailSignature(overrides: Partial<MailSignature> = {}): MailSignature {
  return { html: '', autoNew: true, autoReply: false, updatedAt: null, droppedImageCount: 0, ...overrides }
}
