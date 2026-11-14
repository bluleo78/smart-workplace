package com.workplace.issue.dto;

import com.workplace.global.time.SupportedDates;
import java.time.Instant;
import java.time.LocalDate;

/**
 * 이슈 쪽 커서가 담은 시각·날짜를 읽으며 앱 공통 범위({@link SupportedDates})로 거른다(WP-1586).
 *
 * <p>커서는 클라이언트가 그대로 돌려보내는 값이라 손으로 고친 값이 올 수 있다. Instant 끝에 가까운 시각은 seek 의 {@code atOffset} 에서
 * DateTimeException(500)이 났고, 10000년 이후 시각은 화면이 만들 수 없는 값인데도 그대로 받아들였다. 범위 밖이면 {@link
 * IllegalArgumentException} 을 던지고, 각 커서의 decode 가 이를 받아 자기 400 문구(「cursor 디코딩 실패」)로 바꾼다.
 *
 * <p>시각은 1900-01-01T00:00Z ~ 9999-12-31 끝. 날짜의 아래 끝만 0001-01-01 이다 — 체크리스트·사용자 지정 정렬 커서가 마감 없음을 센티널
 * 0001-01-01 로 적는다({@code IssueRepository.CHECKLIST_NO_DUE}·{@code IssueSortedRepository.NO_DATE}).
 */
public final class CursorTimes {

  /** 커서 날짜의 아래 끝 — 마감 없음 센티널(0001-01-01)까지 받는다. */
  static final LocalDate MIN_DATE = LocalDate.of(1, 1, 1);

  private CursorTimes() {}

  /** Instant 문자열을 읽고 범위를 본다. */
  public static Instant instant(String s) {
    return checked(Instant.parse(s));
  }

  /** 이미 읽은 시각의 범위를 본다(밀리초 epoch 커서용). */
  public static Instant checked(Instant t) {
    if (!SupportedDates.isSupported(t)) {
      throw new IllegalArgumentException(SupportedDates.MESSAGE);
    }
    return t;
  }

  /** 날짜(yyyy-MM-dd) 문자열을 읽고 범위(0001-01-01 ~ 9999-12-31)를 본다. */
  public static LocalDate date(String s) {
    LocalDate d = LocalDate.parse(s);
    if (d.isBefore(MIN_DATE) || d.isAfter(SupportedDates.MAX)) {
      throw new IllegalArgumentException(SupportedDates.MESSAGE);
    }
    return d;
  }
}
