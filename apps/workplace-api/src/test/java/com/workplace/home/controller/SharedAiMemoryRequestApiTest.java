package com.workplace.home.controller;

import static com.workplace.home.SharedMemoryFixtures.addProjectMember;
import static com.workplace.home.SharedMemoryFixtures.addWikiMember;
import static com.workplace.home.SharedMemoryFixtures.project;
import static com.workplace.home.SharedMemoryFixtures.teamWiki;
import static com.workplace.home.SharedMemoryFixtures.user;
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
import com.workplace.global.tenant.TenantContext;
import com.workplace.home.exception.MemoryCleanupAiException;
import com.workplace.home.outbound.AiAgentSharedMemoryClient;
import com.workplace.home.outbound.SharedMemoryMessages.CheckRequest;
import com.workplace.home.outbound.SharedMemoryMessages.CheckResult;
import com.workplace.home.outbound.SharedMemoryMessages.Verdict;
import com.workplace.home.repository.HomeMessageRepository;
import com.workplace.home.repository.SharedAiMemoryRepository;
import com.workplace.home.service.HomeSessionService;
import com.workplace.home.service.SharedSpace.SpaceKey;
import com.workplace.project.repository.ProjectMemberRepository;
import com.workplace.project.service.ProjectService;
import com.workplace.support.FakeTextEmbedderConfig;
import com.workplace.support.IntegrationTestBase;
import com.workplace.wiki.service.WikiSpaceService;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.client.ResourceAccessException;

/**
 * WP-386 스펙 6.2 — 직접 요청: 지금 공간(대화의 마지막 사용자 메시지 공간)·이름 지정, 권한, 한도, 공용성 검사(통과·개인 422·실패 503), 사람 요청
 * 출처·기록. 검사 결과가 불통과·실패면 공용에도 개인에도 아무것도 저장하지 않는다.
 */
@Transactional
@Import(FakeTextEmbedderConfig.class)
class SharedAiMemoryRequestApiTest extends IntegrationTestBase {

  @Autowired MockMvc mvc;
  @Autowired DSLContext dsl;
  @Autowired ProjectService projectService;
  @Autowired ProjectMemberRepository projectMembers;
  @Autowired HomeSessionService sessions;
  @Autowired HomeMessageRepository messages;
  @Autowired SharedAiMemoryRepository repo;
  @Autowired WikiSpaceService wikiService;
  @MockitoBean AiAgentSharedMemoryClient client;
  @MockitoBean AssistantResolver assistantResolver;

  long owner;
  long member;
  long projectId;
  SpaceKey k;
  UUID sessionId;

  @BeforeEach
  void seed() {
    owner = user(dsl);
    member = user(dsl);
    var p = project(projectService, owner, "REQ", "TEAM");
    projectId = p.id();
    addProjectMember(projectMembers, projectId, member);
    k = SpaceKey.of("PROJECT", projectId);
    sessionId = sessions.create(member).id();
    long mid =
        sessions.appendMessage(member, sessionId, "USER", "이건 이 프로젝트 규칙으로 기억해", null, null, null);
    messages.setSpace(sessionId, mid, k);
    when(assistantResolver.resolveOrEmpty(anyLong()))
        .thenReturn(
            Optional.of(
                new AssistantSpec(
                    9L, "claude-sonnet-4-6", "NORMAL", 8, 60000, "claude-haiku-5-5")));
  }

  @AfterEach
  void tenant() {
    TenantContext.set(1L);
  }

  private void verdict(boolean teamWide, boolean personal) {
    when(client.checkNow(any()))
        .thenReturn(new CheckResult(List.of(new Verdict(teamWide, personal, "r"))));
  }

