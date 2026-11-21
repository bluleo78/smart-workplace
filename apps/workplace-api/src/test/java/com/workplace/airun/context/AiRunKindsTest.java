package com.workplace.airun.context;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.junit.jupiter.api.Test;

/** AiRunKinds 단위 테스트 — 경로 정규화 규칙과 ai-agent kinds.ts 표 대조 (WP-1829). */
class AiRunKindsTest {

  @Test
  void 경로로_kind를_찾는다() {
    assertThat(AiRunKinds.kindForPath("/mail/analyze-content")).contains("MAIL_ANALYZE_CONTENT");
    assertThat(AiRunKinds.kindForPath("/drive/overview/")).contains("DRIVE_OVERVIEW");
    assertThat(AiRunKinds.kindForPath("/AI/CHAT")).contains("AI_CHAT");
    assertThat(AiRunKinds.kindForPath("  /ai/chat?x=1 ")).contains("AI_CHAT");
    assertThat(AiRunKinds.kindForPath("/models")).isEmpty();
    assertThat(AiRunKinds.kindForPath(null)).isEmpty();
  }

  @Test
  void ai_agent_표와_같다() throws Exception {
    // 작업 폴더 apps/workplace-api 기준 상대 경로
    String src = Files.readString(Path.of("../workplace-ai-agent/src/ai-run/kinds.ts"));
    int start = src.indexOf("AI_RUN_ROUTE_KINDS");
    int end = src.indexOf("AI_RUN_EVENT_KINDS");
    String block = src.substring(start, end);

    Map<String, String> expected = new LinkedHashMap<>();
    // 직접 쓴 '/ai/chat': 'AI_CHAT' 쌍
    Matcher direct = Pattern.compile("'(/[^']+)'\\s*:\\s*'([A-Z_]+)'").matcher(block);
    while (direct.find()) {
      expected.put(direct.group(1), direct.group(2));
    }
    // area('/prefix', { name: 'KIND', 'a-b': 'KIND' }) 블록
    Matcher area =
        Pattern.compile("area\\('(/[^']+)',\\s*\\{(.*?)\\}\\)", Pattern.DOTALL).matcher(block);
    Pattern pair = Pattern.compile("'?([a-z][a-z-]*)'?\\s*:\\s*'([A-Z_]+)'");
    while (area.find()) {
      Matcher p = pair.matcher(area.group(2));
      while (p.find()) {
        expected.put(area.group(1) + "/" + p.group(1), p.group(2));
      }
    }

    assertThat(expected).hasSize(28);
    assertThat(AiRunKinds.routeKinds()).isEqualTo(expected);
  }
}
