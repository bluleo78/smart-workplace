package com.workplace.wiki;

import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static com.workplace.jooq.Tables.WIKI_HTML_SCRIPTS_CHECK;
import static com.workplace.jooq.Tables.WIKI_PAGE;
import static com.workplace.jooq.Tables.WIKI_PAGE_SHARE;
import static com.workplace.jooq.Tables.WIKI_SPACE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.awaitility.Awaitility.await;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.auth.service.AssistantResolver;
import com.workplace.auth.service.AssistantSpec;
import com.workplace.fileai.outbound.AiAgentDriveClient;
import com.workplace.fileai.outbound.AiAgentDriveClient.SecurityCheckRes;
import com.workplace.global.tenant.TenantContext;
import com.workplace.support.ExternalClientMockedTestBase;
import com.workplace.wiki.dto.CreatePageRequest;
import com.workplace.wiki.dto.WikiHtmlScriptsCheckResponse;
import com.workplace.wiki.service.WikiHtmlScriptsCheckService;
import com.workplace.wiki.service.WikiPageService;
import com.workplace.wiki.service.WikiSpaceService;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.function.Supplier;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 노트 HTML 블록 보안 점검 요청의 커밋 경로(WP-1290) — 요청이 커밋되면 전용 실행기에서 점검이 돌아 DONE 이 된다. 커밋 뒤 콜백은 실제 커밋에서만 돌므로
 * 클래스 트랜잭션을 쓰지 않고 만든 행을 직접 지운다(스페이스 삭제 → 페이지 → 점검 행 CASCADE).
 */
class WikiHtmlScriptsCheckCommitTest extends ExternalClientMockedTestBase {

  private static final AssistantSpec SPEC =
      new AssistantSpec(1L, "claude-sonnet-4-6", "NORMAL", 1, 60_000);

  @Autowired DSLContext dsl;
  @Autowired MockMvc mvc;
  @Autowired ObjectMapper om;
  @Autowired WikiSpaceService spaceService;
  @Autowired WikiPageService pageService;
  @Autowired WikiHtmlScriptsCheckService service;
  @Autowired AiAgentDriveClient driveClient;
  @Autowired AssistantResolver assistantResolver;

  private final List<Long> userIds = new ArrayList<>();
  private long spaceId = -1;

  @AfterEach
  void cleanup() {
    cleanupInTenant(
        1L,
        () -> {
          if (spaceId != -1) {
            dsl.deleteFrom(WIKI_SPACE).where(WIKI_SPACE.ID.eq(spaceId)).execute();
          }
          if (!userIds.isEmpty()) {
            dsl.deleteFrom(USER_ROLE).where(USER_ROLE.USER_ID.in(userIds)).execute();
            dsl.deleteFrom(USER).where(USER.ID.in(userIds)).execute();
          }
        });
    userIds.clear();
    spaceId = -1;
    TenantContext.clear();
  }

  /** 요청(커밋) → 실행기에서 점검 → DONE. */
  @Test
  void request_commits_and_check_runs_to_done() {
    stubAi();
    long ownerId = withMembership(inTenant(() -> createUser()));
    long pageId = seedPage(ownerId);

    TenantContext.set(1L);
    WikiHtmlScriptsCheckResponse res;
    try {
      res = service.request(ownerId, pageId, null);
    } finally {
      TenantContext.clear();
    }
    assertThat(res.view().status()).isEqualTo("PENDING");
    awaitDone(pageId, res.hash());
  }

