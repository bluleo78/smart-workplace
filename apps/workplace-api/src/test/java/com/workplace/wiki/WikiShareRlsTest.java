package com.workplace.wiki;

import static com.workplace.jooq.Tables.TENANT;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.WIKI_PAGE;
import static com.workplace.jooq.Tables.WIKI_SPACE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import com.workplace.user.service.UserService;
import java.util.function.Consumer;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * V194 노트 페이지 공유 스키마 검증(WP-579): 새 4개 테이블의 tenant_id RLS(NULLIF fail-closed) 격리, 외부(비로그인) 조회용
 * SECURITY DEFINER 함수 {@code wiki_page_share_resolve_public} / {@code wiki_page_share_tenant} 의 판정,
 * 그리고 외부 공유는 보기 전용이라는 DB CHECK. {@link WikiRlsTest} 와 같이 전체를 롤백되는 단일 트랜잭션으로 수행해 공유 DB 를 오염시키지 않는다.
 */
class WikiShareRlsTest extends IntegrationTestBase {

  @Autowired private DSLContext dsl;
  @Autowired private PlatformTransactionManager txManager;
  @Autowired private UserService userService;

  /** 트랜잭션-로컬 GUC 직접 설정. null 이면 빈 문자열(= 외부·비로그인 조회처럼 테넌트 컨텍스트 없음). */
  private void setGuc(Long tenantId) {
    dsl.execute(
        "SELECT set_config('app.tenant_id', '" + (tenantId == null ? "" : tenantId) + "', true)");
  }

  /** 롤백되는 트랜잭션 안에서 본문을 실행한다. */
  private void inRolledBackTx(Consumer<Fixture> body) {
    new TransactionTemplate(txManager)
        .execute(
            status -> {
              body.accept(seed());
              status.setRollbackOnly();
              return null;
            });
  }

  /** 테넌트 1 에 사용자·팀 스페이스·페이지를 만들고, 이후 격리 대조용 신규 테넌트도 하나 만든다. */
  private Fixture seed() {
    String suffix = String.valueOf(System.nanoTime() % 1_000_000);
    Long otherTenant =
        dsl.insertInto(TENANT)
            .set(TENANT.SLUG, "rls-wsh-" + System.nanoTime())
            .set(TENANT.NAME, "RLS-WSH")
            .set(TENANT.STATUS, "ACTIVE")
            .returning(TENANT.ID)
            .fetchOne()
            .getId();
    Long userId =
        dsl.insertInto(USER)
            .set(USER.USERNAME, "rls-wsh-" + suffix)
            .set(USER.NAME, "RLS Share Owner")
            .set(USER.EMAIL, "rls-wsh-" + suffix + "@example.com")
            .set(USER.KIND, "HUMAN")
            .returning(USER.ID)
            .fetchOne()
            .getId();
    setGuc(1L);
    Long spaceId =
        dsl.insertInto(WIKI_SPACE)
            .set(WIKI_SPACE.TYPE, "TEAM")
            .set(WIKI_SPACE.NAME, "공유 RLS 위키")
            .set(WIKI_SPACE.OWNER_ID, userId)
            .set(WIKI_SPACE.TENANT_ID, 1L)
            .returning(WIKI_SPACE.ID)
            .fetchOne()
            .getId();
    Long pageId = newPage(spaceId, "공유 대상");
    return new Fixture(otherTenant, userId, spaceId, pageId, suffix);
  }

  private Long newPage(Long spaceId, String title) {
    return dsl.insertInto(WIKI_PAGE)
        .set(WIKI_PAGE.SPACE_ID, spaceId)
        .set(WIKI_PAGE.TITLE, title)
        .set(WIKI_PAGE.TENANT_ID, 1L)
        .returning(WIKI_PAGE.ID)
        .fetchOne()
        .getId();
  }

