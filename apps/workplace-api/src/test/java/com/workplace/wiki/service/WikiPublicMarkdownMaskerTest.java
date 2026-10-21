package com.workplace.wiki.service;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.Map;
import org.junit.jupiter.api.Test;

/**
 * 외부(비로그인) 공유 보기의 본문 가림(WP-579 Task 7, 설계 「볼 수 없는 링크 가림」) — 사람·범위 밖 페이지·이슈 멘션, 앱 내부 링크가 외부 응답에 남지
 * 않고, 범위 안 페이지 멘션은 제목 글자로, 본문 이미지는 공개 첨부 주소로 바뀌는지 본다.
 *
 * <p>입력 형태는 실제 노트 직렬화 결과다 — GFM 표 셀의 멘션 토큰, GFM 으로 못 쓰는 표의 HTML 폴백(#742, 멘션은 {@code <span
 * data-mtype data-id>&lt;@3&gt;</span>}, 링크는 {@code <a target rel href>}, 이미지는 {@code <img src
 * alt>}), 표 안 주소의 괄호 이스케이프.
 */
class WikiPublicMarkdownMaskerTest {

  private static final String BASE = "http://localhost:6173";
  private static final String TOKEN = "wsh_tok";
  private static final String NO_ACCESS = "‹접근 권한 없음›";

  private final WikiPublicMarkdownMasker masker = new WikiPublicMarkdownMasker(BASE);

  /** 공유 범위 — 20 「1분기」, 21 「2분기」 만 범위 안. 12·99 는 범위 밖. */
  private static final Map<Long, String> SCOPE = Map.of(20L, "1분기", 21L, "2분기");

  private String mask(String md) {
    return masker.mask(md, SCOPE, TOKEN);
  }

  /** 멘션·내부 링크 가림 — 표 셀 안(GFM·HTML 폴백 모두)까지, 외부 http(s) 링크는 그대로. */
  @Test
  void public_markdown_masks_mentions_and_internal_links() {
    // 표(GFM) 셀 안 멘션·내부 링크.
    assertThat(
            mask(
                "| 담당 | 비고 |\n| --- | --- |\n| <@3> [작업](/wiki/spaces/1/pages/2) | <#page:12> <#issue:7> |\n"))
        .isEqualTo(
            "| 담당 | 비고 |\n| --- | --- |\n| "
                + NO_ACCESS
                + " 작업 | "
                + NO_ACCESS
                + " "
                + NO_ACCESS
                + " |\n");

    // 범위 안 페이지 멘션은 그 제목 글자, 범위 밖은 가림.
    assertThat(mask("참고 <#page:20> 와 <#page:12>")).isEqualTo("참고 1분기 와 " + NO_ACCESS);

    // 앱 내부 링크(상대·같은 오리진 절대·프로토콜 상대·위험 스킴)는 글자만, 외부 http(s) 링크는 유지.
    assertThat(mask("[이슈](/issues/WP-1)")).isEqualTo("이슈");
    assertThat(mask("[절대](http://localhost:6173/drive/folders/3 \"제목\")")).isEqualTo("절대");
    assertThat(mask("[상대](issues/1) [앵커](#h) [프로토콜](//localhost:6173/x)")).isEqualTo("상대 앵커 프로토콜");
    assertThat(mask("[js](javascript:alert\\(1\\))")).isEqualTo("js");
    assertThat(mask("[외부](https://ex.com/a_\\(b\\)) [제목](https://ex.com \"t\")"))
        .isEqualTo("[외부](https://ex.com/a_\\(b\\)) [제목](https://ex.com \"t\")");
    // 자동 링크: 외부는 유지, 같은 오리진은 링크를 뗀 글자.
    assertThat(mask("<https://ex.com/x> <http://localhost:6173/issues/1>"))
        .isEqualTo("<https://ex.com/x> http://localhost:6173/issues/1");
    // 참조형 링크 정의 — 내부 주소 정의는 지운다, 외부는 둔다.
    assertThat(mask("[a][1] [b][2]\n\n[1]: /issues/1\n[2]: https://ex.com\n"))
        .isEqualTo("[a][1] [b][2]\n\n[2]: https://ex.com\n");

    // GFM 으로 못 쓰는 표의 HTML 폴백 — 멘션 칩 span(속성 순서 무관)·내부 a 는 글자, 외부 a 는 그대로.
    String htmlTable =
        "<div class=\"tableWrapper\">\n<table><tbody><tr><td colspan=\"1\" rowspan=\"1\"><p>"
            + "<span data-mtype=\"USER\" data-id=\"3\">&lt;@3&gt;</span> "
            + "<span data-id=\"20\" data-mtype=\"PAGE\">&lt;#page:20&gt;</span> "
            + "<span data-mtype=\"PAGE\" data-id=\"12\">&lt;#page:12&gt;</span> "
            + "<span data-mtype=\"ISSUE\" data-id=\"7\">&lt;#issue:7&gt;</span></p></td>"
            + "<td colspan=\"1\" rowspan=\"1\"><p>"
            + "<a target=\"_blank\" rel=\"noopener noreferrer nofollow\" href=\"/issues/1\">이슈</a> "
            + "<a target=\"_blank\" rel=\"noopener noreferrer nofollow\" href=\"https://ex.com/a(b)\">외부</a>"
            + "</p></td></tr></tbody></table>\n</div>";
    assertThat(mask(htmlTable))
        .isEqualTo(
            "<div class=\"tableWrapper\">\n<table><tbody><tr><td colspan=\"1\" rowspan=\"1\"><p>"
                + NO_ACCESS
                + " 1분기 "
                + NO_ACCESS
                + " "
                + NO_ACCESS
                + "</p></td>"
                + "<td colspan=\"1\" rowspan=\"1\"><p>이슈 "
                + "<a target=\"_blank\" rel=\"noopener noreferrer nofollow\" href=\"https://ex.com/a(b)\">외부</a>"
                + "</p></td></tr></tbody></table>\n</div>");

    // 글자로 이스케이프된 토큰·닫는 태그 없는 칩도 가린다(실패 시 닫힘).
    assertThat(mask("&lt;@5&gt; &lt;#issue:9&gt; <span data-mtype=\"USER\" data-id=\"5\">"))
        .isEqualTo(NO_ACCESS + " " + NO_ACCESS + " " + NO_ACCESS);
    // 코드 안 토큰도 가린다 — 외부에 사람·이슈 id 를 남기지 않는다.
    assertThat(mask("`<@3>`")).isEqualTo("`" + NO_ACCESS + "`");
    // 알 수 없는 종류의 멘션 토큰(예: 앞으로 생길 드라이브)도 가린다.
    assertThat(mask("<#drive:4>")).isEqualTo(NO_ACCESS);
    // long 범위를 넘는 id 도 오류 없이 가린다.
    assertThat(
            mask(
                "<#page:9999999999999999999> ![x](/api/v1/wiki/pages/9999999999999999999/attachments/1/content)"))
        .isEqualTo(NO_ACCESS + " x");
  }

