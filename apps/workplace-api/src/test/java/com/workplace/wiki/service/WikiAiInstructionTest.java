package com.workplace.wiki.service;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Collectors;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/** 노트 마크다운에서 AI 지시 상자를 지우는 {@link WikiAiInstruction} 검증(WP-1482). */
class WikiAiInstructionTest {

  private static final String OPEN = "<div class=\"wp-ai-instruction\">";

  @Test
  @DisplayName("null 은 null")
  void nullStaysNull() {
    assertThat(WikiAiInstruction.strip(null)).isNull();
  }

  @Test
  @DisplayName("지시 상자가 없으면 입력 그대로(같은 문자열)")
  void noBoxReturnsSame() {
    String md = "# 제목\n\n\n\n본문\n";
    assertThat(WikiAiInstruction.strip(md)).isSameAs(md);
  }

  @Test
  @DisplayName("지시 상자를 통째로 지운다")
  void stripsBox() {
    String md = "# 제목\n\n" + OPEN + "\n\n지시\n\n</div>\n\n본문\n";
    assertThat(WikiAiInstruction.strip(md)).isEqualTo("# 제목\n\n본문\n");
  }

  @Test
  @DisplayName("style·다른 class 토큰이 함께 있어도, 속성 순서·작은따옴표여도 지운다")
  void stripsWithOtherAttributes() {
    assertThat(
            WikiAiInstruction.strip(
                "<div class=\"card wp-ai-instruction\" style=\"border: 1px solid red\">\n\nx\n\n</div>\n\n본문"))
        .isEqualTo("본문");
    assertThat(
            WikiAiInstruction.strip(
                "<div style=\"color:red\" class=\"wp-ai-instruction\">\n\nx\n\n</div>\n\n본문"))
        .isEqualTo("본문");
    assertThat(WikiAiInstruction.strip("<div class='wp-ai-instruction'>\n\nx\n\n</div>\n\n본문"))
        .isEqualTo("본문");
  }

  @Test
  @DisplayName("class 토큰이 다르면 지우지 않는다")
  void differentTokenKept() {
    String md = "<div class=\"wp-ai-instructions\">\n\nx\n\n</div>\n\n본문";
    assertThat(WikiAiInstruction.strip(md)).isEqualTo(md);
  }

  @Test
  @DisplayName("다른 허용 태그도 지운다")
  void otherAllowedTag() {
    assertThat(
            WikiAiInstruction.strip(
                "<section class=\"wp-ai-instruction\">\n\nx\n\n</section>\n\n본문"))
        .isEqualTo("본문");
  }

  @Test
  @DisplayName("안에 겹친 일반 상자까지 바깥 닫는 태그에서 끝난다")
  void nestedInside() {
    String md = OPEN + "\n\n<div class=\"card\">\n\nA\n\n</div>\n\nB\n\n</div>\n\n본문";
    assertThat(WikiAiInstruction.strip(md)).isEqualTo("본문");
  }

  @Test
  @DisplayName("일반 상자 안의 지시 상자는 지시 상자만 지운다")
  void insideOtherBox() {
    String md = "<div class=\"card\">\n\n위\n\n" + OPEN + "\n\n지시\n\n</div>\n\n아래\n\n</div>\n";
    assertThat(WikiAiInstruction.strip(md))
        .isEqualTo("<div class=\"card\">\n\n위\n\n아래\n\n</div>\n");
  }

  @Test
  @DisplayName("닫는 태그가 없으면 끝까지 지운다")
  void unclosedRunsToEnd() {
    assertThat(WikiAiInstruction.strip("앞\n\n" + OPEN + "\n\n지시\n\n끝\n")).isEqualTo("앞\n");
  }

  @Test
  @DisplayName("펜스 코드 블록 안의 글자는 남긴다")
  void fencedKept() {
    String backtick = "```\n" + OPEN + "\n\n지시\n\n</div>\n```\n";
    assertThat(WikiAiInstruction.strip(backtick)).isEqualTo(backtick);
    String tilde = "~~~md\n" + OPEN + "\n지시\n</div>\n~~~\n";
    assertThat(WikiAiInstruction.strip(tilde)).isEqualTo(tilde);
  }

  @Test
  @DisplayName("여러 개를 지우고 3줄 이상 이어진 빈 줄은 접는다")
  void multipleAndCollapse() {
    String box = OPEN + "\n\n지시\n\n</div>";
    String md = "가\n\n" + box + "\n\n나\n\n" + box + "\n\n다\n";
    assertThat(WikiAiInstruction.strip(md)).isEqualTo("가\n\n나\n\n다\n");
  }

