package com.workplace.audit.repository;

import static org.assertj.core.api.Assertions.assertThat;
import static org.jooq.impl.DSL.field;
import static org.jooq.impl.DSL.name;
import static org.jooq.impl.DSL.table;

import com.workplace.audit.dto.AuditLogResponse;
import com.workplace.support.IntegrationTestBase;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/**
 * 감사 로그 페이지 조회의 정렬 결정성 (WP-182).
 *
 * <p>웹이 페이지를 이어 붙이는 무한 스크롤로 바뀌어, 같은 action_time 을 가진 행의 순서가 요청마다 달라지면 페이지 경계에서 행이 중복되거나 누락된다.
 * action_time desc 다음에 id desc 로 고정되는지 검증한다.
 */
@Transactional
class AuditLogRepositoryPagingTest extends IntegrationTestBase {

  @Autowired private AuditLogRepository repository;
  @Autowired private DSLContext dsl;

  @Test
  void sameActionTime_pagesAreOrderedByIdDesc_withoutDuplicatesOrGaps() {
    // 이 테스트 행만 고르도록 설명에 고유 태그를 넣는다(다른 테스트가 남긴 로그와 섞이지 않게).
    String tag = "wp182-" + UUID.randomUUID();
    List<Long> ids = new ArrayList<>();
    for (int i = 0; i < 7; i++) {
      ids.add(
          repository.save(
              null, // 시스템 행위 — user FK 없이 저장
              "system",
              "CREATE",
              "issue",
              String.valueOf(i),
              tag + " " + i,
              null,
              null,
              "SUCCESS",
              null,
              null));
    }
    // 모든 행을 같은 시각으로 맞춰 action_time 만으로는 순서가 정해지지 않게 한다.
    dsl.update(table(name("audit_log")))
        .set(field(name("action_time"), LocalDateTime.class), LocalDateTime.of(2026, 10, 2, 9, 0))
        .where(field(name("id"), Long.class).in(ids))
        .execute();

    List<Long> paged = new ArrayList<>();
    for (int page = 0; page < 3; page++) {
      repository.findAll(tag, null, null, null, null, null, null, page, 3).content().stream()
          .map(AuditLogResponse::id)
          .forEach(paged::add);
    }

    assertThat(paged)
        .containsExactlyElementsOf(ids.stream().sorted(Comparator.reverseOrder()).toList());
  }
}
