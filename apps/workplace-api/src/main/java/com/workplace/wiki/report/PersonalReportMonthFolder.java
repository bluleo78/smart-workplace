package com.workplace.wiki.report;

import java.time.YearMonth;
import java.util.Optional;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 개인 보고 달 폴더 제목 판정(WP-1655) — 「2026년 11월」 꼴(월 1–12)을 연월로 읽는다.
 *
 * <p>생성기의 달 폴더 자리 계산과 저장 위치 해석기의 「달 폴더 갈래는 막는다」 판정이 같은 규칙을 쓰도록 한곳에 둔다(웹 고르기 창의 판정 함수도 같은 규칙 — 어긋나면
 * 창에서 고른 것을 서버가 거절한다).
 */
final class PersonalReportMonthFolder {

  /** 달 폴더 제목 꼴 — 「2026년 11월」. 월 범위(1–12)는 {@link #parse} 가 따로 본다. */
  private static final Pattern MONTH_FOLDER = Pattern.compile("^(\\d{4})년 (\\d{1,2})월$");

  private PersonalReportMonthFolder() {}

  /** 「2026년 11월」 꼴 제목을 연월로 읽는다(PersonalReportPeriod.monthFolderTitle 의 역). 다른 제목·월 범위 밖이면 empty. */
  static Optional<YearMonth> parse(String title) {
    if (title == null) return Optional.empty();
    Matcher m = MONTH_FOLDER.matcher(title);
    if (!m.matches()) return Optional.empty();
    int month = Integer.parseInt(m.group(2));
    if (month < 1 || month > 12) return Optional.empty();
    return Optional.of(YearMonth.of(Integer.parseInt(m.group(1)), month));
  }

  /** 달 폴더 제목인가 — 저장 위치 검사에서 페이지 자신이나 조상 제목에 쓴다. */
  static boolean isMonthFolder(String title) {
    return parse(title).isPresent();
  }
}
