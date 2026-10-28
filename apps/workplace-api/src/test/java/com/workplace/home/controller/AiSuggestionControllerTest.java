package com.workplace.home.controller;

import static com.workplace.jooq.Tables.HOME_SESSION;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.authentication;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workplace.auth.service.AssistantResolver;
import com.workplace.auth.service.AssistantSpec;
import com.workplace.home.outbound.AiAgentSuggestionClient;
import com.workplace.home.outbound.ChatMessages.SuggestionRequest;
import com.workplace.home.service.HomeSessionService;
import com.workplace.support.ExternalClientMockedTestBase;
import com.workplace.support.TestFixtures;
import com.workplace.user.service.AiPreferenceService;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

/** WP-139 POST /api/v1/ai/suggestions — 켜짐/꺼짐/비서 없음, 화면 참고 유무에 따른 최근 제목·개수, ai-agent 실패 시 빈 결과. */
@Transactional
@TestPropertySource(properties = "workplace.ai-agent.enabled=true")
class AiSuggestionControllerTest extends ExternalClientMockedTestBase {

  @Autowired MockMvc mvc;
  @Autowired DSLContext dsl;
  @Autowired HomeSessionService sessionService;
  @Autowired AiPreferenceService preferences;
  @Autowired AiAgentSuggestionClient suggestionClient;
  @Autowired AssistantResolver assistantResolver;

  private Authentication auth(long userId) {
    return new UsernamePasswordAuthenticationToken(userId, "n/a", List.of());
  }

  private void stubAssistant() {
    when(assistantResolver.resolveOrEmpty(anyLong()))
        .thenReturn(
            Optional.of(
                new AssistantSpec(
                    5L, "claude-sonnet-5-5", "NORMAL", 8, 60000, "claude-haiku-5-5")));
  }

  /** 제목이 있는 세션 — 최근 활동 시각을 직접 정해 순서를 결정적으로 만든다(같은 트랜잭션의 now() 는 모두 같다). */
  private void session(long uid, String title, int minutesAgo) {
    UUID sid = sessionService.create(uid).id();
    sessionService.appendMessage(uid, sid, "USER", title, null, null, null);
    dsl.update(HOME_SESSION)
        .set(
            HOME_SESSION.LAST_MESSAGE_AT,
            OffsetDateTime.now(ZoneOffset.UTC).minusMinutes(minutesAgo))
        .where(HOME_SESSION.ID.eq(sid))
        .execute();
  }

  /** 제목이 없거나(null) 빈 세션 — 최근 활동 시각은 직접 정한다(메시지 없는 세션은 NULL 이라 DESC 정렬에서 맨 앞에 온다). */
  private void untitledSession(long uid, String title, int minutesAgo) {
    UUID sid = sessionService.create(uid).id();
    dsl.update(HOME_SESSION)
        .set(HOME_SESSION.TITLE, title)
        .set(
            HOME_SESSION.LAST_MESSAGE_AT,
            OffsetDateTime.now(ZoneOffset.UTC).minusMinutes(minutesAgo))
        .where(HOME_SESSION.ID.eq(sid))
        .execute();
  }

  private SuggestionRequest captured() {
    ArgumentCaptor<SuggestionRequest> c = ArgumentCaptor.forClass(SuggestionRequest.class);
    verify(suggestionClient).suggest(c.capture());
    return c.getValue();
  }

  @Test
  void 화면_참고가_없으면_최근_대화_제목_5개를_싣고_일반_4개를_요청한다() throws Exception {
    long uid = TestFixtures.createHuman(dsl);
    stubAssistant();
    for (int i = 1; i <= 6; i++) session(uid, "대화 " + i, i);
    when(suggestionClient.suggest(any())).thenReturn(List.of("오늘 일정 요약해줘"));

    mvc.perform(
            post("/api/v1/ai/suggestions")
                .with(authentication(auth(uid)))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{}"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.items[0]").value("오늘 일정 요약해줘"))
        .andExpect(jsonPath("$.enabled").value(true));

