package com.workplace.calendar.controller;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.nullValue;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.authentication;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workplace.calendar.CalendarNoteTestBase;
import com.workplace.global.tenant.TenantContext;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.RequestPostProcessor;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ObjectNode;

/** 일정 노트 잇기·끊기·조회 HTTP(WP-1701) — 응답 모양, 404 존재 은닉(볼 수 없는 노트 = 없는 노트), 409, 400, 204. */
class CalendarEventNoteApiTest extends CalendarNoteTestBase {
  @Autowired MockMvc mvc;
  @Autowired ObjectMapper om;

  /** 사람 요청으로 꾸민다 — 요청마다 테넌트를 되돌려 놓는다. */
  private RequestPostProcessor as(long uid) {
    RequestPostProcessor auth =
        authentication(
            new UsernamePasswordAuthenticationToken(
                uid,
                "n/a",
                List.of(
                    new SimpleGrantedAuthority("calendar:read"),
                    new SimpleGrantedAuthority("calendar:write"))));
    return req -> {
      TenantContext.set(1L);
      return auth.postProcessRequest(req);
    };
  }

  private static String body(Object pageId) {
    return "{\"pageId\":" + pageId + "}";
  }

  @Test
  void putNote_returnsCardJson() throws Exception {
    long e = singleEvent(ownerA);
    mvc.perform(
            put("/api/v1/calendar/events/{id}/note", e)
                .with(as(ownerA))
                .contentType(MediaType.APPLICATION_JSON)
                .content(body(pA)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.note.title").value("A 만 보는 노트"))
        .andExpect(jsonPath("$.note.spaceName").exists())
        .andExpect(jsonPath("$.note.restricted").value(false));
  }

  /** 볼 수 없는 노트와 없는 노트는 상태·본문이 같다(타임스탬프·경로 칸 제외) — 응답 차이로 노트의 존재를 알아내지 못하게. */
  @Test
  void linkNote_unreadableAndMissingPage_lookIdentical() throws Exception {
    long e = singleEvent(strangerC);
    JsonNode unreadable = putNotFound(strangerC, e, pA);
    JsonNode missing = putNotFound(strangerC, e, Long.MAX_VALUE);
    assertThat(unreadable).isEqualTo(missing);
    assertThat(unreadable.get("message").asString()).doesNotContainPattern("\\d");
  }

  private JsonNode putNotFound(long caller, long eventId, long pageId) throws Exception {
    MvcResult r =
        mvc.perform(
                put("/api/v1/calendar/events/{id}/note", eventId)
                    .with(as(caller))
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(body(pageId)))
            .andReturn();
    assertThat(r.getResponse().getStatus()).isEqualTo(404);
    JsonNode n = om.readTree(r.getResponse().getContentAsString(StandardCharsets.UTF_8));
    ObjectNode copy = (ObjectNode) n.deepCopy();
    for (String k : new ArrayList<>(copy.propertyNames())) {
      if (k.equals("timestamp") || k.equals("path")) copy.remove(k);
    }
    return copy;
  }

  @Test
  void putNote_readOnly_409() throws Exception {
    long ev = seedExternalEvent(true, "api-ro");
    mvc.perform(
            put("/api/v1/calendar/events/{id}/note", ev)
                .with(as(ownerA))
                .contentType(MediaType.APPLICATION_JSON)
                .content(body(pA)))
        .andExpect(status().isConflict());
  }

  @Test
  void getNote_restricted_hasOnlyRestrictedField() throws Exception {
    long e = singleEvent(ownerA);
    // B 를 참석자로 둔 일정에 A 만 보는 노트를 잇는다.
    long shared = weeklyEvent(ownerA, attendeeB);
    eventService.linkNote(ownerA, shared, START, pA);
    MvcResult r =
        mvc.perform(
                get("/api/v1/calendar/events/{id}/note", shared)
                    .param("occurrenceDate", "2026-11-18T01:00:00Z")
                    .with(as(attendeeB)))
            .andExpect(status().isOk())
            .andReturn();
    JsonNode note =
        om.readTree(r.getResponse().getContentAsString(StandardCharsets.UTF_8)).get("note");
    List<String> keys = new ArrayList<>();
    note.propertyNames().forEach(keys::add);
    assertThat(keys).containsExactly("restricted");
    assertThat(note.get("restricted").asBoolean()).isTrue();
    assertThat(e).isPositive();
  }

  @Test
  void getNote_noLink_noteIsNull() throws Exception {
    long e = singleEvent(ownerA);
    mvc.perform(get("/api/v1/calendar/events/{id}/note", e).with(as(ownerA)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.note").value(nullValue()))
        // 키 자체는 있어야 한다 — {} 가 아니라 {"note": null}.
        .andExpect(content().string(containsString("\"note\":null")));
  }

  @Test
  void deleteNote_204() throws Exception {
    long e = singleEvent(ownerA);
    eventService.linkNote(ownerA, e, null, pA);
    mvc.perform(delete("/api/v1/calendar/events/{id}/note", e).with(as(ownerA)))
        .andExpect(status().isNoContent());
    assertThat(noteRows(e)).isZero();
    // 연결이 없어도 204.
    mvc.perform(delete("/api/v1/calendar/events/{id}/note", e).with(as(ownerA)))
        .andExpect(status().isNoContent());
  }

  @Test
  void putNote_missingPageId_400() throws Exception {
    long e = singleEvent(ownerA);
    mvc.perform(
            put("/api/v1/calendar/events/{id}/note", e)
                .with(as(ownerA))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{}"))
        .andExpect(status().isBadRequest());
  }
}
