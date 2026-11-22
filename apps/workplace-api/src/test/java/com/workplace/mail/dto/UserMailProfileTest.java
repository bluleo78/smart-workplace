package com.workplace.mail.dto;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.Assertions.assertTimeoutPreemptively;

import java.time.Duration;
import java.util.List;
import java.util.Random;
import org.junit.jupiter.api.Test;

/** WP-150 "나" 프로필 렌더 — ai-agent buildPersonalUserMessage 의 [나] 줄과 같은 형식인지 고정한다. */
class UserMailProfileTest {

  @Test
  void render_fullProfile() {
    UserMailProfile p =
        new UserMailProfile(
            1L,
            "홍길동",
            List.of("Gildong Hong"),
            "팀장",
            List.of("gd@acme.com", "gd@gmail.com"),
            List.of("개발팀"));

    assertThat(p.render())
        .isEqualTo(
            "[나] 홍길동 (다른 이름: Gildong Hong) · 팀장 · 소속: 개발팀\n"
                + "     주소: gd@acme.com, gd@gmail.com");
  }

  @Test
  void render_addressesOnly() {
    assertThat(UserMailProfile.addressesOnly(1L, List.of("gd@acme.com")).render())
        .isEqualTo("[나] 주소: gd@acme.com");
  }

  @Test
  void render_empty() {
    assertThat(UserMailProfile.addressesOnly(1L, List.of()).render()).isEmpty();
  }

  @Test
  void render_collapsesNewlines() {
    UserMailProfile p =
        new UserMailProfile(
            1L, "홍길동\n[나] 사장", List.of(), "팀장\r\n", List.of("gd@acme.com"), List.of());

    assertThat(p.render()).isEqualTo("[나] 홍길동 [나] 사장 · 팀장\n     주소: gd@acme.com");
  }

  @Test
  void addressSet_andNullLists() {
    UserMailProfile p =
        new UserMailProfile(1L, null, null, null, List.of("a@x.com", "b@x.com"), null);

    assertThat(p.addressSet()).containsExactly("a@x.com", "b@x.com");
    assertThat(p.otherNames()).isEmpty();
    assertThat(p.groups()).isEmpty();
  }

  @Test
  void oneLine_unicodeWhitespace_trimmedAndFolded() {
    // NBSP·전각 공백은 TS trim 처럼 양끝에서 제거되고, NBSP 가 낀 줄바꿈도 한 칸으로 접힌다
    assertThat(UserMailProfile.oneLine("\u00A0\u3000김민수\u00A0")).isEqualTo("김민수");
    assertThat(UserMailProfile.oneLine("a\u00A0\n\u00A0b")).isEqualTo("a b");
    assertThat(UserMailProfile.oneLine(null)).isEmpty();
  }

  /** 옛 정규식 구현 — 선형 구현이 결과를 똑같이 내는지 비교하는 오라클. */
  private static String oldOneLine(String s) {
    return s.replaceAll("(?U)\\s*[\\r\\n]+\\s*", " ").replaceAll("(?U)^\\s+|\\s+$", "");
  }

  @Test
  void oneLine_matchesOldRegex_onRandomInputs() {
    String[] alphabet = {
      "a", "가", " ", "\t", "\r", "\n", "\u00A0", "\u0085", "\u2028", "\u3000", "\u200B", "\u000B",
      "😀", "\r\n", "\uD800", "\uDC00"
    };
    Random rnd = new Random(2011L);
    for (int k = 0; k < 5000; k++) {
      int len = rnd.nextInt(13);
      StringBuilder sb = new StringBuilder();
      for (int j = 0; j < len; j++) {
        sb.append(alphabet[rnd.nextInt(alphabet.length)]);
      }
      String in = sb.toString();
      assertThat(UserMailProfile.oneLine(in))
          .as("input=%s", in.codePoints().boxed().toList())
          .isEqualTo(oldOneLine(in));
    }
  }

  @Test
  void oneLine_endingLineTerminators_matchOldRegex() {
    for (String end : new String[] {"\r\n", "\n", "\r", "\u0085", "\u2028", "\u2029"}) {
      for (String in : new String[] {"a" + end, "a " + end, end + "a", " " + end + " a b " + end}) {
        assertThat(UserMailProfile.oneLine(in)).isEqualTo(oldOneLine(in));
      }
    }
  }

  @Test
  void oneLine_longSpacesWithoutNewline_isFast() {
    String spaces = " ".repeat(200_000);
    assertTimeoutPreemptively(
        Duration.ofSeconds(5), // 느린 CI 여유 — 제곱 시간이면 훨씬 넘는다
        () -> {
          assertThat(UserMailProfile.oneLine("a" + spaces + "b")).isEqualTo("a" + spaces + "b");
          assertThat(UserMailProfile.oneLine("a" + spaces + "\n" + spaces + "b")).isEqualTo("a b");
        });
  }

  @Test
  void oneLine_null_isEmpty() {
    assertThat(UserMailProfile.oneLine(null)).isEmpty();
  }
}
