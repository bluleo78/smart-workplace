package com.workplace.issue.dto;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.issue.exception.InvalidCursorException;
import java.time.Instant;
import org.junit.jupiter.api.Test;

/** IssueCursor encode/decode 라운드트립 및 오류 경로 검증. */
class IssueCursorTest {

  @Test
  void encode_decode_round_trip() {
    var ts = Instant.parse("2026-05-22T03:14:00Z");
    String enc = IssueCursor.encode(ts, 42L);
    IssueCursor decoded = IssueCursor.decode(enc);
    assertThat(decoded.updatedAt()).isEqualTo(ts);
    assertThat(decoded.id()).isEqualTo(42L);
  }

  /** 마이크로초까지 그대로 돌아온다(WP-1618 — 밀리초로 자르면 같은 밀리초 행을 건너뛴다). */
  @Test
  void round_trip_keeps_microseconds() {
    var ts = Instant.parse("2026-11-15T10:13:59.335266Z");
    assertThat(IssueCursor.decode(IssueCursor.encode(ts, 7L)).updatedAt()).isEqualTo(ts);
  }

  /** 배포 전에 받은 밀리초 숫자 커서도 읽는다. */
  @Test
  void decodes_legacy_epoch_milli_cursor() {
    String legacy =
        java.util.Base64.getUrlEncoder()
            .withoutPadding()
            .encodeToString("1763201639335:155".getBytes());
    IssueCursor c = IssueCursor.decode(legacy);
    assertThat(c.updatedAt()).isEqualTo(Instant.ofEpochMilli(1763201639335L));
    assertThat(c.id()).isEqualTo(155L);
  }

  @Test
  void decode_invalid_throws() {
    assertThatThrownBy(() -> IssueCursor.decode("not-base64!!"))
        .isInstanceOf(InvalidCursorException.class);
  }

  @Test
  void decode_wrong_shape_throws() {
    String bad = java.util.Base64.getUrlEncoder().encodeToString("nocolon".getBytes());
    assertThatThrownBy(() -> IssueCursor.decode(bad)).isInstanceOf(InvalidCursorException.class);
  }
}
