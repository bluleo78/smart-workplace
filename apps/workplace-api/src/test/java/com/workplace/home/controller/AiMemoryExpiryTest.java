package com.workplace.home.controller;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.nullValue;
import static org.mockito.Mockito.when;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.authentication;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.node.ObjectNode;
import com.workplace.global.ai.AiMemoryLine;
import com.workplace.home.AiMemoryTestFixtures;
import com.workplace.home.repository.AiMemoryRepository;
import com.workplace.home.repository.AiMemoryRepository.NewMemory;
import com.workplace.home.service.AiMemoryClock;
import com.workplace.home.service.AiMemoryService;
import com.workplace.home.service.HomeSessionService;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.time.LocalDate;
import java.util.List;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.transaction.annotation.Transactional;

/**
 * WP-380: 메모리 기한 — 오늘(고정 시계 2026-10-14, Asia/Seoul) 기준 유효/만료 경계, 과거·형식 오류 400, 기한 지정·없애기, 만료 행 되살리기
 * 한도, 되돌리기의 기한 복원·과거 기한 재생성, 주입 항목의 기한. 시계는 {@link AiMemoryClock} 목으로 고정한다(실시간 날짜에 기대지 않는다).
 */
@Transactional
class AiMemoryExpiryTest extends IntegrationTestBase {

  private static final String BASE = "/api/v1/users/me/ai-memories";
  private static final LocalDate TODAY = LocalDate.of(2026, 10, 14);

  @Autowired MockMvc mvc;
  @Autowired DSLContext dsl;
  @Autowired AiMemoryRepository repo;
  @Autowired AiMemoryService memories;
  @Autowired HomeSessionService sessions;
  @MockitoBean AiMemoryClock clock;

  @BeforeEach
  void fixToday() {
    when(clock.today()).thenReturn(TODAY);
  }

  /** 브라우저 사용자로 JSON 본문 요청. */
  private ResultActions call(long uid, MockHttpServletRequestBuilder rb, String json)
      throws Exception {
    return mvc.perform(
        rb.with(authentication(new UsernamePasswordAuthenticationToken(uid, "n/a", List.of())))
            .contentType(MediaType.APPLICATION_JSON)
            .content(json));
  }

  private ResultActions list(long uid) throws Exception {
    return mvc.perform(
        get(BASE)
            .with(authentication(new UsernamePasswordAuthenticationToken(uid, "n/a", List.of()))));
  }

  /** 저장소로 직접 1건(과거 기한 행을 만들 수 있게). */
  private long seed(long uid, String scope, LocalDate expiresOn) {
    return repo.insert(uid, new NewMemory("PREFERENCE", "m", "USER", null, scope, expiresOn)).id();
  }

  private ResultActions undo(long uid, long messageId) throws Exception {
    return call(uid, post(BASE + "/undo"), "{\"messageId\":" + messageId + ",\"blockIndex\":0}");
  }

  /** 기한 당일은 주입·한도·expired=false, 다음 날부터 주입·한도에서 빠지고 expired=true(목록엔 남는다). */
  @Test
  void 만료일_당일은_유효하고_다음_날부터_만료다() throws Exception {
    long uid = TestFixtures.createHuman(dsl);
    AiMemoryTestFixtures.fill(dsl, uid, null, AiMemoryService.LIMIT - 1);
    call(
            uid,
            post(BASE),
            "{\"kind\":\"PREFERENCE\",\"content\":\"이번 주는 결제 모듈\",\"expiresOn\":\"2026-10-14\"}")
        .andExpect(status().isCreated())
        .andExpect(jsonPath("$.expiresOn").value("2026-10-14"))
        .andExpect(jsonPath("$.expired").value(false));

    assertThat(memories.loadForChat(uid, null, null).items())
        .extracting(AiMemoryLine::content)
        .contains("이번 주는 결제 모듈");
    call(uid, post(BASE), "{\"kind\":\"PREFERENCE\",\"content\":\"하나 더\"}")
        .andExpect(status().isConflict())
        .andExpect(jsonPath("$.errors.scope").value("COMMON"));

    when(clock.today()).thenReturn(TODAY.plusDays(1));
    list(uid)
        .andExpect(jsonPath("$.items[0].content").value("이번 주는 결제 모듈"))
        .andExpect(jsonPath("$.items[0].expired").value(true));
    assertThat(memories.loadForChat(uid, null, null).items())
        .extracting(AiMemoryLine::content)
        .doesNotContain("이번 주는 결제 모듈");
    call(uid, post(BASE), "{\"kind\":\"PREFERENCE\",\"content\":\"하나 더\"}")
        .andExpect(status().isCreated());
  }

