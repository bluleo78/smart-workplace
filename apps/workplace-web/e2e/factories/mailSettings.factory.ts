// 메일 사용자 설정 mock 팩토리(WP-1744) — /api/v1/mail/settings 응답. 기본값은 서버가 아직 저장한 적 없는 사용자에게 주는 값(우측 하단, DOCK)과 같다.
// 화면 테스트·E2E·공통 기본 스텁이 같은 값을 쓴다.
import type { MailUserSettings } from '../../src/types/mailSettings'

export function createMailSettings(overrides: Partial<MailUserSettings> = {}): MailUserSettings {
  return { composeMode: 'DOCK', ...overrides }
}
