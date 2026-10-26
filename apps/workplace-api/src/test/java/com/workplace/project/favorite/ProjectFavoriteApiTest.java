package com.workplace.project.favorite;

import static com.workplace.jooq.Tables.PROJECT_FAVORITE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.global.tenant.TenantContext;
import com.workplace.project.dto.AddMemberRequest;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.service.ProjectService;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.transaction.annotation.Transactional;

/**
 * WP-1001 프로젝트 즐겨찾기 서버 저장 — 추가·해제(멱등), 사용자별 분리, 볼 수 없는 프로젝트(404·목록에서 숨김), 지운 프로젝트 숨김, 브라우저 값
 * 이관(없는·볼 수 없는 key 건너뜀), 테넌트 격리(RLS).
 *
 * <p>@Transactional 이라 MockMvc 요청이 테스트 트랜잭션에 합류해 시드를 보고, 끝나면 롤백된다.
 */
@Transactional
class ProjectFavoriteApiTest extends IntegrationTestBase {

  private static final String BASE = "/api/v1/me/project-favorites";

  @Autowired MockMvc mvc;
  @Autowired ObjectMapper om;
  @Autowired DSLContext dsl;
  @Autowired JwtTokenProvider jwt;
  @Autowired ProjectService projectService;

  private long ownerId;
  private long memberId;
  private long outsiderId;
  private String open1;
  private String open2;
  private String team;

  @BeforeEach
  void seed() {
    TenantContext.set(1L);
    ownerId = human();
    memberId = human();
    outsiderId = human();
    open1 = project("OPEN");
    open2 = project("OPEN");
    // TEAM — 멤버만 본다. memberId 를 멤버로 넣어 「멤버에서 빠지면 숨김」을 본다.
    team = project("TEAM");
    projectService.addMember(ownerId, team, new AddMemberRequest(memberId, "MEMBER"));
  }

  @AfterEach
  void clearTenant() {
    TenantContext.clear();
  }

  /** 추가는 멱등이고(한 행), 해제도 멱등(없어도 204). 순서는 한 트랜잭션 안에서 시각이 같아 보지 않는다. */
  @Test
  void addListRemove() throws Exception {
    call(put(BASE + "/" + open2), memberId).andExpect(status().isNoContent());
    call(put(BASE + "/" + open1), memberId).andExpect(status().isNoContent());
    call(put(BASE + "/" + open2), memberId).andExpect(status().isNoContent());
    assertThat(keys(memberId)).containsExactlyInAnyOrder(open2, open1);

    call(delete(BASE + "/" + open2), memberId).andExpect(status().isNoContent());
    call(delete(BASE + "/" + open2), memberId).andExpect(status().isNoContent());
    call(delete(BASE + "/NOSUCHKEY"), memberId).andExpect(status().isNoContent());
    assertThat(keys(memberId)).containsExactly(open1);
  }

  /** 다른 사용자의 즐겨찾기와 섞이지 않는다. */
  @Test
  void perUser() throws Exception {
    call(put(BASE + "/" + open1), memberId).andExpect(status().isNoContent());
    call(put(BASE + "/" + open2), outsiderId).andExpect(status().isNoContent());
    assertThat(keys(memberId)).containsExactly(open1);
    assertThat(keys(outsiderId)).containsExactly(open2);
  }

  /** 볼 수 없는 프로젝트는 없는 프로젝트와 같은 404, 멤버에서 빠지면 목록에서 숨고 다시 들어오면 되살아난다. */
  @Test
  void unreadableProjects() throws Exception {
    call(put(BASE + "/" + team), outsiderId).andExpect(status().isNotFound());
    call(put(BASE + "/NOSUCHKEY"), outsiderId).andExpect(status().isNotFound());

    call(put(BASE + "/" + team), memberId).andExpect(status().isNoContent());
    assertThat(keys(memberId)).containsExactly(team);
    projectService.removeMember(ownerId, team, memberId);
    assertThat(keys(memberId)).isEmpty();
    projectService.addMember(ownerId, team, new AddMemberRequest(memberId, "MEMBER"));
    assertThat(keys(memberId)).containsExactly(team);
  }

