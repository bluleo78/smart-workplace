package com.workplace.fileai.security;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

/** 스크립트 요지(WP-1262) — AI 에 넘길 위험 신호만 섹션별로 모으고 길이를 묶는다. */
class ScriptDigestTest {

  /** 인라인 스크립트 본문은 그대로 실린다. */
  @Test
  void build_whenInlineScript_includesBody() {
    var r = ScriptDigest.build("<html><script>fetch('/steal?c='+document.cookie)</script></html>");
    assertThat(r.text()).contains("[스크립트]").contains("fetch('/steal?c='+document.cookie)");
    assertThat(r.truncated()).isFalse();
  }

  /** 외부 스크립트는 주소만 싣고 외부 주소 목록에도 오른다. */
  @Test
  void build_whenExternalScript_includesOnlyAddress() {
    var r = ScriptDigest.build("<script src=\"https://cdn.example/a.js\"></script>");
    assertThat(r.text()).contains("https://cdn.example/a.js").contains("[외부 주소]");
  }

  /** 인라인 이벤트 속성 값이 실린다. */
  @Test
  void build_whenEventAttribute_includesValue() {
    var r = ScriptDigest.build("<button onclick=\"doEvil(1)\">x</button>");
    assertThat(r.text()).contains("[이벤트 속성]").contains("onclick").contains("doEvil(1)");
  }

  /** javascript: 주소가 실린다. */
  @Test
  void build_whenJavascriptHref_includesIt() {
    var r = ScriptDigest.build("<a href=\"javascript:go()\">x</a>");
    assertThat(r.text()).contains("[javascript: 주소]").contains("javascript:go()");
  }

  /** 폼 action 과 입력의 type·name 이 실린다. */
  @Test
  void build_whenCredentialForm_includesActionTypeName() {
    var r =
        ScriptDigest.build(
            "<form action=\"https://evil.example/login\"><input type=\"password\" name=\"pw\"></form>");
    assertThat(r.text())
        .contains("[폼·입력]")
        .contains("https://evil.example/login")
        .contains("password")
        .contains("pw");
  }

  /** iframe 주소와 meta refresh 이동이 실린다. */
  @Test
  void build_whenFrameAndRefresh_includesBoth() {
    var r =
        ScriptDigest.build(
            "<meta http-equiv=\"refresh\" content=\"0;url=https://go.example/x\">"
                + "<iframe src=\"https://frame.example/p\"></iframe>");
    assertThat(r.text())
        .contains("[프레임·이동]")
        .contains("https://frame.example/p")
        .contains("0;url=https://go.example/x");
  }

  /** data: URI 는 앞 64자 + … 만 남는다(1MB 이미지가 요지를 채우지 않게). */
  @Test
  void build_whenHugeDataUri_keepsOnly64Chars() {
    String prefix = "data:image/png;base64,";
    String uri = prefix + "A".repeat(1024 * 1024);
    var r = ScriptDigest.build("<script>x()</script><img src=\"" + uri + "\">");
    String kept = uri.substring(0, 64) + "…";
    assertThat(r.text()).contains(kept).doesNotContain(uri.substring(0, 65)).hasSizeLessThan(2_000);
  }

  /** data: URI 를 쓰는 외부 스크립트도 64자로 자른다. */
  @Test
  void build_whenDataUriScriptSrc_trims() {
    String uri = "data:text/javascript;base64," + "B".repeat(10_000);
    var r = ScriptDigest.build("<script src=\"" + uri + "\"></script>");
    assertThat(r.text()).contains(uri.substring(0, 64) + "…").doesNotContain(uri.substring(0, 65));
  }

  /** 스크립트가 길면 앞 40,000자 + 중략 + 뒤 20,000자로 줄이고 truncated 를 켠다. */
  @Test
  void build_whenOverLimit_truncatesHeadAndTail() {
    String body = "h".repeat(50_000) + "t".repeat(50_000);
    var r = ScriptDigest.build("<script>" + body + "</script>");
    assertThat(r.truncated()).isTrue();
    assertThat(r.text()).contains("\n…(중략)…\n");
    assertThat(r.text().length()).isLessThanOrEqualTo(60_000 + "\n…(중략)…\n".length());
    assertThat(r.text()).startsWith("[스크립트]").endsWith("t");
  }

  /** 외부 주소 목록은 중복을 뺀다. */
  @Test
  void build_whenRepeatedExternal_deduplicates() {
    var r =
        ScriptDigest.build(
            "<script src=\"https://cdn.example/a.js\"></script>"
                + "<script src=\"https://cdn.example/a.js\"></script>"
                + "<img src=\"https://img.example/p.png\">");
    String external = r.text().substring(r.text().indexOf("[외부 주소]"));
    assertThat(external.split("https://cdn.example/a.js", -1)).hasSize(2);
    assertThat(external).contains("https://img.example/p.png");
  }
}
