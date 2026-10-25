package com.workplace.issue.service;

import com.workplace.issue.dto.IssueRelationTypeRow;
import com.workplace.issue.repository.IssueRelationTypeRepository;
import java.util.Comparator;
import java.util.Map;
import java.util.function.Function;
import java.util.function.ToLongFunction;
import java.util.stream.Collectors;

/**
 * 이슈 상세의 관계 목록·외부 링크 목록이 함께 쓰는 정렬(WP-887) — 유형 정렬값 → 이 이슈 쪽 말. 그 뒤 순서(상대 키 등)는 목록마다 다르므로 부르는 쪽이
 * {@code thenComparing} 으로 잇는다. 두 목록이 같은 순서로 보여야 레일의 묶음 순서가 어긋나지 않는다.
 */
final class RelationListOrder {

  private RelationListOrder() {}

  /** 유형 id → 유형 — 목록 한 번에 한 번만 읽는다(유형은 워크스페이스에 수십 개뿐). */
  static Map<Long, IssueRelationTypeRow> typesById(IssueRelationTypeRepository repo) {
    return repo.findAll().stream()
        .collect(Collectors.toMap(IssueRelationTypeRow::id, Function.identity()));
  }

  /**
   * 유형 정렬값 → 말 순 비교기. 말은 늘 있어야 하지만(방향 있는 유형의 B 쪽은 inwardLabel 필수 — B 쪽 말 없는 유형은 target 으로 저장하지 않는다)
   * 옛 데이터에 비어 있어도 500 이 나지 않게 null 은 뒤로 둔다.
   */
  static <V> Comparator<V> byTypeThenLabel(
      Map<Long, IssueRelationTypeRow> types, ToLongFunction<V> typeId, Function<V, String> label) {
    return Comparator.<V>comparingInt(v -> types.get(typeId.applyAsLong(v)).sortOrder())
        .thenComparing(label, Comparator.nullsLast(Comparator.naturalOrder()));
  }
}
