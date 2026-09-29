package com.workplace.auth.sso;

import static com.workplace.jooq.Tables.TENANT;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.authentication;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.List;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

/** 워크스페이스 SSO 설정 — 권한·토글·동의 링크·비밀번호 없는 구성원 수. */
@AutoConfigureMockMvc
@Transactional
class SsoAdminControllerTest extends SsoIntegrationTestBase {

  @Autowired MockMvc mvc;
  @Autowired DSLContext dsl;

  // 기본 테넌트(1) 사용 — 감사 로그 등 RLS 대상 쓰기가 트랜잭션 시작 시 GUC(1)를 받도록. 변경은 테스트 롤백으로 되돌아간다.
  long tenantId = 1L;

  @BeforeEach
  void seed() {
    dsl.update(TENANT).set(TENANT.SSO_ENABLED, false).where(TENANT.ID.eq(tenantId)).execute();
  }

  // audit_log.user_id 가 user(id) FK 라 실제 존재하는 사용자를 호출자로 쓴다(빈 DB 에는 id=1 이 없을 수 있음).
  private UsernamePasswordAuthenticationToken admin() {
    long callerId = SsoTestData.user(dsl, SsoTestData.uniqueEmail("admin"), "hash");
    return new UsernamePasswordAuthenticationToken(
        callerId, null, List.of(new SimpleGrantedAuthority("sso:manage")));
  }

  @Test
  void get_requiresPermission() throws Exception {
    var noPerm = new UsernamePasswordAuthenticationToken(1L, null, List.of());
    mvc.perform(get("/api/v1/admin/sso").with(authentication(noPerm)))
        .andExpect(status().isForbidden());
  }

  @Test
  void get_returnsSettings() throws Exception {
    mvc.perform(get("/api/v1/admin/sso").with(authentication(admin())))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.available").value(true))
        .andExpect(jsonPath("$.enabled").value(false))
        .andExpect(
            jsonPath("$.adminConsentUrl")
                .value(org.hamcrest.Matchers.containsString("/organizations/v2.0/adminconsent")))
        .andExpect(jsonPath("$.passwordlessMemberCount").isNumber());
  }

  @Test
  void put_togglesTenantFlag() throws Exception {
    mvc.perform(
            put("/api/v1/admin/sso/enabled")
                .with(authentication(admin()))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"enabled\":true}"))
        .andExpect(status().isNoContent());
    assertThat(
            dsl.select(TENANT.SSO_ENABLED)
                .from(TENANT)
                .where(TENANT.ID.eq(tenantId))
                .fetchOne(TENANT.SSO_ENABLED))
        .isTrue();
  }

  @Autowired com.workplace.user.repository.UserRepository userRepository;

  @Test
  void passwordlessCount_excludesOtherTenantsAgentsAndInactive() throws Exception {
    // 테넌트 1 에는 다른 테스트가 커밋한 구성원이 있을 수 있어 기준값 대비 증가분(+1)으로 검증한다.
    long baseline = userRepository.countPasswordlessHumanMembers(tenantId);
    long a = SsoTestData.user(dsl, SsoTestData.uniqueEmail("a"), null);
    SsoTestData.member(dsl, a, tenantId);
    long withPw = SsoTestData.user(dsl, SsoTestData.uniqueEmail("pw"), "hash");
    SsoTestData.member(dsl, withPw, tenantId);
    long off = SsoTestData.user(dsl, SsoTestData.uniqueEmail("off"), null);
    SsoTestData.member(dsl, off, tenantId);
    dsl.update(USER).set(USER.IS_ACTIVE, false).where(USER.ID.eq(off)).execute();
    long agent = SsoTestData.user(dsl, SsoTestData.uniqueEmail("bot"), null);
    SsoTestData.member(dsl, agent, tenantId);
    dsl.update(USER).set(USER.KIND, "AGENT").where(USER.ID.eq(agent)).execute();
    long other = SsoTestData.user(dsl, SsoTestData.uniqueEmail("other"), null);
    SsoTestData.member(dsl, other, SsoTestData.tenant(dsl, true));

    mvc.perform(get("/api/v1/admin/sso").with(authentication(admin())))
        .andExpect(jsonPath("$.passwordlessMemberCount").value((int) baseline + 1));
  }
}