  @Test
  void 과거_기한과_형식_오류와_기한_동시_지정은_400() throws Exception {
    long uid = TestFixtures.createHuman(dsl);
    call(
            uid,
            post(BASE),
            "{\"kind\":\"PREFERENCE\",\"content\":\"a\",\"expiresOn\":\"2026-10-13\"}")
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.errors.code").value("AI_MEMORY_INVALID"));
    call(
            uid,
            post(BASE),
            "{\"kind\":\"PREFERENCE\",\"content\":\"a\",\"expiresOn\":\"2026/10/20\"}")
        .andExpect(status().isBadRequest());
    long id = seed(uid, null, null);
    call(uid, patch(BASE + "/" + id), "{\"expiresOn\":\"2026-10-01\"}")
        .andExpect(status().isBadRequest());
    call(uid, patch(BASE + "/" + id), "{\"expiresOn\":\"2026-10-20\",\"clearExpiry\":true}")
        .andExpect(status().isBadRequest());
  }

  /**
   * 요청 기한은 연도 네 자리 yyyy-MM-dd 의 실제 날짜만 받는다 — 부호 붙은 큰 연도는 DB 상한을 넘기면 500, 그 아래면 저장돼도 웹 표기·ai-agent
   * 주입(같은 정규식)에서 빠진다. 없는 날짜와 빈 문자열도 400 이고, 빈 문자열이 기한을 지우지 않는다(없애기는 clearExpiry 로만).
   */
  @Test
  void 연도_네_자리_실제_날짜가_아닌_기한은_400() throws Exception {
    long uid = TestFixtures.createHuman(dsl);
    long id = seed(uid, null, LocalDate.of(2026, 10, 24));
    for (String bad : List.of("+12026-01-01", "2026-02-30", "", " ")) {
      call(
              uid,
              post(BASE),
              "{\"kind\":\"PREFERENCE\",\"content\":\"a\",\"expiresOn\":\"" + bad + "\"}")
          .andExpect(status().isBadRequest())
          .andExpect(jsonPath("$.errors.code").value("AI_MEMORY_INVALID"));
      call(uid, patch(BASE + "/" + id), "{\"expiresOn\":\"" + bad + "\"}")
          .andExpect(status().isBadRequest())
          .andExpect(jsonPath("$.errors.code").value("AI_MEMORY_INVALID"));
    }
    list(uid)
        .andExpect(jsonPath("$.items.length()").value(1))
        .andExpect(jsonPath("$.items[0].expiresOn").value("2026-10-24"));
  }

  @Test
  void 기한을_정하고_없애면_이전_기한을_응답에_싣는다() throws Exception {
    long uid = TestFixtures.createHuman(dsl);
    long id = seed(uid, "ISSUE", null);
    call(uid, patch(BASE + "/" + id), "{\"expiresOn\":\"2026-10-24\"}")
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.expiresOn").value("2026-10-24"))
        .andExpect(jsonPath("$.scope").value("ISSUE"))
        .andExpect(jsonPath("$.previousExpiresOn").doesNotExist());
    call(uid, patch(BASE + "/" + id), "{\"clearExpiry\":true}")
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.expiresOn").value(nullValue()))
        .andExpect(jsonPath("$.previousExpiresOn").value("2026-10-24"));
  }

  /** 만료 행은 한도에 안 든다 — 되살리기(기한 연장·계속 기억)는 그 범위가 300 이면 409, 만료인 채 내용만 고치기는 된다. */
  @Test
  void 만료_행_되살리기는_범위가_가득이면_409() throws Exception {
    long uid = TestFixtures.createHuman(dsl);
    long expired = seed(uid, "ISSUE", TODAY.minusDays(1));
    long last = 0;
    for (int i = 0; i < AiMemoryService.LIMIT; i++) last = seed(uid, "ISSUE", null);

    call(uid, patch(BASE + "/" + expired), "{\"clearExpiry\":true}")
        .andExpect(status().isConflict())
        .andExpect(jsonPath("$.errors.code").value("AI_MEMORY_FULL"))
        .andExpect(jsonPath("$.errors.scope").value("ISSUE"));
    call(uid, patch(BASE + "/" + expired), "{\"expiresOn\":\"2026-10-30\"}")
        .andExpect(status().isConflict());
    call(uid, patch(BASE + "/" + expired), "{\"content\":\"고친 내용\"}")
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.expired").value(true));

    repo.delete(uid, last);
    call(uid, patch(BASE + "/" + expired), "{\"clearExpiry\":true}")
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.expired").value(false));
  }

