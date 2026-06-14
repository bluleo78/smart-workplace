package com.workplace.wiki.service;

import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.wiki.dto.WikiReferenceRow;
import java.util.List;
import org.junit.jupiter.api.Test;

/** WikiReferenceParser 순수 단위 테스트 — 토큰 추출·중복제거·무시 규칙 검증. */
class WikiReferenceParserTest {
  private final WikiReferenceParser parser = new WikiReferenceParser();

  @Test
  void extractsPageAndIssueTokens() {
    List<WikiReferenceRow> refs = parser.parse(1L, "본문 <#page:9> 그리고 <#issue:7> 끝");
    assertThat(refs)
        .containsExactly(
            new WikiReferenceRow(1L, "PAGE", 9L), new WikiReferenceRow(1L, "ISSUE", 7L));
  }

  @Test
  void ignoresUserMentionTokens() {
    // 유저 멘션(<@id>)은 칩 렌더만 하므로 적재하지 않는다.
    List<WikiReferenceRow> refs = parser.parse(1L, "안녕 <@5> 그리고 <@42>");
    assertThat(refs).isEmpty();
  }

  @Test
  void dedupesRepeatedTokensPreservingOrder() {
    // 같은 토큰이 여러 번 등장해도 첫 등장 순서로 1회만.
    List<WikiReferenceRow> refs = parser.parse(1L, "<#issue:7> <#page:9> <#page:9> <#issue:7>");
    assertThat(refs)
        .containsExactly(
            new WikiReferenceRow(1L, "ISSUE", 7L), new WikiReferenceRow(1L, "PAGE", 9L));
  }

  @Test
  void emptyBodyReturnsEmptyList() {
    assertThat(parser.parse(1L, "")).isEmpty();
  }

  @Test
  void nullBodyReturnsEmptyList() {
    assertThat(parser.parse(1L, null)).isEmpty();
  }

  @Test
  void ignoresOverlongAndNonMatchingTokens() {
    // 19자리(상한 18 초과)·잘못된 prefix·닫는 괄호 없음 → 모두 무시.
    List<WikiReferenceRow> refs =
        parser.parse(1L, "<#page:1234567890123456789> <#user:3> <#page:5 <#issue:8>");
    // 유일하게 유효한 <#issue:8> 만 추출.
    assertThat(refs).containsExactly(new WikiReferenceRow(1L, "ISSUE", 8L));
  }

  @Test
  void ignoresUppercaseTypeTokens() {
    // 토큰 type 은 소문자(page/issue)만 매칭 — 대문자는 무시.
    assertThat(parser.parse(1L, "<#PAGE:1> <#ISSUE:2>")).isEmpty();
  }

  @Test
  void fillsSourcePageIdOnEachRow() {
    List<WikiReferenceRow> refs = parser.parse(42L, "<#page:9>");
    assertThat(refs).containsExactly(new WikiReferenceRow(42L, "PAGE", 9L));
  }
}
