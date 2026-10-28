package com.workplace.home.controller;

import static com.workplace.home.SharedMemoryFixtures.addProjectMember;
import static com.workplace.home.SharedMemoryFixtures.addWikiMember;
import static com.workplace.home.SharedMemoryFixtures.grantAdmin;
import static com.workplace.home.SharedMemoryFixtures.project;
import static com.workplace.home.SharedMemoryFixtures.teamWiki;
import static com.workplace.home.SharedMemoryFixtures.user;
import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.hasSize;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.authentication;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.global.tenant.TenantContext;
import com.workplace.home.repository.CursorCodec;
import com.workplace.home.repository.SharedAiMemoryForgottenRepository;
import com.workplace.home.repository.SharedAiMemoryRepository;
import com.workplace.home.service.SharedSpace.SpaceKey;
import com.workplace.project.repository.ProjectMemberRepository;
import com.workplace.project.service.ProjectService;
import com.workplace.support.FakeTextEmbedder;
import com.workplace.support.IntegrationTestBase;
import com.workplace.wiki.service.WikiSpaceService;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.test.web.servlet.request.RequestPostProcessor;
import org.springframework.transaction.annotation.Transactional;

/** WP-386 관리 API — 공간 목록·권한 표(추가·고치기·지우기)·한도·키셋·검색·지운 기록·내부 토큰 쓰기 거절. */
@Transactional
class SharedAiMemoryApiTest extends IntegrationTestBase {

  @Autowired MockMvc mvc;
  @Autowired ObjectMapper om;
  @Autowired DSLContext dsl;
  @Autowired ProjectService projectService;
  @Autowired ProjectMemberRepository projectMembers;
  @Autowired WikiSpaceService wikiService;
  @Autowired SharedAiMemoryRepository repo;
  @Autowired SharedAiMemoryForgottenRepository forgottenRepo;
  @Autowired FakeTextEmbedder embedder;

  long owner;
  long member;
  long outsider;
  long projectId;
  final OffsetDateTime t0 = OffsetDateTime.of(2026, 10, 15, 0, 0, 0, 0, ZoneOffset.UTC);

  @BeforeEach
  void seed() {
    embedder.reset();
    owner = user(dsl);
    member = user(dsl);
    outsider = user(dsl);
    var p = project(projectService, owner, "SMA", "TEAM");
    projectId = p.id();
    addProjectMember(projectMembers, projectId, member);
  }

  /** 사람 요청으로 꾸민다. 오류 응답을 거치면 필터가 테스트 스레드의 테넌트를 지우므로 요청마다 되돌려 놓는다 — 이어지는 서비스 호출·요청이 같은 테넌트에서 돈다. */
  private static RequestPostProcessor as(long uid) {
    RequestPostProcessor auth =
        authentication(new UsernamePasswordAuthenticationToken(uid, "n/a", List.of()));
    return req -> {
      TenantContext.set(1L);
      return auth.postProcessRequest(req);
    };
  }

  private MockHttpServletRequestBuilder addReq(String type, Long id, String content)
      throws Exception {
    var body = new java.util.LinkedHashMap<String, Object>();
    body.put("spaceType", type);
    body.put("spaceId", id);
    body.put("content", content);
    return post("/api/v1/shared-ai-memories")
        .contentType(MediaType.APPLICATION_JSON)
        .content(om.writeValueAsString(body));
  }

  private long addAs(long uid, String content) throws Exception {
    String json =
        mvc.perform(addReq("PROJECT", projectId, content).with(as(uid)))
            .andExpect(status().isCreated())
            .andReturn()
            .getResponse()
            .getContentAsString();
    return om.readTree(json).path("id").asLong();
  }