    SuggestionRequest req = captured();
    assertThat(req.mode()).isEqualTo("starter");
    assertThat(req.agentId()).isEqualTo(5L);
    assertThat(req.model()).isEqualTo("claude-haiku-5-5");
    assertThat(req.count()).isEqualTo(4);
    assertThat(req.timeoutMs()).isEqualTo(15_000);
    assertThat(req.screenContext()).isNull();
    assertThat(req.recentTitles()).containsExactly("대화 1", "대화 2", "대화 3", "대화 4", "대화 5");
  }

  @Test
  void 화면_맞춤이면_제목_없이_3개를_요청한다() throws Exception {
    long uid = TestFixtures.createHuman(dsl);
    stubAssistant();
    session(uid, "다른 대화", 1);
    when(suggestionClient.suggest(any())).thenReturn(List.of());

    mvc.perform(
            post("/api/v1/ai/suggestions")
                .with(authentication(auth(uid)))
                .contentType(MediaType.APPLICATION_JSON)
                .content(
                    "{\"screenContext\":{\"view\":\"이슈 상세\",\"focus\":{\"type\":\"이슈\","
                        + "\"label\":\"WP-12 로그인 버그\",\"refs\":{\"issueKey\":\"WP-12\"}}}}"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.items").isEmpty());

    SuggestionRequest req = captured();
    assertThat(req.count()).isEqualTo(3);
    assertThat(req.recentTitles()).isNull();
    assertThat(req.screenContext().focus().refs()).containsEntry("issueKey", "WP-12");
  }

  @Test
  void 대상이_없는_화면이면_화면_참고는_싣되_일반_4개() throws Exception {
    long uid = TestFixtures.createHuman(dsl);
    stubAssistant();
    when(suggestionClient.suggest(any())).thenReturn(List.of());
    mvc.perform(
            post("/api/v1/ai/suggestions")
                .with(authentication(auth(uid)))
                .contentType(MediaType.APPLICATION_JSON)
                .content(
                    "{\"screenContext\":{\"view\":\"이슈 목록\",\"scope\":{\"label\":\"프로젝트 WP\"}}}"))
        .andExpect(status().isOk());
    SuggestionRequest req = captured();
    assertThat(req.count()).isEqualTo(4);
    assertThat(req.recentTitles()).isNull();
  }

  @Test
  void 추천을_끄면_ai_agent_를_부르지_않고_enabled_false() throws Exception {
    long uid = TestFixtures.createHuman(dsl);
    stubAssistant();
    preferences.update(uid, false, null);
    mvc.perform(
            post("/api/v1/ai/suggestions")
                .with(authentication(auth(uid)))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{}"))
        .andExpect(jsonPath("$.items").isEmpty())
        .andExpect(jsonPath("$.enabled").value(false));
    verify(suggestionClient, never()).suggest(any());
  }

  @Test
  void 비서가_없으면_빈_결과() throws Exception {
    long uid = TestFixtures.createHuman(dsl);
    when(assistantResolver.resolveOrEmpty(anyLong())).thenReturn(Optional.empty());
    mvc.perform(
            post("/api/v1/ai/suggestions")
                .with(authentication(auth(uid)))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{}"))
        .andExpect(jsonPath("$.items").isEmpty())
        .andExpect(jsonPath("$.enabled").value(true));
    verify(suggestionClient, never()).suggest(any());
  }

  @Test
  void 화면_참고_검증_실패는_400() throws Exception {
    long uid = TestFixtures.createHuman(dsl);
    mvc.perform(
            post("/api/v1/ai/suggestions")
                .with(authentication(auth(uid)))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"screenContext\":{\"view\":\"\"}}"))
        .andExpect(status().isBadRequest());
  }

  @Test
  void ai_agent_실패로_빈_목록이면_200_빈_결과에_enabled_true() throws Exception {
    // 클라이언트는 ai-agent 의 모든 실패(502·시간 초과·연결 오류)를 빈 목록으로 바꾼다 — 컨트롤러도 오류 없이 빈 결과를 돌려 웹이 보이던 문구를 유지한다.
    long uid = TestFixtures.createHuman(dsl);
    stubAssistant();
    when(suggestionClient.suggest(any())).thenReturn(List.of());
    mvc.perform(
            post("/api/v1/ai/suggestions")
                .with(authentication(auth(uid)))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{}"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.items").isArray())
        .andExpect(jsonPath("$.items").isEmpty())
        .andExpect(jsonPath("$.enabled").value(true));
  }

  @Test
  void 최근_대화_제목은_다른_사용자와_제목_없는_대화를_뺀다() throws Exception {
    long uid = TestFixtures.createHuman(dsl);
    long other = TestFixtures.createHuman(dsl);
    stubAssistant();
    when(suggestionClient.suggest(any())).thenReturn(List.of());
    session(uid, "내 대화", 30);
    // 제외 대상은 더 최근으로 둔다 — 조건이 빠지면 맨 앞에 끼어 보인다.
    session(other, "남의 대화", 1);
    untitledSession(uid, null, 2);
    untitledSession(uid, "", 3);

    mvc.perform(
            post("/api/v1/ai/suggestions")
                .with(authentication(auth(uid)))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{}"))
        .andExpect(status().isOk());

    assertThat(captured().recentTitles()).containsExactly("내 대화");
  }
}
