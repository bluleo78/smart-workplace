package com.workplace.home.controller;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.authentication;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workplace.global.tenant.TenantContext;
import com.workplace.home.dto.AiMemoryItem;
import com.workplace.home.exception.AiMemoryException;
import com.workplace.home.repository.AiMemoryRepository;
import com.workplace.home.repository.AiMemoryRepository.NewMemory;
import com.workplace.home.repository.AiMemoryRepository.Row;
import com.workplace.home.service.AiMemoryService;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
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
 * WP-383 고정 — 사용자 전용 토글(Internal 대행 403), 범위마다 10개(만료 행 포함, 409 AI_MEMORY_PIN_FULL + 범위), 토글은
 * updated_at 을 바꾸지 않는다, 고정 행을 다른 범위로 옮길 때도 고정 상한을 센다, 지움 되돌리기는 고정을 푼다(판정 1~3).
 */
@Transactional
class AiMemoryPinTest extends IntegrationTestBase {

  private static final String BASE = "/api/v1/users/me/ai-memories";

  @Autowired MockMvc mvc;
  @Autowired DSLContext dsl;
  @Autowired AiMemoryRepository repo;
  @Autowired AiMemoryService memories;

  /** 브라우저 사용자 인증. */
  private ResultActions call(long uid, MockHttpServletRequestBuilder rb) throws Exception {
    return mvc.perform(
        rb.with(authentication(new UsernamePasswordAuthenticationToken(uid, "n/a", List.of())))
            .contentType(MediaType.APPLICATION_JSON));
  }

  /** ai-agent 처럼 Internal + 대행 헤더로 부른다. 필터가 지운 테스트 스레드 TenantContext 를 되돌린다. */
  private ResultActions internal(long uid, MockHttpServletRequestBuilder rb) throws Exception {
    try {
      return mvc.perform(
          rb.header("Authorization", "Internal test-token")
              .header("X-On-Behalf-Of", String.valueOf(uid))
              .contentType(MediaType.APPLICATION_JSON));
    } finally {
      TenantContext.set(1L);
    }
  }

  private static NewMemory mem(String content, String scope) {
    return new NewMemory("PREFERENCE", content, "USER", null, scope, null);
  }

  private Row row(long uid, long id) {
    return repo.lock(uid, id).orElseThrow();
  }

  private void pin(long uid, long id) throws Exception {
    call(uid, put(BASE + "/" + id + "/pin").content("{\"pinned\":true}"))
        .andExpect(status().isOk());
  }

