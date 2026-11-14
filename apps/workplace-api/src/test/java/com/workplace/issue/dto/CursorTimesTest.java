package com.workplace.issue.dto;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.issue.exception.InvalidCursorException;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.LocalDate;
import java.util.Base64;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

/**
 * 이슈 쪽 커서가 앱 공통 범위(1900-01-01 ~ 9999-12-31) 밖의 시각·날짜를 400(InvalidCursorException)으로 거절하는지(WP-1586).
 * 전에는 Instant 끝 시각이 seek 의 atOffset 에서 500, 10000년 이후는 그대로 받아들였다.
 */
class CursorTimesTest {

  /** 범위 밖 시각 — Instant 끝 근처·10000년·1900년 이전. */
  private static final String[] BAD_INSTANTS = {
    "+1000000000-01-01T00:00:00Z", "+10000-01-01T00:00:00Z", "1899-12-31T23:59:59Z"
  };

  private static String b64(String raw) {
    return Base64.getUrlEncoder()
        .withoutPadding()
        .encodeToString(raw.getBytes(StandardCharsets.UTF_8));
  }

  private static String aiTask(String sortAt) {
    String ok = "2026-05-22T03:14:00Z";
    return b64(String.join("|", "0", ok, "1", "0", ok, "1", "0", "0", sortAt, "9"));
  }

  @ParameterizedTest
  @ValueSource(
      strings = {"+1000000000-01-01T00:00:00Z", "+10000-01-01T00:00:00Z", "1899-12-31T23:59:59Z"})
  void aiTaskCursorRejectsOutOfRangeInstant(String bad) {
    assertThatThrownBy(() -> AiTaskCursor.decode(aiTask(bad)))
        .isInstanceOf(InvalidCursorException.class)
        .hasMessage("cursor 디코딩 실패");
  }

  @Test
  void aiTaskCursorAcceptsRangeEdges() {
    assertThat(AiTaskCursor.decode(aiTask("1900-01-01T00:00:00Z")).sortAt())
        .isEqualTo(Instant.parse("1900-01-01T00:00:00Z"));
    assertThat(AiTaskCursor.decode(aiTask("9999-12-31T23:59:59.999999Z")).id()).isEqualTo(9L);
  }

  @Test
  void meGroupedCursorRejectsOutOfRangeInstantAndDate() {
    for (String bad : BAD_INSTANTS) {
      String recent =
          b64(String.join("|", "g1", "-", bad, "1", "-", "-", "2026-05-22T03:14:00Z", "9"));
      assertThatThrownBy(() -> MeGroupedCursor.decode(recent))
          .isInstanceOf(InvalidCursorException.class);
      String row =
          b64(String.join("|", "g1", "-", "2026-05-22T03:14:00Z", "1", "-", "-", bad, "9"));
      assertThatThrownBy(() -> MeGroupedCursor.decode(row))
          .isInstanceOf(InvalidCursorException.class);
    }
    String farDue =
        b64(
            String.join(
                "|",
                "g1",
                "+10000-01-01",
                "-",
                "1",
                "0",
                "2026-01-01",
                "2026-05-22T03:14:00Z",
                "9"));
    assertThatThrownBy(() -> MeGroupedCursor.decode(farDue))
        .isInstanceOf(InvalidCursorException.class);
    String ok =
        b64(
            String.join(
                "|", "g1", "2026-01-01", "-", "1", "0", "2026-01-01", "2026-05-22T03:14:00Z", "9"));
    assertThat(MeGroupedCursor.decode(ok).groupDue()).isEqualTo(LocalDate.of(2026, 1, 1));
  }

  @Test
  void issueCursorRejectsOutOfRangeMillis() {
    long far = Instant.parse("+10000-01-01T00:00:00Z").toEpochMilli();
    assertThatThrownBy(() -> IssueCursor.decode(b64(far + ":1")))
        .isInstanceOf(InvalidCursorException.class);
    long early = Instant.parse("1899-12-31T00:00:00Z").toEpochMilli();
    assertThatThrownBy(() -> IssueCursor.decode(b64(early + ":1")))
        .isInstanceOf(InvalidCursorException.class);
  }

  @Test
  void checklistCursorRejectsOutOfRangeDue() {
    assertThatThrownBy(() -> ChecklistCursor.decode(b64("c1|0|0|+10000-01-01|1")))
        .isInstanceOf(InvalidCursorException.class);
    assertThat(ChecklistCursor.decode(b64("c1|0|0|2026-01-01|1")).id()).isEqualTo(1L);
    // 마감 없음 센티널 0001-01-01 은 받는다.
    assertThat(ChecklistCursor.decode(b64("c1|0|0|0001-01-01|1")).due())
        .isEqualTo(LocalDate.of(1, 1, 1));
    assertThatThrownBy(() -> ChecklistCursor.decode(b64("c1|0|0|-0001-01-01|1")))
        .isInstanceOf(InvalidCursorException.class);
  }
}
