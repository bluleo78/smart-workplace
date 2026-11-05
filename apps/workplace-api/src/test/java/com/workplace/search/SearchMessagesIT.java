package com.workplace.search;

import static com.workplace.jooq.Tables.MESSAGE;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.global.tenant.TenantContext;
import com.workplace.messaging.dto.CreateMessageRequest;
import com.workplace.messaging.repository.ChannelMemberRepository;
import com.workplace.messaging.repository.MessageRepository;
import com.workplace.messaging.service.ChannelService;
import com.workplace.messaging.service.DmService;
import com.workplace.messaging.service.MessageService;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.nio.charset.StandardCharsets;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
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
 * 통합 검색 팔레트(WP-1358)의 메시지 본문 검색 — 내가 멤버인 채널·DM 만, 보관 채널·삭제 메시지 제외, 스레드 답글 포함, 대소문자 무시·와일드카드 글자 그대로,
 * 최신순 키셋 커서·hasMore, DM 이름은 상대 이름, 짧은 검색어 빈 결과, size 범위 밖 400.
 */
@Transactional
class SearchMessagesIT extends IntegrationTestBase {

  @Autowired MockMvc mvc;
  @Autowired ObjectMapper om;
  @Autowired DSLContext dsl;
  @Autowired JwtTokenProvider jwt;
  @Autowired ChannelService channelService;
  @Autowired DmService dmService;
  @Autowired MessageService messageService;
  @Autowired MessageRepository messageRepo;
  @Autowired ChannelMemberRepository memberRepo;

  private long me;
  private long other;
  private long myChannel;
  private String s;
  private String word;

  /** 테스트마다 고유한 검색어(word)와 사용자·내 채널을 만든다 — 다른 테스트 데이터와 섞이지 않게. */
  @BeforeEach
  void seed() {
    TenantContext.set(1L);
    s = UUID.randomUUID().toString().replace("-", "").substring(0, 8);
    word = "zq" + s;
    me = withMembership(TestFixtures.createHuman(dsl));
    other = withMembership(TestFixtures.createHuman(dsl));
    myChannel = channelService.create(me, "srch-" + s, "PUBLIC").id();
  }

  @AfterEach
  void clearTenant() {
    TenantContext.clear();
  }

  private long post(long author, long channel, String body) {
    return messageService.create(author, channel, new CreateMessageRequest(body)).id();
  }

  /** 테스트 트랜잭션 안에서는 created_at 이 모두 같다 — 최신순을 확인하려고 시각을 직접 정한다. */
  private void at(long messageId, int minutesAgo) {
    dsl.update(MESSAGE)
        .set(MESSAGE.CREATED_AT, OffsetDateTime.now(ZoneOffset.UTC).minusMinutes(minutesAgo))
        .where(MESSAGE.ID.eq(messageId))
        .execute();
  }

  private String nameOf(long userId) {
    return dsl.select(USER.NAME).from(USER).where(USER.ID.eq(userId)).fetchOne(USER.NAME);
  }

  @Test
  void searchMessages_onlyChannelsIAmMemberOf() throws Exception {
    long mine = post(me, myChannel, "내 채널 " + word);
    // 남의 비공개 채널, 가입 안 한 공개 채널 — 둘 다 내가 멤버가 아니라 빠진다.
    long theirPrivate = channelService.create(other, "srch-priv-" + s, "PRIVATE").id();
    post(other, theirPrivate, "비공개 " + word);
    long theirPublic = channelService.create(other, "srch-pub-" + s, "PUBLIC").id();
    post(other, theirPublic, "공개 " + word);

    JsonNode items = search(me, word, null).get("items");

    assertThat(items).hasSize(1);
    JsonNode hit = items.get(0);
    assertThat(hit.get("id").asLong()).isEqualTo(mine);
    assertThat(hit.get("channelId").asLong()).isEqualTo(myChannel);
    assertThat(hit.get("channelKind").asText()).isEqualTo("CHANNEL");
    assertThat(hit.get("channelName").asText()).isEqualTo("srch-" + s);
    assertThat(hit.get("authorName").asText()).isEqualTo(nameOf(me));
    assertThat(hit.get("authorKind").asText()).isEqualTo("HUMAN");
    assertThat(hit.get("parentMessageId").isNull()).isTrue();
    assertThat(hit.get("excerpt").asText()).isEqualTo("내 채널 " + word);
    assertThat(hit.get("createdAt").isTextual()).isTrue();
  }

