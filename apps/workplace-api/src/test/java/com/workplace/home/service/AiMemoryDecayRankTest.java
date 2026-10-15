package com.workplace.home.service;

import static com.workplace.jooq.Tables.AI_MEMORY;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.global.ai.AiMemoryLine;
import com.workplace.home.AiMemoryTestFixtures;
import com.workplace.home.repository.AiMemoryRepository;
import com.workplace.home.repository.AiMemoryRepository.NewMemory;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/**
 * WP-385 감쇠 순위 — AI 저장·고정 아님·30일 넘게 안 쓴 행은 최근순(빈 질의) 목록에서 빠지고, 키워드로 맞으면 그대로 들어오며, 메모리 30개 이하면 전부
 * 실린다. 테스트 트랜잭션 안에서 돈다(사용 기록은 커밋 뒤라 돌지 않는다).
 */
@Transactional
class AiMemoryDecayRankTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired AiMemoryService service;
  @Autowired AiMemoryRepository repo;

  /** AI 메모리 1건 — 사용 시각을 daysAgo 일 전으로, 수정 시각은 지금(최신순이면 맨 앞)으로. */
  private long aiMemory(long uid, String content, int daysAgo, boolean pinned) {
    long id = repo.insert(uid, new NewMemory("PREFERENCE", content, "AI", null, null, null)).id();
    if (pinned) repo.setPinned(uid, id, true);
    dsl.update(AI_MEMORY)
        .set(AI_MEMORY.LAST_USED_AT, OffsetDateTime.now(ZoneOffset.UTC).minusDays(daysAgo))
        .where(AI_MEMORY.ID.eq(id))
        .execute();
    return id;
  }

  private static List<String> contents(AiMemoryService.ChatMemories m) {
    return m.items().stream().map(AiMemoryLine::content).toList();
  }

  @Test
  void 서른_개_이하면_감쇠_행도_전부_싣는다() {
    long uid = TestFixtures.createHuman(dsl);
    aiMemory(uid, "오래 안 쓴 메모리", 40, false);
    assertThat(contents(service.loadForChat(uid, null, ""))).contains("오래 안 쓴 메모리");
  }

  /**
   * 감쇠가 아닌 후보 32개 — 새 USER 10개 + 40일 안 쓴 USER 22개(USER 는 감쇠하지 않아 후보에 남는다). 비고정 상위 20 은 새 10개 + 오래된
   * USER 10개로 차므로, 감쇠 행(35일)은 감쇠 필터가 없으면 오래된 USER 보다 최근이라 그 20 안에 들어온다 — 필터가 있어야만 빠진다.
   */
  private void fillFreshAndStaleUser(long uid) {
    AiMemoryTestFixtures.fill(dsl, uid, null, 32);
    List<Long> ids =
        dsl.select(AI_MEMORY.ID)
            .from(AI_MEMORY)
            .where(AI_MEMORY.USER_ID.eq(uid))
            .orderBy(AI_MEMORY.ID)
            .limit(22)
            .fetch(AI_MEMORY.ID);
    dsl.update(AI_MEMORY)
        .set(AI_MEMORY.LAST_USED_AT, OffsetDateTime.now(ZoneOffset.UTC).minusDays(40))
        .where(AI_MEMORY.ID.in(ids))
        .execute();
  }

  @Test
  void 많을_때_빈_질의는_감쇠_행을_빼고_고정은_남긴다() {
    long uid = TestFixtures.createHuman(dsl);
    fillFreshAndStaleUser(uid);
    aiMemory(uid, "오래 안 쓴 AI 메모리", 35, false);
    aiMemory(uid, "오래 안 쓴 고정 메모리", 35, true);

    List<String> got = contents(service.loadForChat(uid, null, ""));

    assertThat(got).doesNotContain("오래 안 쓴 AI 메모리");
    assertThat(got).contains("오래 안 쓴 고정 메모리");
  }

  @Test
  void 많을_때_키워드가_맞으면_감쇠_행도_들어온다() {
    long uid = TestFixtures.createHuman(dsl);
    fillFreshAndStaleUser(uid);
    aiMemory(uid, "고양이 사진은 앨범으로 보여 준다", 35, false);
    aiMemory(uid, "오래 안 쓴 무관한 메모리", 35, false);

    List<String> got = contents(service.loadForChat(uid, null, "고양이 사진 보여줘"));

    assertThat(got).contains("고양이 사진은 앨범으로 보여 준다");
    assertThat(got).doesNotContain("오래 안 쓴 무관한 메모리");
  }
}
