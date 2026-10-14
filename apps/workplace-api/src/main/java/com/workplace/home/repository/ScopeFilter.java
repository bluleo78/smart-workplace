package com.workplace.home.repository;

import static com.workplace.jooq.Tables.AI_MEMORY;

import java.util.List;
import org.jooq.Condition;
import org.jooq.impl.DSL;

/**
 * 메모리 범위 필터(WP-383) — 채팅은 공통 + 지금 앱, 검색은 전부·공통·앱 하나. 공통은 {@code scope IS NULL} 이다(eq(null) 금지 —
 * AiMemoryRepository.inScope 와 같은 이유).
 *
 * @param common 공통(scope NULL)을 넣는가
 * @param apps 넣을 앱 코드 — null 이면 앱 전부, 빈 목록이면 앱 없음. 코드 검증은 호출자(AiMemoryScope)가 한다
 */
public record ScopeFilter(boolean common, List<String> apps) {

  /** 모든 범위(검색 ALL). */
  public static final ScopeFilter ALL = new ScopeFilter(true, null);

  /** 채팅·다른 진입점 — 공통 + 지금 앱(없으면 공통만, 판정: 홈은 공통만). */
  public static ScopeFilter chat(String app) {
    return new ScopeFilter(true, app == null ? List.of() : List.of(app));
  }

  /** 공통만(검색 COMMON). */
  public static ScopeFilter commonOnly() {
    return new ScopeFilter(true, List.of());
  }

  /** 앱 하나만(검색 scope=ISSUE 등). */
  public static ScopeFilter app(String app) {
    return new ScopeFilter(false, List.of(app));
  }

  /** jOOQ 조건 — 같은 패키지의 저장소만 쓴다. */
  Condition condition() {
    if (apps == null) return common ? DSL.noCondition() : AI_MEMORY.SCOPE.isNotNull();
    Condition c = common ? AI_MEMORY.SCOPE.isNull() : DSL.falseCondition();
    return apps.isEmpty() ? c : c.or(AI_MEMORY.SCOPE.in(apps));
  }
}