  @Test
  void searchMessages_excludesArchivedChannelAndDeletedMessage() throws Exception {
    long gone = post(me, myChannel, "지운 " + word);
    long live = post(me, myChannel, "남은 " + word);
    messageService.delete(me, gone);
    long archived = channelService.create(me, "srch-arch-" + s, "PUBLIC").id();
    post(me, archived, "보관 " + word);
    channelService.archive(me, archived);

    JsonNode items = search(me, word, null).get("items");

    assertThat(items).hasSize(1);
    assertThat(items.get(0).get("id").asLong()).isEqualTo(live);
  }

  @Test
  void searchMessages_includesThreadRepliesAndAgentMessages() throws Exception {
    long root = post(me, myChannel, "루트 메시지");
    long reply =
        messageService.create(me, myChannel, new CreateMessageRequest("답글 " + word, root)).id();
    // AI(AGENT) 가 보낸 메시지도 찾는다 — 채널 멤버로 넣고 바로 기록한다.
    long agent = createAgentUserWithMembership("srch-agent");
    memberRepo.add(myChannel, agent, "MEMBER");
    long agentMsg = messageRepo.insert(myChannel, agent, "에이전트 " + word, List.of(), null);
    at(reply, 2);
    at(agentMsg, 1);

    JsonNode items = search(me, word, null).get("items");

    assertThat(items).hasSize(2);
    assertThat(items.get(0).get("id").asLong()).isEqualTo(agentMsg);
    assertThat(items.get(0).get("authorKind").asText()).isEqualTo("AGENT");
    assertThat(items.get(1).get("id").asLong()).isEqualTo(reply);
    assertThat(items.get(1).get("parentMessageId").asLong()).isEqualTo(root);
  }

  @Test
  void searchMessages_caseInsensitiveAndWildcardsLiteral() throws Exception {
    long upper = post(me, myChannel, "HELLO " + word.toUpperCase());
    long pct = post(me, myChannel, "할인 50%_" + word);
    post(me, myChannel, "할인 50ab" + word);

    JsonNode byCase = search(me, "hello " + word, null).get("items");
    assertThat(byCase).hasSize(1);
    assertThat(byCase.get(0).get("id").asLong()).isEqualTo(upper);

    // 「%」·「_」 는 글자 그대로 — 「50ab」 와 맞지 않는다.
    JsonNode byWildcard = search(me, "50%_", null).get("items");
    assertThat(byWildcard).extracting(n -> n.get("id").asLong()).containsExactly(pct);
  }

  @Test
  void searchMessages_newestFirstWithCursorPages() throws Exception {
    List<Long> ids = new ArrayList<>();
    for (int i = 0; i < 3; i++) {
      long id = post(me, myChannel, word + " " + i);
      ids.add(id);
    }
    // 0 이 가장 오래, 2 가 가장 최근. 1 과 2 는 같은 시각 — id 로 가른다.
    at(ids.get(0), 10);
    at(ids.get(1), 5);
    dsl.update(MESSAGE)
        .set(
            MESSAGE.CREATED_AT,
            dsl.select(MESSAGE.CREATED_AT)
                .from(MESSAGE)
                .where(MESSAGE.ID.eq(ids.get(1)))
                .<OffsetDateTime>asField())
        .where(MESSAGE.ID.eq(ids.get(2)))
        .execute();

    JsonNode p1 = search(me, word, 2);
    assertThat(p1.get("items"))
        .extracting(n -> n.get("id").asLong())
        .containsExactly(ids.get(2), ids.get(1));
    assertThat(p1.get("hasMore").asBoolean()).isTrue();

    // 커서는 응답의 createdAt 문자열을 그대로 넘긴다(정밀도 왕복 확인).
    JsonNode last = p1.get("items").get(1);
    JsonNode p2 =
        read(
            call(
                get("/api/v1/search/messages")
                    .param("q", word)
                    .param("size", "2")
                    .param("beforeAt", last.get("createdAt").asText())
                    .param("beforeId", last.get("id").asText()),
                me));
    assertThat(p2.get("items")).extracting(n -> n.get("id").asLong()).containsExactly(ids.get(0));
    assertThat(p2.get("hasMore").asBoolean()).isFalse();
  }

