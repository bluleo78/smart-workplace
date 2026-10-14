package com.workplace.home.controller;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.nullValue;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.authentication;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.global.ai.AiMemoryLine;
import com.workplace.home.AiMemoryTestFixtures;
import com.workplace.home.repository.AiMemoryRepository;
import com.workplace.home.repository.AiMemoryRepository.NewMemory;
import com.workplace.home.service.AiMemoryService;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.time.LocalDate;
import java.util.HashMap;
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

/**
 * WP-379: 메모리 범위 — 생성·목록의 scope, 잘못된 범위 400, 범위마다 50개 한도(409 + errors.scope), PATCH 범위
 * 이동(present-flag: 키가 없으면 유지, null 이면 공통), 가득 찬 범위로 이동 409 와 같은 범위 안 고치기 허용, 목록은 범위를 합쳐 전부.
 */
@Transactional
class AiMemoryScopeTest extends IntegrationTestBase {

  private static final String BASE = "/api/v1/users/me/ai-memories";

  @Autowired MockMvc mvc;
  @Autowired DSLContext dsl;
  @Autowired ObjectMapper om;
  @Autowired AiMemoryRepository repo;
  @Autowired AiMemoryService memoryService;

  /** 브라우저 사용자 인증으로 요청한다(AiMemoryControllerTest 와 같은 방식). */
  private ResultActions call(long uid, MockHttpServletRequestBuilder rb) throws Exception {
    return mvc.perform(
        rb.with(authentication(new UsernamePasswordAuthenticationToken(uid, "n/a", List.of())))
            .contentType(MediaType.APPLICATION_JSON));
  }

  /** 생성 본문 — scope 가 null 이면 키를 싣지 않는다(공통). */
  private String createBody(String kind, String content, String scope) throws Exception {
    Map<String, Object> m = new HashMap<>();
    m.put("kind", kind);
    m.put("content", content);
    if (scope != null) m.put("scope", scope);
    return om.writeValueAsString(m);
  }

  private long idOf(ResultActions r) throws Exception {
    return om.readTree(r.andReturn().getResponse().getContentAsString()).get("id").asLong();
  }

  /** 범위(null = 공통)에 n 개를 바로 넣는다(서비스 한도를 거치지 않는 시드). */
  private void fill(long uid, String scope, int n) {
    for (int i = 0; i < n; i++)
      repo.insert(uid, new NewMemory("PREFERENCE", "m" + i, "USER", null, scope, null));
  }

  @Test
  void 범위를_지정해_만들면_목록에_scope_가_보이고_생략하면_공통_null() throws Exception {
    long uid = TestFixtures.createHuman(dsl);
    call(uid, post(BASE).content(createBody("PREFERENCE", "이슈 목록은 짧게 보여 준다", "ISSUE")))
        .andExpect(status().isCreated())
        .andExpect(jsonPath("$.scope").value("ISSUE"));
    call(uid, post(BASE).content(createBody("CONTEXT", "백엔드 팀이다", null)))
        .andExpect(status().isCreated())
        .andExpect(jsonPath("$.scope").value(nullValue()));
    call(uid, get(BASE))
        .andExpect(jsonPath("$.items[0].scope").value(nullValue()))
        .andExpect(jsonPath("$.items[1].scope").value("ISSUE"))
        .andExpect(jsonPath("$.limit").value(50));
  }

  @Test
  void 모르는_범위는_생성_고치기_모두_400() throws Exception {
    long uid = TestFixtures.createHuman(dsl);
    call(uid, post(BASE).content(createBody("PREFERENCE", "x", "CONTACTS")))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.errors.code").value("AI_MEMORY_INVALID"));
    long id = idOf(call(uid, post(BASE).content(createBody("PREFERENCE", "x", null))));
    // 공통은 null 로 보낸다 — "COMMON" 문자열은 API 계약이 아니다(ai-agent 가 null 로 바꿔 보낸다).
    call(uid, patch(BASE + "/" + id).content("{\"scope\":\"COMMON\"}"))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.errors.code").value("AI_MEMORY_INVALID"));
  }

  @Test
  void 범위마다_50개다_공통이_가득해도_이슈는_만들어지고_이슈가_가득이면_409_와_범위() throws Exception {
    long uid = TestFixtures.createHuman(dsl);
    fill(uid, null, 50);
    call(uid, post(BASE).content(createBody("PREFERENCE", "이슈 1", "ISSUE")))
        .andExpect(status().isCreated());
    fill(uid, "ISSUE", 49);
    call(uid, post(BASE).content(createBody("PREFERENCE", "이슈 51", "ISSUE")))
        .andExpect(status().isConflict())
        .andExpect(jsonPath("$.errors.code").value("AI_MEMORY_FULL"))
        .andExpect(jsonPath("$.errors.scope").value("ISSUE"))
        .andExpect(jsonPath("$.message").value("이슈 메모리가 가득 찼어요(최대 50개). 필요 없는 항목을 지워 주세요"));
    // 공통이 가득이면 범위는 COMMON, 문구는 WP-55 그대로.
    call(uid, post(BASE).content(createBody("PREFERENCE", "공통 51", null)))
        .andExpect(status().isConflict())
        .andExpect(jsonPath("$.errors.scope").value("COMMON"))
        .andExpect(jsonPath("$.message").value("메모리가 가득 찼어요(최대 50개). 필요 없는 항목을 지워 주세요"));
    call(uid, post(BASE).content(createBody("PREFERENCE", "메일 1", "MAIL")))
        .andExpect(status().isCreated());
  }

