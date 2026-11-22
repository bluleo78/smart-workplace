package com.workplace.issue.workflow;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.issue.workflow.domain.WorkflowSchema;
import com.workplace.issue.workflow.domain.WorkflowYamlParser;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.JsonNode;

/** 워크플로우 스키마 원본(packages)과 서버 사본, 그리고 서버 검사기가 아는 키워드를 지킨다(WP-1984). */
class WorkflowSchemaTest {

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

  @Test
  @DisplayName("서버 사본은 공용 패키지 원본과 바이트까지 같다")
  void apiCopy_equalsPackageSource() throws IOException {
    Path source = findUp("packages/mcp-tools-shared/src/workflow-schema.json");
    Path copy = findUp("apps/workplace-api/src/main/resources/workflow/workflow-schema.json");

    assertThat(Files.readAllBytes(copy)).isEqualTo(Files.readAllBytes(source));
  }

  @Test
  @DisplayName("스키마는 검사기가 아는 키워드만 쓰고, 아는 키워드는 모두 쓰인다")
  void onlySupportedKeywords() {
    Set<String> used = new HashSet<>();
    collect(WorkflowSchema.root(), used);

    assertThat(WorkflowSchema.SUPPORTED_KEYWORDS).containsAll(used);
    assertThat(used).containsAll(WorkflowSchema.SUPPORTED_KEYWORDS);
  }

  @Test
  @DisplayName("x-nodeTypes 는 종류별 허용 필드를 주고 예약 종류는 넣지 않는다")
  void nodeTypes_listsAllowedFields() {
    JsonNode types = WorkflowSchema.nodeTypes();

    Set<String> names = new HashSet<>();
    types.propertyNames().forEach(names::add);
    assertThat(names)
        .containsExactlyInAnyOrder("start", "end", "decision", "agent_task", "human_task");
    assertThat(types.get("start").toString()).isEqualTo("[\"type\",\"name\"]");
    assertThat(types.get("agent_task").toString()).contains("\"ask\"").doesNotContain("returnTo");
    assertThat(types.get("human_task").toString())
        .contains("\"returnTo\"")
        .doesNotContain("\"ask\"");
  }

  @Test
  @DisplayName("공유 검사기의 패턴 표는 생성 때 채워진 읽기 전용이다(첫 요청들의 동시 채움 경합이 없다)")
  void sharedCheckerPatterns_arePrecompiledAndReadOnly() throws ReflectiveOperationException {
    var checkerField = WorkflowYamlParser.class.getDeclaredField("CHECKER");
    checkerField.setAccessible(true);
    Object checker = checkerField.get(null);
    var patternsField = checker.getClass().getDeclaredField("patterns");
    patternsField.setAccessible(true);
    @SuppressWarnings("unchecked")
    Map<String, ?> patterns = (Map<String, ?>) patternsField.get(checker);

    assertThat(patterns).containsKey("^[a-z][a-z0-9_]*$");
    assertThatThrownBy(() -> patterns.put("x", null))
        .isInstanceOf(UnsupportedOperationException.class);
  }

  /** 스키마를 재귀로 돌며 키워드 위치의 이름만 모은다(properties·$defs 의 이름은 키워드가 아니다). */
  private static void collect(JsonNode schema, Set<String> used) {
    if (!schema.isObject()) {
      return;
    }
    for (var e : schema.properties()) {
      String keyword = e.getKey();
      JsonNode value = e.getValue();
      used.add(keyword);
      switch (keyword) {
        case "properties", "$defs" -> value.properties().forEach(p -> collect(p.getValue(), used));
        case "additionalProperties", "propertyNames", "items", "not" -> collect(value, used);
        case "oneOf" -> value.forEach(s -> collect(s, used));
        default -> {}
      }
    }
  }
}
