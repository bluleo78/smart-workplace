package com.workplace.issue.workflow.domain;

/**
 * 결과·출력의 표시 이름 해석(WP-2158). 화면·MCP 가 같은 규칙으로 이름을 보이도록 서버가 한 곳에서 정한다.
 *
 * <p>정의에 name 을 적었으면 그 name, 없으면 key 가 ask·answered 인 결과는 기본 이름(질문·답변), 복구 조치 결과(_recover)는 「조치」, 그
 * 밖은 key 를 그대로 쓴다. 웹 workflowNames.ts 의 기본 이름 표와 같다.
 */
public final class WorkflowDisplayNames {

  private WorkflowDisplayNames() {}

  /** 결과의 표시 이름 — key 가 null 이면 null(자동 노드는 결과가 없다). */
  public static String outcome(String key, String name) {
    if (key == null) {
      return null;
    }
    if (usable(name)) {
      return name;
    }
    return switch (key) {
      case ReservedOutcomes.ASK -> "질문";
      case ReservedOutcomes.ANSWERED -> "답변";
      case ReservedOutcomes.RECOVER -> "조치";
      default -> key;
    };
  }

  /** 출력의 표시 이름 — name 이 비었으면 key. */
  public static String output(String key, String name) {
    return usable(name) ? name : key;
  }

  /** 이름이 쓸 만한 값인지 — null·공백뿐이면 없는 것으로 본다. */
  private static boolean usable(String name) {
    return name != null && !name.isBlank();
  }
}
