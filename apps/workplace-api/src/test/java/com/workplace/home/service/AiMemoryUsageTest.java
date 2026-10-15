package com.workplace.home.service;

import static com.workplace.jooq.Tables.AI_MEMORY;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.global.ai.AiMemoryReader;
import com.workplace.global.tenant.TenantContext;
import com.workplace.home.repository.AiMemoryRepository;
import com.workplace.home.repository.AiMemoryRepository.NewMemory;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.time.Duration;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.Executor;
import java.util.function.Supplier;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * WP-385 사용 시각 — 홈 채팅 블록·search_memory 결과·다른 진입점에 실린 메모리는 last_used_at 이 오르고(updated_at 은 그대로), 1시간
 * 안에 다시 쓰면 생략하며, 배경 정리의 비교 대상 조회는 사용으로 치지 않는다. 갱신은 커밋 뒤 비동기라 실행기를 호출 스레드로 바꾸고, 갱신이 다른 커넥션에서 보이도록
 * 트랜잭션 없이(커밋) 돌린다.
 */
class AiMemoryUsageTest extends IntegrationTestBase {

  @Autowired AiMemoryService service;
  @Autowired AiMemoryRepository repo;
  @Autowired AiMemoryUsageRecorder usage;
  @Autowired AiMemoryReader reader;
  @Autowired AiMemorySelector selector;

  private final List<Long> users = new ArrayList<>();
  private Executor previous;

  @BeforeEach
  void setUp() {
    previous = usage.useExecutorForTest(Runnable::run);
    TenantContext.set(1L);
  }

  @AfterEach
  void tearDown() {
    usage.useExecutorForTest(previous);
    cleanupInTenant(
        1L, () -> baseDsl.deleteFrom(AI_MEMORY).where(AI_MEMORY.USER_ID.in(users)).execute());
    baseDsl.deleteFrom(USER).where(USER.ID.in(users)).execute();
    TenantContext.clear();
  }

  private <T> T inTenant(Supplier<T> work) {
    return new TransactionTemplate(txManager).execute(s -> work.get());
  }

  private long user() {
    long uid = TestFixtures.createHuman(baseDsl);
    users.add(uid);
    return uid;
  }

  /** 메모리 1건 — 사용 시각을 usedAgo 전으로 돌려 둔다(1시간 생략 규칙에 걸리지 않게). */
  private long seed(long uid, String content, Duration usedAgo) {
    long id =
        inTenant(
            () ->
                repo.insert(uid, new NewMemory("PREFERENCE", content, "AI", null, null, null))
                    .id());
    OffsetDateTime past = OffsetDateTime.now(ZoneOffset.UTC).minus(usedAgo);
    inTenant(
        () ->
            baseDsl
                .update(AI_MEMORY)
                .set(AI_MEMORY.LAST_USED_AT, past)
                .set(AI_MEMORY.UPDATED_AT, past)
                .where(AI_MEMORY.ID.eq(id))
                .execute());
    return id;
  }

  private OffsetDateTime lastUsed(long id) {
    return inTenant(
        () ->
            baseDsl
                .select(AI_MEMORY.LAST_USED_AT)
                .from(AI_MEMORY)
                .where(AI_MEMORY.ID.eq(id))
                .fetchOne(AI_MEMORY.LAST_USED_AT));
  }

  private OffsetDateTime updated(long id) {
    return inTenant(
        () ->
            baseDsl
                .select(AI_MEMORY.UPDATED_AT)
                .from(AI_MEMORY)
                .where(AI_MEMORY.ID.eq(id))
                .fetchOne(AI_MEMORY.UPDATED_AT));
  }

  @Test
  void 채팅에_실린_메모리는_사용_시각이_오르고_수정_시각은_그대로다() {
    long uid = user();
    long id = seed(uid, "이슈 목록은 짧게 보여 준다", Duration.ofHours(2));
    OffsetDateTime before = lastUsed(id);
    OffsetDateTime editedAt = updated(id);

    service.loadForChat(uid, null, "이슈 보여줘");

    assertThat(lastUsed(id)).isAfter(before);
    assertThat(updated(id)).isEqualTo(editedAt);
  }

  @Test
  void search_memory_결과도_사용으로_친다() {
    long uid = user();
    long id = seed(uid, "주간 보고서는 표로 정리한다", Duration.ofHours(2));
    OffsetDateTime before = lastUsed(id);

    service.search(uid, "보고서", null, null);

    assertThat(lastUsed(id)).isAfter(before);
  }

  @Test
  void 다른_진입점에_실린_메모리도_사용으로_친다() {
    long uid = user();
    long id = seed(uid, "노트는 개조식으로 쓴다", Duration.ofHours(2));
    OffsetDateTime before = lastUsed(id);

    reader.readForEntry(uid, AiMemoryReader.WIKI, "회의록 정리");

    assertThat(lastUsed(id)).isAfter(before);
  }

  @Test
  void 한_시간_안에_다시_쓰면_갱신하지_않는다() {
    long uid = user();
    long id = seed(uid, "답은 존댓말로 한다", Duration.ofMinutes(10));
    OffsetDateTime before = lastUsed(id);

    service.loadForChat(uid, null, "안녕");

    assertThat(lastUsed(id)).isEqualTo(before);
  }

  @Test
  void 배경_정리_비교_대상_조회는_사용으로_치지_않는다() {
    long uid = user();
    long id = seed(uid, "배포는 API 먼저 한다", Duration.ofHours(2));
    OffsetDateTime before = lastUsed(id);

    List<AiMemoryRepository.Row> related =
        selector.related(
            uid, "배포 순서", LocalDate.now(AiMemoryClock.ZONE), Duration.ofMillis(100), 20);

    assertThat(related).extracting(AiMemoryRepository.Row::id).contains(id);
    assertThat(lastUsed(id)).isEqualTo(before);
  }
}
