package com.workplace.notify.controller;

import static org.hamcrest.Matchers.contains;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workplace.global.security.JwtTokenProvider;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

/**
 * notification_setting/notification_app_setting 이 테넌트 GUC(app.tenant_id) 없이 DB 계층까지 동작하는지 고정하는 회귀
 * 테스트({@link PushControllerTenantlessTest} 와 같은 이유 — 기본 테스트 베이스는 GUC 를 심어 줘서 이 경로를 가린다). 두 테이블은 RLS
 * 없는 글로벌 테이블(V207)이라 테넌트 선택 전 토큰으로도 조회·수정돼야 한다.
 */
@Transactional
class NotificationSettingsControllerTenantlessTest extends IntegrationTestBase {

  @Override
  protected Long defaultTenantId() {
    // GUC 를 심지 않는다 — TenantAwareTransactionManager.doBegin 이 null 로 set_config 를 건너뛰는 경로.
    return null;
  }

  @Autowired MockMvc mvc;
  @Autowired DSLContext dsl;
  @Autowired JwtTokenProvider jwt;

  long userId;
  String token; // 테넌트 미선택(2-인자) 토큰

  @BeforeEach
  void setUp() {
    userId = TestFixtures.createHuman(dsl);
    token = jwt.generateAccessToken(userId, "u");
  }

  @Test
  void worksWithoutTenantGuc() throws Exception {
    mvc.perform(get("/api/v1/notification-settings").header("Authorization", "Bearer " + token))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.apps[0].enabled").value(true));

    mvc.perform(
            put("/api/v1/notification-settings")
                .header("Authorization", "Bearer " + token)
                .contentType(MediaType.APPLICATION_JSON)
                .content(
                    """
                    {"apps":{"WIKI":false},
                     "cells":[{"item":"CHAT_DM","actor":"AGENT","enabled":false}]}"""))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.apps[3].enabled").value(false))
        .andExpect(jsonPath("$.apps[*].items[?(@.item == 'CHAT_DM')].agent", contains(false)));
  }
}
