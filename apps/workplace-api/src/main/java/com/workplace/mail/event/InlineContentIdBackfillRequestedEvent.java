package com.workplace.mail.event;

/**
 * 인라인 이미지 Content-ID 지연 백필 요청(WP-68).
 *
 * <p>상세 열람 시 본문이 cid: 를 참조하는데 Content-ID 가 비어 있는 이미지 첨부가 있으면 발행한다. 규칙 도입 전에 적재된 Graph 메일은
 * Content-ID 가 저장돼 있지 않아 파일명과 무관한 cid(예: Gmail 발신 {@code ii_xxx})를 매칭할 수 없기 때문이다. 비동기 리스너({@link
 * com.workplace.mail.service.MailInlineContentIdBackfiller})가 Graph 단건 조회로 채운다 — best-effort.
 *
 * @param tenantId 발행 시점 테넌트 ID (비동기 스레드에서 TenantContext 재주입)
 * @param userId 열람 사용자 ID (소유 검증·Graph 토큰 조회)
 * @param messageId email_message.id
 */
public record InlineContentIdBackfillRequestedEvent(long tenantId, long userId, long messageId) {}
