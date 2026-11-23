package com.workplace.global.realtime.relay;

import static java.nio.charset.StandardCharsets.UTF_8;
import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

/** 중계 메시지 직렬화 계약(WP-1973) — NOTIFY 페이로드로 오가는 encode/decode 와 아웃박스 판정. */
class RelayMessageCodecTest {

  /** 임의의 target·event·payload·keys 가 decode(encode(m)) 로 그대로 돌아온다 — 닫힘 신호(null 필드)까지. */
  @Test
  void encode_decode_순환() {
    RelayMessage 원본 = new RelayMessage("user", "notify.created", "{\"a\":1}", "[1,2]");
    assertThat(RelayMessage.decode(원본.encode())).isEqualTo(원본);

    // 닫힘 신호는 event·payload 없이 keysJson 만 가므로 null 필드도 순환에서 살아남아야 한다.
    RelayMessage 닫힘 = RelayMessage.closeUser(7);
    assertThat(RelayMessage.decode(닫힘.encode())).isEqualTo(닫힘);
  }

  /**
   * PostgreSQL NOTIFY 페이로드 상한(8000 바이트) 아래 여유분을 지키기 위해, encode() 결과의 UTF-8 길이가
   * MAX_NOTIFY_BYTES(7000) 를 넘으면 아웃박스 표를 거쳐 발행해야 한다(needsOutbox). 한글 payload 로 검증해 문자 수가 아니라 바이트 수로
   * 판정하는지 함께 고정한다.
   */
  @Test
  void _7000_바이트_이상은_아웃박스_대상이다() {
    RelayMessage 큰_메시지 =
        new RelayMessage(
            "user", "messaging.message.created", "\"" + "가".repeat(2500) + "\"", "[1]");

    assertThat(큰_메시지.encode().getBytes(UTF_8).length).isGreaterThan(RelayMessage.MAX_NOTIFY_BYTES);
    assertThat(큰_메시지.needsOutbox()).isTrue();

    RelayMessage 작은_메시지 = new RelayMessage("user", "notify.created", "{\"a\":1}", "[1]");
    assertThat(작은_메시지.needsOutbox()).isFalse();
  }

  /**
   * 생성 취소 중계(WP-1974)는 payload 에 correlationId, keys 에 소유자를 싣고 순환에서 그대로 돌아온다 — 닫힘 타깃이 아니므로 발행 파드 id
   * 를 싣지 않는다.
   */
  @Test
  void 생성_취소는_id와_소유자를_싣고_순환한다() {
    RelayMessage 취소 = RelayMessage.generationCancel("c-\"1", 42L);

    assertThat(취소.target()).isEqualTo(RelayMessage.TARGET_GENERATION_CANCEL);
    assertThat(취소.keysJson()).isEqualTo("[42]");
    assertThat(RelayMessage.isCloseTarget(취소.target())).isFalse();
    assertThat(RelayMessage.decode(취소.encode())).isEqualTo(취소);
    assertThat(RelayMessage.generationCancelId(RelayMessage.decode(취소.encode())))
        .isEqualTo("c-\"1");
  }

  /** 닫힘 신호는 event 없이 keysJson 만 간다 — 수신 파드는 키를 읽어 자기 연결을 닫으면 된다. */
  @Test
  void 닫힘_신호는_event_없이_keys만_간다() {
    RelayMessage 닫힘 = RelayMessage.closeUser(7);

    assertThat(닫힘.target()).isEqualTo("user.close");
    assertThat(닫힘.event()).isNull();
    assertThat(닫힘.payloadJson()).isNull();
    assertThat(닫힘.keysJson()).isEqualTo("[7]");
  }

  /**
   * 발행 파드 id(§ pub)는 닫힘 신호에만 싣고 순환에서 살아남는다(WP-1973 리뷰 3차 선택) — 없는 메시지에는 아예 키를 쓰지 않아 옛 버전 파드가 이 키를
   * 모르더라도 읽을 수 있다.
   */
  @Test
  void 발행_파드_id는_닫힘_신호에만_싣고_순환한다() {
    RelayMessage 닫힘 = RelayMessage.closeUser(7).withPublisher("pod-a");

    assertThat(RelayMessage.decode(닫힘.encode())).isEqualTo(닫힘);

    RelayMessage 이벤트 = new RelayMessage("user", "notify.created", "{\"a\":1}", "[1]");
    assertThat(이벤트.encode()).as("이벤트에는 pub 키가 없다").doesNotContain("\"pub\"");
    assertThat(RelayMessage.decode(이벤트.encode()).publisher()).isNull();

    // 여러 사람으로 나뉜 닫힘에도 파드 id 가 이어져야 발행 파드가 나뉜 닫힘까지 알아볼 수 있다.
    RelayMessage 여러명닫힘 =
        new RelayMessage(RelayMessage.TARGET_USER_CLOSE, null, null, "[7,8]", "pod-a");
    assertThat(여러명닫힘.perRecipient())
        .as("부분집합마다 publisher 가 이어진다")
        .allSatisfy(part -> assertThat(part.publisher()).isEqualTo("pod-a"));
  }
}