  /** 지운(soft-delete) 프로젝트는 목록에서 빠진다. */
  @Test
  void deletedProjectHidden() throws Exception {
    call(put(BASE + "/" + open1), memberId).andExpect(status().isNoContent());
    call(put(BASE + "/" + open2), memberId).andExpect(status().isNoContent());
    projectService.softDelete(ownerId, open1);
    assertThat(keys(memberId)).containsExactly(open2);
  }

  /** 이관 — 볼 수 있는 key 만 더하고(중복·빈 값·없는·볼 수 없는 key 건너뜀), 이미 있는 것은 그대로, 올린 뒤 목록을 돌려준다. */
  @Test
  void importSkipsUnknownAndUnreadable() throws Exception {
    call(put(BASE + "/" + open2), outsiderId).andExpect(status().isNoContent());
    String body =
        om.writeValueAsString(
            java.util.Map.of("projectKeys", List.of(open1, "NOSUCHKEY", team, open1, "", open2)));
    JsonNode res = json(call(post(BASE + "/import").content(body), outsiderId));
    assertThat(texts(res.get("projectKeys"))).containsExactlyInAnyOrder(open2, open1);
    assertThat(keys(outsiderId)).containsExactlyInAnyOrder(open2, open1);
  }

  /** 이관 요청은 key 목록이 있어야 하고 200개를 넘지 않는다. */
  @Test
  void importValidation() throws Exception {
    call(post(BASE + "/import").content("{}"), memberId).andExpect(status().isBadRequest());
    List<String> many = new ArrayList<>();
    for (int i = 0; i < 201; i++) many.add("K" + i);
    call(
            post(BASE + "/import")
                .content(om.writeValueAsString(java.util.Map.of("projectKeys", many))),
            memberId)
        .andExpect(status().isBadRequest());
  }

  /** 다른 워크스페이스(테넌트)에서는 이 행이 보이지 않는다 — RLS. */
  @Test
  void tenantIsolation() throws Exception {
    call(put(BASE + "/" + open1), memberId).andExpect(status().isNoContent());
    assertThat(dsl.fetchCount(PROJECT_FAVORITE, PROJECT_FAVORITE.USER_ID.eq(memberId)))
        .isEqualTo(1);
    useTenant(ensureFixtureTenant("wp1001-other"));
    assertThat(dsl.fetchCount(PROJECT_FAVORITE, PROJECT_FAVORITE.USER_ID.eq(memberId))).isZero();
    useTenant(1L);
  }

  private String project(String type) {
    String key = "PF" + UUID.randomUUID().toString().replace("-", "").substring(0, 6).toUpperCase();
    projectService.create(ownerId, new CreateProjectRequest(key, "즐겨찾기", "x", type));
    return key;
  }

  private long human() {
    long id = withMembership(TestFixtures.createHuman(dsl));
    TestFixtures.grantRole(dsl, id, "USER");
    return id;
  }

  private List<String> keys(long caller) throws Exception {
    return texts(json(call(get(BASE), caller).andExpect(status().isOk())).get("projectKeys"));
  }

  private static List<String> texts(JsonNode arr) {
    List<String> out = new ArrayList<>();
    arr.forEach(n -> out.add(n.asText()));
    return out;
  }

  private ResultActions call(MockHttpServletRequestBuilder req, long caller) throws Exception {
    req.header("Authorization", "Bearer " + jwt.generateAccessToken(caller, "u-" + caller, 1L))
        .contentType(MediaType.APPLICATION_JSON);
    ResultActions r = mvc.perform(req);
    // 요청 처리가 지우는 테넌트 문맥을 다시 심는다.
    TenantContext.set(1L);
    return r;
  }

  private JsonNode json(ResultActions r) throws Exception {
    return om.readTree(r.andReturn().getResponse().getContentAsString());
  }
}
