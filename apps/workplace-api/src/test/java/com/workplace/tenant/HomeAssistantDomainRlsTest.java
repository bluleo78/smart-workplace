package com.workplace.tenant;

import static com.workplace.jooq.Tables.ASSISTANT_CONFIG;
import static com.workplace.jooq.Tables.HOME_MESSAGE;
import static com.workplace.jooq.Tables.HOME_SESSION;
import static com.workplace.jooq.Tables.TENANT;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.auth.repository.WorkspaceAssistantRepository;
import com.workplace.support.IntegrationTestBase;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * V65/V66 home AI / assistant 도메인 RLS 격리 증명.
 *
 * <p>대상 4테이블: home_session / home_message / assistant_config / workspace_assistant.
 *
 * <p>전체를 롤백되는 단일 트랜잭션으로 수행 → 공유 DB 무오염 (app_tenant 는 tenant 행 DELETE 불가, V46; 롤백으로 미커밋
 * tenant/user/home·assistant 행 모두 사라짐).
 *
 * <p>마스킹 주의: application-test.yml 이 세션 GUC app.tenant_id=1 을 풀 커넥션마다 고정하므로, tenant#1 만 쓰는 격리 테스트는
 * 버그가 있어도 거짓-통과한다. 따라서 신규 tenant#2 를 트랜잭션 내에 삽입하고 setGuc(...) 로 트랜잭션-로컬 GUC 를 전환해 검증한다. 삽입 시
 * tenant_id 는 설정하지 않고 GUC DEFAULT 가 채우게 둔다 (생성된 jOOQ baseline 에는 해당 테이블들의 tenant_id 필드가 없어 의존할 수도
 * 없다).
 */
class HomeAssistantDomainRlsTest extends IntegrationTestBase {

  @Autowired private DSLContext dsl;
  @Autowired private PlatformTransactionManager txManager;
  @Autowired private WorkspaceAssistantRepository workspaceRepo;

  /** tenant#2 GUC 로 삽입한 home_session 은 tenant#1 컨텍스트에서 비가시. */
  @Test
  void homeSession_isolatedAcrossTenants() {
    new TransactionTemplate(txManager)
        .execute(
            status -> {
              Long tid2 = insertTenant("rls-hs");
              Long userId = insertUser("rls-hs");

              setGuc(tid2);
              // home_session 삽입 — tenant_id 는 GUC DEFAULT(tid2)로 자동 세팅
              UUID sessionId =
                  dsl.insertInto(HOME_SESSION)
                      .set(HOME_SESSION.USER_ID, userId)
                      .set(HOME_SESSION.TITLE, "rls-home-session")
                      .returning(HOME_SESSION.ID)
                      .fetchOne()
                      .getId();

              // tid2 컨텍스트에서는 가시
              assertThat(
                      dsl.fetchCount(
                          dsl.selectFrom(HOME_SESSION).where(HOME_SESSION.ID.eq(sessionId))))
                  .isEqualTo(1);

              // tenant#1 컨텍스트 → 비가시 (RLS USING 차단)
              setGuc(1L);
              assertThat(
                      dsl.fetchCount(
                          dsl.selectFrom(HOME_SESSION).where(HOME_SESSION.ID.eq(sessionId))))
                  .isZero();

              status.setRollbackOnly();
              return null;
            });
  }

  /** tenant#2 GUC 로 삽입한 home_message 는 tenant#1 컨텍스트에서 비가시. */
  @Test
  void homeMessage_isolatedAcrossTenants() {
    new TransactionTemplate(txManager)
        .execute(
            status -> {
              Long tid2 = insertTenant("rls-hm");
              Long userId = insertUser("rls-hm");

              setGuc(tid2);
              UUID sessionId =
                  dsl.insertInto(HOME_SESSION)
                      .set(HOME_SESSION.USER_ID, userId)
                      .returning(HOME_SESSION.ID)
                      .fetchOne()
                      .getId();

              // home_message 삽입 — tenant_id 는 GUC DEFAULT(tid2)로 자동 세팅
              Long msgId =
                  dsl.insertInto(HOME_MESSAGE)
                      .set(HOME_MESSAGE.SESSION_ID, sessionId)
                      .set(HOME_MESSAGE.ROLE, "USER")
                      .set(HOME_MESSAGE.CONTENT, "rls-home-message")
                      .returning(HOME_MESSAGE.ID)
                      .fetchOne()
                      .getId();

              // tid2 컨텍스트에서는 가시
              assertThat(
                      dsl.fetchCount(dsl.selectFrom(HOME_MESSAGE).where(HOME_MESSAGE.ID.eq(msgId))))
                  .isEqualTo(1);

              // tenant#1 컨텍스트 → 비가시
              setGuc(1L);
              assertThat(
                      dsl.fetchCount(dsl.selectFrom(HOME_MESSAGE).where(HOME_MESSAGE.ID.eq(msgId))))
                  .isZero();

              status.setRollbackOnly();
              return null;
            });
  }

