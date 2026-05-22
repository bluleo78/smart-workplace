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
