package com.workplace.notify.controller;

import static com.workplace.jooq.Tables.NOTIFICATION_APP_SETTING;
import static com.workplace.jooq.Tables.NOTIFICATION_SETTING;
import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.contains;
import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.nullValue;
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
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.transaction.annotation.Transactional;

/**
 * GET/PUT /api/v1/notification-settings 통합 테스트 — 기본값 매트릭스, 바뀐 칸만 저장, 앱 스위치가 칸 값을 보존, 없는 칸·모르는
 * 항목·null 값은 400, DB 에 남은 모르는 항목은 무시. 토큰은 테넌트 미선택(2-인자) — 설정은 글로벌이라 이 토큰으로 동작해야 한다.
 */
@Transactional
class NotificationSettingsControllerTest extends IntegrationTestBase {

  private static final String URL = "/api/v1/notification-settings";

  @Autowired MockMvc mvc;
  @Autowired DSLContext dsl;
  @Autowired JwtTokenProvider jwt;

  long userId;
  String token;

  @BeforeEach
  void setUp() {
    userId = TestFixtures.createHuman(dsl);
    token = jwt.generateAccessToken(userId, "u");
  }

  private ResultActions putJson(String body) throws Exception {
    return mvc.perform(
        put(URL)
            .header("Authorization", "Bearer " + token)
            .contentType(MediaType.APPLICATION_JSON)
            .content(body));
  }

  /** 그 항목 줄의 JSONPath(앱 묶음 안에서 item 이름으로 찾는다). */
  private static String item(String name, String field) {
    return "$.apps[*].items[?(@.item == '" + name + "')]." + field;
  }

  @Test
  void get_returnsDefaultsMatrix() throws Exception {
    mvc.perform(get(URL).header("Authorization", "Bearer " + token))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.apps", hasSize(4)))
        .andExpect(jsonPath("$.apps[*].app", contains("ISSUE", "CHAT", "CALENDAR", "WIKI")))
        .andExpect(jsonPath("$.apps[*].enabled", contains(true, true, true, true)))
        .andExpect(jsonPath("$.apps[0].items", hasSize(8)))
        .andExpect(jsonPath("$.apps[1].items", hasSize(2)))
        .andExpect(jsonPath("$.apps[2].items", hasSize(5)))
        .andExpect(jsonPath("$.apps[3].items", hasSize(3)))
        .andExpect(jsonPath("$.apps[0].items[0].item").value("ISSUE_ASSIGNED"))
        .andExpect(jsonPath(item("ISSUE_ASSIGNED", "human"), contains(true)))
        .andExpect(jsonPath(item("ISSUE_ASSIGNED", "agent"), contains(false)))
        .andExpect(jsonPath(item("ISSUE_STATUS_CHANGED", "human"), contains(false)))
        // 칸 없는 쪽은 JSON null(키는 있다)
        .andExpect(jsonPath(item("ISSUE_AI_NEEDS_INPUT", "human"), contains(nullValue())))
        .andExpect(jsonPath(item("ISSUE_AI_NEEDS_INPUT", "agent"), contains(true)))
        .andExpect(jsonPath(item("CALENDAR_REMINDER", "agent"), contains(nullValue())));
  }

  @Test
  void put_changedCellsOnly_thenGetReflects() throws Exception {
    putJson("{\"cells\":[{\"item\":\"ISSUE_COMMENTED\",\"actor\":\"AGENT\",\"enabled\":true}]}")
        .andExpect(status().isOk())
        .andExpect(jsonPath(item("ISSUE_COMMENTED", "agent"), contains(true)))
        .andExpect(jsonPath(item("ISSUE_COMMENTED", "human"), contains(true)))
        .andExpect(jsonPath(item("ISSUE_ASSIGNED", "agent"), contains(false)));

    mvc.perform(get(URL).header("Authorization", "Bearer " + token))
        .andExpect(status().isOk())
        .andExpect(jsonPath(item("ISSUE_COMMENTED", "agent"), contains(true)));

    // 바꾼 칸 하나만 저장된다(기본값을 행으로 채우지 않는다).
    assertThat(dsl.fetchCount(NOTIFICATION_SETTING, NOTIFICATION_SETTING.USER_ID.eq(userId)))
        .isEqualTo(1);
  }

  @Test
  void put_appOff_keepsCellValues() throws Exception {
    putJson("{\"cells\":[{\"item\":\"ISSUE_ASSIGNED\",\"actor\":\"AGENT\",\"enabled\":true}]}")
        .andExpect(status().isOk());

    putJson("{\"apps\":{\"ISSUE\":false}}")
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.apps[0].app").value("ISSUE"))
        .andExpect(jsonPath("$.apps[0].enabled").value(false))
        .andExpect(jsonPath("$.apps[1].enabled").value(true))
        .andExpect(jsonPath(item("ISSUE_ASSIGNED", "agent"), contains(true)));

    putJson("{\"apps\":{\"ISSUE\":true}}")
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.apps[0].enabled").value(true))
        .andExpect(jsonPath(item("ISSUE_ASSIGNED", "agent"), contains(true)));
  }

