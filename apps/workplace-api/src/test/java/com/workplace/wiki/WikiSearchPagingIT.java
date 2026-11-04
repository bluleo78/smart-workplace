package com.workplace.wiki;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import com.workplace.wiki.dto.CreatePageRequest;
import com.workplace.wiki.service.WikiPageService;
import com.workplace.wiki.service.WikiSpaceService;
import java.nio.charset.StandardCharsets;
import java.util.HashSet;
import java.util.Set;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.transaction.annotation.Transactional;

/**
 * 노트 검색 페이지 인자(WP-1353) — size·offset 으로 이어 받고, 인자가 없으면 예전처럼 앞 50건이다. 같은 트랜잭션에서 만든 페이지는 updated_at
 * 이 같아도 id 로 정렬이 안정돼 묶음이 겹치지 않는다.
 */
@Transactional
class WikiSearchPagingIT extends IntegrationTestBase {

  @Autowired MockMvc mvc;
  @Autowired ObjectMapper om;
  @Autowired DSLContext dsl;
  @Autowired JwtTokenProvider jwt;
  @Autowired WikiSpaceService spaceService;
  @Autowired WikiPageService pageService;

  private long ownerId;
  private long spaceId;
  private String word;

  @BeforeEach
  void seed() {
    TenantContext.set(1L);
    String suffix = UUID.randomUUID().toString().replace("-", "").substring(0, 8);
    word = "paging" + suffix;
    ownerId = withMembership(TestFixtures.createHuman(dsl));
    spaceId = spaceService.createTeamSpace(ownerId, "검색페이징-" + suffix).id();
  }

  @AfterEach
  void clearTenant() {
    TenantContext.clear();
  }

  private void pages(int n) {
    for (int i = 0; i < n; i++) {
      pageService.create(ownerId, spaceId, new CreatePageRequest(null, word + "-" + i));
    }
  }

  @Test
  void search_pagesWithSizeAndOffset() throws Exception {
    pages(5);
    Set<Long> seen = new HashSet<>();
    int[][] cases = {{0, 2}, {2, 2}, {4, 1}};
    for (int[] c : cases) {
      JsonNode r =
          json(
              call(get("/api/v1/wiki/search")
                      .param("q", word)
                      .param("size", "2")
                      .param("offset", "" + c[0]))
                  .andExpect(status().isOk()));
      assertThat(r).hasSize(c[1]);
      r.forEach(n -> assertThat(seen.add(n.get("id").asLong())).isTrue());
    }
    assertThat(seen).hasSize(5);
  }

  @Test
  void search_withoutPaging_returnsUpTo50() throws Exception {
    pages(51);
    JsonNode r = json(call(get("/api/v1/wiki/search").param("q", word)).andExpect(status().isOk()));
    assertThat(r).hasSize(50);
  }

  @Test
  void search_invalidPaging_is400() throws Exception {
    call(get("/api/v1/wiki/search").param("q", word).param("size", "0"))
        .andExpect(status().isBadRequest());
    call(get("/api/v1/wiki/search").param("q", word).param("size", "51"))
        .andExpect(status().isBadRequest());
    call(get("/api/v1/wiki/search").param("q", word).param("offset", "-1"))
        .andExpect(status().isBadRequest());
  }

  private JsonNode json(ResultActions r) throws Exception {
    return om.readTree(r.andReturn().getResponse().getContentAsString(StandardCharsets.UTF_8));
  }

  private ResultActions call(MockHttpServletRequestBuilder req) throws Exception {
    req.header("Authorization", "Bearer " + jwt.generateAccessToken(ownerId, "u-" + ownerId, 1L));
    ResultActions r = mvc.perform(req);
    TenantContext.set(1L);
    return r;
  }
}