  @Test
  void 고정하면_pinned_가_켜지고_최신순_자리는_그대로다() throws Exception {
    long uid = TestFixtures.createHuman(dsl);
    long older = repo.insert(uid, mem("오래된 것", null)).id();
    long newer = repo.insert(uid, mem("새 것", null)).id();
    Instant before = row(uid, older).updatedAt();

    call(uid, put(BASE + "/" + older + "/pin").content("{\"pinned\":true}"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.pinned").value(true));

    assertThat(row(uid, older).updatedAt()).isEqualTo(before);
    call(uid, get(BASE))
        .andExpect(jsonPath("$.items[0].id").value(newer))
        .andExpect(jsonPath("$.items[0].pinned").value(false))
        .andExpect(jsonPath("$.items[1].pinned").value(true))
        .andExpect(jsonPath("$.limit").value(AiMemoryService.LIMIT))
        .andExpect(jsonPath("$.pinLimit").value(AiMemoryService.PIN_LIMIT));
    call(uid, put(BASE + "/" + older + "/pin").content("{\"pinned\":false}"))
        .andExpect(jsonPath("$.pinned").value(false));
  }

  @Test
  void 범위마다_고정은_10개다_만료_행도_세고_다른_범위는_된다() throws Exception {
    long uid = TestFixtures.createHuman(dsl);
    for (int i = 0; i < AiMemoryService.PIN_LIMIT - 1; i++) {
      pin(uid, repo.insert(uid, mem("공통 " + i, null)).id());
    }
    // 만료된 고정 행도 센다(판정 1) — 되살리기가 고정 상한을 넘기지 않게.
    long expired =
        repo.insert(
                uid,
                new NewMemory("PREFERENCE", "지난 일", "USER", null, null, LocalDate.of(2020, 1, 1)))
            .id();
    repo.setPinned(uid, expired, true);
    long extra = repo.insert(uid, mem("하나 더", null)).id();

    call(uid, put(BASE + "/" + extra + "/pin").content("{\"pinned\":true}"))
        .andExpect(status().isConflict())
        .andExpect(jsonPath("$.errors.code").value("AI_MEMORY_PIN_FULL"))
        .andExpect(jsonPath("$.errors.scope").value("COMMON"))
        .andExpect(jsonPath("$.message").value("메모리 고정은 최대 10개예요. 다른 고정을 풀어 주세요"));
    long issue = repo.insert(uid, mem("이슈 것", "ISSUE")).id();
    pin(uid, issue);
    // 이미 고정된 행을 다시 고정하는 것은 상한과 무관하다.
    pin(uid, expired);
  }

  @Test
  void 고정_행을_고정이_가득한_범위로_옮기면_409() throws Exception {
    long uid = TestFixtures.createHuman(dsl);
    for (int i = 0; i < AiMemoryService.PIN_LIMIT; i++) {
      pin(uid, repo.insert(uid, mem("이슈 " + i, "ISSUE")).id());
    }
    long common = repo.insert(uid, mem("공통 고정", null)).id();
    pin(uid, common);

    call(uid, patch(BASE + "/" + common).content("{\"scope\":\"ISSUE\"}"))
        .andExpect(status().isConflict())
        .andExpect(jsonPath("$.errors.code").value("AI_MEMORY_PIN_FULL"))
        .andExpect(jsonPath("$.errors.scope").value("ISSUE"))
        .andExpect(jsonPath("$.message").value("이슈 메모리 고정은 최대 10개예요. 다른 고정을 풀어 주세요"));
    assertThat(row(uid, common).scope()).isNull();
    // 고정이 아닌 행은 옮겨진다.
    long plain = repo.insert(uid, mem("공통 보통", null)).id();
    call(uid, patch(BASE + "/" + plain).content("{\"scope\":\"ISSUE\"}"))
        .andExpect(status().isOk());
  }

  @Test
  void AI_대행은_고정할_수_없다_403() throws Exception {
    long uid = withMembership(TestFixtures.createHuman(dsl));
    long id = repo.insert(uid, mem("x", null)).id();

    internal(uid, put(BASE + "/" + id + "/pin").content("{\"pinned\":true}"))
        .andExpect(status().isForbidden())
        .andExpect(jsonPath("$.errors.code").value("AI_MEMORY_PIN_USER_ONLY"));
    assertThat(row(uid, id).pinned()).isFalse();
  }

  @Test
  void 남의_메모리는_404_이고_pinned_가_없으면_400() throws Exception {
    long owner = TestFixtures.createHuman(dsl);
    long other = TestFixtures.createHuman(dsl);
    long id = repo.insert(owner, mem("x", null)).id();

    call(other, put(BASE + "/" + id + "/pin").content("{\"pinned\":true}"))
        .andExpect(status().isNotFound())
        .andExpect(jsonPath("$.errors.code").value("AI_MEMORY_NOT_FOUND"));
    call(owner, put(BASE + "/" + id + "/pin").content("{}"))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.errors.code").value("AI_MEMORY_INVALID"));
  }

  @Test
  void 지움_되돌리기는_고정을_풀고_다시_만든다() {
    long uid = TestFixtures.createHuman(dsl);
    long id = repo.insert(uid, mem("다시 만들 것", null)).id();
    repo.setPinned(uid, id, true);
    memories.delete(uid, id, false);

    AiMemoryItem back = memories.restore(uid, id, "PREFERENCE", "다시 만들 것", "USER", null, null);

    assertThat(back.id()).isEqualTo(id);
    assertThat(back.pinned()).isFalse();
  }

  @Test
  void 범위_이동_되돌리기도_고정이_가득한_범위로는_409() {
    long uid = TestFixtures.createHuman(dsl);
    for (int i = 0; i < AiMemoryService.PIN_LIMIT; i++) {
      long id = repo.insert(uid, mem("공통 " + i, null)).id();
      repo.setPinned(uid, id, true);
    }
    // 고정된 이슈 범위 행 — 되돌리기 대상은 "공통 → 이슈" 로 옮겨진 고침이다(이전 범위 = 공통).
    long moved = repo.insert(uid, mem("옮겨진 것", "ISSUE")).id();
    repo.setPinned(uid, moved, true);
    var after = new AiMemoryService.Snapshot("옮겨진 것", "PREFERENCE", "ISSUE", null);
    var before = new AiMemoryService.Snapshot("옮겨진 것", "PREFERENCE", null, null);

    assertThatThrownBy(() -> memories.restoreContent(uid, moved, after, before))
        .isInstanceOfSatisfying(
            AiMemoryException.class,
            e -> {
              assertThat(e.code()).isEqualTo(AiMemoryException.PIN_FULL);
              assertThat(e.status().value()).isEqualTo(409);
            });
    assertThat(row(uid, moved).scope()).isEqualTo("ISSUE");
  }
}
