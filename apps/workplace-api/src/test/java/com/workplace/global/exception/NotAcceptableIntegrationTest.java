package com.workplace.global.exception;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workplace.global.security.JwtTokenProvider;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

/**
 * {@code produces} 가 고정된 엔드포인트에 지원하지 않는 Accept 로 요청하면 500 이 아니라 406 이 나가는지 확인한다(WP-1601).
 *
 * <p>예전엔 {@code Accept: application/json} 일 때만 catch-all 처리기가 JSON 500 을 써서 내보냈다(xml·text/plain 은
 * 처리기 쓰기가 실패해 Spring 기본 처리가 우연히 406 을 냈다).
 *
 * <p>본문 없는 406 은 MockMvc 기준이다 — 실제 서버에서는 Tomcat 오류 밸브(WP-732)가 같은 문구의 JSON 으로 채운다 ({@code
 * ContainerErrorJsonIntegrationTest} 가 실제 요청으로 확인).
 *
 * <p>{@code /events} 의 {@code Accept: *}{@code /*} 정상 요청은 SSE 가 열려 MockMvc 에서 끝나지 않으므로 회귀 확인에서 뺀다.
 */
@Transactional
class NotAcceptableIntegrationTest extends IntegrationTestBase {

  private static final String EVENTS = "/api/v1/events";
  private static final String PREVIEW_META = "/api/v1/public/drive/share/zzzz/preview-meta";

  @Autowired MockMvc mvc;
  @Autowired DSLContext dsl;
  @Autowired JwtTokenProvider jwtTokenProvider;

  /** 테넌트#1 ACTIVE 멤버인 USER 의 Authorization 헤더 값(/events 는 로그인이 필요하다). */
  private String bearer() {
    long id = withMembership(TestFixtures.createHuman(dsl));
    grantUserRole(id);
    return "Bearer " + jwtTokenProvider.generateAccessToken(id, "human-" + id, 1L);
  }

  @Test
  void events_에_Accept_json_이면_406_JSON_본문() throws Exception {
    mvc.perform(get(EVENTS).header("Authorization", bearer()).accept("application/json"))
        .andExpect(status().isNotAcceptable())
        .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_JSON))
        .andExpect(jsonPath("$.status").value(406));
  }

  @Test
  void 공개_preview_meta_에_Accept_json_이면_406_JSON_본문() throws Exception {
    mvc.perform(get(PREVIEW_META).accept("application/json"))
        .andExpect(status().isNotAcceptable())
        .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_JSON))
        .andExpect(jsonPath("$.status").value(406));
  }

  @Test
  void events_에_Accept_xml_이면_본문_없는_406() throws Exception {
    mvc.perform(get(EVENTS).header("Authorization", bearer()).accept("application/xml"))
        .andExpect(status().isNotAcceptable())
        .andExpect(content().string(""));
  }

  @Test
  void 공개_preview_meta_에_Accept_xml_이면_본문_없는_406() throws Exception {
    mvc.perform(get(PREVIEW_META).accept("application/xml"))
        .andExpect(status().isNotAcceptable())
        .andExpect(content().string(""));
  }

  @Test
  void events_에_Accept_text_plain_이면_본문_없는_406() throws Exception {
    mvc.perform(get(EVENTS).header("Authorization", bearer()).accept("text/plain"))
        .andExpect(status().isNotAcceptable())
        .andExpect(content().string(""));
  }

  @Test
  void 공개_preview_meta_에_Accept_text_plain_이면_본문_없는_406() throws Exception {
    mvc.perform(get(PREVIEW_META).accept("text/plain"))
        .andExpect(status().isNotAcceptable())
        .andExpect(content().string(""));
  }

  @Test
  void Accept_json_q0_은_JSON_을_거절한다는_뜻이라_본문_없는_406() throws Exception {
    mvc.perform(get(PREVIEW_META).header("Accept", "text/csv, application/json;q=0"))
        .andExpect(status().isNotAcceptable())
        .andExpect(content().string(""));
  }

  @Test
  void Accept_헤더가_여러_줄이어도_JSON_을_받으면_406_JSON_본문() throws Exception {
    mvc.perform(get(PREVIEW_META).header("Accept", "application/xml", "application/json"))
        .andExpect(status().isNotAcceptable())
        .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_JSON))
        .andExpect(jsonPath("$.status").value(406));
  }

  @Test
  void 공개_preview_meta_에_Accept_any_는_기존대로_204() throws Exception {
    mvc.perform(get(PREVIEW_META).accept("*/*")).andExpect(status().isNoContent());
  }
}
