package com.workplace.mail;

import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.mail.service.MailSignatureHtmlSanitizer;
import org.jsoup.nodes.Element;
import org.junit.jupiter.api.Test;

/**
 * 메일 서명 HTML 정리기(WP-1517) 단위 — 스크립트·이벤트 속성 제거, 글꼴·색 style 보존과 위험한 CSS 제거, font·표 속성 보존, 링크 프로토콜 제한,
 * 빈 서명 판정.
 */
class MailSignatureHtmlSanitizerTest {

  private final MailSignatureHtmlSanitizer sanitizer = new MailSignatureHtmlSanitizer();

  private String clean(String html) {
    return MailSignatureHtmlSanitizer.toHtml(sanitizer.clean(html));
  }

  @Test
  void script_iframe_style블록_이벤트속성을_지운다() {
    String out =
        clean("<p onclick=\"x\">a<script>1</script></p><style>p{}</style><iframe></iframe>");

    assertThat(out).isEqualTo("<p>a</p>");
  }

  @Test
  void 글꼴_색_style은_남기고_위험한_CSS는_뺀다() {
    String out =
        clean(
            "<span style=\"font-family:Malgun Gothic;color:#1F4E79;position:fixed;"
                + "background:url(javascript:1)\">x</span>");

    assertThat(out).isEqualTo("<span style=\"font-family:Malgun Gothic;color:#1F4E79\">x</span>");
  }

  @Test
  void 허용_속성이라도_url_expression_값은_뺀다() {
    String out =
        clean(
            "<p style=\"background-color:expression(alert(1));border:1px solid red;"
                + "width:u\\72l(x)\">y</p>");

    assertThat(out).isEqualTo("<p style=\"border:1px solid red\">y</p>");
  }

  @Test
  void font태그와_표_속성을_남긴다() {
    String out =
        clean(
            "<table width=\"400\" cellpadding=\"0\"><tr><td valign=\"top\">"
                + "<font color=\"red\" face=\"Arial\">x</font></td></tr></table>");

    assertThat(out).contains("<table width=\"400\" cellpadding=\"0\">");
    assertThat(out).contains("<td valign=\"top\">");
    assertThat(out).contains("<font color=\"red\" face=\"Arial\">x</font>");
  }

  @Test
  void 링크는_http_https_mailto_tel만() {
    assertThat(clean("<a href=\"javascript:alert(1)\">x</a>")).isEqualTo("<a>x</a>");
    assertThat(clean("<a href=\"https://a.com\">x</a>"))
        .isEqualTo("<a href=\"https://a.com\">x</a>");
    assertThat(clean("<a href=\"tel:0212345678\">x</a>"))
        .isEqualTo("<a href=\"tel:0212345678\">x</a>");
    assertThat(clean("<a href=\"mailto:a@b.com\">x</a>"))
        .isEqualTo("<a href=\"mailto:a@b.com\">x</a>");
  }

  @Test
  void img_src는_그대로_받고_판단은_이미지_처리기에_맡긴다() {
    String out = clean("<img src=\"data:image/png;base64,AAAA\" width=\"10\" onerror=\"x\">");

    assertThat(out).isEqualTo("<img src=\"data:image/png;base64,AAAA\" width=\"10\">");
  }

  @Test
  void 글자도_이미지도_없으면_빈칸() {
    Element blank = sanitizer.clean("<p>&nbsp;</p><p></p>");
    assertThat(MailSignatureHtmlSanitizer.isBlank(blank)).isTrue();

    assertThat(MailSignatureHtmlSanitizer.isBlank(sanitizer.clean("<p>홍</p>"))).isFalse();
    assertThat(MailSignatureHtmlSanitizer.isBlank(sanitizer.clean("<p><img src=\"x\"></p>")))
        .isFalse();
    assertThat(MailSignatureHtmlSanitizer.isBlank(sanitizer.clean(""))).isTrue();
  }

  @Test
  void 음수_margin_padding_text_indent는_뺀다() {
    String out =
        clean(
            "<p style=\"margin-top:-40px;margin:0 -2em;padding-left:-.5em;text-indent:-9999px;"
                + "margin-left:4px;padding:2px 4px;border-top:1px solid #ccc\">x</p>");

    assertThat(out)
        .isEqualTo("<p style=\"margin-left:4px;padding:2px 4px;border-top:1px solid #ccc\">x</p>");
  }

  @Test
  void 크기는_px_퍼센트_em이고_상한_안일_때만_남긴다() {
    String out =
        clean(
            "<div style=\"width:5000px;height:100vh;max-width:calc(100% + 900px)\">a</div>"
                + "<div style=\"width:120%;height:60em\">b</div>"
                + "<div style=\"width:800px;height:auto;max-width:100%\">c</div>"
                + "<img src=\"x\" style=\"width:120px;height:4.5em\">");

    assertThat(out)
        .isEqualTo(
            "<div>a</div><div>b</div>"
                + "<div style=\"width:800px;height:auto;max-width:100%\">c</div>"
                + "<img src=\"x\" style=\"width:120px;height:4.5em\">");
  }

  @Test
  void width_height_속성도_상한을_넘으면_뺀다() {
    String out =
        clean(
            "<img src=\"x\" width=\"5000\" height=\"60\">"
                + "<table width=\"100%\" height=\"-5\"><tr><td width=\"200%\">y</td></tr></table>");

    assertThat(out).contains("<img src=\"x\" height=\"60\">");
    assertThat(out).contains("<table width=\"100%\">");
    assertThat(out).contains("<td>y</td>");
  }
}