  /**
   * 정규식이 못 푸는 모양·남은 HTML 주소 속성도 실패 시 닫힘으로 링크가 되지 않는다 — 겹친 대괄호, 속성값 안의 {@code >}, 닫히지 않은 태그·따옴표,
   * srcset·iframe, 인용 안 참조 정의, 위험한 자동 링크.
   */
  @Test
  void public_masker_fails_closed_on_unparsed_shapes() {
    // 겹친 대괄호·두 겹 괄호 — 링크 문법이 깨져 주소가 남지 않는다.
    assertThat(mask("[a [b] c](/issues/1)")).isEqualTo("[a [b] c]");
    assertThat(mask("[x](/a(b(c)))")).doesNotContain("](").doesNotContain("/a(b");
    // 겹친 대괄호라도 외부 주소는 그대로.
    assertThat(mask("[a [b] c](https://ex.com)")).isEqualTo("[a [b] c](https://ex.com)");
    // 앞 속성값 안의 > 뒤 href, 닫히지 않은 태그, 닫히지 않은 따옴표.
    assertThat(mask("<a title=\"a>b\" href=\"/x\">t</a>")).doesNotContain("href").contains("t</a>");
    assertThat(mask("<a href=\"/x\">t")).isEqualTo("<a >t");
    assertThat(mask("<a href=/issues/1>t")).isEqualTo("<a >t");
    assertThat(mask("<a href=\"/x>t")).doesNotContain("href").startsWith("<a data-masked=");
    // srcset — 후보 중 하나라도 외부·공개 첨부가 아니면 통째로 지운다. 외부만이면 그대로.
    assertThat(mask("<img srcset=\"/api/v1/wiki/pages/9/attachments/1/content 1x\">"))
        .isEqualTo("<img >");
    assertThat(mask("<img srcset=\"https://ex.com/a.png 1x, /x 2x\">")).isEqualTo("<img >");
    assertThat(mask("<img srcset=\"https://ex.com/a.png 1x, https://ex.com/b.png 2x\">"))
        .isEqualTo("<img srcset=\"https://ex.com/a.png 1x, https://ex.com/b.png 2x\">");
    // iframe·source·area 의 내부 주소.
    assertThat(mask("<iframe src=\"/x\"></iframe>")).isEqualTo("<iframe ></iframe>");
    assertThat(mask("<video><source src='/drive/files/1'></video>"))
        .isEqualTo("<video><source ></video>");
    assertThat(mask("<map><area href=\"http://localhost:6173/issues/1\"></map>"))
        .isEqualTo("<map><area ></map>");
    assertThat(mask("<iframe src=\"https://ex.com/embed\"></iframe>"))
        .isEqualTo("<iframe src=\"https://ex.com/embed\"></iframe>");
    // 인용·목록 안 참조 정의, 주소가 다음 줄인 정의.
    assertThat(mask("[a][r]\n\n> [r]: /issues/1\n")).isEqualTo("[a][r]\n\n");
    assertThat(mask("- [r]: /issues/1 \"t\"\n")).isEmpty();
    assertThat(mask("[r]:\n/issues/1\n")).isEqualTo("/issues/1\n");
    // 여러 줄 제목 정의 — 정의가 될 수 없게 이름 앞 [ 를 이스케이프(참조 [x][r] 는 링크가 되지 않는다).
    assertThat(mask("[x][r]\n\n[r]: /issues/1 \"a\nb\"\n"))
        .isEqualTo("[x][r]\n\n\\[r]: /issues/1 \"a\nb\"\n");
    assertThat(mask("> [r]: /issues/1 \"a\n> b\"\n")).isEqualTo("> \\[r]: /issues/1 \"a\n> b\"\n");
    // 첫 주소가 외부면 그대로.
    assertThat(mask("[r]: https://ex.com \"a\nb\"\n")).isEqualTo("[r]: https://ex.com \"a\nb\"\n");
    // 정의 모양이 아닌 문장도 같은 이스케이프 — 보이는 글자는 같고 정의가 될 수 없다.
    assertThat(mask("[참고]: 아래 표를 보세요")).isEqualTo("\\[참고]: 아래 표를 보세요");
    // 목록 안·1~3칸 들여쓴 여러 줄 제목 정의도 같다.
    assertThat(mask("- [r]: /issues/1 \"a\n  b\"\n")).isEqualTo("- \\[r]: /issues/1 \"a\n  b\"\n");
    assertThat(mask(" [r]: /issues/1 \"a\nb\"\n")).isEqualTo(" \\[r]: /issues/1 \"a\nb\"\n");
    assertThat(mask("   [r]: /issues/1 \"a\nb\"\n")).isEqualTo("   \\[r]: /issues/1 \"a\nb\"\n");
    // 못 푼 링크 꼬리 — ) 가 없는 ]( 는 ( 를 이스케이프해 링크가 될 수 없다(많아도 같은 결과).
    assertThat(mask("](".repeat(5_000))).isEqualTo("]\\(".repeat(5_000));
    // 길이 상한 없음 — 아주 긴 내부 주소도 떼어 낸다.
    assertThat(mask("[a [b] c](/issues/" + "x".repeat(3_000) + ")")).isEqualTo("[a [b] c]");
    // 여러 줄 제목이라 같은 줄에 ) 가 없는 꼬리 — 내부는 ( 이스케이프, 외부는 그대로.
    assertThat(mask("[a [b] c](/issues/1 \"a\nb\")")).isEqualTo("[a [b] c]\\(/issues/1 \"a\nb\")");
    assertThat(mask("[a [b] c](https://ex.com \"a\nb\")"))
        .isEqualTo("[a [b] c](https://ex.com \"a\nb\")");
    assertThat(mask("[a [b] c](http://localhost:6173/x \"a\nb\")"))
        .isEqualTo("[a [b] c]\\(http://localhost:6173/x \"a\nb\")");
    // 자동 링크 — 위험 스킴·메일도 글자로.
    assertThat(mask("<javascript:alert(1)> <mailto:a@b.c>"))
        .isEqualTo("javascript:alert(1) mailto:a@b.c");
    // 아주 긴 id(정수 범위 밖)도 가린다 — 칩 HTML 포함.
    assertThat(mask("<@99999999999999999999> <#page:99999999999999999999>"))
        .isEqualTo(NO_ACCESS + " " + NO_ACCESS);
    assertThat(mask("<span data-mtype=\"PAGE\" data-id=\"99999999999999999999\">x</span>"))
        .isEqualTo(NO_ACCESS);
    // 바꾼 공개 첨부 주소는 안전망을 지나도 남는다(HTML·마크다운).
    String pub = "/api/v1/public/wiki/shares/" + TOKEN + "/pages/20/attachments/9";
    assertThat(mask("<img src=\"/api/v1/wiki/pages/20/attachments/9/content\">"))
        .isEqualTo("<img src=\"" + pub + "\">");
    // 다른 토큰·범위 밖 페이지의 공개 주소는 남기지 않는다.
    assertThat(mask("<img src=\"/api/v1/public/wiki/shares/wsh_other/pages/20/attachments/9\">"))
        .isEqualTo("");
  }

