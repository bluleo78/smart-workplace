package com.workplace.global.exception;

import org.jooq.exception.IntegrityConstraintViolationException;
import org.springframework.dao.DuplicateKeyException;

/**
 * jOOQ 무결성 위반 중 「이름 유일 인덱스 위반」만 {@link DuplicateKeyException}(서비스가 409 이름 중복으로 바꾼다)으로 옮기는 공용
 * 규칙(WP-1393). 그 밖의 위반(FK·CHECK 등 — 동시에 지워진 프로젝트 등)은 이름 중복으로 잘못 알리지 않도록 그대로 돌려준다.
 *
 * <p>버전·사이클이 같은 규칙을 따로 갖던 것을 한곳에 모았다. 라벨·마일스톤 등 다른 저장소는 아직 모든 무결성 위반을 이름 중복으로 바꾼다 — 옮기면 FK·CHECK
 * 위반의 응답이 409 에서 바뀌므로 각자 테스트와 함께 옮긴다.
 */
public final class UniqueViolations {

  /** 유일 제약 위반의 PostgreSQL SQLState. */
  public static final String UNIQUE_VIOLATION = "23505";

  private UniqueViolations() {}

  /**
   * 위반이 {@code constraintName} 유일 인덱스의 것이면 {@code message} 로 DuplicateKeyException 을, 아니면 원래 예외를
   * 돌려준다 — 호출 쪽은 {@code throw UniqueViolations.asDuplicateOr(e, …)} 로 쓴다. 제약 이름까지 보는 것은 같은 테이블에 다른
   * 유일 제약이 생겨도 그 위반을 이 이름 중복으로 오인하지 않게 하려는 것이다.
   */
  public static RuntimeException asDuplicateOr(
      IntegrityConstraintViolationException e, String constraintName, String message) {
    String msg = e.getMessage();
    if (UNIQUE_VIOLATION.equals(e.sqlState()) && msg != null && msg.contains(constraintName)) {
      return new DuplicateKeyException(message, e);
    }
    return e;
  }
}
