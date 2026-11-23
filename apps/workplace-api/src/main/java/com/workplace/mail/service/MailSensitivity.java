package com.workplace.mail.service;

/**
 * 받은 메일의 기밀 표시 판정(WP-2030). 발신 측이 RFC 2156 {@code Sensitivity} 헤더(IMAP) 또는 MAPI 속성 0x0036(Graph)로
 * 남긴 「기밀」 값만 인식한다. 제목의 「[기밀]」 같은 문구는 발신자 임의 텍스트라 판정에 쓰지 않는다.
 */
public final class MailSensitivity {

  /** IMAP 에서 읽는 헤더 이름. */
  public static final String HEADER = "Sensitivity";

  /** Graph singleValueExtendedProperties 로 조회하는 PR_SENSITIVITY 속성 id. */
  public static final String GRAPH_PROP_ID = "Integer 0x0036";

  private static final String CONFIDENTIAL_HEADER_VALUE = "company-confidential";

  /** Graph PR_SENSITIVITY 에서 「기밀」을 뜻하는 값(0 보통·1 개인·2 비공개·3 기밀). */
  private static final String CONFIDENTIAL_GRAPH_VALUE = "3";

  private MailSensitivity() {}

  /** Sensitivity 헤더 값이 Company-Confidential(대소문자·앞뒤 공백 무시)이면 true. */
  public static boolean isConfidentialHeader(String value) {
    return value != null && CONFIDENTIAL_HEADER_VALUE.equalsIgnoreCase(value.trim());
  }

  /**
   * Sensitivity 헤더 값 여럿 중 하나라도 Company-Confidential 이면 true — IMAP 메타·본문, Graph 본문 헤더가 모두 이 한 규칙으로
   * 판정해 같은 메일이 경로마다 달리 판정되지 않게 한다.
   */
  public static boolean anyConfidentialHeader(java.util.Collection<String> values) {
    return values != null && values.stream().anyMatch(MailSensitivity::isConfidentialHeader);
  }

  /** Graph PR_SENSITIVITY 값이 "3"(앞뒤 공백 무시)이면 true. */
  public static boolean isConfidentialGraphValue(String value) {
    return value != null && CONFIDENTIAL_GRAPH_VALUE.equals(value.trim());
  }
}