  /**
   * wiki_page_share 한 행 삽입(tenant 1 컨텍스트). expires 는 SQL 식(예: "now() + interval '1 day'" / "null").
   */
  private Long insertShare(
      Fixture f, Long pageId, String token, String audience, String permission, String expires) {
    return dsl.fetchOne(
            "INSERT INTO wiki_page_share(tenant_id, page_id, space_id, token, audience, permission,"
                + " include_children, expires_at, created_by) VALUES (1, ?, ?, ?, ?, ?, false, "
                + expires
                + ", ?) RETURNING id",
            pageId,
            f.spaceId,
            token,
            audience,
            permission,
            f.userId)
        .get(0, Long.class);
  }

  private int count(String table) {
    return dsl.fetchOne("SELECT count(*) FROM " + table).get(0, Integer.class);
  }

  private Long resolveTenant(String token) {
    return dsl.fetchOne("SELECT wiki_page_share_tenant(?)", token).get(0, Long.class);
  }

  private int resolvePublicCount(String token) {
    return dsl.fetchOne("SELECT count(*) FROM wiki_page_share_resolve_public(?)", token)
        .get(0, Integer.class);
  }

  @Test
  void shareTables_createdInTenant1_areInvisibleInOtherTenantAndWithoutGuc() {
    inRolledBackTx(
        f -> {
          Long shareId =
              insertShare(f, f.pageId, "wsh_rls_a_" + f.suffix, "PEOPLE", "VIEW", "null");
          dsl.execute(
              "INSERT INTO wiki_page_share_member(share_id, user_id, added_by, tenant_id)"
                  + " VALUES (?, ?, ?, 1)",
              shareId,
              f.userId,
              f.userId);
          dsl.execute(
              "INSERT INTO wiki_page_share_event(tenant_id, page_id, actor_id, type)"
                  + " VALUES (1, ?, ?, 'CREATED')",
              f.pageId,
              f.userId);
          dsl.execute(
              "INSERT INTO wiki_share_access_request(tenant_id, page_id, requester_id, status)"
                  + " VALUES (1, ?, ?, 'PENDING')",
              f.pageId,
              f.userId);

          // 양성 대조 — tenant 1 에서는 네 테이블 모두 한 행씩 보인다.
          for (String t :
              new String[] {
                "wiki_page_share",
                "wiki_page_share_member",
                "wiki_page_share_event",
                "wiki_share_access_request"
              }) {
            assertThat(count(t)).as("tenant1 " + t).isEqualTo(1);
          }

          // 다른 테넌트 GUC → 비가시
          setGuc(f.otherTenant);
          for (String t :
              new String[] {
                "wiki_page_share",
                "wiki_page_share_member",
                "wiki_page_share_event",
                "wiki_share_access_request"
              }) {
            assertThat(count(t)).as("other tenant " + t).isZero();
          }

          // GUC 없음(빈 문자열) → fail-closed 로 비가시
          setGuc(null);
          for (String t :
              new String[] {
                "wiki_page_share",
                "wiki_page_share_member",
                "wiki_page_share_event",
                "wiki_share_access_request"
              }) {
            assertThat(count(t)).as("no guc " + t).isZero();
          }
        });
  }

