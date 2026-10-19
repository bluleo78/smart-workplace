package com.workplace.wiki;

import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static com.workplace.jooq.Tables.WIKI_SPACE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import com.workplace.wiki.dto.CreatePageRequest;
import com.workplace.wiki.service.WikiPageService;
import com.workplace.wiki.service.WikiSpaceService;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

/**
 * 노트 404 존재 은닉(WP-558) — 비멤버에게 「볼 수 없는 페이지·공간」과 「없는 페이지·공간」이 같은 404 안내여야 한다. 응답이 다르면 페이지 존재와 소속 공간
 * id 가 드러난다.
 *
 * <p>비-@Transactional: MockMvc 요청이 시드를 보려면 커밋돼야 해서 {@code @AfterEach} 에서 지운다(공간 삭제 → 페이지 CASCADE).
 */
class WikiNotFoundOracleTest extends IntegrationTestBase {
  @Autowired MockMvc mvc;
  @Autowired DSLContext dsl;
  @Autowired WikiSpaceService spaceService;
  @Autowired WikiPageService pageService;
  @Autowired JwtTokenProvider jwt;
  @Autowired ObjectMapper om;

  private final List<Long> seededUserIds = new ArrayList<>();
  private long ownerId;
  private long strangerId;
  private long spaceId;
  private long pageId;

  @BeforeEach
  void seed() {
    ownerId = seedUser();
    strangerId = seedUser();
    TenantContext.set(1L);
    spaceId = spaceService.createTeamSpace(ownerId, "오라클팀-" + UUID.randomUUID()).id();
    TenantContext.set(1L);
    pageId = pageService.create(ownerId, spaceId, new CreatePageRequest(null, "비밀 기획")).id();
  }

  @AfterEach
  void cleanup() {
    cleanupInTenant(
        1L,
        () -> {
          dsl.deleteFrom(WIKI_SPACE).where(WIKI_SPACE.OWNER_ID.in(seededUserIds)).execute();
          dsl.deleteFrom(USER_ROLE).where(USER_ROLE.USER_ID.in(seededUserIds)).execute();
          dsl.deleteFrom(USER).where(USER.ID.in(seededUserIds)).execute();
        });
    seededUserIds.clear();
    TenantContext.clear();
  }

  /** 페이지 경로 — 남의 공간에 있는 페이지와 없는 페이지가 같은 상태·같은 문구이고, 문구에 id 가 없다. */
  @Test
  void pagePaths_foreignAndMissingPage_lookIdentical() throws Exception {
    long missing = pageId + 1_000_000;
    for (String path :
        List.of(
            "/api/v1/wiki/pages/{id}",
            "/api/v1/wiki/pages/{id}/revisions",
            "/api/v1/wiki/pages/{id}/backlinks")) {
      JsonNode foreign = notFound(path, pageId);
      JsonNode none = notFound(path, missing);
      assertThat(foreign.get("message").asText()).as(path).isEqualTo(none.get("message").asText());
      assertThat(foreign.get("message").asText()).as(path).doesNotContainPattern("\\d");
    }
  }

  /** 공간 경로 — 남의 공간과 없는 공간이 같은 문구이고, 페이지 경로와도 같은 문구다(공간·페이지 구분도 드러나지 않게). */
  @Test
  void spacePath_foreignAndMissingSpace_lookIdenticalToPagePath() throws Exception {
    JsonNode foreign = notFound("/api/v1/wiki/spaces/{id}/pages", spaceId);
    JsonNode none = notFound("/api/v1/wiki/spaces/{id}/pages", spaceId + 1_000_000);
    JsonNode page = notFound("/api/v1/wiki/pages/{id}", pageId);
    assertThat(foreign.get("message").asText())
        .isEqualTo(none.get("message").asText())
        .isEqualTo(page.get("message").asText())
        .doesNotContainPattern("\\d");
  }

  private JsonNode notFound(String path, long id) throws Exception {
    MvcResult r =
        mvc.perform(
                get(path, id)
                    .header(
                        "Authorization", "Bearer " + jwt.generateAccessToken(strangerId, "u", 1L)))
            .andReturn();
    assertThat(r.getResponse().getStatus()).as(path + " " + id).isEqualTo(404);
    return om.readTree(r.getResponse().getContentAsString(java.nio.charset.StandardCharsets.UTF_8));
  }

  private long seedUser() {
    TenantContext.set(1L);
    long id = TestFixtures.createHuman(dsl);
    seededUserIds.add(id);
    return withMembership(id);
  }
}