  @Test
  void searchMessages_dmChannelNameIsCounterpart() throws Exception {
    long dm = dmService.createOrGet(me, List.of(other)).dm().id();
    post(other, dm, "DM " + word);

    JsonNode hit = search(me, word, null).get("items").get(0);

    assertThat(hit.get("channelKind").asText()).isEqualTo("DM");
    assertThat(hit.get("channelId").asLong()).isEqualTo(dm);
    assertThat(hit.get("channelName").asText()).isEqualTo(nameOf(other));
    assertThat(hit.get("authorName").asText()).isEqualTo(nameOf(other));
  }

  @Test
  void searchMessages_longBodyIsExcerptedAroundMatch() throws Exception {
    String body = "가".repeat(200) + "\n" + word + "\n" + "나".repeat(200);
    post(me, myChannel, body);

    String excerpt = search(me, word, null).get("items").get(0).get("excerpt").asText();

    assertThat(excerpt)
        .startsWith("…")
        .endsWith("…")
        .contains(" " + word + " ")
        .doesNotContain("\n");
  }

  /** 한 줄 행에 맞은 곳이 보이도록 — 120자 미만이어도 맞은 곳이 뒤쪽이면 앞을 잘라 맞은 곳을 앞으로 당긴다. */
  @Test
  void searchMessages_matchNearEndIsPulledForward() throws Exception {
    String body = "다".repeat(80) + " " + word + " 끝";
    post(me, myChannel, body);

    String excerpt = search(me, word, null).get("items").get(0).get("excerpt").asText();

    assertThat(excerpt).startsWith("…").contains(word);
    assertThat(excerpt.indexOf(word)).isLessThan(30);
  }

  @Test
  void searchMessages_shortQueryEmpty() throws Exception {
    post(me, myChannel, "a " + word);
    JsonNode r = search(me, " a ", null);
    assertThat(r.get("items")).isEmpty();
    assertThat(r.get("hasMore").asBoolean()).isFalse();
  }

  @Test
  void searchMessages_invalidSize_is400() throws Exception {
    call(get("/api/v1/search/messages").param("q", word).param("size", "0"), me)
        .andExpect(status().isBadRequest());
    call(get("/api/v1/search/messages").param("q", word).param("size", "51"), me)
        .andExpect(status().isBadRequest());
  }

  private JsonNode search(long user, String q, Integer size) throws Exception {
    MockHttpServletRequestBuilder req = get("/api/v1/search/messages").param("q", q);
    if (size != null) req.param("size", "" + size);
    return read(call(req, user));
  }

  private JsonNode read(ResultActions r) throws Exception {
    r.andExpect(status().isOk());
    return om.readTree(r.andReturn().getResponse().getContentAsString(StandardCharsets.UTF_8));
  }

  private ResultActions call(MockHttpServletRequestBuilder req, long userId) throws Exception {
    req.header("Authorization", "Bearer " + jwt.generateAccessToken(userId, "u-" + userId, 1L));
    ResultActions r = mvc.perform(req);
    TenantContext.set(1L);
    return r;
  }
}
