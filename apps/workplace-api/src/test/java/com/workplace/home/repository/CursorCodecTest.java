package com.workplace.home.repository;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Base64;
import org.junit.jupiter.api.Test;

/** 홈 목록(활동·세션·AI 메모리) 커서의 시각 보존·구 커서 호환·범위 밖 거부(WP-1618). */
class CursorCodecTest {

  private static String b64(String raw) {
    return Base64.getUrlEncoder()
        .withoutPadding()
        .encodeToString(raw.getBytes(StandardCharsets.UTF_8));
  }

  /** 마이크로초까지 그대로 돌아온다 — 밀리초로 자르면 같은 밀리초 행을 다음 페이지가 건너뛴다. */
  @Test
  void roundTripKeepsMicroseconds() {
    Instant t = Instant.parse("2026-11-15T10:13:59.335266Z");
    CursorCodec.Decoded d = CursorCodec.decode(CursorCodec.encode(t, "42"));
    assertThat(d.createdAt()).isEqualTo(t);
    assertThat(d.longId()).isEqualTo(42L);
  }

  /** UUID id 도 그대로. */
  @Test
  void roundTripKeepsUuidId() {
    String id = "3f1c2b9a-0000-4000-8000-000000000001";
    assertThat(CursorCodec.decode(CursorCodec.encode(Instant.EPOCH, id)).id()).isEqualTo(id);
  }

  /** 배포 전에 받은 밀리초 숫자 커서도 읽는다. */
  @Test
  void decodesLegacyEpochMilliCursor() {
    CursorCodec.Decoded d = CursorCodec.decode(b64("1763201639335:155"));
    assertThat(d.createdAt()).isEqualTo(Instant.ofEpochMilli(1763201639335L));
    assertThat(d.longId()).isEqualTo(155L);
  }

  /** 손으로 고친 범위 밖 시각·깨진 값은 null(첫 페이지) — 뒤에서 500 이 나지 않게. */
  @Test
  void rejectsOutOfRangeOrBrokenTime() {
    assertThat(CursorCodec.decode(b64("+1000000000-12-31T23:59:59Z:1"))).isNull();
    assertThat(CursorCodec.decode(b64("+300000-01-01T00:00:00Z:1"))).isNull();
    assertThat(CursorCodec.decode(b64("1899-12-31T23:59:59Z:1"))).isNull();
    assertThat(CursorCodec.decode(b64("2026-13-01T00:00:00Z:1"))).isNull();
    assertThat(CursorCodec.decode(b64("nocolon"))).isNull();
  }
}