  /** tenant#2 GUC 로 삽입한 assistant_config 는 tenant#1 컨텍스트에서 비가시. */
  @Test
  void assistantConfig_isolatedAcrossTenants() {
    new TransactionTemplate(txManager)
        .execute(
            status -> {
              Long tid2 = insertTenant("rls-ac");
              Long agentId = insertUser("rls-ac"); // PK=agent_user_id 로 쓸 전역 user

              setGuc(tid2);
              // assistant_config 삽입 — tenant_id 는 GUC DEFAULT(tid2)로 자동 세팅
              dsl.insertInto(ASSISTANT_CONFIG)
                  .set(ASSISTANT_CONFIG.AGENT_USER_ID, agentId)
                  .set(ASSISTANT_CONFIG.MODEL, "claude-opus-4-8")
                  .execute();

              // tid2 컨텍스트에서는 가시
              assertThat(
                      dsl.fetchCount(
                          dsl.selectFrom(ASSISTANT_CONFIG)
                              .where(ASSISTANT_CONFIG.AGENT_USER_ID.eq(agentId))))
                  .isEqualTo(1);

              // tenant#1 컨텍스트 → 비가시
              setGuc(1L);
              assertThat(
                      dsl.fetchCount(
                          dsl.selectFrom(ASSISTANT_CONFIG)
                              .where(ASSISTANT_CONFIG.AGENT_USER_ID.eq(agentId))))
                  .isZero();

              status.setRollbackOnly();
              return null;
            });
  }

  /**
   * 헤드라인 증명: workspace_assistant 는 더 이상 싱글톤이 아니라 "테넌트당 1행" 이다.
   *
   * <p>tenant#1 GUC 에서 한 행을 삽입(id 생략 → DEFAULT 1, tenant_id 생략 → DEFAULT 1)한 뒤, tenant#2 GUC 에서 또 한
   * 행을 삽입(id 또 DEFAULT 1, tenant_id DEFAULT tid2)한다. 두 번째 INSERT 가 id=1 행이 이미 존재함에도 예외 없이 성공한다는 사실이
   * 곧 증명이다 — 구(舊) 스키마(PK=id, CHECK id=1)였다면 unique 위반으로 실패했을 것이다.
   *
   * <p>그 뒤 각 행이 자기 테넌트 GUC 에서만 보임을(app_tenant RLS) 단언한다. 두 행을 동시에 볼 수는 없는 게 정상이다 — "두 INSERT 모두 성공
   * + 각자 자기 GUC 에서만 가시" 가 완전한 증명이다. 추가로 findAgentId() 가 tid2 컨텍스트에서 tid2 의 agent 를 반환함을 확인한다(테스트 tx
   * 합류).
   */
  @Test
  void workspaceAssistant_perTenantNotSingleton() {
    new TransactionTemplate(txManager)
        .execute(
            status -> {
              Long tid2 = insertTenant("rls-wa");
              Long admin = insertUser("rls-wa-admin");
              Long agent1 = insertUser("rls-wa-agent1");
              Long agent2 = insertUser("rls-wa-agent2");

              // tenant#1 행 보장 — upsert(ON CONFLICT (tenant_id))로 멱등 삽입(기존 행 유무와 무관)
              setGuc(1L);
              workspaceRepo.upsert(agent1, admin);

              // tenant#2 행 삽입 — id 또 1 이지만 PK=tenant_id 이므로 충돌 없이 성공해야 한다(싱글톤 폐지 증명)
              setGuc(tid2);
              insertWorkspaceAssistant(agent2, admin);

              // tid2 컨텍스트: tid2 의 agent 만 보인다
              assertThat(workspaceRepo.findAgentId()).hasValue(agent2);

              // tenant#1 컨텍스트: tenant#1 의 agent 만 보인다(tid2 행은 비가시)
              setGuc(1L);
              assertThat(workspaceRepo.findAgentId()).hasValue(agent1);

              status.setRollbackOnly();
              return null;
            });
  }

  // ----------------------------------------------------------------
  // 헬퍼 (IntegrationTestBase 에 없으므로 로컬 정의 — ChatDomainRlsTest 와 동일 패턴)
  // ----------------------------------------------------------------

  /**
   * 현재 GUC 컨텍스트에서 workspace_assistant 행 삽입. id / tenant_id 는 모두 컬럼 DEFAULT(각각 1, GUC)로 채워지도록 생략한다.
   * 생성 jOOQ baseline 에 tenant_id 필드가 없어 raw SQL 을 쓴다.
   */
  private void insertWorkspaceAssistant(long agentUserId, long updatedBy) {
    dsl.execute(
        "INSERT INTO workspace_assistant (agent_user_id, updated_by) VALUES (?, ?)",
        agentUserId,
        updatedBy);
  }

  /** 신규 테넌트(tid)를 트랜잭션 내에 삽입하고 id 반환. */
  private Long insertTenant(String prefix) {
    return dsl.insertInto(TENANT)
        .set(TENANT.SLUG, prefix + "-" + System.nanoTime())
        .set(TENANT.NAME, prefix.toUpperCase())
        .set(TENANT.STATUS, "ACTIVE")
        .returning(TENANT.ID)
        .fetchOne()
        .getId();
  }

  /** 임시 user 삽입(kind 기본 HUMAN, 고유 username/email)하고 id 반환. user 는 전역 — RLS 비대상. */
  private Long insertUser(String prefix) {
    String suffix = prefix + "-" + System.nanoTime();
    return dsl.insertInto(USER)
        .set(USER.USERNAME, suffix)
        .set(USER.NAME, "Home/Assistant RLS User")
        .set(USER.EMAIL, suffix + "@example.com")
        .set(USER.KIND, "HUMAN")
        .returning(USER.ID)
        .fetchOne()
        .getId();
  }

  /** 트랜잭션-로컬 GUC 직접 설정 헬퍼. */
  private void setGuc(Long tenantId) {
    dsl.execute("SELECT set_config('app.tenant_id', '" + tenantId + "', true)");
  }
}
