package com.workplace.global.util;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

/** SecretTextMasker 단위 테스트 — 스프링 없이 순수 JUnit. 비밀값이 가려지고 일반 글은 남는지 확인한다. */
class SecretTextMaskerTest {

  @Test
  void bearerTokenIsMasked() {
    assertThat(SecretTextMasker.mask("헤더 Bearer abc.DEF-123_xyz 넣음")).isEqualTo("헤더 [가림] 넣음");
    // 숫자 없는 평범한 낱말은 토큰이 아니다 — 검색어가 읽히게 남긴다
    assertThat(SecretTextMasker.mask("bearer token 발급")).isEqualTo("bearer token 발급");
  }

  @Test
  void knownPrefixesAreMasked() {
    assertThat(SecretTextMasker.mask("키 sk-ant-api03-AbCdEf1234567890")).isEqualTo("키 [가림]");
    assertThat(SecretTextMasker.mask("ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123 실패")).isEqualTo("[가림] 실패");
    assertThat(SecretTextMasker.mask("github_pat_11ABCDEFG0123456789_abc")).isEqualTo("[가림]");
    assertThat(SecretTextMasker.mask("xoxb-1234-5678-abcdefgh")).isEqualTo("[가림]");
    assertThat(SecretTextMasker.mask("AKIAIOSFODNN7EXAMPLE 키")).isEqualTo("[가림] 키");
  }

  @Test
  void jwtLikeIsMasked() {
    assertThat(SecretTextMasker.mask("eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJlMTIz"))
        .isEqualTo("[가림]");
  }

  @Test
  void emailIsMasked() {
    assertThat(SecretTextMasker.mask("문의 kim.dev@example.com 보냄")).isEqualTo("문의 [가림] 보냄");
  }

  @Test
  void longMixedRunIsMaskedIncludingRepoTokens() {
    // 저장소 자체 토큰(swp_·ak_)은 따로 규칙이 없고 긴 영숫자 덩어리 규칙으로 가려진다
    assertThat(SecretTextMasker.mask("swp_Ab12Cd34Ef56Gh78Ij90Kl")).isEqualTo("[가림]");
    assertThat(SecretTextMasker.mask("ak_9f8e7d6c5b4a39281706aBcD")).isEqualTo("[가림]");
  }

  @Test
  void plainWordsAndShortIdsStay() {
    assertThat(SecretTextMasker.mask("WP-1512 토큰 만료 방법")).isEqualTo("WP-1512 토큰 만료 방법");
    // 20자 넘어도 숫자가 없으면 그대로
    assertThat(SecretTextMasker.mask("internationalization")).isEqualTo("internationalization");
  }

  @Test
  void hyphenatedPathAndShortMixedRunStay() {
    // 하이픈으로 이어진 경로 꼴은 덩어리로 보지 않는다
    assertThat(SecretTextMasker.mask("docs-manual-user-17-audit-logs-chapter"))
        .isEqualTo("docs-manual-user-17-audit-logs-chapter");
    // 20~23자 혼합 덩어리는 24자 기준에 못 미쳐 그대로
    assertThat(SecretTextMasker.mask("abc123def456ghi789jk")).isEqualTo("abc123def456ghi789jk");
  }

  @Test
  void whitespaceCollapsedAndBlankIsEmpty() {
    assertThat(SecretTextMasker.mask("  두\n\n줄   질문 ")).isEqualTo("두 줄 질문");
    assertThat(SecretTextMasker.mask(null)).isEmpty();
    assertThat(SecretTextMasker.mask("   ")).isEmpty();
  }

  @Test
  void cappedAt200CodePoints() {
    String out = SecretTextMasker.mask("😀".repeat(300));
    assertThat(out.codePointCount(0, out.length())).isEqualTo(200);
  }

  @Test
  void tokenCutByPreTrimAfterLeadingWhitespaceIsDropped() {
    // 앞을 공백으로 채워 앞 자르기(2000) 경계에 토큰이 걸려도, 공백을 먼저 합치므로 토큰이 온전히 가려진다.
    String out = SecretTextMasker.mask(" ".repeat(1990) + "질문 ghp_" + "A".repeat(36));
    assertThat(out).isEqualTo("질문 [가림]");
  }

  @Test
  void tokenStraddlingCapIsMaskedNotCut() {
    String out = SecretTextMasker.mask("가".repeat(190) + " sk-" + "a1".repeat(20));
    assertThat(out).doesNotContain("sk-").doesNotContain("a1");
    assertThat(out.codePointCount(0, out.length())).isLessThanOrEqualTo(200);
  }
}
