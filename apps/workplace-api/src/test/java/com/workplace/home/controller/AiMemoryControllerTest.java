package com.workplace.home.controller;

import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.authentication;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.home.repository.AiMemoryRepository;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.util.List;
import java.util.Map;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.transaction.annotation.Transactional;

/** WP-55: 본인 AI 메모리 관리 — 목록·직접 추가·고치기·지우기·모두 지우기·길이·상한·다른 사용자 404. */
@Transactional
class AiMemoryControllerTest extends IntegrationTestBase {

  private static final String BASE = "/api/v1/users/me/ai-memories";

  @Autowired MockMvc mvc;
  @Autowired DSLContext dsl;
  @Autowired ObjectMapper om;
  @Autowired AiMemoryRepository repo;

  /** 브라우저 사용자 인증(AiPreferenceControllerTest 와 같은 방식)으로 요청한다. */
  private ResultActions call(long uid, MockHttpServletRequestBuilder rb) throws Exception {
    return mvc.perform(
        rb.with(authentication(new UsernamePasswordAuthenticationToken(uid, "n/a", List.of())))
            .contentType(MediaType.APPLICATION_JSON));
  }

  private String body(String kind, String content) throws Exception {
    return om.writeValueAsString(Map.of("kind", kind, "content", content));
  }

  private long idOf(ResultActions r) throws Exception {
    return om.readTree(r.andReturn().getResponse().getContentAsString()).get("id").asLong();
  }

  @Test
  void 처음에는_빈_목록과_상한_50() throws Exception {
    long uid = TestFixtures.createHuman(dsl);
    call(uid, get(BASE))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.items.length()").value(0))
        .andExpect(jsonPath("$.limit").value(50));
  }

  @Test
  void 직접_추가는_앞뒤_공백을_지우고_USER_로_저장하며_최신순으로_보인다() throws Exception {
    long uid = TestFixtures.createHuman(dsl);
    call(uid, post(BASE).content(body("PREFERENCE", "  짧은 목록으로 보여 준다  ")))
        .andExpect(status().isCreated())
        .andExpect(jsonPath("$.content").value("짧은 목록으로 보여 준다"))
        .andExpect(jsonPath("$.kind").value("PREFERENCE"))
        .andExpect(jsonPath("$.source").value("USER"))
        .andExpect(jsonPath("$.previousContent").doesNotExist());
    call(uid, post(BASE).content(body("CONTEXT", "백엔드 팀이다"))).andExpect(status().isCreated());
    call(uid, get(BASE))
        .andExpect(jsonPath("$.items[0].content").value("백엔드 팀이다"))
        .andExpect(jsonPath("$.items[0].kind").value("CONTEXT"))
        .andExpect(jsonPath("$.items[1].content").value("짧은 목록으로 보여 준다"))
        .andExpect(jsonPath("$.items[1].createdAt").exists())
        .andExpect(jsonPath("$.items[1].updatedAt").exists());
  }

  /** Review Focus 3: 서로게이트 쌍(이모지)도 한 글자 — 300개는 받고 301개는 자르지 않고 거절한다. */
  @Test
  void 내용은_코드포인트_기준_300자까지_받고_넘거나_비거나_종류가_틀리면_400() throws Exception {
    long uid = TestFixtures.createHuman(dsl);
    call(uid, post(BASE).content(body("PREFERENCE", "😀".repeat(300))))
        .andExpect(status().isCreated());
    call(uid, post(BASE).content(body("PREFERENCE", "😀".repeat(301))))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.errors.code").value("AI_MEMORY_INVALID"));
    call(uid, post(BASE).content(body("PREFERENCE", "   ")))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.errors.code").value("AI_MEMORY_INVALID"));
    call(uid, post(BASE).content(body("OTHER", "x")))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.errors.code").value("AI_MEMORY_INVALID"));
  }

  @Test
  void 고치면_이전_내용을_돌려주고_맨_위로_올라간다() throws Exception {
    long uid = TestFixtures.createHuman(dsl);
    long a = idOf(call(uid, post(BASE).content(body("PREFERENCE", "표로 보여 준다"))));
    call(uid, post(BASE).content(body("CONTEXT", "백엔드 팀이다")));
    call(uid, patch(BASE + "/" + a).content("{\"content\":\"짧은 목록으로 보여 준다\",\"kind\":\"CONTEXT\"}"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.content").value("짧은 목록으로 보여 준다"))
        .andExpect(jsonPath("$.kind").value("CONTEXT"))
        .andExpect(jsonPath("$.previousContent").value("표로 보여 준다"));
    call(uid, get(BASE)).andExpect(jsonPath("$.items[0].id").value(a));
    call(uid, patch(BASE + "/" + a).content("{}"))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.errors.code").value("AI_MEMORY_INVALID"));
  }

  @Test
  void 다른_사용자의_메모리는_보이지_않고_고치기_지우기는_404() throws Exception {
    long owner = TestFixtures.createHuman(dsl);
    long other = TestFixtures.createHuman(dsl);
    long id = idOf(call(owner, post(BASE).content(body("PREFERENCE", "내 메모리"))));
    call(other, get(BASE)).andExpect(jsonPath("$.items.length()").value(0));
    call(other, patch(BASE + "/" + id).content("{\"content\":\"가로채기\"}"))
        .andExpect(status().isNotFound())
        .andExpect(jsonPath("$.errors.code").value("AI_MEMORY_NOT_FOUND"));
    call(other, delete(BASE + "/" + id)).andExpect(status().isNotFound());
    call(owner, get(BASE)).andExpect(jsonPath("$.items[0].content").value("내 메모리"));
  }

  @Test
  void 지우면_지운_항목을_돌려주고_모두_지우기는_내_것만_지운다() throws Exception {
    long uid = TestFixtures.createHuman(dsl);
    long other = TestFixtures.createHuman(dsl);
    long id = idOf(call(uid, post(BASE).content(body("CONTEXT", "백엔드 팀이다"))));
    call(uid, post(BASE).content(body("PREFERENCE", "짧게 답한다")));
    call(other, post(BASE).content(body("PREFERENCE", "남의 것")));
    call(uid, delete(BASE + "/" + id))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.kind").value("CONTEXT"))
        .andExpect(jsonPath("$.content").value("백엔드 팀이다"))
        .andExpect(jsonPath("$.source").value("USER"));
    call(uid, delete(BASE + "/" + id)).andExpect(status().isNotFound());
    call(uid, delete(BASE)).andExpect(status().isNoContent());
    call(uid, get(BASE)).andExpect(jsonPath("$.items.length()").value(0));
    call(other, get(BASE)).andExpect(jsonPath("$.items.length()").value(1));
  }

  @Test
  void 오십개면_추가는_409_AI_MEMORY_FULL() throws Exception {
    long uid = TestFixtures.createHuman(dsl);
    for (int i = 0; i < 50; i++) repo.insert(uid, "PREFERENCE", "메모리 " + i, "USER", null);
    call(uid, post(BASE).content(body("PREFERENCE", "하나 더")))
        .andExpect(status().isConflict())
        .andExpect(jsonPath("$.errors.code").value("AI_MEMORY_FULL"));
    call(uid, get(BASE)).andExpect(jsonPath("$.items.length()").value(50));
  }
}
