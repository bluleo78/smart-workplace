package com.workplace.messaging.service;

import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.messaging.service.OpenGraphParser.OgMeta;
import java.nio.charset.StandardCharsets;
import org.junit.jupiter.api.Test;

/** WP-874: 고정 HTML 에서 og → twitter → title/description 순서·상대 이미지 절대화·길이 상한. */
class OpenGraphParserTest {

  private static OgMeta parse(String html) {
    return OpenGraphParser.parse(
        html.getBytes(StandardCharsets.UTF_8), "UTF-8", "https://example.com/blog/post");
  }

  @Test
  void openGraph_wins_and_relativeImage_absolutized() {
    OgMeta m =
        parse(
            """
            <html><head><title>문서 제목</title>
            <meta property="og:title" content="  OG   제목 ">
            <meta property="og:description" content="OG 설명">
            <meta property="og:site_name" content="예제">
            <meta property="og:image" content="/img/cover.png">
            <meta name="twitter:title" content="트위터 제목">
            </head><body></body></html>""");
    assertThat(m.title()).isEqualTo("OG 제목");
    assertThat(m.description()).isEqualTo("OG 설명");
    assertThat(m.siteName()).isEqualTo("예제");
    assertThat(m.imageUrl()).isEqualTo("https://example.com/img/cover.png");
  }

  @Test
  void fallsBack_to_twitter_then_title_and_metaDescription() {
    OgMeta tw =
        parse(
            """
            <head><meta name="twitter:title" content="트위터 제목">
            <meta name="twitter:image" content="https://cdn.example.com/a.jpg"></head>""");
    assertThat(tw.title()).isEqualTo("트위터 제목");
    assertThat(tw.imageUrl()).isEqualTo("https://cdn.example.com/a.jpg");

    OgMeta plain =
        parse(
            """
            <head><title>그냥 제목</title><meta name="description" content="그냥 설명"></head>""");
    assertThat(plain.title()).isEqualTo("그냥 제목");
    assertThat(plain.description()).isEqualTo("그냥 설명");
    assertThat(plain.siteName()).isNull();
    assertThat(plain.imageUrl()).isNull();
  }

  @Test
  void noTitle_and_nonHttpImage_ignored() {
    OgMeta m =
        parse(
            """
            <head><meta property="og:image" content="javascript:alert(1)"></head>""");
    assertThat(m.title()).isNull();
    assertThat(m.imageUrl()).isNull();
  }

  @Test
  void long_values_cut() {
    String longTitle = "가".repeat(400);
    String longDesc = "나".repeat(800);
    OgMeta m =
        parse(
            "<head><meta property=\"og:title\" content=\""
                + longTitle
                + "\"><meta property=\"og:description\" content=\""
                + longDesc
                + "\"><meta property=\"og:site_name\" content=\""
                + "다".repeat(200)
                + "\"></head>");
    assertThat(m.title()).hasSize(OpenGraphParser.MAX_TITLE);
    assertThat(m.description()).hasSize(OpenGraphParser.MAX_DESCRIPTION);
    assertThat(m.siteName()).hasSize(OpenGraphParser.MAX_SITE);
  }

  @Test
  void charset_fromMeta_whenHeaderMissing() {
    byte[] eucKr =
        "<html><head><meta charset=\"euc-kr\"><title>한글 제목</title></head></html>"
            .getBytes(java.nio.charset.Charset.forName("EUC-KR"));
    assertThat(OpenGraphParser.parse(eucKr, null, "https://example.com/").title())
        .isEqualTo("한글 제목");
  }
}
