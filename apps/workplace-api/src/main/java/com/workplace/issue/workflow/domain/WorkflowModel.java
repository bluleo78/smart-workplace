package com.workplace.issue.workflow.domain;

import java.time.Duration;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 파싱을 마친 워크플로우 정의 모델(YAML 의 줄임·use 가 이미 펼쳐진 꼴).
 *
 * <p>왜: 검증기·저장·실행 엔진이 YAML 을 다시 읽지 않고 같은 모델을 쓰게 한다. 규칙: 없는 목록·맵은 빈 값, 없는 단일 값은 null. nodes 와
 * outcomes 는 적힌 순서가 뜻이라 LinkedHashMap 이다.
 *
 * @param schema 스키마 식별자(genia/workflow@1)
 * @param name 정의 이름
 * @param roles 역할 키 → 역할
 * @param shared 공용 지시 이름 → 글
 * @param nodes 노드 키 → 노드(적힌 순서, ask 펼침은 원 노드 바로 뒤)
 * @param start 최상위 start 조건 목록
 * @param layout 노드 키 → 편집기 좌표
 */
public record WorkflowModel(
    String schema,
    String name,
    Map<String, Role> roles,
    Map<String, String> shared,
    LinkedHashMap<String, Node> nodes,
    List<Condition> start,
    Map<String, Point> layout) {

  /** 빈 값 규칙을 지키도록 null 목록·맵을 비어 있는 값으로 바꾸고 순서를 보존해 복사한다. */
  public WorkflowModel {
    roles = orderedCopy(roles);
    shared = orderedCopy(shared);
    nodes = nodes == null ? new LinkedHashMap<>() : new LinkedHashMap<>(nodes);
    start = start == null ? List.of() : List.copyOf(start);
    layout = orderedCopy(layout);
  }

  /**
   * 게시본으로 남길 모델 — 역할 구성원만 저장된 username 으로 바꾸고 같은 사람은 처음 자리만 남긴다.
   *
   * <p>왜: 버전은 바뀌지 않고 실행 엔진은 username 을 정확히 견주므로, 관대하게 맞춘 글을 그대로 남기면 실행 때 아무도 아니거나 다른 사람이 된다.
   *
   * @param members 이 모델을 검증한 것과 같은 구성원 표
   * @throws IllegalStateException 해석되지 않은 구성원이 있을 때(검증 ERROR 가 있는 모델은 게시본이 될 수 없다)
   */
  public WorkflowModel withStoredUsernames(ProjectMembers members) {
    Map<String, Role> stored = new LinkedHashMap<>();
    roles.forEach(
        (key, role) -> {
          Set<String> usernames = new LinkedHashSet<>();
          for (String typed : role.memberUsernames()) {
            usernames.add(
                members
                    .find(typed)
                    .orElseThrow(() -> new IllegalStateException("해석되지 않은 구성원이 있는 모델은 게시할 수 없다"))
                    .username());
          }
          stored.put(key, new Role(role.key(), role.name(), List.copyOf(usernames)));
        });
    return new WorkflowModel(schema, name, stored, shared, nodes, start, layout);
  }

  /**
   * 역할. {@code memberUsernames} 는 파서가 만든 모델에서는 적힌 글 그대로이고, 게시해 저장한 모델에서는 저장된 정확한 username 이며 중복이
   * 없다({@link WorkflowModel#withStoredUsernames}).
   */
  public record Role(String key, String name, List<String> memberUsernames) {
    /** 구성원 목록이 없으면 빈 목록으로 두고 바뀌지 않게 복사한다. */
    public Role {
      memberUsernames = memberUsernames == null ? List.of() : List.copyOf(memberUsernames);
    }
  }

  /** 노드(종류별로 쓰는 필드가 다르며 안 쓰는 것은 빈 값·null). */
  public record Node(
      String key,
      String type,
      String name,
      String roleKey,
      String instructions,
      List<String> use,
      List<String> requires,
      Map<String, OutputSpec> outputs,
      LinkedHashMap<String, Outcome> outcomes,
      List<Condition> conditions,
      String defaultTo,
      Integer maxVisits,
      Timeout timeout,
      Target onError,
      String returnTo) {
    /** 없는 목록·맵은 빈 값으로 두고 적힌 순서를 지켜 복사한다(소비자가 null 을 보지 않게). */
    public Node {
      use = use == null ? List.of() : List.copyOf(use);
      requires = requires == null ? List.of() : List.copyOf(requires);
      outputs = orderedCopy(outputs);
      outcomes = outcomes == null ? new LinkedHashMap<>() : new LinkedHashMap<>(outcomes);
      conditions = conditions == null ? List.of() : List.copyOf(conditions);
    }
  }

  /** 결과 한 개의 이동: 도착 노드, 담당을 바꿀 역할(keep 은 그대로), 의견 필수 여부, 표시 이름(없으면 null — 화면은 key 로 대신한다). */
  public record Outcome(
      String key, String to, String assignTo, boolean requireComment, String name) {}

  /** decision·start 조건. assigneeRole 또는 (contextKey, equalsValue) 중 하나만 채워진다. */
  public record Condition(String assigneeRole, String contextKey, Object equalsValue, String to) {}

  /** 노드가 내놓을 값의 명세. {@code name} 은 표시 이름(없으면 null). */
  public record OutputSpec(String type, boolean required, String name) {}

  /** 기한: 지나면 {@code then}(remind|escalate). */
  public record Timeout(Duration after, String then) {}

  /** onError 이동: 도착 노드와 담당을 바꿀 역할. */
  public record Target(String to, String assignTo) {}

  /** 편집기 좌표. */
  public record Point(double x, double y) {}

  /** 키 순서를 지킨 불변 사본(null 이면 빈 맵). */
  private static <V> Map<String, V> orderedCopy(Map<String, V> src) {
    return src == null ? Map.of() : Collections.unmodifiableMap(new LinkedHashMap<>(src));
  }
}
