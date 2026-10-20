package com.workplace.mail.exception;

/**
 * ai-agent 메일 기능 미설정/일시 불가(503) — 사용자 친화 메시지.
 *
 * <p>영구 사유(AI 꺼짐·비서 미설정)는 {@code errors.code} 로 사유 코드를 함께 싣는다 — 웹이 "잠시 후 다시"가 아니라 설정 안내를 띄우도록. 일시
 * 불가(ai-agent 재기동 등)는 코드가 없다(null).
 */
public class MailAiUnavailableException extends RuntimeException {

  /** 계정의 AI 비서가 꺼져 있다(계정 설정에서 켜야 한다). */
  public static final String AI_DISABLED = "AI_DISABLED";

  /** 사용할 AI 비서가 설정돼 있지 않다(관리자 설정 필요). */
  public static final String ASSISTANT_NOT_CONFIGURED = "ASSISTANT_NOT_CONFIGURED";

  /** errors.code 로 싣는 사유 코드 — 일시 불가면 null. */
  private final String code;

  public MailAiUnavailableException(String message) {
    this(message, null);
  }

  public MailAiUnavailableException(String message, String code) {
    super(message);
    this.code = code;
  }

  /** 계정 AI 꺼짐(503, AI_DISABLED). */
  public static MailAiUnavailableException aiDisabled() {
    return new MailAiUnavailableException("이 계정은 AI 비서가 꺼져 있어요. 계정 설정에서 켜주세요.", AI_DISABLED);
  }

  /** AI 비서 미설정(503, ASSISTANT_NOT_CONFIGURED). */
  public static MailAiUnavailableException assistantNotConfigured() {
    return new MailAiUnavailableException(
        "AI 비서가 아직 설정되지 않았어요. 관리자에게 문의해주세요.", ASSISTANT_NOT_CONFIGURED);
  }

  /** 사유 코드(없으면 null). */
  public String code() {
    return code;
  }
}
