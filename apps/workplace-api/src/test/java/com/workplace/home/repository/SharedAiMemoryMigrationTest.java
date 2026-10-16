package com.workplace.home.repository;

import static com.workplace.jooq.Tables.HOME_MESSAGE;
import static com.workplace.jooq.Tables.SHARED_AI_MEMORY;
import static com.workplace.jooq.Tables.SHARED_AI_MEMORY_CHANGE;
import static com.workplace.jooq.Tables.SHARED_AI_MEMORY_FORGOTTEN;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.home.service.HomeSessionService;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.transaction.annotation.Transactional;

/**
 * WP-386 V180 — 공용 메모리 표 셋의 테넌트 RLS·CHECK 제약, home_message 의 공간 컬럼(기존 메시지는 비어 있다). RLS 는
 * AiMemoryCleanupMigrationTest 와 같이 트랜잭션-로컬 GUC 를 바꿔 본다.
 */
@Transactional
class SharedAiMemoryMigrationTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired HomeSessionService sessions;

  /** 트랜잭션-로컬 GUC 직접 설정. */
  private void setGuc(long tenantId) {
    dsl.execute("SELECT set_config('app.tenant_id', '" + tenantId + "', true)");
  }

  /**
   * 제약 위반 insert 를 savepoint 안에서 실행해 그 제약 이름으로 거절되는지 확인한다. Postgres 는 오류가 난 트랜잭션을 중단시키므로 savepoint
   * 로 되돌리지 않으면 다음 단언이 "transaction is aborted" 로 엉뚱하게 실패(또는 엉뚱한 이유로 통과)한다.
   */
  private void assertRejected(String constraint, Runnable insert) {
    dsl.execute("SAVEPOINT before_reject");
    assertThatThrownBy(insert::run)
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining(constraint);
    dsl.execute("ROLLBACK TO SAVEPOINT before_reject");
  }

  @Test
  void 공용_표_셋은_다른_테넌트에서_보이지_않는다() {
    long tid2 = TestFixtures.createTenant(dsl, "ACTIVE");
    setGuc(tid2);
    dsl.insertInto(SHARED_AI_MEMORY)
        .set(SHARED_AI_MEMORY.SPACE_TYPE, "PROJECT")
        .set(SHARED_AI_MEMORY.SPACE_ID, 777L)
        .set(SHARED_AI_MEMORY.CONTENT, "배포는 API 먼저 한다")
        .set(SHARED_AI_MEMORY.ORIGIN, "USER_ADDED")
        .execute();
    dsl.insertInto(SHARED_AI_MEMORY_CHANGE)
        .set(SHARED_AI_MEMORY_CHANGE.SPACE_TYPE, "PROJECT")
        .set(SHARED_AI_MEMORY_CHANGE.SPACE_ID, 777L)
        .set(SHARED_AI_MEMORY_CHANGE.ACTION, "ADDED")
        .set(SHARED_AI_MEMORY_CHANGE.ACTOR_KIND, "AI")
        .set(SHARED_AI_MEMORY_CHANGE.MEMORY_ID, 1L)
        .execute();
    dsl.insertInto(SHARED_AI_MEMORY_FORGOTTEN)
        .set(SHARED_AI_MEMORY_FORGOTTEN.SPACE_TYPE, "PROJECT")
        .set(SHARED_AI_MEMORY_FORGOTTEN.SPACE_ID, 777L)
        .set(SHARED_AI_MEMORY_FORGOTTEN.CONTENT, "잊은 것")
        .set(SHARED_AI_MEMORY_FORGOTTEN.NORMALIZED, "잊은것")
        .execute();
    assertThat(dsl.fetchCount(SHARED_AI_MEMORY, SHARED_AI_MEMORY.SPACE_ID.eq(777L))).isEqualTo(1);
    assertThat(dsl.fetchCount(SHARED_AI_MEMORY_CHANGE, SHARED_AI_MEMORY_CHANGE.SPACE_ID.eq(777L)))
        .isEqualTo(1);
    assertThat(
            dsl.fetchCount(
                SHARED_AI_MEMORY_FORGOTTEN, SHARED_AI_MEMORY_FORGOTTEN.SPACE_ID.eq(777L)))
        .isEqualTo(1);

    setGuc(1L);
    assertThat(dsl.fetchCount(SHARED_AI_MEMORY, SHARED_AI_MEMORY.SPACE_ID.eq(777L))).isZero();
    assertThat(dsl.fetchCount(SHARED_AI_MEMORY_CHANGE, SHARED_AI_MEMORY_CHANGE.SPACE_ID.eq(777L)))
        .isZero();
    assertThat(
            dsl.fetchCount(
                SHARED_AI_MEMORY_FORGOTTEN, SHARED_AI_MEMORY_FORGOTTEN.SPACE_ID.eq(777L)))
        .isZero();
  }

  @Test
  void 조직은_공간_id_가_없어야_하고_다른_범위는_있어야_한다() {
    assertRejected(
        "ck_shared_ai_memory_space",
        () ->
            dsl.insertInto(SHARED_AI_MEMORY)
                .set(SHARED_AI_MEMORY.SPACE_TYPE, "ORG")
                .set(SHARED_AI_MEMORY.SPACE_ID, 1L)
                .set(SHARED_AI_MEMORY.CONTENT, "x")
                .set(SHARED_AI_MEMORY.ORIGIN, "USER_ADDED")
                .execute());
    assertRejected(
        "ck_shared_ai_memory_space",
        () ->
            dsl.insertInto(SHARED_AI_MEMORY)
                .set(SHARED_AI_MEMORY.SPACE_TYPE, "PROJECT")
                .set(SHARED_AI_MEMORY.CONTENT, "x")
                .set(SHARED_AI_MEMORY.ORIGIN, "USER_ADDED")
                .execute());
    // 알 수 없는 범위도 막는다(개인 메모리는 이 표에 두지 않는다).
    assertRejected(
        "ck_shared_ai_memory_space",
        () ->
            dsl.insertInto(SHARED_AI_MEMORY)
                .set(SHARED_AI_MEMORY.SPACE_TYPE, "PERSONAL")
                .set(SHARED_AI_MEMORY.SPACE_ID, 1L)
                .set(SHARED_AI_MEMORY.CONTENT, "x")
                .set(SHARED_AI_MEMORY.ORIGIN, "USER_ADDED")
                .execute());
  }

  @Test
  void 모르는_출처와_동작은_막는다() {
    assertRejected(
        "ck_shared_ai_memory_origin",
        () ->
            dsl.insertInto(SHARED_AI_MEMORY)
                .set(SHARED_AI_MEMORY.SPACE_TYPE, "ORG")
                .set(SHARED_AI_MEMORY.CONTENT, "x")
                .set(SHARED_AI_MEMORY.ORIGIN, "SOMEONE")
                .execute());
    assertRejected(
        "ck_shared_ai_memory_change_action",
        () ->
            dsl.insertInto(SHARED_AI_MEMORY_CHANGE)
                .set(SHARED_AI_MEMORY_CHANGE.SPACE_TYPE, "ORG")
                .set(SHARED_AI_MEMORY_CHANGE.ACTION, "FORGOTTEN")
                .set(SHARED_AI_MEMORY_CHANGE.ACTOR_KIND, "AI")
                .set(SHARED_AI_MEMORY_CHANGE.MEMORY_ID, 1L)
                .execute());
    assertRejected(
        "ck_shared_ai_memory_change_actor",
        () ->
            dsl.insertInto(SHARED_AI_MEMORY_CHANGE)
                .set(SHARED_AI_MEMORY_CHANGE.SPACE_TYPE, "ORG")
                .set(SHARED_AI_MEMORY_CHANGE.ACTION, "ADDED")
                .set(SHARED_AI_MEMORY_CHANGE.ACTOR_KIND, "ROBOT")
                .set(SHARED_AI_MEMORY_CHANGE.MEMORY_ID, 1L)
                .execute());
  }

  @Test
  void 새_메시지의_공간은_비어_있다() {
    long uid = TestFixtures.createHuman(dsl);
    UUID sid = sessions.create(uid).id();
    long mid = sessions.appendMessage(uid, sid, "USER", "질문", null, null, null);
    var r =
        dsl.select(HOME_MESSAGE.SPACE_TYPE, HOME_MESSAGE.SPACE_ID)
            .from(HOME_MESSAGE)
            .where(HOME_MESSAGE.ID.eq(mid))
            .fetchOne();
    assertThat(r.value1()).isNull();
    assertThat(r.value2()).isNull();
  }

  /** 공용 메모리 표의 컬럼 이름 집합 — information_schema 에서 읽는다. */
  private java.util.List<String> columnsOf(String table) {
    return dsl.fetch(
            "SELECT column_name FROM information_schema.columns "
                + "WHERE table_schema = current_schema() AND table_name = ?",
            table)
        .getValues(0, String.class);
  }

  /**
   * 개인정보 규칙 — 대화에서 뽑힌 공용 메모리 행에는 발화자·세션·메시지 id 를 어디에도 남기지 않는다. 컬럼 집합을 정확히 고정해, 나중에 그런
   * 컬럼(session_id·message_id·speaker 등)이 더해지면 이 테스트가 깨지게 한다.
   */
  @Test
  void 공용_표에는_발화자_세션_메시지_열이_없다() {
    assertThat(columnsOf("shared_ai_memory"))
        .containsExactlyInAnyOrder(
            "id",
            "tenant_id",
            "space_type",
            "space_id",
            "content",
            "origin",
            "author_user_id",
            "created_at",
            "updated_at",
            "updated_by",
            "search_tv",
            "embedding");
    assertThat(columnsOf("shared_ai_memory_change"))
        .containsExactlyInAnyOrder(
            "id",
            "tenant_id",
            "space_type",
            "space_id",
            "run_id",
            "action",
            "actor_user_id",
            "actor_kind",
            "memory_id",
            "before",
            "after",
            "created_at",
            "undone_at",
            "undone_by");
    assertThat(columnsOf("shared_ai_memory_forgotten"))
        .containsExactlyInAnyOrder(
            "id",
            "tenant_id",
            "space_type",
            "space_id",
            "content",
            "normalized",
            "embedding",
            "created_at");
  }
}
