package com.workplace.issue.repository;

import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import org.jooq.Condition;
import org.jooq.Field;

/**
 * 복합 정렬 키 keyset 페이징 도우미 — 커서 행 "다음" 조건을 정렬 키와 같은 키·방향으로 만든다. AI 위임 작업 목록({@link
 * AiTaskRepository})과 /me/issues 프로젝트 묶음 정렬({@link MeIssueGroupedRepository})이 같은 규칙을 쓰도록 한 곳에
 * 둔다(WP-915 에서 AiTaskRepository 에서 옮김).
 */
final class KeysetSeek {

  private KeysetSeek() {}

  /** seek 정렬 키 하나 — 필드·커서 값·방향. */
  record SeekKey<T>(Field<T> field, T value, boolean desc) {
    static <T> SeekKey<T> asc(Field<T> f, T v) {
      return new SeekKey<>(f, v, false);
    }

    static <T> SeekKey<T> desc(Field<T> f, T v) {
      return new SeekKey<>(f, v, true);
    }

    /** 이 키에서 커서 행보다 "뒤"(ASC 면 큼, DESC 면 작음). */
    Condition beyond() {
      return desc ? field.lt(value) : field.gt(value);
    }

    /** 이 키에서 커서 행과 같음 — 다음 키로 동률을 깬다. */
    Condition same() {
      return field.eq(value);
    }
  }

  /**
   * 커서 행 다음 행 조건 — 정렬 키를 사전식으로 비교한다: k1 뒤 OR (k1 같음 AND (k2 뒤 OR (k2 같음 AND …))). 방향이 섞인 키에도 맞다(행 값
   * 비교 (a,b) &gt; (x,y) 는 방향이 모두 같을 때만 쓸 수 있다). 키 값에 NULL 이 있으면 안 된다(lt·eq 가 NULL 이 된다).
   */
  static Condition after(List<SeekKey<?>> keys) {
    Condition c = keys.get(keys.size() - 1).beyond();
    for (int i = keys.size() - 2; i >= 0; i--) {
      SeekKey<?> k = keys.get(i);
      c = k.beyond().or(k.same().and(c));
    }
    return c;
  }

  /** 커서 시각(Instant) → timestamptz 비교 값. 마이크로초 그대로. */
  static OffsetDateTime utc(Instant t) {
    return t.atOffset(ZoneOffset.UTC);
  }
}
