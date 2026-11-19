package com.workplace.mail.dto;

/**
 * 내 메일 사용자 설정(WP-1744). 설정이 아직 없으면 {@link #defaults()}(우측 하단).
 *
 * @param composeMode 새 작성을 열 곳
 */
public record MailUserSettingResponse(MailComposePlacement composeMode) {

  /** 한 번도 고르지 않은 사람의 기본값 — 지금까지처럼 우측 하단(DOCK). */
  public static MailUserSettingResponse defaults() {
    return new MailUserSettingResponse(MailComposePlacement.DOCK);
  }
}
