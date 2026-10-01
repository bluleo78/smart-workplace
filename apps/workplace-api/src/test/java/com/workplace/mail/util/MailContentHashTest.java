package com.workplace.mail.util;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

/** MailContentHash 단위 테스트 — null-safe, 결정적(동일 입력 동일 해시), 구분자 길이 확인. */
class MailContentHashTest {

  @Test
  void sameBodyProducesSameHash_nullSafe() {
    // null 정규화: null html 은 빈 문자열로 처리
    String a = MailContentHash.of("hello", null);
    String b = MailContentHash.of("hello", null);
    assertThat(a).isEqualTo(b).hasSize(64);
    // 입력이 다르면 해시도 달라야 한다
    assertThat(MailContentHash.of(null, "<p>x</p>")).isNotEqualTo(a);
  }

  @Test
  void separatorPreventsCollision() {
    // "ab" + "" ≠ "a" + "b" : \000 구분자가 ambiguity 방지
    String h1 = MailContentHash.of("ab", "");
    String h2 = MailContentHash.of("a", "b");
    assertThat(h1).isNotEqualTo(h2);
  }

  @Test
  void bothNullProducesConsistentHash() {
    // 두 null 은 "\000" 만인 문자열로 정규화 → 동일 해시
    String h1 = MailContentHash.of(null, null);
    String h2 = MailContentHash.of(null, null);
    assertThat(h1).isEqualTo(h2).hasSize(64);
  }

  /** 공유 지문용 헤더 메시지(본문 없음). */
  private static com.workplace.mail.dto.ParsedMessage header(String from, String structure) {
    java.time.Instant sent = java.time.Instant.parse("2026-09-01T00:00:00.123Z");
    return new com.workplace.mail.dto.ParsedMessage(
        1L,
        "<m@x>",
        "<m@x>",
        null,
        null,
        from,
        null,
        null,
        null,
        "제목",
        sent,
        sent,
        false,
        false,
        null,
        null,
        null,
        java.util.List.of(),
        structure);
  }

  @Test
  void fingerprint_imapWithoutStructure_isNull() {
    assertThat(
            MailContentHash.fingerprint(
                com.workplace.mail.dto.ContentSource.IMAP, header("a@x", null)))
        .isNull();
  }

  @Test
  void fingerprint_normalizesSenderCase_andSeparatesSources() {
    var imap = com.workplace.mail.dto.ContentSource.IMAP;
    var graph = com.workplace.mail.dto.ContentSource.GRAPH;
    String f = MailContentHash.fingerprint(imap, header("CEO@Corp.test", "[s]"));
    assertThat(f)
        .hasSize(64)
        .isEqualTo(MailContentHash.fingerprint(imap, header("ceo@corp.test", "[s]")));
    assertThat(MailContentHash.fingerprint(imap, header("ceo@corp.test", "[t]"))).isNotEqualTo(f);
    assertThat(MailContentHash.fingerprint(graph, header("ceo@corp.test", "[s]"))).isNotEqualTo(f);
    assertThat(MailContentHash.fingerprint(graph, header("ceo@corp.test", null))).isNotNull();
  }
}