  @Test
  void resolvePublic_findsPublicTokenWithoutGuc_butNotWorkspaceExpiredOrPolicyOff() {
    inRolledBackTx(
        f -> {
          String pub = "wsh_rls_pub_" + f.suffix;
          String ws = "wsh_rls_ws_" + f.suffix;
          String expired = "wsh_rls_exp_" + f.suffix;
          Long pubPage = f.pageId;
          Long wsPage = newPage(f.spaceId, "WORKSPACE 공유");
          Long expPage = newPage(f.spaceId, "만료 공유");
          insertShare(f, pubPage, pub, "PUBLIC", "VIEW", "now() + interval '1 day'");
          insertShare(f, wsPage, ws, "WORKSPACE", "VIEW", "null");
          insertShare(f, expPage, expired, "PUBLIC", "VIEW", "now() - interval '1 second'");

          // 외부 조회처럼 테넌트 컨텍스트 없이 호출
          setGuc(null);
          var row =
              dsl.fetchOne(
                  "SELECT tenant_id, page_id, include_children, expires_at"
                      + " FROM wiki_page_share_resolve_public(?)",
                  pub);
          assertThat(row).isNotNull();
          assertThat(row.get("tenant_id", Long.class)).isEqualTo(1L);
          assertThat(row.get("page_id", Long.class)).isEqualTo(pubPage);
          assertThat(row.get("include_children", Boolean.class)).isFalse();
          assertThat(row.get("expires_at")).isNotNull();

          assertThat(resolvePublicCount(ws)).as("WORKSPACE 는 외부 조회 불가").isZero();
          assertThat(resolvePublicCount(expired)).as("만료 토큰").isZero();
          assertThat(resolvePublicCount("wsh_no_such_token")).as("없는 토큰").isZero();

          // 테넌트 정책 끔 → PUBLIC 이어도 빈 결과
          dsl.execute("UPDATE tenant SET wiki_external_share_enabled = false WHERE id = 1");
          assertThat(resolvePublicCount(pub)).as("정책 꺼짐").isZero();
        });
  }

  @Test
  void shareTenant_resolvesAnyAudienceWithoutGuc() {
    inRolledBackTx(
        f -> {
          String ws = "wsh_rls_tws_" + f.suffix;
          String people = "wsh_rls_tpp_" + f.suffix;
          insertShare(f, f.pageId, ws, "WORKSPACE", "VIEW", "null");
          insertShare(f, newPage(f.spaceId, "지정 공유"), people, "PEOPLE", "EDIT", "null");

          setGuc(null);
          assertThat(resolveTenant(ws)).isEqualTo(1L);
          assertThat(resolveTenant(people)).isEqualTo(1L);
          assertThat(resolveTenant("wsh_no_such_token")).isNull();
        });
  }

  @Test
  void publicShare_cannotBeEditable_andPageIsUnique() {
    inRolledBackTx(
        f -> {
          // 외부 공유는 보기 전용 — DB CHECK
          assertThatThrownBy(
                  () ->
                      insertShare(f, f.pageId, "wsh_rls_pe_" + f.suffix, "PUBLIC", "EDIT", "null"))
              .hasMessageContaining("wiki_page_share");
        });
    inRolledBackTx(
        f -> {
          // 페이지당 공유는 하나
          insertShare(f, f.pageId, "wsh_rls_u1_" + f.suffix, "WORKSPACE", "VIEW", "null");
          assertThatThrownBy(
                  () ->
                      insertShare(
                          f, f.pageId, "wsh_rls_u2_" + f.suffix, "WORKSPACE", "VIEW", "null"))
              .hasMessageContaining("wiki_page_share");
        });
  }