  /** 고침 되돌리기는 이전 기한으로 — 그 뒤 기한이 또 바뀌었으면 409 CHANGED(덮지 않는다). */
  @Test
  void 고침_되돌리기는_이전_기한으로_복원하고_그_뒤_바뀌었으면_409() throws Exception {
    long uid = TestFixtures.createHuman(dsl);
    long id = seed(uid, null, null);
    ObjectNode cleared =
        AiMemoryTestFixtures.memoryBlock("updated", id, "PREFERENCE", "m", "m", "AI");
    cleared.put("previousExpiresOn", "2026-10-24");
    undo(uid, AiMemoryTestFixtures.assistantMessageWithMemory(sessions, uid, cleared))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.memory.expiresOn").value("2026-10-24"));

    long other = seed(uid, null, LocalDate.of(2026, 10, 30));
    ObjectNode stale =
        AiMemoryTestFixtures.memoryBlock("updated", other, "PREFERENCE", "m", "m", "AI");
    undo(uid, AiMemoryTestFixtures.assistantMessageWithMemory(sessions, uid, stale))
        .andExpect(status().isConflict())
        .andExpect(jsonPath("$.errors.code").value("AI_MEMORY_CHANGED"));
  }

  /** 지움 되돌리기에서 기한이 이미 지났으면 만료 상태로 다시 만든다 — 과거 기한 400·한도를 적용하지 않는다(30일 뒤 정리 배치가 지운다). */
  @Test
  void 지난_기한의_지움_되돌리기는_만료_상태로_재생성한다() throws Exception {
    long uid = TestFixtures.createHuman(dsl);
    for (int i = 0; i < AiMemoryService.LIMIT; i++) seed(uid, "ISSUE", null);
    ObjectNode forgotten =
        AiMemoryTestFixtures.memoryBlock("forgotten", 987700L, "PREFERENCE", "지난 일", null, "AI");
    forgotten.put("scope", "ISSUE").put("expiresOn", "2026-10-01");
    undo(uid, AiMemoryTestFixtures.assistantMessageWithMemory(sessions, uid, forgotten))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.memory.expiresOn").value("2026-10-01"))
        .andExpect(jsonPath("$.memory.expired").value(true))
        .andExpect(jsonPath("$.memory.scope").value("ISSUE"));
  }

  @Test
  void 주입_항목에_기한을_싣고_오늘을_문자열로_준다() {
    long uid = TestFixtures.createHuman(dsl);
    seed(uid, null, LocalDate.of(2026, 10, 24));
    seed(uid, null, null);
    AiMemoryService.ChatMemories m = memories.loadForChat(uid, null, null);
    assertThat(m.items()).extracting(AiMemoryLine::expiresOn).containsExactly(null, "2026-10-24");
    // 유효 행을 고른 그 오늘을 함께 돌려준다 — 채팅이 다시 읽지 않아 자정을 걸쳐도 어긋나지 않는다.
    assertThat(m.today()).isEqualTo("2026-10-14");
  }

  /**
   * 설정 목록은 유효 행을 모두 싣고 만료 행은 최신 100개까지만 싣는다 — AI 가 짧은 기한 메모리를 많이 만들어 만료 행이 쌓여도(30일 동안 남는다) 그보다 오래된
   * 유효 행이 목록에서 밀려나지 않는다(웹은 이 목록으로 범위별 개수·가득 참을 계산한다).
   */
  @Test
  void 설정_목록은_유효_행을_모두_싣고_만료_행은_최신_100개까지만_싣는다() throws Exception {
    long uid = TestFixtures.createHuman(dsl);
    long oldActive = seed(uid, null, null);
    long oldActiveIssue = seed(uid, "ISSUE", LocalDate.of(2026, 10, 20));
    List<Long> expired = new java.util.ArrayList<>();
    for (int i = 0; i < 520; i++) expired.add(seed(uid, null, LocalDate.of(2026, 10, 1)));

    String body =
        list(uid).andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
    List<Integer> ids = com.jayway.jsonpath.JsonPath.read(body, "$.items[*].id");
    List<Boolean> expiredFlags = com.jayway.jsonpath.JsonPath.read(body, "$.items[*].expired");

    assertThat(ids).contains((int) oldActive, (int) oldActiveIssue);
    assertThat(expiredFlags.stream().filter(Boolean::booleanValue).count()).isEqualTo(100);
    // 만료 행은 최신 100개 — 가장 오래된 420개는 빠진다.
    assertThat(ids.stream().map(Integer::longValue).filter(expired::contains).toList())
        .containsExactlyInAnyOrderElementsOf(expired.subList(420, 520));
  }
}
