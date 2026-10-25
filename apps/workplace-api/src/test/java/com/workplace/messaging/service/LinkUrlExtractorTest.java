package com.workplace.messaging.service;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

/** WP-874: 서버 URL 추출이 웹 linkify.test.ts 와 같은 경계를 쓰는지(같은 사례). */
class LinkUrlExtractorTest {

  @Test
  void noUrl_empty() {
    assertThat(LinkUrlExtractor.extract("안녕하세요")).isEmpty();
    assertThat(LinkUrlExtractor.extract("")).isEmpty();
    assertThat(LinkUrlExtractor.extract(null)).isEmpty();
  }

  @Test
  void basic_and_www_and_uppercase() {
    assertThat(LinkUrlExtractor.extract("이거 https://github.com/a/b 보세요"))
        .containsExactly("https://github.com/a/b");
    assertThat(LinkUrlExtractor.extract("www.example.com/notes"))
        .containsExactly("https://www.example.com/notes");
    assertThat(LinkUrlExtractor.extract("HTTP://A.COM 와 http://b.com"))
        .containsExactly("HTTP://A.COM", "http://b.com");
  }

  @Test
  void trailingPunctuation_trimmed() {
    assertThat(LinkUrlExtractor.extract("봐요 https://a.com.")).containsExactly("https://a.com");
    assertThat(LinkUrlExtractor.extract("https://a.com, https://b.com! https://c.com?"))
        .containsExactly("https://a.com", "https://b.com", "https://c.com");
    assertThat(LinkUrlExtractor.extract("'https://a.com/x'")).containsExactly("https://a.com/x");
    assertThat(LinkUrlExtractor.extract("https://a.com/x...;:")).containsExactly("https://a.com/x");
    assertThat(LinkUrlExtractor.extract("https://a.com/p?q=1&r=2#frag 끝"))
        .containsExactly("https://a.com/p?q=1&r=2#frag");
  }

  @Test
  void parentheses_balanced_kept_unbalanced_trimmed() {
    assertThat(LinkUrlExtractor.extract("(see https://a.com).")).containsExactly("https://a.com");
    assertThat(LinkUrlExtractor.extract("https://en.wikipedia.org/wiki/Foo_(bar)"))
        .containsExactly("https://en.wikipedia.org/wiki/Foo_(bar)");
    assertThat(LinkUrlExtractor.extract("[https://a.com/x]")).containsExactly("https://a.com/x");
    assertThat(LinkUrlExtractor.extract("(https://en.wikipedia.org/wiki/Foo_(bar))"))
        .containsExactly("https://en.wikipedia.org/wiki/Foo_(bar)");
  }

  @Test
  void boundaries_nonAscii_angle_quote_whitespace_mention() {
    assertThat(LinkUrlExtractor.extract("https://a.com에서 봤어요")).containsExactly("https://a.com");
    assertThat(LinkUrlExtractor.extract("<https://a.com/x>")).containsExactly("https://a.com/x");
    assertThat(LinkUrlExtractor.extract("\"https://a.com/y\"")).containsExactly("https://a.com/y");
    assertThat(LinkUrlExtractor.extract("https://a.com/1\nhttps://a.com/2"))
        .containsExactly("https://a.com/1", "https://a.com/2");
    assertThat(LinkUrlExtractor.extract("https://a.com<@12>")).containsExactly("https://a.com");
  }

  @Test
  void wordCharBefore_notStart_and_prefixOnly_notLink() {
    assertThat(LinkUrlExtractor.extract("xhttps://a.com")).isEmpty();
    assertThat(LinkUrlExtractor.extract("abcwww.a.com")).isEmpty();
    assertThat(LinkUrlExtractor.extract("링크:https://a.com")).containsExactly("https://a.com");
    assertThat(LinkUrlExtractor.extract("https:// 와 www. 만")).isEmpty();
  }

  @Test
  void firstThreeDistinct() {
    assertThat(
            LinkUrlExtractor.extract(
                "https://a.com https://a.com https://b.com www.c.com https://d.com"))
        .containsExactly("https://a.com", "https://b.com", "https://www.c.com");
  }

  /** WP-101: 마크다운 본문 — 링크는 주소만, 강조 기호는 끝에서 뺀다. */
  @Test
  void markdownLinkAndEmphasis() {
    assertThat(LinkUrlExtractor.extract("[문서](https://a.com/x) 참고"))
        .containsExactly("https://a.com/x");
    assertThat(LinkUrlExtractor.extract("[https://a.com](https://a.com)"))
        .containsExactly("https://a.com");
    assertThat(LinkUrlExtractor.extract("[위키](https://en.wikipedia.org/wiki/A_(b))"))
        .containsExactly("https://en.wikipedia.org/wiki/A_(b)");
    assertThat(LinkUrlExtractor.extract("**https://a.com** ~~https://b.com~~ *https://c.com*"))
        .containsExactly("https://a.com", "https://b.com", "https://c.com");
    assertThat(LinkUrlExtractor.extract("`https://a.com/x_y`"))
        .containsExactly("https://a.com/x_y");
  }
}
