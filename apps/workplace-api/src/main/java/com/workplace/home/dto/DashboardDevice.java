package com.workplace.home.dto;

import java.util.Locale;

/**
 * 홈 대시보드 레이아웃을 따로 저장하는 기기 구분(WP-142). 모바일과 데스크톱은 각자 1행을 갖고 서로의 편집에 영향을 주지 않는다.
 *
 * <p>DB 값은 enum 이름(DESKTOP/MOBILE)이며 V142 의 CHECK 제약과 일치해야 한다.
 */
public enum DashboardDevice {
  DESKTOP,
  MOBILE;

  /**
   * 쿼리 파라미터({@code ?device=desktop|mobile}) 해석. 생략·빈 값은 DESKTOP — device 를 모르는 기존 클라이언트·테스트가 그대로
   * 데스크톱 레이아웃을 쓰게 한다. 대소문자는 무시한다. 그 외 값은 IllegalArgumentException 으로 던져 GlobalExceptionHandler 가
   * 400 으로 매핑한다.
   */
  public static DashboardDevice fromParam(String raw) {
    if (raw == null || raw.isBlank()) {
      return DESKTOP;
    }
    return switch (raw.trim().toLowerCase(Locale.ROOT)) {
      case "desktop" -> DESKTOP;
      case "mobile" -> MOBILE;
      default -> throw new IllegalArgumentException("알 수 없는 기기 구분입니다: " + raw);
    };
  }
}
