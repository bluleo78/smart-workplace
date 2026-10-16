package com.workplace.home.repository;

import static com.workplace.jooq.Tables.AI_MEMORY_CHANGE;
import static com.workplace.jooq.Tables.AI_MEMORY_FORGOTTEN;
import static com.workplace.jooq.Tables.HOME_SESSION;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.home.repository.AiMemoryRepository.NewMemory;
import com.workplace.home.repository.AiMemoryRepository.Row;
import com.workplace.home.service.HomeSessionService;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.core.io.ClassPathResource;
import org.springframework.transaction.annotation.Transactional;

/**
 * WP-385 V179 — 새 메모리의 사용 시각, 배포 직후 과거 대화를 정리하지 않게 하는 경계 채움, 새 표 두 개의 테넌트 RLS. 경계 채움은 Flyway 가 이미
 * 돌았으므로 마이그레이션 파일의 마커 사이 문장을 시드 위에 다시 돌려 본다(같은 문장을 테스트한다).
 */
@Transactional
class AiMemoryCleanupMigrationTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired AiMemoryRepository repo;
  @Autowired HomeSessionService sessions;

  /** V179 의 경계 채움 문장 — `-- @wp385-backfill-begin` 과 `-- @wp385-backfill-end` 사이(끝 세미콜론 제외). */
  private static String backfillSql() throws IOException {
    String all =
        new ClassPathResource("db/migration/V179__ai_memory_cleanup.sql")
            .getContentAsString(StandardCharsets.UTF_8);
    int begin = all.indexOf("-- @wp385-backfill-begin");
    int end = all.indexOf("-- @wp385-backfill-end");
    String body = all.substring(all.indexOf('\n', begin) + 1, end).strip();
    return body.endsWith(";") ? body.substring(0, body.length() - 1) : body;
  }

  private Long processed(UUID sessionId) {
    return dsl.select(HOME_SESSION.MEMORY_PROCESSED_MESSAGE_ID)
        .from(HOME_SESSION)
        .where(HOME_SESSION.ID.eq(sessionId))
        .fetchOne(HOME_SESSION.MEMORY_PROCESSED_MESSAGE_ID);
  }

  /** 트랜잭션-로컬 GUC 직접 설정(AiMemoryRlsTest 와 같은 방식). */
  private void setGuc(long tenantId) {
    dsl.execute("SELECT set_config('app.tenant_id', '" + tenantId + "', true)");
  }

  @Test
  void 새_메모리의_사용_시각은_만든_시각과_같다() {
    long uid = TestFixtures.createHuman(dsl);
    Row r = repo.insert(uid, new NewMemory("PREFERENCE", "짧게 답한다", "AI", null, null, null));
    assertThat(r.lastUsedAt()).isEqualTo(r.createdAt());
  }

  @Test
  void 새_세션은_경계가_비어_있고_실패_횟수는_0_이다() {
    long uid = TestFixtures.createHuman(dsl);
    UUID sid = sessions.create(uid).id();
    assertThat(processed(sid)).isNull();
    assertThat(
            dsl.select(HOME_SESSION.MEMORY_CLEANUP_FAILURES)
                .from(HOME_SESSION)
                .where(HOME_SESSION.ID.eq(sid))
                .fetchOne(HOME_SESSION.MEMORY_CLEANUP_FAILURES))
        .isEqualTo((short) 0);
  }

  @Test
  void 경계_채움은_세션마다_마지막_메시지_id_로_채우고_메시지_없는_세션은_비운다() throws IOException {
    long uid = TestFixtures.createHuman(dsl);
    UUID withMessages = sessions.create(uid).id();
    sessions.appendMessage(uid, withMessages, "USER", "질문", null, null, null);
    long last = sessions.appendMessage(uid, withMessages, "ASSISTANT", "답", null, null, null);
    UUID empty = sessions.create(uid).id();

    dsl.execute(backfillSql());

    assertThat(processed(withMessages)).isEqualTo(last);
    assertThat(processed(empty)).isNull();
  }

  @Test
  void 정리_기록과_지운_기록은_다른_테넌트에서_보이지_않는다() {
    long tid2 = TestFixtures.createTenant(dsl, "ACTIVE");
    long uid = TestFixtures.createHuman(dsl);
    setGuc(tid2);
    dsl.insertInto(AI_MEMORY_CHANGE)
        .set(AI_MEMORY_CHANGE.USER_ID, uid)
        .set(AI_MEMORY_CHANGE.RUN_ID, UUID.randomUUID())
        .set(AI_MEMORY_CHANGE.ACTION, "ADDED")
        .set(AI_MEMORY_CHANGE.MEMORY_ID, 1L)
        .execute();
    dsl.insertInto(AI_MEMORY_FORGOTTEN)
        .set(AI_MEMORY_FORGOTTEN.USER_ID, uid)
        .set(AI_MEMORY_FORGOTTEN.CONTENT, "잊은 것")
        .set(AI_MEMORY_FORGOTTEN.NORMALIZED, "잊은것")
        .execute();
    assertThat(dsl.fetchCount(AI_MEMORY_CHANGE, AI_MEMORY_CHANGE.USER_ID.eq(uid))).isEqualTo(1);
    assertThat(dsl.fetchCount(AI_MEMORY_FORGOTTEN, AI_MEMORY_FORGOTTEN.USER_ID.eq(uid)))
        .isEqualTo(1);

    setGuc(1L);
    assertThat(dsl.fetchCount(AI_MEMORY_CHANGE, AI_MEMORY_CHANGE.USER_ID.eq(uid))).isZero();
    assertThat(dsl.fetchCount(AI_MEMORY_FORGOTTEN, AI_MEMORY_FORGOTTEN.USER_ID.eq(uid))).isZero();
  }
}
