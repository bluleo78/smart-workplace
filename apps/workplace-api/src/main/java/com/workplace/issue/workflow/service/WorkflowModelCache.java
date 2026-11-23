package com.workplace.issue.workflow.service;

import com.workplace.issue.workflow.domain.WorkflowModel;
import com.workplace.issue.workflow.domain.WorkflowModel.Node;
import com.workplace.issue.workflow.domain.WorkflowModelJson;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.function.Supplier;
import org.springframework.stereotype.Component;

/**
 * 게시 버전 id → 해석한 모델 캐시(WP-1985). 버전은 게시한 뒤 바뀌지 않으므로 id 하나로 담아 두고, 이동·조회마다 모델 JSON 을 다시 읽고 해석하지 않는다.
 *
 * <p>규칙:
 *
 * <ul>
 *   <li>부르는 쪽은 RLS 조회로 그 실행(또는 워크플로우)과 버전이 보이는 것을 확인한 <b>뒤에만</b> 부른다 — 캐시는 테넌트를 모르므로, 보이지 않는 버전 id
 *       로 꺼내면 남의 모델이 새어 나간다(설계 §11).
 *   <li>상한 {@link #MAX_ENTRIES} 개, 가장 오래 쓰지 않은 것부터 버린다.
 *   <li>{@link WorkflowModel} 의 nodes·outcomes 는 가변 맵이라 담은 것을 그대로 내주지 않고 매번 사본을 준다(한 요청이 바꿔도 다른 요청이
 *       흔들리지 않게).
 * </ul>
 */
@Component
public class WorkflowModelCache {

  /** 담아 둘 버전 수 상한. */
  static final int MAX_ENTRIES = 500;

  /** 접근 순서 LRU — 모든 접근을 이 객체로 직렬화한다. */
  private final Map<Long, WorkflowModel> cache =
      new LinkedHashMap<>(64, 0.75f, true) {
        @Override
        protected boolean removeEldestEntry(Map.Entry<Long, WorkflowModel> eldest) {
          return size() > MAX_ENTRIES;
        }
      };

  /**
   * 버전의 모델 사본.
   *
   * @param versionId RLS 로 보이는 것이 확인된 버전 id
   * @param modelJson 캐시에 없을 때 읽을 모델 JSON(부르는 쪽 트랜잭션에서 RLS 로 읽는다)
   */
  public WorkflowModel get(long versionId, Supplier<String> modelJson) {
    WorkflowModel cached;
    synchronized (cache) {
      cached = cache.get(versionId);
    }
    if (cached == null) {
      // 해석은 잠금 밖에서 — 같은 버전을 동시에 두 번 해석해도 결과가 같아 먼저 넣은 것을 쓰면 된다.
      WorkflowModel parsed = WorkflowModelJson.read(modelJson.get());
      synchronized (cache) {
        cached = cache.computeIfAbsent(versionId, id -> parsed);
      }
    }
    return copy(cached);
  }

  /** 담은 수(시험용). */
  int size() {
    synchronized (cache) {
      return cache.size();
    }
  }

  /** 노드마다 새 Node 로 다시 만든 사본 — Node 생성자가 outcomes 맵을 새로 복사하고, 나머지 칸은 불변 값이다. */
  static WorkflowModel copy(WorkflowModel m) {
    LinkedHashMap<String, Node> nodes = new LinkedHashMap<>();
    m.nodes()
        .forEach(
            (key, n) ->
                nodes.put(
                    key,
                    new Node(
                        n.key(),
                        n.type(),
                        n.name(),
                        n.roleKey(),
                        n.instructions(),
                        n.use(),
                        n.requires(),
                        n.outputs(),
                        n.outcomes(),
                        n.conditions(),
                        n.defaultTo(),
                        n.maxVisits(),
                        n.timeout(),
                        n.onError(),
                        n.returnTo())));
    return new WorkflowModel(
        m.schema(), m.name(), m.roles(), m.shared(), nodes, m.start(), m.layout());
  }
}