  /** ai-agent 처럼 Internal + 대행 헤더로 부른다. 오류 응답을 거치면 필터가 테스트 스레드의 테넌트를 지우므로 요청 전에 되돌린다. */
  private ResultActions request(long uid, String json) throws Exception {
    TenantContext.set(1L);
    return mvc.perform(
        post("/api/v1/shared-ai-memories/requests")
            .header("Authorization", "Internal test-token")
            .header("X-On-Behalf-Of", String.valueOf(uid))
            .contentType(MediaType.APPLICATION_JSON)
            .content(json));
  }

  @Test
  void 지금_공간에_사람_요청으로_저장하고_기록을_남긴다() throws Exception {
    verdict(true, false);
    request(member, "{\"content\":\"PR 설명에는 바뀐 화면 캡처를 붙인다\",\"sessionId\":\"" + sessionId + "\"}")
        .andExpect(status().isCreated())
        .andExpect(jsonPath("$.spaceType").value("PROJECT"))
        .andExpect(jsonPath("$.spaceId").value(projectId))
        .andExpect(jsonPath("$.spaceName").value("REQ 프로젝트(REQ)"))
        .andExpect(jsonPath("$.changeId").isNumber());
    var rows = repo.all(k);
    assertThat(rows).hasSize(1);
    assertThat(rows.get(0).origin()).isEqualTo("USER_REQUESTED");
    assertThat(rows.get(0).authorUserId()).isEqualTo(member);
    ArgumentCaptor<CheckRequest> cap = ArgumentCaptor.forClass(CheckRequest.class);
    verify(client).checkNow(cap.capture());
    assertThat(cap.getValue().candidates()).containsExactly("PR 설명에는 바뀐 화면 캡처를 붙인다");
    assertThat(cap.getValue().model()).isEqualTo("claude-haiku-5-5");
    assertThat(cap.getValue().timeoutMs()).isEqualTo(12_000);
    assertThat(cap.getValue().spaceType()).isEqualTo("PROJECT");
    assertThat(cap.getValue().spaceName()).isEqualTo("REQ 프로젝트(REQ)");
  }

  @Test
  void 기록은_요청한_사람의_ADDED_이고_응답_changeId_와_같다() throws Exception {
    verdict(true, false);
    String json =
        request(
                member,
                "{\"content\":\"PR 설명에는 바뀐 화면 캡처를 붙인다\",\"sessionId\":\"" + sessionId + "\"}")
            .andExpect(status().isCreated())
            .andReturn()
            .getResponse()
            .getContentAsString();
    long changeId =
        new com.fasterxml.jackson.databind.ObjectMapper().readTree(json).path("changeId").asLong();
    var c = com.workplace.jooq.Tables.SHARED_AI_MEMORY_CHANGE;
    var rec = dsl.selectFrom(c).where(c.ID.eq(changeId)).fetchOne();
    assertThat(rec.getAction()).isEqualTo("ADDED");
    assertThat(rec.getActorUserId()).isEqualTo(member);
    assertThat(rec.getActorKind()).isEqualTo("USER");
    assertThat(rec.getMemoryId()).isEqualTo(repo.all(k).get(0).id());
  }

  @Test
  void 제어문자는_걷어_낸_뒤_검사하고_저장한다() throws Exception {
    verdict(true, false);
    request(member, "{\"content\":\" 배포는\\u0000 API 먼저 한다 \",\"sessionId\":\"" + sessionId + "\"}")
        .andExpect(status().isCreated())
        .andExpect(jsonPath("$.content").value("배포는 API 먼저 한다"));
    ArgumentCaptor<CheckRequest> cap = ArgumentCaptor.forClass(CheckRequest.class);
    verify(client).checkNow(cap.capture());
    assertThat(cap.getValue().candidates()).containsExactly("배포는 API 먼저 한다");
    assertThat(repo.all(k).get(0).content()).isEqualTo("배포는 API 먼저 한다");
  }