  @Test
  void 공간_목록은_개수와_권한을_싣는다() throws Exception {
    addAs(member, "배포는 API 먼저 한다");
    String mine = "$.items[?(@.type=='PROJECT' && @.id==" + projectId + ")]";
    mvc.perform(get("/api/v1/shared-ai-memories/spaces").with(as(member)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.items[0].type").value("ORG"))
        .andExpect(jsonPath("$.items[0].canAdd").value(false))
        .andExpect(jsonPath("$.items[0].limit").value(30))
        .andExpect(jsonPath(mine + ".key").value("SMA"))
        .andExpect(jsonPath(mine + ".label").value("SMA 프로젝트(SMA)"))
        .andExpect(jsonPath(mine + ".count").value(1))
        .andExpect(jsonPath(mine + ".limit").value(50))
        .andExpect(jsonPath(mine + ".canAdd").value(true))
        .andExpect(jsonPath(mine + ".canManage").value(false));
  }

  @Test
  void 구성원이_직접_추가하면_본인_항목이고_메타에_이름이_있다() throws Exception {
    addAs(member, "이슈 본문은 배경·목표·완료 조건 순서로 쓴다");
    mvc.perform(
            get("/api/v1/shared-ai-memories")
                .param("spaceType", "PROJECT")
                .param("spaceId", String.valueOf(projectId))
                .with(as(member)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.items", hasSize(1)))
        .andExpect(jsonPath("$.items[0].origin").value("USER_ADDED"))
        .andExpect(jsonPath("$.items[0].author.name").exists())
        .andExpect(jsonPath("$.items[0].canEdit").value(true))
        .andExpect(jsonPath("$.count").value(1))
        .andExpect(jsonPath("$.limit").value(50))
        .andExpect(jsonPath("$.nextCursor").doesNotExist());
  }

  @Test
  void 대화에서_뽑힌_항목은_작성자가_없고_구성원은_못_고친다() throws Exception {
    var k = SpaceKey.of("PROJECT", projectId);
    var ai = repo.insert(k, "PR 설명에는 바뀐 화면 캡처를 붙인다", "AI_EXTRACTED", null, null, t0);
    mvc.perform(
            get("/api/v1/shared-ai-memories")
                .param("spaceType", "PROJECT")
                .param("spaceId", String.valueOf(projectId))
                .with(as(member)))
        .andExpect(jsonPath("$.items[0].author").doesNotExist())
        .andExpect(jsonPath("$.items[0].canEdit").value(false));
    mvc.perform(
            patch("/api/v1/shared-ai-memories/" + ai.id())
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"content\":\"바꿈\"}")
                .with(as(member)))
        .andExpect(status().isForbidden())
        .andExpect(jsonPath("$.errors.code").value("SHARED_MEMORY_FORBIDDEN"));
    mvc.perform(delete("/api/v1/shared-ai-memories/" + ai.id()).with(as(member)))
        .andExpect(status().isForbidden());
  }

  @Test
  void 소유자가_AI_항목을_고치면_출처는_그대로고_지우면_지운_기록에_남는다() throws Exception {
    var k = SpaceKey.of("PROJECT", projectId);
    var ai = repo.insert(k, "코드 리뷰는 두 명 승인 뒤 머지한다", "AI_EXTRACTED", null, null, t0);
    mvc.perform(
            patch("/api/v1/shared-ai-memories/" + ai.id())
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"content\":\"코드 리뷰는 두 명이 승인한 뒤 머지한다\"}")
                .with(as(owner)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.origin").value("AI_EXTRACTED"))
        .andExpect(jsonPath("$.canEdit").value(true));
    assertThat(repo.findById(ai.id()).orElseThrow().updatedBy()).isEqualTo(owner);

    mvc.perform(delete("/api/v1/shared-ai-memories/" + ai.id()).with(as(owner)))
        .andExpect(status().isNoContent());
    assertThat(forgottenRepo.contents(k)).containsExactly("코드 리뷰는 두 명이 승인한 뒤 머지한다");
  }

  @Test
  void 본인_항목을_지우면_지운_기록에_넣지_않는다() throws Exception {
    long id = addAs(member, "스프린트는 2주 단위다");
    mvc.perform(delete("/api/v1/shared-ai-memories/" + id).with(as(member)))
        .andExpect(status().isNoContent());
    assertThat(forgottenRepo.contents(SpaceKey.of("PROJECT", projectId))).isEmpty();
  }

  @Test
  void 남의_항목은_구성원이_못_고친다() throws Exception {
    long id = addAs(owner, "회의록은 노트에 남긴다");
    mvc.perform(
            patch("/api/v1/shared-ai-memories/" + id)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"content\":\"바꿈\"}")
                .with(as(member)))
        .andExpect(status().isForbidden());
  }

  @Test
  void 읽지_못하는_공간은_404_추가_권한이_없으면_403() throws Exception {
    mvc.perform(addReq("PROJECT", projectId, "몰래").with(as(outsider)))
        .andExpect(status().isNotFound())
        .andExpect(jsonPath("$.errors.code").value("SHARED_MEMORY_NOT_FOUND"));
    long openOwner = user(dsl);
    var open = project(projectService, openOwner, "OPA", "OPEN");
    mvc.perform(addReq("PROJECT", open.id(), "구경꾼").with(as(outsider)))
        .andExpect(status().isForbidden());
    mvc.perform(
            get("/api/v1/shared-ai-memories")
                .param("spaceType", "PROJECT")
                .param("spaceId", String.valueOf(projectId))
                .with(as(outsider)))
        .andExpect(status().isNotFound());
  }

  @Test
  void 조직_지침은_관리자만_쓴다() throws Exception {
    mvc.perform(addReq("ORG", null, "모든 문서는 존댓말로 쓴다").with(as(member)))
        .andExpect(status().isForbidden());
    long admin = user(dsl);
    grantAdmin(dsl, admin);
    mvc.perform(addReq("ORG", null, "모든 문서는 존댓말로 쓴다").with(as(admin)))
        .andExpect(status().isCreated())
        .andExpect(jsonPath("$.origin").value("USER_ADDED"));
  }

  @Test
  void 스페이스는_EDITOR_부터_추가한다() throws Exception {
    long sid = teamWiki(wikiService, owner, "개발팀 노트");
    addWikiMember(wikiService, owner, sid, member, "VIEWER");
    mvc.perform(addReq("WIKI_SPACE", sid, "용어집은 이 스페이스에 둔다").with(as(member)))
        .andExpect(status().isForbidden());
    TenantContext.set(1L); // 앞선 403 응답이 필터에서 테넌트를 지웠다
    wikiService.changeRole(owner, sid, member, "EDITOR");
    mvc.perform(addReq("WIKI_SPACE", sid, "용어집은 이 스페이스에 둔다").with(as(member)))
        .andExpect(status().isCreated());
  }

  @Test
  void 공간이_가득_차면_409() throws Exception {
    var k = SpaceKey.of("PROJECT", projectId);
    for (int i = 0; i < 50; i++) repo.insert(k, "규칙 " + i, "USER_ADDED", owner, owner, t0);
    mvc.perform(addReq("PROJECT", projectId, "하나 더").with(as(owner)))
        .andExpect(status().isConflict())
        .andExpect(jsonPath("$.errors.code").value("SHARED_MEMORY_FULL"));
  }

  @Test
  void 내용은_1_300자() throws Exception {
    mvc.perform(addReq("PROJECT", projectId, "   ").with(as(member)))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.errors.code").value("SHARED_MEMORY_INVALID"));
    mvc.perform(addReq("PROJECT", projectId, "가".repeat(301)).with(as(member)))
        .andExpect(status().isBadRequest());
  }

  @Test
  void 목록은_30개씩_키셋으로_이어진다() throws Exception {
    var k = SpaceKey.of("PROJECT", projectId);
    for (int i = 0; i < 35; i++)
      repo.insert(k, "규칙 " + i, "USER_ADDED", owner, owner, t0.plusSeconds(i));
    String first =
        mvc.perform(
                get("/api/v1/shared-ai-memories")
                    .param("spaceType", "PROJECT")
                    .param("spaceId", String.valueOf(projectId))
                    .with(as(member)))
            .andExpect(jsonPath("$.items", hasSize(30)))
            .andExpect(jsonPath("$.items[0].content").value("규칙 34"))
            .andExpect(jsonPath("$.count").value(35))
            .andReturn()
            .getResponse()
            .getContentAsString();
    String cursor = om.readTree(first).path("nextCursor").asText();
    mvc.perform(
            get("/api/v1/shared-ai-memories")
                .param("spaceType", "PROJECT")
                .param("spaceId", String.valueOf(projectId))
                .param("cursor", cursor)
                .with(as(member)))
        .andExpect(jsonPath("$.items", hasSize(5)))
        .andExpect(jsonPath("$.items[4].content").value("규칙 0"))
        .andExpect(jsonPath("$.nextCursor").doesNotExist());
  }

  @Test
  void 같은_밀리초_행도_페이지_경계에서_빠지지_않는다() throws Exception {
    var k = SpaceKey.of("PROJECT", projectId);
    for (int i = 0; i < 5; i++) repo.insert(k, "같은 순간 규칙 " + i, "USER_ADDED", owner, owner, t0);
    java.util.Set<Long> seen = new java.util.HashSet<>();
    String cursor = null;
    int pages = 0;
    do {
      var req =
          get("/api/v1/shared-ai-memories")
              .param("spaceType", "PROJECT")
              .param("spaceId", String.valueOf(projectId))
              .param("size", "2")
              .with(as(member));
      if (cursor != null) req.param("cursor", cursor);
      JsonNode page =
          om.readTree(
              mvc.perform(req)
                  .andExpect(status().isOk())
                  .andReturn()
                  .getResponse()
                  .getContentAsString());
      page.path("items").forEach(n -> seen.add(n.path("id").asLong()));
      cursor = page.path("nextCursor").isMissingNode() ? null : page.path("nextCursor").asText();
      pages++;
    } while (cursor != null && pages < 10);
    assertThat(seen).hasSize(5);
    assertThat(pages).isEqualTo(3);
  }

  @Test
  void 숫자가_아닌_커서_id_는_첫_페이지로() throws Exception {
    var k = SpaceKey.of("PROJECT", projectId);
    repo.insert(k, "규칙 하나", "USER_ADDED", owner, owner, t0);
    mvc.perform(
            get("/api/v1/shared-ai-memories")
                .param("spaceType", "PROJECT")
                .param("spaceId", String.valueOf(projectId))
                .param("cursor", CursorCodec.encode(Instant.now(), "abc"))
                .with(as(member)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.items", hasSize(1)));
  }

  @Test
  void 검색은_맞는_것만_한_묶음으로() throws Exception {
    var k = SpaceKey.of("PROJECT", projectId);
    repo.insert(k, "배포는 API 먼저 한다", "USER_ADDED", owner, owner, t0);
    repo.insert(k, "회의록은 노트에 남긴다", "USER_ADDED", owner, owner, t0);
    mvc.perform(
            get("/api/v1/shared-ai-memories")
                .param("spaceType", "PROJECT")
                .param("spaceId", String.valueOf(projectId))
                .param("q", "배포를")
                .with(as(member)))
        .andExpect(jsonPath("$.items", hasSize(1)))
        .andExpect(jsonPath("$.items[0].content").value("배포는 API 먼저 한다"))
        .andExpect(jsonPath("$.nextCursor").doesNotExist());
  }

  @Test
  void 구성원에서_빠지면_바로_못_본다() throws Exception {
    addAs(member, "배포 전 체크리스트를 돈다");
    projectMembers.delete(projectId, member);
    mvc.perform(
            get("/api/v1/shared-ai-memories")
                .param("spaceType", "PROJECT")
                .param("spaceId", String.valueOf(projectId))
                .with(as(member)))
        .andExpect(status().isNotFound());
  }

  @Test
  void 에이전트_내부_토큰으로는_직접_쓰지_못한다() throws Exception {
    long id = addAs(member, "내부 토큰이 못 건드린다");
    try {
      mvc.perform(
              addReq("PROJECT", projectId, "AI 가 몰래")
                  .header("Authorization", "Internal test-token")
                  .header("X-On-Behalf-Of", String.valueOf(member)))
          .andExpect(status().isForbidden())
          .andExpect(jsonPath("$.errors.code").value("SHARED_MEMORY_FORBIDDEN"));
      mvc.perform(
              patch("/api/v1/shared-ai-memories/" + id)
                  .contentType(MediaType.APPLICATION_JSON)
                  .content("{\"content\":\"바꿈\"}")
                  .header("Authorization", "Internal test-token")
                  .header("X-On-Behalf-Of", String.valueOf(member)))
          .andExpect(status().isForbidden());
      mvc.perform(
              delete("/api/v1/shared-ai-memories/" + id)
                  .header("Authorization", "Internal test-token")
                  .header("X-On-Behalf-Of", String.valueOf(member)))
          .andExpect(status().isForbidden());
    } finally {
      TenantContext.set(1L);
    }
    assertThat(repo.findById(id).orElseThrow().content()).isEqualTo("내부 토큰이 못 건드린다");
  }

  @Test
  void 추가는_공간_기록에_사람_행위자로_남는다() throws Exception {
    long id = addAs(member, "장애 공지는 #incident 채널에 올린다");
    JsonNode row =
        om.readTree(
            dsl.fetchOne(
                    "select json_build_object('a', action, 'k', actor_kind, 'u', actor_user_id, 'm', memory_id)::text"
                        + " from shared_ai_memory_change where memory_id = ? order by id desc limit 1",
                    id)
                .get(0, String.class));
    assertThat(row.path("a").asText()).isEqualTo("ADDED");
    assertThat(row.path("k").asText()).isEqualTo("USER");
    assertThat(row.path("u").asLong()).isEqualTo(member);
    assertThat(row.path("m").asLong()).isEqualTo(id);
  }

  @Test
  void 고치기와_지우기도_공간_기록에_사람_행위자로_남는다() throws Exception {
    long id = addAs(member, "릴리스는 금요일에 하지 않는다");
    mvc.perform(
            patch("/api/v1/shared-ai-memories/" + id)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"content\":\"릴리스는 금요일 오후에 하지 않는다\"}")
                .with(as(member)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.content").value("릴리스는 금요일 오후에 하지 않는다"))
        .andExpect(jsonPath("$.origin").value("USER_ADDED"));
    mvc.perform(delete("/api/v1/shared-ai-memories/" + id).with(as(member)))
        .andExpect(status().isNoContent());
    var rows =
        dsl.fetch(
            "select action, actor_kind, actor_user_id from shared_ai_memory_change"
                + " where memory_id = ? order by id",
            id);
    assertThat(rows.getValues("action", String.class))
        .containsExactly("ADDED", "UPDATED", "DELETED");
    assertThat(rows.getValues("actor_kind", String.class)).containsOnly("USER");
    assertThat(rows.getValues("actor_user_id", Long.class)).containsOnly(member);
    assertThat(repo.findById(id)).isEmpty();
  }

  @Test
  void 제어문자는_걷어_내고_제어문자만이면_400() throws Exception {
    // 추가 — 중간의 NUL 은 빠진 채 저장된다.
    mvc.perform(addReq("PROJECT", projectId, "배포는\u0000 API 먼저").with(as(member)))
        .andExpect(status().isCreated())
        .andExpect(jsonPath("$.content").value("배포는 API 먼저"));
    mvc.perform(addReq("PROJECT", projectId, "\u0000\u0001").with(as(member)))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.errors.code").value("SHARED_MEMORY_INVALID"));

    // 고치기 — 같은 규칙.
    long id = addAs(member, "회의는 월요일에 한다");
    mvc.perform(
            patch("/api/v1/shared-ai-memories/" + id)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"content\":\"회의는\\u0000 화요일에 한다\"}")
                .with(as(member)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.content").value("회의는 화요일에 한다"));
    mvc.perform(
            patch("/api/v1/shared-ai-memories/" + id)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"content\":\"\\u0000\"}")
                .with(as(member)))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.errors.code").value("SHARED_MEMORY_INVALID"));
    assertThat(repo.findById(id).orElseThrow().content()).isEqualTo("회의는 화요일에 한다");
  }

  @Test
  void 못_읽는_공간_검색은_임베딩_없이_404() throws Exception {
    mvc.perform(
            get("/api/v1/shared-ai-memories")
                .param("spaceType", "PROJECT")
                .param("spaceId", String.valueOf(projectId))
                .param("q", "배포")
                .with(as(outsider)))
        .andExpect(status().isNotFound());
    assertThat(embedder.lastQueryTimeout()).isNull(); // seed 가 reset — 질의 임베딩이 한 번도 불리지 않았다
  }
}
