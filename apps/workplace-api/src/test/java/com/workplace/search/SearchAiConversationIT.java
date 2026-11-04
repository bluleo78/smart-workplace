package com.workplace.search;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.global.tenant.TenantContext;
import com.workplace.home.service.HomeSessionService;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import com.workplace.user.service.AiPreferenceService;
import java.nio.charset.StandardCharsets;
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
 * 통합 검색 팔레트(WP-1360)의 AI 대화 검색 — 본인 대화만, AI 기억이 꺼져 있어도 결과, offset/size/hasMore 페이지, 짧은 검색어 빈 결과, 맞은
 * 메시지의 role·excerpt, 잘못된 paging 400.
 */
@Transactional
class SearchAiConversationIT extends IntegrationTestBase {

  @Autowired MockMvc mvc;
  @Autowired ObjectMapper om;
  @Autowired DSLContext dsl;
  @Autowired JwtTokenProvider jwt;
  @Autowired HomeSessionService sessions;
  @Autowired AiPreferenceService preferences;

  private long me;
  private long other;
  private String word;

  @BeforeEach
  void seed() {
    TenantContext.set(1L);
    word = "zq" + UUID.randomUUID().toString().replace("-", "").substring(0, 8);
    me = withMembership(TestFixtures.createHuman(dsl));
    other = withMembership(TestFixtures.createHuman(dsl));
  }

  @AfterEach
  void clearTenant() {
    TenantContext.clear();
  }

  /** 질문·답 한 턴을 가진 대화를 만든다 → 대화 id. */
  private UUID turn(long uid, String question, String answer) {
    UUID sid = sessions.create(uid).id();
    sessions.appendMessage(uid, sid, "USER", question, null, null, null);
    sessions.appendMessage(uid, sid, "ASSISTANT", answer, null, null, null);
    return sid;
  }

  @Test
  void onlyMyConversations() throws Exception {
    turn(other, "남의 " + word + " 질문", "답");
    UUID mine = turn(me, "내 " + word + " 질문", "답");

    JsonNode r = search(me, word, null, null);

    assertThat(r.get("items")).hasSize(1);
    assertThat(r.get("items").get(0).get("sessionId").asText()).isEqualTo(mine.toString());
  }

  @Test
  void worksEvenWhenMemoryDisabled() throws Exception {
    turn(me, "끄기 전 " + word, "답");
    preferences.update(me, null, false);

    assertThat(search(me, word, null, null).get("items")).hasSize(1);
  }

  @Test
  void pagesWithHasMore() throws Exception {
    for (int i = 0; i < 3; i++) turn(me, word + " 질문 " + i, "네");

    JsonNode p1 = search(me, word, 0, 2);
    assertThat(p1.get("items")).hasSize(2);
    assertThat(p1.get("hasMore").asBoolean()).isTrue();
    JsonNode p2 = search(me, word, 2, 2);
    assertThat(p2.get("items")).hasSize(1);
    assertThat(p2.get("hasMore").asBoolean()).isFalse();
    assertThat(p1.get("items").get(0).get("sessionId").asText())
        .isNotEqualTo(p2.get("items").get(0).get("sessionId").asText());
  }

  /** 맞은 대화는 점수가 아니라 최근 대화 순 — 나중에 만든(id 가 큰) 대화라도 마지막 대화가 오래됐으면 뒤로 간다. */
  @Test
  void newestConversationFirst() throws Exception {
    UUID recent = turn(me, word + " 최근", "네");
    UUID old = turn(me, word + " 오래된", "네");
    dsl.execute(
        "UPDATE home_session SET last_message_at = now() - interval '30 days' WHERE id = ?", old);

    JsonNode items = search(me, word, null, null).get("items");

    assertThat(items).hasSize(2);
    assertThat(items.get(0).get("sessionId").asText()).isEqualTo(recent.toString());
    assertThat(items.get(1).get("sessionId").asText()).isEqualTo(old.toString());
  }

  @Test
  void shortQueryEmpty() throws Exception {
    turn(me, "가 나 다", "라");
    JsonNode r = search(me, " 가 ", null, null);
    assertThat(r.get("items")).isEmpty();
    assertThat(r.get("hasMore").asBoolean()).isFalse();
  }

  @Test
  void roleFollowsMatchedMessage() throws Exception {
    UUID inAnswer = turn(me, "무관한 질문", "답에만 " + word + " 가 있다");
    JsonNode a = search(me, word, null, null).get("items");
    assertThat(a).hasSize(1);
    assertThat(a.get(0).get("sessionId").asText()).isEqualTo(inAnswer.toString());
    assertThat(a.get(0).get("role").asText()).isEqualTo("ASSISTANT");
    assertThat(a.get(0).get("excerpt").asText()).contains(word);

    String w2 = "yk" + UUID.randomUUID().toString().replace("-", "").substring(0, 8);
    turn(me, "질문에만 " + w2 + " 가 있다", "무관한 답");
    JsonNode q = search(me, w2, null, null).get("items");
    assertThat(q).hasSize(1);
    assertThat(q.get(0).get("role").asText()).isEqualTo("USER");
    assertThat(q.get(0).get("excerpt").asText()).contains(w2);
  }

  @Test
  void invalidPaging_is400() throws Exception {
    call(get("/api/v1/search/ai-conversations").param("q", word).param("size", "0"), me)
        .andExpect(status().isBadRequest());
    call(get("/api/v1/search/ai-conversations").param("q", word).param("size", "51"), me)
        .andExpect(status().isBadRequest());
    call(get("/api/v1/search/ai-conversations").param("q", word).param("offset", "-1"), me)
        .andExpect(status().isBadRequest());
  }

  private JsonNode search(long user, String q, Integer offset, Integer size) throws Exception {
    MockHttpServletRequestBuilder req = get("/api/v1/search/ai-conversations").param("q", q);
    if (offset != null) req.param("offset", "" + offset);
    if (size != null) req.param("size", "" + size);
    ResultActions r = call(req, user).andExpect(status().isOk());
    return om.readTree(r.andReturn().getResponse().getContentAsString(StandardCharsets.UTF_8));
  }

  private ResultActions call(MockHttpServletRequestBuilder req, long userId) throws Exception {
    req.header("Authorization", "Bearer " + jwt.generateAccessToken(userId, "u-" + userId, 1L));
    ResultActions r = mvc.perform(req);
    TenantContext.set(1L);
    return r;
  }
}