  @Test
  @DisplayName("2단 목록 안 들여쓴 지시 상자를 지운다")
  void indentedInList() {
    String md = "- 가\n  - 나\n    " + OPEN + "\n    지시\n    </div>\n  - 다\n";
    assertThat(WikiAiInstruction.strip(md)).isEqualTo("- 가\n  - 나\n  - 다\n");
  }

  @Test
  @DisplayName("인용 안 지시 상자를 접두째 지우고 인용의 다른 줄은 남긴다")
  void insideQuote() {
    String md = "> 앞\n> " + OPEN + "\n> 지시\n> </div>\n> 뒤\n";
    assertThat(WikiAiInstruction.strip(md)).isEqualTo("> 앞\n> 뒤\n");
    String nested = "> > " + OPEN + "\n> > 지시\n> > </div>\n본문\n";
    assertThat(WikiAiInstruction.strip(nested)).isEqualTo("본문\n");
  }

  @Test
  @DisplayName("상자 안 펜스 코드의 </div>·<div> 줄은 깊이에 세지 않는다")
  void fenceInsideBox() {
    String closeInFence = OPEN + "\n\n```html\n</div>\n```\n\n</div>\n\n본문\n";
    assertThat(WikiAiInstruction.strip(closeInFence)).isEqualTo("본문\n");
    String openInFence = OPEN + "\n\n```html\n<div>\n```\n\n</div>\n\n본문\n";
    assertThat(WikiAiInstruction.strip(openInFence)).isEqualTo("본문\n");
  }

  @Test
  @DisplayName("글자 뒤 같은 줄 끝에 붙은 닫는 태그도 닫힘이다")
  void closeAtEndOfTextLine() {
    String md = OPEN + "\n지시 내용</div>\n\n본문\n";
    assertThat(WikiAiInstruction.strip(md)).isEqualTo("본문\n");
  }

  @Test
  @DisplayName("여는 태그와 닫는 태그가 한 줄이면 그 줄만 지운다")
  void singleLineBox() {
    String md = "앞\n<div class=\"wp-ai-instruction\">지시</div>\n뒤\n";
    assertThat(WikiAiInstruction.strip(md)).isEqualTo("앞\n뒤\n");
  }

  @Test
  @DisplayName("빈 줄 접기는 지운 이음매에서만 — 다른 곳(펜스 안)의 빈 줄은 그대로")
  void collapseOnlyAtSeam() {
    String fence = "```\na\n\n\nb\n```";
    String md = fence + "\n\n" + OPEN + "\n지시\n</div>\n\n본문\n\n\n\n끝\n";
    assertThat(WikiAiInstruction.strip(md)).isEqualTo(fence + "\n\n본문\n\n\n\n끝\n");
  }

  @Test
  @DisplayName("style 값 안의 > 가 있어도 지시 상자로 인식한다")
  void quotedGreaterThanInAttribute() {
    String md = "<div class=\"wp-ai-instruction\" style=\"content: '>'\">\n지시\n</div>\n\n본문\n";
    assertThat(WikiAiInstruction.strip(md)).isEqualTo("본문\n");
  }

  @Test
  @DisplayName("태그 목록이 웹 WIKI_HTML_BOX_TAGS 와 같은 집합이다")
  void tagListMatchesWebSchema() throws IOException {
    Path file = findUp("packages/wiki-editor-schema/src/htmlSanitize.ts");
    String ts = Files.readString(file, StandardCharsets.UTF_8);
    Matcher block = Pattern.compile("WIKI_HTML_BOX_TAGS\\s*=\\s*\\[([^\\]]*)\\]").matcher(ts);
    assertThat(block.find()).isTrue();
    Set<String> web = new HashSet<>();
    Matcher tag = Pattern.compile("'([a-z]+)'").matcher(block.group(1));
    while (tag.find()) {
      web.add(tag.group(1));
    }
    Set<String> server =
        Arrays.stream(WikiAiInstruction.TAGS.split("\\|")).collect(Collectors.toSet());
    assertThat(web).isNotEmpty().isEqualTo(server);
  }

  /** 테스트 작업 폴더에서 위로 올라가며 상대 경로 파일을 찾는다(못 찾으면 실패). */
  private static Path findUp(String relative) {
    for (Path dir = Path.of("").toAbsolutePath(); dir != null; dir = dir.getParent()) {
      Path candidate = dir.resolve(relative);
      if (Files.exists(candidate)) {
        return candidate;
      }
    }
    throw new AssertionError("파일을 찾지 못했다: " + relative);
  }
}
