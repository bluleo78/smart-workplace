package com.workplace.issue.workflow.domain;

import com.workplace.global.json.JsonMappers;
import java.io.IOException;
import java.io.InputStream;
import java.util.List;
import java.util.Set;
import tools.jackson.databind.JsonNode;

/**
 * 워크플로우 스키마({@code workflow/workflow-schema.json}) 적재기.
 *
 * <p>왜: 문법·형태 규칙의 단일 원본은 {@code packages/mcp-tools-shared} 의 스키마 파일이고, Docker 빌드 컨텍스트가 packages/ 를
 * 볼 수 없어 서버는 커밋된 바이트 동일 사본을 클래스패스에서 읽는다(동일성은 테스트가 지킨다). 이 클래스는 한 번 읽어 공유한다.
 */
public final class WorkflowSchema {

  /**
   * 서버 검사기({@link SchemaChecker})가 해석하는 스키마 키워드 전부. 스키마가 이 밖의 키워드를 쓰면 조용히 무시돼 규칙이 빠지므로 테스트가 막고,
   * 스키마가 쓰지 않는 키워드는 구현하지 않는다.
   */
  public static final Set<String> SUPPORTED_KEYWORDS =
      Set.of(
          "$schema",
          "$id",
          "$defs",
          "$ref",
          "title",
          "description",
          "type",
          "properties",
          "additionalProperties",
          "propertyNames",
          "items",
          "required",
          "const",
          "enum",
          "pattern",
          "minimum",
          "minLength",
          "maxLength",
          "oneOf",
          "not",
          "x-nodeTypes");

  /** 클래스패스 위치. */
  private static final String RESOURCE = "/workflow/workflow-schema.json";

  /** 한 번 읽은 스키마(불변으로만 쓴다). */
  private static final JsonNode ROOT = load();

  private WorkflowSchema() {}

  /** 스키마 루트. */
  public static JsonNode root() {
    return ROOT;
  }

  /** 노드 종류별 허용 필드표({@code x-nodeTypes}: 종류 → 필드 이름 배열). 예약 종류는 들어 있지 않다. */
  public static JsonNode nodeTypes() {
    return ROOT.get("x-nodeTypes");
  }

  /** 노드에 적을 수 있는 모든 필드 이름({@code $defs.Node.properties} 에 적힌 순서). */
  static List<String> nodeFields() {
    return List.copyOf(ROOT.at("/$defs/Node/properties").propertyNames());
  }

  /** 스키마 파일을 읽는다. 없거나 깨지면 빌드 결함이라 즉시 실패한다. */
  private static JsonNode load() {
    try (InputStream in = WorkflowSchema.class.getResourceAsStream(RESOURCE)) {
      if (in == null) {
        throw new IllegalStateException("워크플로우 스키마를 찾지 못했다: " + RESOURCE);
      }
      return JsonMappers.JACKSON2.readTree(in);
    } catch (IOException e) {
      throw new IllegalStateException("워크플로우 스키마를 읽지 못했다", e);
    }
  }
}
