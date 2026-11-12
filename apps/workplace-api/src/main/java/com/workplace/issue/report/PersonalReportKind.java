package com.workplace.issue.report;

/** 개인 보고 종류(WP-1486) — 일일·주간·월간. {@link #label()} 은 화면·페이지 제목에 쓰는 한글 이름이다. */
public enum PersonalReportKind {
  DAILY("일일"),
  WEEKLY("주간"),
  MONTHLY("월간");

  private final String label;

  PersonalReportKind(String label) {
    this.label = label;
  }

  /** 한글 이름(「일일」「주간」「월간」). */
  public String label() {
    return label;
  }

  /** 요청 값을 종류로 바꾼다. 모르는 값은 IllegalArgumentException(→ 400). */
  public static PersonalReportKind parse(String value) {
    if (value == null) {
      throw new IllegalArgumentException("보고 종류를 지정해 주세요");
    }
    try {
      return valueOf(value.trim().toUpperCase(java.util.Locale.ROOT));
    } catch (IllegalArgumentException e) {
      throw new IllegalArgumentException("알 수 없는 보고 종류예요: " + value);
    }
  }
}