  /**
   * 기본값과 다른 값으로 바꿨다가 기본값으로 되돌리면 행이 남지 않는다 — 남으면 나중에 코드 기본값을 바꿔도 이 사용자에게 반영되지 않는다(스펙 §4). 앱 스위치도
   * 같다(기본값 켜짐).
   */
  @Test
  void put_backToDefault_deletesStoredRows() throws Exception {
    // ISSUE_ASSIGNED·HUMAN 기본값은 켜짐 → 끔(행 생김) → 켬(행 삭제). 앱 스위치도 끔 → 켬.
    putJson(
            """
            {"apps":{"ISSUE":false},
             "cells":[{"item":"ISSUE_ASSIGNED","actor":"HUMAN","enabled":false}]}
            """)
        .andExpect(status().isOk());
    assertThat(dsl.fetchCount(NOTIFICATION_SETTING, NOTIFICATION_SETTING.USER_ID.eq(userId)))
        .isEqualTo(1);
    assertThat(
            dsl.fetchCount(NOTIFICATION_APP_SETTING, NOTIFICATION_APP_SETTING.USER_ID.eq(userId)))
        .isEqualTo(1);

    putJson(
            """
            {"apps":{"ISSUE":true},
             "cells":[{"item":"ISSUE_ASSIGNED","actor":"HUMAN","enabled":true}]}
            """)
        .andExpect(status().isOk());
    assertThat(dsl.fetchCount(NOTIFICATION_SETTING, NOTIFICATION_SETTING.USER_ID.eq(userId)))
        .isZero();
    assertThat(
            dsl.fetchCount(NOTIFICATION_APP_SETTING, NOTIFICATION_APP_SETTING.USER_ID.eq(userId)))
        .isZero();

    // 기본값과 같은 값을 처음부터 보내도 행을 만들지 않는다(기본 끔인 칸을 끔으로).
    putJson("{\"cells\":[{\"item\":\"ISSUE_ASSIGNED\",\"actor\":\"AGENT\",\"enabled\":false}]}")
        .andExpect(status().isOk());
    assertThat(dsl.fetchCount(NOTIFICATION_SETTING, NOTIFICATION_SETTING.USER_ID.eq(userId)))
        .isZero();

    mvc.perform(get(URL).header("Authorization", "Bearer " + token))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.apps[0].enabled").value(true))
        .andExpect(jsonPath(item("ISSUE_ASSIGNED", "human"), contains(true)))
        .andExpect(jsonPath(item("ISSUE_ASSIGNED", "agent"), contains(false)));
  }

  @Test
  void put_nonexistentCell_returns400() throws Exception {
    putJson(
            "{\"cells\":[{\"item\":\"ISSUE_AI_NEEDS_INPUT\",\"actor\":\"HUMAN\",\"enabled\":false}]}")
        .andExpect(status().isBadRequest());
    putJson("{\"cells\":[{\"item\":\"CALENDAR_REMINDER\",\"actor\":\"AGENT\",\"enabled\":false}]}")
        .andExpect(status().isBadRequest());
  }

  @Test
  void put_nonexistentCell_savesNothing() throws Exception {
    // 앞의 정상 칸·앱 스위치도 저장되지 않는다(검증이 저장보다 먼저).
    putJson(
            """
            {"apps":{"CHAT":false},
             "cells":[{"item":"ISSUE_COMMENTED","actor":"AGENT","enabled":true},
                      {"item":"ISSUE_AI_FAILED","actor":"HUMAN","enabled":false}]}""")
        .andExpect(status().isBadRequest());
    mvc.perform(get(URL).header("Authorization", "Bearer " + token))
        .andExpect(jsonPath("$.apps[1].enabled").value(true))
        .andExpect(jsonPath(item("ISSUE_COMMENTED", "agent"), contains(false)));
  }

  @Test
  void put_unknownItem_returns400() throws Exception {
    putJson("{\"cells\":[{\"item\":\"NOPE\",\"actor\":\"HUMAN\",\"enabled\":true}]}")
        .andExpect(status().isBadRequest());
    putJson("{\"apps\":{\"NOPE\":false}}").andExpect(status().isBadRequest());
  }

  @Test
  void put_nullValues_return400() throws Exception {
    putJson("{\"apps\":{\"ISSUE\":null}}").andExpect(status().isBadRequest());
    putJson("{\"cells\":[{\"item\":\"ISSUE_COMMENTED\",\"actor\":\"AGENT\",\"enabled\":null}]}")
        .andExpect(status().isBadRequest());
    putJson("{\"cells\":[null]}").andExpect(status().isBadRequest());
  }

  @Test
  void put_emptyBody_changesNothing() throws Exception {
    putJson("{}")
        .andExpect(status().isOk())
        .andExpect(jsonPath(item("ISSUE_ASSIGNED", "human"), contains(true)));
  }

  @Test
  void get_ignoresUnknownStoredItem() throws Exception {
    dsl.insertInto(NOTIFICATION_SETTING)
        .set(NOTIFICATION_SETTING.USER_ID, userId)
        .set(NOTIFICATION_SETTING.ITEM, "OBSOLETE_ITEM")
        .set(NOTIFICATION_SETTING.ACTOR, "HUMAN")
        .set(NOTIFICATION_SETTING.ENABLED, false)
        .execute();

    mvc.perform(get(URL).header("Authorization", "Bearer " + token))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.apps", hasSize(4)))
        .andExpect(jsonPath(item("ISSUE_ASSIGNED", "human"), contains(true)));
  }

  @Test
  void unauthenticated_returns401() throws Exception {
    mvc.perform(get(URL)).andExpect(status().isUnauthorized());
    mvc.perform(put(URL).contentType(MediaType.APPLICATION_JSON).content("{}"))
        .andExpect(status().isUnauthorized());
  }
}
