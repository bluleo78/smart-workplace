package com.workplace.issue.domain;

import java.util.Locale;
import java.util.Optional;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 이슈 키({@code WPV-28}) 읽기 — 관계 대상 찾기와 관계 일괄 가져오기가 같은 규칙으로 키를 나눈다(WP-887). 한쪽만 바꾸면 화면에서 찾히는 키와 가져오기가
 * 받는 키가 어긋나므로 한 곳에 둔다.
 */
public final class IssueKeys {

  private IssueKeys() {}

  /** 키 꼴 — 영문으로 시작하는 프로젝트 키 + 하이픈 + 번호(대소문자 무시). */
  private static final Pattern KEY =
      Pattern.compile("^([A-Z][A-Z0-9_]*)-(\\d+)$", Pattern.CASE_INSENSITIVE);

  /**
   * 나눈 키.
   *
   * @param projectKey 대문자로 맞춘 프로젝트 키
   * @param number 이슈 번호
   */
  public record IssueKey(String projectKey, int number) {}

  /** 프로젝트 키와 번호로 이슈 키를 만든다(WP, 12 → WP-12) — {@link #parse} 의 반대. */
  public static String format(String projectKey, int number) {
    return projectKey + "-" + number;
  }

  /** 키 꼴이면 (대문자 프로젝트 키, 번호). 키 꼴이 아니거나 번호가 int 를 넘으면 빈 값(그런 번호의 이슈는 없다). */
  public static Optional<IssueKey> parse(String text) {
    if (text == null) {
      return Optional.empty();
    }
    Matcher m = KEY.matcher(text);
    if (!m.matches()) {
      return Optional.empty();
    }
    Integer number = parseNumber(m.group(2));
    return number == null
        ? Optional.empty()
        : Optional.of(new IssueKey(m.group(1).toUpperCase(Locale.ROOT), number));
  }

  /** 숫자 문자열 → int. int 를 넘으면 null — 500 대신 「없음」으로 다루게 한다. */
  public static Integer parseNumber(String digits) {
    try {
      return Integer.valueOf(digits);
    } catch (NumberFormatException e) {
      return null;
    }
  }
}