  /** 범위 안 페이지 제목은 마크업·표 구분자로 해석되지 않게 문자 참조로 넣는다. */
  @Test
  void public_in_scope_title_is_escaped() {
    WikiPublicMarkdownMasker m = new WikiPublicMarkdownMasker(BASE);
    String out = m.mask("| <#page:30> |", Map.of(30L, "a|b <i>x</i> [y](/z)"), TOKEN);
    assertThat(out).doesNotContain("<i>").doesNotContain("|b").doesNotContain("](");
    assertThat(out)
        .isEqualTo("| a&#124;b &#60;i&#62;x&#60;&#47;i&#62; &#91;y&#93;&#40;&#47;z&#41; |");
    // HTML 폴백 안의 칩도 같은 이스케이프.
    assertThat(
            m.mask(
                "<p><span data-mtype=\"PAGE\" data-id=\"30\">&lt;#page:30&gt;</span></p>",
                Map.of(30L, "<b>"),
                TOKEN))
        .isEqualTo("<p>&#60;b&#62;</p>");
  }

  /** 본문 이미지 — 범위 안 페이지의 첨부는 공개 첨부 주소로, 범위 밖·내부 주소 이미지는 빼고, 외부 이미지는 그대로. */
  @Test
  void public_rewrites_image_urls() {
    String pub = "/api/v1/public/wiki/shares/" + TOKEN + "/pages/20/attachments/9";
    assertThat(mask("![사진](/api/v1/wiki/pages/20/attachments/9/content)"))
        .isEqualTo("![사진](" + pub + ")");
    // 같은 오리진 절대 주소·title 포함.
    assertThat(mask("![a](http://localhost:6173/api/v1/wiki/pages/20/attachments/9/content \"t\")"))
        .isEqualTo("![a](" + pub + " \"t\")");
    // 표 셀 안 이미지.
    assertThat(mask("| ![](/api/v1/wiki/pages/20/attachments/9/content) | x |"))
        .isEqualTo("| ![](" + pub + ") | x |");
    // 범위 밖 페이지의 첨부·옛 첨부 주소·다른 내부 주소 이미지는 이미지를 빼고 대체 글자만.
    assertThat(mask("![밖](/api/v1/wiki/pages/99/attachments/9/content)")).isEqualTo("밖");
    assertThat(mask("![옛](/api/v1/wiki/attachments/1)")).isEqualTo("옛");
    // 외부 이미지는 그대로.
    assertThat(mask("![ext](https://ex.com/i.png)")).isEqualTo("![ext](https://ex.com/i.png)");
    // 링크로 감싼 이미지 — 이미지는 공개 주소로, 내부 링크는 떼어 낸다.
    assertThat(mask("[![a](/api/v1/wiki/pages/20/attachments/9/content)](/wiki/spaces/1/pages/20)"))
        .isEqualTo("![a](" + pub + ")");
    // 첨부를 가리키는 링크는 공개 첨부 주소 링크로.
    assertThat(mask("[파일](/api/v1/wiki/pages/21/attachments/5/content)"))
        .isEqualTo("[파일](/api/v1/public/wiki/shares/" + TOKEN + "/pages/21/attachments/5)");

    // HTML 폴백 표 안 img — 범위 안은 src 를 바꾸고, 범위 밖은 태그를 지운다.
    assertThat(mask("<p><img src=\"/api/v1/wiki/pages/20/attachments/9/content\" alt=\"\"></p>"))
        .isEqualTo("<p><img src=\"" + pub + "\" alt=\"\"></p>");
    assertThat(mask("<p><img src=\"/api/v1/wiki/pages/99/attachments/9/content\" alt=\"\"></p>"))
        .isEqualTo("<p></p>");
    assertThat(mask("<p><img alt=\"x\" src=\"https://ex.com/i.png\"></p>"))
        .isEqualTo("<p><img alt=\"x\" src=\"https://ex.com/i.png\"></p>");
  }
}
