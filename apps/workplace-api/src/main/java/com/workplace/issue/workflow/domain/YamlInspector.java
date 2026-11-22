package com.workplace.issue.workflow.domain;

import com.workplace.issue.workflow.dto.StorableText;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import org.yaml.snakeyaml.nodes.MappingNode;
import org.yaml.snakeyaml.nodes.Node;
import org.yaml.snakeyaml.nodes.NodeTuple;
import org.yaml.snakeyaml.nodes.ScalarNode;
import org.yaml.snakeyaml.nodes.SequenceNode;

/**
 * Node 트리를 한 번 훑으며 YAML 수준의 금지 사항을 점검하고 위치표를 채운다.
 *
 * <p>왜: 신뢰할 수 없는 문서라 스키마 검사 전에 중복 키·NUL·깨진 문자를 막아야 한다. 같은 순회에서 모든 맵 키와 목록 항목의 위치를 {@link SourceMap}
 * 에 넣는다. 맵 항목 위치는 키가 적힌 자리, 목록 항목은 항목이 시작하는 자리다. 별칭·태그·중첩 깊이는 파서의 이벤트 훑기가 트리를 만들기 전에 막으므로 여기 오는 트리는
 * 얕고, 재귀가 스택을 넘지 않는다.
 */
final class YamlInspector {

  private final ParseSession session;

  /** 문제를 같은 세션의 목록·위치표에 담도록 세션을 받는다. */
  YamlInspector(ParseSession session) {
    this.session = session;
  }

  /** 루트부터 점검하고 위치를 등록한다. */
  void inspect(Node root) {
    session.source.put(List.of(), session.pos(root.getStartMark()));
    walk(root, new ArrayList<>());
  }

  /** 노드 하나와 그 아래를 점검한다. */
  private void walk(Node node, List<String> path) {
    if (node instanceof ScalarNode scalar) {
      checkText(scalar, path);
      return;
    }
    if (node instanceof MappingNode map) {
      Set<String> seen = new HashSet<>();
      for (NodeTuple tuple : map.getValue()) {
        // 글이 아닌 키는 스키마 검사가 SCHEMA_TYPE 으로 알린다(위치표에는 넣지 않는다).
        if (!(tuple.getKeyNode() instanceof ScalarNode key)) {
          continue;
        }
        checkText(key, path);
        path.add(key.getValue());
        if (seen.add(key.getValue())) {
          session.source.put(path, session.pos(key.getStartMark()));
        } else {
          session.error(
              "YAML_DUPLICATE_KEY",
              () -> "같은 키 '" + ParseSession.clip(key.getValue()) + "' 가 한 번 더 적혀 있습니다.",
              session.pos(key.getStartMark()),
              ParseSession.nodeKey(path));
        }
        walk(tuple.getValueNode(), path);
        path.remove(path.size() - 1);
      }
    } else if (node instanceof SequenceNode seq) {
      int i = 0;
      for (Node item : seq.getValue()) {
        path.add(Integer.toString(i++));
        session.source.put(path, session.pos(item.getStartMark()));
        walk(item, path);
        path.remove(path.size() - 1);
      }
    }
  }

  /** 저장할 수 없는 글자(NUL, 짝 없는 서로게이트)를 막는다. */
  private void checkText(ScalarNode scalar, List<String> path) {
    if (!StorableText.Validator.isStorable(scalar.getValue())) {
      session.error(
          "YAML_INVALID_TEXT",
          "저장할 수 없는 문자(NUL 또는 깨진 문자)가 들어 있습니다.",
          session.pos(scalar.getStartMark()),
          ParseSession.nodeKey(path));
    }
  }
}