  @Test
  void 내용이_비었거나_300자를_넘으면_400_이고_검사하지_않는다() throws Exception {
    request(member, "{\"content\":\"  \",\"sessionId\":\"" + sessionId + "\"}")
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.errors.code").value("SHARED_MEMORY_INVALID"));
    request(member, "{\"content\":\"" + "가".repeat(301) + "\",\"sessionId\":\"" + sessionId + "\"}")
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.errors.code").value("SHARED_MEMORY_INVALID"));
    verify(client, never()).checkNow(any());
  }

  @Test
  void 남의_대화로_지금_공간을_알아내지_못한다() throws Exception {
    request(owner, "{\"content\":\"배포는 API 먼저 한다\",\"sessionId\":\"" + sessionId + "\"}")
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.errors.code").value("SHARED_MEMORY_SPACE_UNRESOLVED"));
    verify(client, never()).checkNow(any());
  }

  @Test
  void 개인적_내용이면_422_이고_아무것도_저장하지_않는다() throws Exception {
    verdict(false, true);
    request(member, "{\"content\":\"나는 금요일마다 재택한다\",\"sessionId\":\"" + sessionId + "\"}")
        .andExpect(status().isUnprocessableEntity())
        .andExpect(jsonPath("$.errors.code").value("SHARED_MEMORY_PERSONAL"));
    assertThat(repo.count(k)).isZero();
  }

  @Test
  void 검사_시간_초과는_503_이고_아무것도_저장하지_않는다() throws Exception {
    when(client.checkNow(any()))
        .thenThrow(
            new MemoryCleanupAiException("x", new ResourceAccessException("Read timed out")));
    request(member, "{\"content\":\"배포는 API 먼저 한다\",\"sessionId\":\"" + sessionId + "\"}")
        .andExpect(status().isServiceUnavailable())
        .andExpect(jsonPath("$.errors.code").value("SHARED_MEMORY_CHECK_UNAVAILABLE"));
    assertThat(repo.count(k)).isZero();
    assertThat(
            dsl.fetchCount(
                com.workplace.jooq.Tables.AI_MEMORY,
                com.workplace.jooq.Tables.AI_MEMORY.USER_ID.eq(member)))
        .isZero();
  }

  @Test
  void 지금_공간이_없으면_어느_공간인지_묻게_400() throws Exception {
    UUID other = sessions.create(member).id();
    sessions.appendMessage(member, other, "USER", "기억해", null, null, null);
    request(member, "{\"content\":\"배포는 API 먼저 한다\",\"sessionId\":\"" + other + "\"}")
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.errors.code").value("SHARED_MEMORY_SPACE_UNRESOLVED"));
    verify(client, never()).checkNow(any());
  }

  @Test
  void 이름으로_공간을_고른다() throws Exception {
    verdict(true, false);
    request(member, "{\"content\":\"배포는 API 먼저 한다\",\"space\":\"req\"}")
        .andExpect(status().isCreated())
        .andExpect(jsonPath("$.spaceId").value(projectId));
    request(member, "{\"content\":\"배포는 API 먼저 한다\",\"space\":\"없는 공간\"}")
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.errors.code").value("SHARED_MEMORY_SPACE_UNRESOLVED"));
  }

  /** 읽을 수는 있지만 추가할 수 없는 공간(노트 스페이스 VIEWER)을 이름으로 말하면 "못 찾음" 400 이 아니라 403 으로 알린다. */
  @Test
  void 읽기만_되는_공간을_이름으로_말하면_403() throws Exception {
    verdict(true, false);
    long wiki = teamWiki(wikiService, owner, "읽기전용 노트");
    addWikiMember(wikiService, owner, wiki, member, "VIEWER");
    request(member, "{\"content\":\"배포는 API 먼저 한다\",\"space\":\"읽기전용 노트\"}")
        .andExpect(status().isForbidden())
        .andExpect(jsonPath("$.errors.code").value("SHARED_MEMORY_FORBIDDEN"))
        .andExpect(jsonPath("$.message").value(org.hamcrest.Matchers.containsString("읽기전용 노트")));
    verify(client, never()).checkNow(any());
    assertThat(repo.count(SpaceKey.of("WIKI_SPACE", wiki))).isZero();
  }