  /** 익명 공개 조회(인증·테넌트 컨텍스트 없음)가 행을 만들고, 커밋 뒤 실행기에서 그 테넌트로 점검이 돌아 DONE 이 된다 — 공유 보기가 기대는 경로. */
  @Test
  void anonymous_public_get_enqueues_and_check_runs_to_done() throws Exception {
    stubAi();
    long ownerId = withMembership(inTenant(() -> createUser()));
    long pageId = seedPage(ownerId);
    String token = "wsh_test" + UUID.randomUUID().toString().replace("-", "");
    inTenant(
        () ->
            dsl.insertInto(WIKI_PAGE_SHARE)
                .set(WIKI_PAGE_SHARE.PAGE_ID, pageId)
                .set(WIKI_PAGE_SHARE.SPACE_ID, spaceId)
                .set(WIKI_PAGE_SHARE.TOKEN, token)
                .set(WIKI_PAGE_SHARE.AUDIENCE, "PUBLIC")
                .set(WIKI_PAGE_SHARE.PERMISSION, "VIEW")
                .set(WIKI_PAGE_SHARE.INCLUDE_CHILDREN, false)
                .set(WIKI_PAGE_SHARE.CREATED_BY, ownerId)
                .execute());

    TenantContext.clear();
    String body =
        mvc.perform(
                get(
                    "/api/v1/public/wiki/shares/"
                        + token
                        + "/pages/"
                        + pageId
                        + "/html-scripts/security-check"))
            .andExpect(status().isOk())
            .andReturn()
            .getResponse()
            .getContentAsString(StandardCharsets.UTF_8);
    JsonNode res = om.readTree(body);
    assertThat(res.get("view").get("status").asText()).isEqualTo("PENDING");
    awaitDone(pageId, res.get("hash").asText());
  }

  private void stubAi() {
    when(assistantResolver.resolveWorkspaceOrEmpty()).thenReturn(Optional.of(SPEC));
    when(driveClient.securityCheck(any()))
        .thenReturn(new SecurityCheckRes("LOW", "안전해요", List.of()));
  }

  /** 스페이스·페이지를 만들고(커밋) 스크립트 든 HTML 블록 본문을 넣는다. */
  private long seedPage(long ownerId) {
    return inTenant(
        () -> {
          spaceId = spaceService.createTeamSpace(ownerId, "커밋 점검").id();
          long id = pageService.create(ownerId, spaceId, new CreatePageRequest(null, "노트")).id();
          dsl.update(WIKI_PAGE)
              .set(WIKI_PAGE.BODY, "```html-embed\n<script>draw()</script>\n```\n")
              .where(WIKI_PAGE.ID.eq(id))
              .execute();
          return id;
        });
  }

  /** 점검 행이 DONE 이 될 때까지 기다린다. */
  private void awaitDone(long pageId, String hash) {
    await()
        .atMost(Duration.ofSeconds(10))
        .untilAsserted(
            () -> {
              String status =
                  inTenant(
                      () ->
                          dsl.select(WIKI_HTML_SCRIPTS_CHECK.STATUS)
                              .from(WIKI_HTML_SCRIPTS_CHECK)
                              .where(WIKI_HTML_SCRIPTS_CHECK.PAGE_ID.eq(pageId))
                              .and(WIKI_HTML_SCRIPTS_CHECK.SOURCE_HASH.eq(hash))
                              .fetchOne(WIKI_HTML_SCRIPTS_CHECK.STATUS));
              assertThat(status).isEqualTo("DONE");
            });
  }

  private long createUser() {
    String suffix = UUID.randomUUID().toString().substring(0, 8);
    long id =
        dsl.insertInto(USER)
            .set(USER.USERNAME, "hsc-" + suffix)
            .set(USER.PASSWORD, "pw")
            .set(USER.NAME, "hsc")
            .set(USER.EMAIL, "hsc-" + suffix + "@example.com")
            .returning(USER.ID)
            .fetchOne()
            .getId();
    Long roleId = dsl.select(ROLE.ID).from(ROLE).where(ROLE.NAME.eq("USER")).fetchOne(ROLE.ID);
    dsl.insertInto(USER_ROLE).set(USER_ROLE.USER_ID, id).set(USER_ROLE.ROLE_ID, roleId).execute();
    userIds.add(id);
    return id;
  }

  /** 테넌트 컨텍스트를 세우고 트랜잭션 안에서 실행한다(커밋). */
  private <T> T inTenant(Supplier<T> body) {
    TenantContext.set(1L);
    try {
      return new TransactionTemplate(txManager).execute(s -> body.get());
    } finally {
      TenantContext.clear();
    }
  }
}
