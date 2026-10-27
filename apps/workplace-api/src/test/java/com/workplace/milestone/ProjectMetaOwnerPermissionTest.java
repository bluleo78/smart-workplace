package com.workplace.milestone;

import static com.workplace.jooq.Tables.PERMISSION;
import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.ROLE_PERMISSION;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.global.tenant.TenantContext;
import com.workplace.project.dto.AddMemberRequest;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.service.ProjectService;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
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
 * WP-1008 마일스톤·사이클 관리 권한 — 버전과 같이 프로젝트 OWNER 만 만들고 바꾸고 지운다. 컨트롤러의 {@code @RequirePermission} 까지
 * 거치도록 HTTP(MockMvc)로 부른다.
 *
 * <ul>
 *   <li>OWNER 가 아닌 멤버(USER 역할 — 회사 역할로는 {@code project:manage} 까지 가짐)는 403.
 *   <li>OWNER 는 회사 역할이 {@code project:read}·{@code project:write}·{@code project:manage} 뿐이어도 성공.
 *       (예전 사이클·마일스톤 전용 권한 코드는 WP-1025 의 V226 가 지웠다.)
 * </ul>
 *
 * <p>@Transactional 이라 MockMvc 요청이 테스트 트랜잭션에 합류해 시드를 보고, 끝나면 롤백된다.
 */
@Transactional
class ProjectMetaOwnerPermissionTest extends IntegrationTestBase {

  @Autowired MockMvc mvc;
  @Autowired ObjectMapper om;
  @Autowired DSLContext dsl;
  @Autowired JwtTokenProvider jwt;
  @Autowired ProjectService projectService;

  private long ownerId;
  private long memberId;
  private String key;

  @BeforeEach
  void seed() {
    TenantContext.set(1L);
    // OWNER 는 project:read·project:write·project:manage 만 가진 역할로 둔다.
    ownerId = withMembership(TestFixtures.createHuman(dsl));
    grantCustomRole(ownerId, "project:read", "project:write", "project:manage");
    // 멤버는 USER 역할 — 회사 역할로는 project:manage 까지 가졌지만 프로젝트 OWNER 가 아니다.
    memberId = withMembership(TestFixtures.createHuman(dsl));
    TestFixtures.grantRole(dsl, memberId, "USER");
    key = "PM" + UUID.randomUUID().toString().replace("-", "").substring(0, 6).toUpperCase();
    projectService.create(ownerId, new CreateProjectRequest(key, "메타 권한", "x"));
    projectService.addMember(ownerId, key, new AddMemberRequest(memberId, "MEMBER"));
  }

  @AfterEach
  void clearTenant() {
    TenantContext.clear();
  }

  /** 마일스톤 — OWNER 가 아닌 멤버는 만들기·수정·삭제 모두 403, 조회는 된다. */
  @Test
  void nonOwnerMemberCannotManageMilestone() throws Exception {
    String base = "/api/v1/projects/" + key + "/milestones";
    call(post(base).content(milestone("멤버가 만든 것")), memberId).andExpect(status().isForbidden());

    long id = idOf(call(post(base).content(milestone("대상")), ownerId));
    call(patch(base + "/" + id).content(milestone("멤버 수정")), memberId)
        .andExpect(status().isForbidden());
    call(delete(base + "/" + id), memberId).andExpect(status().isForbidden());
    call(get(base), memberId).andExpect(status().isOk());
  }

  /** 마일스톤 — project:* 만 가진 OWNER 도 만들기·수정·삭제가 된다. */
  @Test
  void ownerWithOnlyProjectPermissionsCanManageMilestone() throws Exception {
    String base = "/api/v1/projects/" + key + "/milestones";
    long id =
        idOf(call(post(base).content(milestone("베타")), ownerId).andExpect(status().isCreated()));
    call(patch(base + "/" + id).content(milestone("베타 2")), ownerId).andExpect(status().isOk());
    call(delete(base + "/" + id), ownerId).andExpect(status().isNoContent());
  }

  /** 사이클 — OWNER 가 아닌 멤버는 만들기·수정·삭제 모두 403, 조회는 된다. */
  @Test
  void nonOwnerMemberCannotManageCycle() throws Exception {
    String base = "/api/v1/projects/" + key + "/cycles";
    call(post(base).content(cycle("멤버 사이클")), memberId).andExpect(status().isForbidden());

    long id = idOf(call(post(base).content(cycle("대상")), ownerId));
    call(patch(base + "/" + id).content(cycle("멤버 수정")), memberId)
        .andExpect(status().isForbidden());
    call(delete(base + "/" + id), memberId).andExpect(status().isForbidden());
    call(get(base), memberId).andExpect(status().isOk());
  }

  /** 사이클 — project:* 만 가진 OWNER 도 만들기·수정·삭제가 된다. */
  @Test
  void ownerWithOnlyProjectPermissionsCanManageCycle() throws Exception {
    String base = "/api/v1/projects/" + key + "/cycles";
    long id = idOf(call(post(base).content(cycle("1주차")), ownerId).andExpect(status().isOk()));
    call(patch(base + "/" + id).content(cycle("1주차 수정")), ownerId).andExpect(status().isOk());
    call(delete(base + "/" + id), ownerId).andExpect(status().isNoContent());
  }

  /** 주어진 권한 코드만 가진 비시스템 역할을 만들어 사용자에게 준다. */
  private void grantCustomRole(long userId, String... codes) {
    long roleId =
        dsl.insertInto(ROLE)
            .set(ROLE.NAME, "META-OWNER-" + UUID.randomUUID().toString().substring(0, 8))
            .set(ROLE.DESCRIPTION, "milestone/cycle manage 없는 역할")
            .set(ROLE.TENANT_ID, 1L)
            .returning(ROLE.ID)
            .fetchOne()
            .getId();
    for (String code : codes) {
      Long permissionId =
          dsl.select(PERMISSION.ID)
              .from(PERMISSION)
              .where(PERMISSION.CODE.eq(code))
              .fetchOne(PERMISSION.ID);
      dsl.insertInto(ROLE_PERMISSION)
          .set(ROLE_PERMISSION.ROLE_ID, roleId)
          .set(ROLE_PERMISSION.PERMISSION_ID, permissionId)
          .set(ROLE_PERMISSION.TENANT_ID, 1L)
          .execute();
    }
    dsl.insertInto(USER_ROLE)
        .set(USER_ROLE.USER_ID, userId)
        .set(USER_ROLE.ROLE_ID, roleId)
        .set(USER_ROLE.TENANT_ID, 1L)
        .execute();
  }

  private String milestone(String name) throws Exception {
    var m = new java.util.LinkedHashMap<String, Object>();
    m.put("name", name);
    m.put("dueDate", "2026-12-01");
    return om.writeValueAsString(m);
  }

  private String cycle(String name) throws Exception {
    var m = new java.util.LinkedHashMap<String, Object>();
    m.put("name", name);
    m.put("startDate", "2026-11-02");
    m.put("endDate", "2026-11-08");
    return om.writeValueAsString(m);
  }

  private long idOf(ResultActions r) throws Exception {
    return om.readTree(r.andReturn().getResponse().getContentAsString()).get("id").asLong();
  }

  private ResultActions call(MockHttpServletRequestBuilder req, long caller) throws Exception {
    req.header("Authorization", "Bearer " + jwt.generateAccessToken(caller, "u-" + caller, 1L))
        .contentType(MediaType.APPLICATION_JSON);
    ResultActions r = mvc.perform(req);
    // 요청 처리가 지우는 테넌트 문맥을 다시 심는다.
    TenantContext.set(1L);
    return r;
  }
}
