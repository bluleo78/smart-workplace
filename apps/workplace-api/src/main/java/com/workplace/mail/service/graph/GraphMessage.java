package com.workplace.mail.service.graph;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;
import java.util.List;
import java.util.Map;

/**
 * Microsoft Graph delta 응답의 단일 메시지 항목. Graph delta 에서 삭제된 항목은 {@code
 * "@removed":{"reason":"deleted"}} 를 포함하고 나머지 필드는 없다. 삭제가 아닌 신규/변경 항목은 {@code @removed}가 null 이다.
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public record GraphMessage(
    String id,
    String subject,
    Recipient from,
    List<Recipient> toRecipients,
    List<Recipient> ccRecipients,
    String receivedDateTime,
    String sentDateTime,
    /**
     * 읽음 여부. delta 응답에 없으면 null — WP-148: 누락을 "안읽음"으로 오인해 로컬 읽음을 되돌리지 않도록 원시형 대신 Boolean. JSON 키를
     * 명시해 is- 접두 레코드 컴포넌트 매핑을 Jackson 추론에 맡기지 않는다.
     */
    @JsonProperty("isRead") Boolean isRead,
    boolean hasAttachments,
    String internetMessageId,
    String conversationId,
    /** {@code @removed} 마커 — 삭제된 항목에만 존재(null이면 신규/변경). */
    @JsonProperty("@removed") Map<String, String> removed) {

  /** 수신자(from · toRecipients · ccRecipients). */
  @JsonIgnoreProperties(ignoreUnknown = true)
  public record Recipient(EmailAddress emailAddress) {}

  /** Graph 이메일 주소 중첩 객체. */
  @JsonIgnoreProperties(ignoreUnknown = true)
  public record EmailAddress(String address, String name) {}
}
