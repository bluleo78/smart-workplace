package com.workplace.mail.dto;

/**
 * 메일 계정 알림 범위 값의 단일 출처(WP-1740). 요청 DTO 검증·서비스 가드·푸시 판정이 같은 집합을 쓰도록 한 곳에 모은다.
 *
 * <p>DB CHECK·웹 타입의 값과 같아야 하므로 바꿀 땐 함께 바꾼다.
 */
public final class MailNotifyModes {

  /** 모든 새 메일 알림. */
  public static final String ALL = "ALL";

  /** 업무 메일만 알림(기본값, DB 기본값과 일치). */
  public static final String WORK = "WORK";

  /** 알림 끔. */
  public static final String OFF = "OFF";

  /** 요청 DTO 검증 정규식 — {@code @Pattern} 은 컴파일 타임 상수만 받으므로 상수를 이어 붙인다. */
  public static final String REGEX = ALL + "|" + WORK + "|" + OFF;

  private MailNotifyModes() {}

  /** 허용된 알림 범위 값인지 판정한다(null 은 false). */
  public static boolean isValid(String mode) {
    return ALL.equals(mode) || WORK.equals(mode) || OFF.equals(mode);
  }
}