  @Test
  void 조직은_요청으로_쓰지_못한다() throws Exception {
    verdict(true, false);
    request(member, "{\"content\":\"모든 문서는 존댓말\",\"space\":\"조직\"}")
        .andExpect(status().isForbidden())
        .andExpect(jsonPath("$.errors.code").value("SHARED_MEMORY_FORBIDDEN"));
    verify(client, never()).checkNow(any());
  }

  @Test
  void 세션도_공간_이름도_없으면_400() throws Exception {
    request(member, "{\"content\":\"배포는 API 먼저 한다\"}")
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.errors.code").value("SHARED_MEMORY_SPACE_UNRESOLVED"));
    verify(client, never()).checkNow(any());
  }

  @Test
  void 형식이_깨진_검사_결과는_422_가_아니라_503_이고_아무것도_저장하지_않는다() throws Exception {
    String body = "{\"content\":\"배포는 API 먼저 한다\",\"sessionId\":\"" + sessionId + "\"}";
    for (CheckResult broken :
        List.of(
            new CheckResult(List.of()),
            new CheckResult(null),
            new CheckResult(java.util.Arrays.asList((Verdict) null)),
            new CheckResult(
                List.of(new Verdict(true, false, "a"), new Verdict(true, false, "b"))))) {
      when(client.checkNow(any())).thenReturn(broken);
      request(member, body)
          .andExpect(status().isServiceUnavailable())
          .andExpect(jsonPath("$.errors.code").value("SHARED_MEMORY_CHECK_UNAVAILABLE"));
    }
    assertThat(repo.count(k)).isZero();
  }

  @Test
  void 구성원이_아닌_공개_프로젝트는_403_이고_가득이면_409_이고_검사하지_않는다() throws Exception {
    long outsider = user(dsl);
    var open = project(projectService, owner, "REO", "OPEN");
    // 읽을 수 있지만 구성원이 아니라 추가할 수 없는 공간 — 못 찾음(400)이 아니라 권한 없음(403).
    request(outsider, "{\"content\":\"구경꾼 규칙\",\"space\":\"REO\"}")
        .andExpect(status().isForbidden())
        .andExpect(jsonPath("$.errors.code").value("SHARED_MEMORY_FORBIDDEN"));
    assertThat(repo.count(SpaceKey.of("PROJECT", open.id()))).isZero();
    OffsetDateTime t = OffsetDateTime.now(ZoneOffset.UTC);
    for (int i = 0; i < 50; i++) repo.insert(k, "채움 " + i, "USER_ADDED", owner, owner, t);
    request(member, "{\"content\":\"하나 더\",\"sessionId\":\"" + sessionId + "\"}")
        .andExpect(status().isConflict())
        .andExpect(jsonPath("$.errors.code").value("SHARED_MEMORY_FULL"));
    verify(client, never()).checkNow(any());
  }

  @Test
  void 비서가_없으면_503() throws Exception {
    when(assistantResolver.resolveOrEmpty(anyLong())).thenReturn(Optional.empty());
    request(member, "{\"content\":\"배포는 API 먼저 한다\",\"sessionId\":\"" + sessionId + "\"}")
        .andExpect(status().isServiceUnavailable())
        .andExpect(jsonPath("$.errors.code").value("SHARED_MEMORY_CHECK_UNAVAILABLE"));
    verify(client, never()).checkNow(any());
    assertThat(repo.count(k)).isZero();
  }

  @Test
  void 사람이_브라우저로_부르면_403() throws Exception {
    TenantContext.set(1L);
    mvc.perform(
            post("/api/v1/shared-ai-memories/requests")
                .with(
                    authentication(
                        new UsernamePasswordAuthenticationToken(member, "n/a", List.of())))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"content\":\"x\",\"sessionId\":\"" + sessionId + "\"}"))
        .andExpect(status().isForbidden());
  }
}