  /** 시드 결과 묶음. */
  /**
   * AGENT 삭제(UserService.deleteAgent — 사용자 행 하드 삭제)가 공유 테이블의 사용자 FK 에 막히지 않는다(V177·V180·V182 관례).
   * 에이전트가 만든 공유·지정된 행·보낸 접근 요청은 함께 지워지고(CASCADE), 기록의 행위자·요청을 결정한 사람·지정한 사람(added_by)은 비워 남긴다(SET
   * NULL).
   */
  @Test
  void deletingAgent_cascadesOrNullsShareUserReferences() {
    inRolledBackTx(
        f -> {
          long agentId = TestFixtures.createAgentNoToken(dsl);
          TestFixtures.addMember(dsl, agentId, 1L);
          setGuc(1L);
          // 에이전트가 만든 공유(지정 대상·추가한 사람도 에이전트)
          Long agentShare =
              dsl.fetchOne(
                      "INSERT INTO wiki_page_share(tenant_id, page_id, space_id, token, audience,"
                          + " permission, created_by) VALUES (1, ?, ?, ?, 'PEOPLE', 'VIEW', ?)"
                          + " RETURNING id",
                      f.pageId,
                      f.spaceId,
                      "wsh_agent_a_" + f.suffix,
                      agentId)
                  .get(0, Long.class);
          dsl.execute(
              "INSERT INTO wiki_page_share_member(share_id, user_id, added_by, tenant_id)"
                  + " VALUES (?, ?, ?, 1)",
              agentShare,
              agentId,
              agentId);
          // 사람이 만든 공유 — 에이전트가 지정한 사람(added_by)으로만 남아 있다.
          Long otherPage = newPage(f.spaceId, "다른 페이지");
          Long humanShare =
              insertShare(f, otherPage, "wsh_agent_h_" + f.suffix, "PEOPLE", "VIEW", "null");
          dsl.execute(
              "INSERT INTO wiki_page_share_member(share_id, user_id, added_by, tenant_id)"
                  + " VALUES (?, ?, ?, 1)",
              humanShare,
              f.userId,
              agentId);
          dsl.execute(
              "INSERT INTO wiki_page_share_event(tenant_id, page_id, actor_id, type)"
                  + " VALUES (1, ?, ?, 'CREATED')",
              otherPage,
              agentId);
          // 에이전트가 보낸 요청(지워짐)과 에이전트가 결정한 요청(결정자만 비워짐)
          dsl.execute(
              "INSERT INTO wiki_share_access_request(tenant_id, page_id, requester_id)"
                  + " VALUES (1, ?, ?)",
              otherPage,
              agentId);
          dsl.execute(
              "INSERT INTO wiki_share_access_request(tenant_id, page_id, requester_id, status,"
                  + " decided_by, decided_at) VALUES (1, ?, ?, 'DENIED', ?, now())",
              otherPage,
              f.userId,
              agentId);

          TenantContext.set(1L);
          try {
            userService.deleteAgent(f.userId, agentId);
          } finally {
            TenantContext.clear();
          }
          setGuc(1L);

          assertThat(
                  dsl.fetchCount(
                      dsl.selectOne().from("wiki_page_share").where("id = ?", agentShare)))
              .isZero();
          assertThat(
                  dsl.fetchCount(
                      dsl.selectOne().from("wiki_page_share_member").where("user_id = ?", agentId)))
              .isZero();
          assertThat(
                  dsl.fetchOne(
                          "SELECT count(*) FROM wiki_page_share_member WHERE share_id = ? AND"
                              + " user_id = ? AND added_by IS NULL",
                          humanShare,
                          f.userId)
                      .get(0, Integer.class))
              .isEqualTo(1);
          assertThat(
                  dsl.fetchOne(
                          "SELECT count(*) FROM wiki_page_share_event WHERE page_id = ? AND"
                              + " actor_id IS NULL",
                          otherPage)
                      .get(0, Integer.class))
              .isEqualTo(1);
          assertThat(
                  dsl.fetchOne(
                          "SELECT count(*) FROM wiki_share_access_request WHERE page_id = ?",
                          otherPage)
                      .get(0, Integer.class))
              .isEqualTo(1);
          assertThat(
                  dsl.fetchOne(
                          "SELECT count(*) FROM wiki_share_access_request WHERE page_id = ? AND"
                              + " requester_id = ? AND decided_by IS NULL",
                          otherPage,
                          f.userId)
                      .get(0, Integer.class))
              .isEqualTo(1);
        });
  }

  /** 노트 알림 부분 인덱스 — 페이지 삭제의 CASCADE 가 notification 을 순차 탐색하지 않게(wiki_page_id 가 있는 행만). */
  @Test
  void notificationWikiPageIndex_isPartial() {
    String def =
        dsl.fetchOne(
                "SELECT indexdef FROM pg_indexes WHERE tablename = 'notification' AND indexname ="
                    + " 'idx_notification_wiki_page'")
            .get(0, String.class);
    assertThat(def).contains("(wiki_page_id)").contains("WHERE (wiki_page_id IS NOT NULL)");
  }

  private record Fixture(Long otherTenant, Long userId, Long spaceId, Long pageId, String suffix) {}
}