  @Test
  void 범위를_옮기고_null_은_공통으로_되돌리며_키를_생략하면_범위를_유지한다() throws Exception {
    long uid = TestFixtures.createHuman(dsl);
    long id = idOf(call(uid, post(BASE).content(createBody("PREFERENCE", "목록은 짧게", "ISSUE"))));
    call(uid, patch(BASE + "/" + id).content("{\"scope\":\"MAIL\"}"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.scope").value("MAIL"))
        .andExpect(jsonPath("$.previousScope").value("ISSUE"))
        .andExpect(jsonPath("$.content").value("목록은 짧게"));
    // 구 웹처럼 내용만 보내면 범위는 그대로다.
    call(uid, patch(BASE + "/" + id).content("{\"content\":\"목록은 담당자만\"}"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.scope").value("MAIL"))
        .andExpect(jsonPath("$.previousScope").value("MAIL"));
    call(uid, patch(BASE + "/" + id).content("{\"scope\":null}"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.scope").value(nullValue()))
        .andExpect(jsonPath("$.previousScope").value("MAIL"));
  }

  /** 가득 찬 범위로 옮기는 것만 막는다 — 그 범위 안의 내용 고치기는 된다. */
  @Test
  void 가득_찬_범위로_옮기면_409_이고_같은_범위_안_고치기는_된다() throws Exception {
    long uid = TestFixtures.createHuman(dsl);
    long common = idOf(call(uid, post(BASE).content(createBody("PREFERENCE", "공통 하나", null))));
    fill(uid, "ISSUE", 50);
    call(uid, patch(BASE + "/" + common).content("{\"scope\":\"ISSUE\"}"))
        .andExpect(status().isConflict())
        .andExpect(jsonPath("$.errors.code").value("AI_MEMORY_FULL"))
        .andExpect(jsonPath("$.errors.scope").value("ISSUE"));
    long issueId =
        AiMemoryTestFixtures.allMemories(dsl, uid).stream()
            .filter(r -> "ISSUE".equals(r.scope()))
            .findFirst()
            .orElseThrow()
            .id();
    call(uid, patch(BASE + "/" + issueId).content("{\"content\":\"이슈 고침\",\"scope\":\"ISSUE\"}"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.content").value("이슈 고침"));
    assertThat(repo.countInScope(uid, "ISSUE", LocalDate.of(2026, 10, 14))).isEqualTo(50);
    assertThat(repo.countInScope(uid, null, LocalDate.of(2026, 10, 14))).isEqualTo(1);
  }

  @Test
  void 목록은_범위를_합쳐_50개를_넘어도_전부_돌려준다() throws Exception {
    long uid = TestFixtures.createHuman(dsl);
    fill(uid, null, 50);
    fill(uid, "ISSUE", 3);
    call(uid, get(BASE)).andExpect(jsonPath("$.items.length()").value(53));
  }

  /** 주입은 범위마다 최신 50개씩 — 공통 55·이슈 52·메일 3 에서 이슈 화면이면 공통 50 + 이슈 50, 메일은 없다. */
  @Test
  void 채팅_주입은_공통과_그_앱만_범위마다_최신_50개씩이다() {
    long uid = TestFixtures.createHuman(dsl);
    for (int i = 0; i < 55; i++)
      repo.insert(uid, new NewMemory("PREFERENCE", "c" + i, "USER", null, null, null));
    for (int i = 0; i < 52; i++)
      repo.insert(uid, new NewMemory("PREFERENCE", "i" + i, "USER", null, "ISSUE", null));
    for (int i = 0; i < 3; i++)
      repo.insert(uid, new NewMemory("PREFERENCE", "m" + i, "USER", null, "MAIL", null));

    AiMemoryService.ChatMemories m = memoryService.loadForChat(uid, "ISSUE");

    assertThat(m.enabled()).isTrue();
    assertThat(m.items()).hasSize(100);
    assertThat(m.items()).filteredOn(c -> "ISSUE".equals(c.scope())).hasSize(50);
    assertThat(m.items()).noneMatch(c -> "MAIL".equals(c.scope()));
    // 각 범위의 가장 오래된 것부터 빠진다.
    assertThat(m.items())
        .extracting(AiMemoryLine::content)
        .doesNotContain("c0", "c4", "i0", "i1")
        .contains("c5", "c54", "i2", "i51");
    // 최신순 — 마지막에 넣은 이슈가 맨 앞.
    assertThat(m.items().get(0).content()).isEqualTo("i51");
  }
}
