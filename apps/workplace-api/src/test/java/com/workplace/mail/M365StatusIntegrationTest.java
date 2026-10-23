package com.workplace.mail;

import static com.workplace.jooq.Tables.TENANT;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.authentication;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workplace.mail.config.M365GraphProperties;
import com.workplace.support.IntegrationTestBase;
import java.util.List;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

/**
 * WP-879 메일 계정 추가 기본 공급자 — 워크스페이스 SSO 가 켜져 있으면 Outlook(Microsoft 365)을 권한다.
 *
 * <p>기본 테넌트(1)의 sso_enabled 를 바꿔 보고, 변경은 테스트 롤백으로 되돌린다. 메일용 M365 앱은 application-test.yml 이 설정해 둔다.
 */
@Transactional
class M365StatusIntegrationTest extends IntegrationTestBase {

  private static final long TENANT_ID = 1L;

  @Autowired MockMvc mvc;
  @Autowired DSLContext dsl;

  /** 일반 구성원(권한 없음) — 관리자 SSO API 와 달리 sso:manage 없이도 읽을 수 있어야 한다. */
  private static UsernamePasswordAuthenticationToken member() {
    return new UsernamePasswordAuthenticationToken(1L, null, List.of());
  }

  private void setSso(boolean enabled) {
    dsl.update(TENANT).set(TENANT.SSO_ENABLED, enabled).where(TENANT.ID.eq(TENANT_ID)).execute();
  }

  /** SSO 켜짐 → Outlook 권함, 꺼짐 → IMAP 그대로. */
  @ParameterizedTest
  @ValueSource(booleans = {true, false})
  void preferredFollowsWorkspaceSso(boolean ssoEnabled) throws Exception {
    setSso(ssoEnabled);
    mvc.perform(get("/api/v1/mail/oauth/m365/status").with(authentication(member())))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.preferred").value(ssoEnabled));
  }

  @Test
  void requiresLogin() throws Exception {
    mvc.perform(get("/api/v1/mail/oauth/m365/status")).andExpect(status().isUnauthorized());
  }

  @Test
  void mailAppNotConfigured_neverPrefersOutlook() {
    // 메일용 M365 앱 값이 하나라도 비면 SSO 가 켜져 있어도 연결이 실패하므로 기본값으로 권하지 않는다.
    assertThat(new M365GraphProperties("cid", "tid", "secret", "https://cb").isConfigured())
        .isTrue();
    assertThat(new M365GraphProperties("", "tid", "secret", "https://cb").isConfigured()).isFalse();
    assertThat(new M365GraphProperties("cid", "tid", null, "https://cb").isConfigured()).isFalse();
    assertThat(new M365GraphProperties("cid", " ", "secret", "https://cb").isConfigured())
        .isFalse();
  }
}
