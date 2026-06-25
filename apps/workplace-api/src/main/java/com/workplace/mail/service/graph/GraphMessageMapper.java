package com.workplace.mail.service.graph;

import com.workplace.mail.dto.ParsedMessage;
import java.time.Instant;
import java.util.List;
import java.util.stream.Collectors;

/**
 * Graph API 메시지 JSON → 내부 {@link ParsedMessage} 매핑 유틸리티. 순수 정적 변환 — 외부 의존 없음, 단위 테스트 가능.
 *
 * <p>imapUid 는 Graph 계정에서 사용되지 않으므로 0 으로 설정하지 않고 ParsedMessage 생성 후 DB 저장 시 null 처리한다. Graph 계정에서는
 * provider_message_id(Graph id)가 실제 고유 키다.
 */
public final class GraphMessageMapper {

  private GraphMessageMapper() {}

  /**
   * Graph 메시지를 {@link ParsedMessage}로 변환한다.
   *
   * <p>threadId NOT NULL 보장 — {@code conversationId → internetMessageId → "provider:{id}"} 폴백 체인.
   *
   * @param m Graph delta 메시지(삭제 마커 없는 신규/변경 항목)
   * @return 파싱된 메시지 DTO. imapUid=0(Graph 계정에서 사용 안 함, DB 저장 시 null 처리)
   */
  public static ParsedMessage toParsed(GraphMessage m) {
    // 보낸사람 주소·이름 추출
    String fromAddress =
        m.from() != null && m.from().emailAddress() != null
            ? m.from().emailAddress().address()
            : null;
    String fromName =
        m.from() != null && m.from().emailAddress() != null ? m.from().emailAddress().name() : null;

    // toRecipients 리스트를 쉼표 구분 문자열로 변환
    String toAddresses = joinRecipients(m.toRecipients());
    // ccRecipients 리스트를 쉼표 구분 문자열로 변환
    String ccAddresses = joinRecipients(m.ccRecipients());

    // 날짜 파싱 — null 안전 처리
    Instant receivedAt = parseInstant(m.receivedDateTime());
    Instant sentAt = parseInstant(m.sentDateTime());

    // threadId NOT NULL 보장: conversationId → internetMessageId → provider id 폴백
    String threadId = m.conversationId();
    if (threadId == null || threadId.isBlank()) {
      threadId = m.internetMessageId();
    }
    if (threadId == null || threadId.isBlank()) {
      threadId = "provider:" + m.id();
    }

    return new ParsedMessage(
        0L /* imapUid — Graph 계정에서 미사용, upsertByProviderId 에서 null 저장 */,
        m.internetMessageId() /* messageId (RFC 2822 Message-ID) */,
        threadId,
        null /* inReplyTo — Graph delta 에서 미제공, on-demand 시 필요 시 보충 */,
        null /* references — 동일 이유 */,
        fromAddress,
        fromName,
        toAddresses,
        ccAddresses,
        m.subject(),
        sentAt,
        receivedAt,
        m.isRead() /* seen */,
        m.hasAttachments(),
        null /* bodyText — on-demand 적재 */,
        null /* bodyHtml — on-demand 적재 */,
        null /* snippet — on-demand 적재 */,
        List.of() /* attachments — on-demand */);
  }

  /** 수신자 목록을 "주소 <이름>, ..." 형식 문자열로 변환. 빈 리스트면 null. */
  private static String joinRecipients(List<GraphMessage.Recipient> recipients) {
    if (recipients == null || recipients.isEmpty()) {
      return null;
    }
    return recipients.stream()
        .filter(r -> r != null && r.emailAddress() != null)
        .map(r -> r.emailAddress().address())
        .filter(a -> a != null && !a.isBlank())
        .collect(Collectors.joining(", "));
  }

  /** ISO-8601 문자열을 Instant 로 파싱. null 또는 빈 문자열이면 null 반환. */
  private static Instant parseInstant(String dateTimeStr) {
    if (dateTimeStr == null || dateTimeStr.isBlank()) {
      return null;
    }
    try {
      return Instant.parse(dateTimeStr);
    } catch (Exception e) {
      return null;
    }
  }
}
