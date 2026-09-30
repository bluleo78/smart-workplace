package com.workplace.home.controller;

import static com.workplace.jooq.Tables.HOME_SESSION;
import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.global.tenant.TenantContext;
import com.workplace.home.service.HomeProposalService;
import com.workplace.home.service.HomeSessionService;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 홈 확인카드 REST 계약 테스트(#843) — 복원(GET)·승인·거부의 응답 형태와 상태코드.
 *
 * <p>무엇을·왜: 실행 실패는 4xx 가 아니라 200 + {@code proposal.status=FAILED} 로 돌려준다(실패 사실이 이미 기록됐으므로). 그 사유
 * 문구는 사전검증(/actions/validate)이 같은 파라미터에 내는 문구와 같아야 한다 — 카드·대화 이력·AI 가 한 문장으로 말하게 하기 위함이며,
 * ApiErrorDescriber 가 GlobalExceptionHandler 를 재사용하는지를 엔드포인트 계층에서 고정한다. 승인은 독립 트랜잭션(REQUIRES_NEW)을
 * 열기 때문에 테스트 트랜잭션으로 감쌀 수 없어 픽스처를 커밋하고 정리한다.
 */
class HomeProposalControllerTest extends IntegrationTestBase {

  @Autowired MockMvc mockMvc;
  @Autowired DSLContext dsl;
  @Autowired ObjectMapper om;
  @Autowired JwtTokenProvider jwtTokenProvider;
  @Autowired HomeSessionService sessionService;
  @Autowired HomeProposalService proposalService;

  private final List<Long> userIds = new ArrayList<>();
  private long owner;
  private String token;
  private UUID sid;

  @BeforeEach
  void setUp() {
    owner = seedUser();
    token = jwtTokenProvider.generateAccessToken(owner, "user-" + owner);
    TenantContext.set(1L);
    sid = sessionService.create(owner).id();
  }

  @AfterEach
  void cleanup() {
    TenantContext.clear();
    cleanupInTenant(
        1L,
        () -> {
          dsl.deleteFrom(HOME_SESSION).where(HOME_SESSION.USER_ID.in(userIds)).execute();
          dsl.deleteFrom(USER_ROLE).where(USER_ROLE.USER_ID.in(userIds)).execute();
          dsl.deleteFrom(USER).where(USER.ID.in(userIds)).execute();
        });
    userIds.clear();
  }

  @Test
  @DisplayName("세션 복원 — 미처리 카드를 id·params 와 함께 돌려준다")
  void pending_listsProposals() throws Exception {
    long id = record("calendar.delete_event", "회의 삭제", "{\"id\":987654321}");

    mockMvc
        .perform(get("/api/v1/home/sessions/" + sid + "/proposals").header(auth(), bearer()))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$[0].id").value(id))
        .andExpect(jsonPath("$[0].status").value("PENDING"))
        .andExpect(jsonPath("$[0].params.id").value(987654321));
  }

  @Test
  @DisplayName("승인 실패 — 200 + FAILED, 사유는 사전검증이 같은 파라미터에 내는 문구와 같다")
  void confirm_failure_returns200WithSameReasonAsValidate() throws Exception {
    String params = "{\"id\":987654321}";
    long id = record("calendar.delete_event", "회의 삭제", params);

    String validateBody =
        mockMvc
            .perform(
                post("/api/v1/actions/validate")
                    .header(auth(), bearer())
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(
                        "{\"actionType\":\"calendar.delete_event\",\"params\":" + params + "}"))
            .andExpect(status().isNotFound())
            .andReturn()
            .getResponse()
            .getContentAsString();
    String validateReason = om.readTree(validateBody).path("message").asText();

    String body =
        mockMvc
            .perform(post("/api/v1/home/proposals/" + id + "/confirm").header(auth(), bearer()))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.proposal.status").value("FAILED"))
            .andExpect(jsonPath("$.message.role").value("ACTION_FAILED"))
            .andReturn()
            .getResponse()
            .getContentAsString();
    JsonNode out = om.readTree(body);
    assertThat(validateReason).isNotBlank();
    assertThat(out.path("proposal").path("errorMessage").asText()).isEqualTo(validateReason);
    assertThat(out.path("message").path("content").asText()).endsWith("사유: " + validateReason);
  }

  @Test
  @DisplayName("이미 처리된 카드 재승인은 409")
  void confirm_twice_returns409() throws Exception {
    long id = record("calendar.delete_event", "회의 삭제", "{\"id\":987654321}");
    mockMvc
        .perform(post("/api/v1/home/proposals/" + id + "/confirm").header(auth(), bearer()))
        .andExpect(status().isOk());

    mockMvc
        .perform(post("/api/v1/home/proposals/" + id + "/confirm").header(auth(), bearer()))
        .andExpect(status().isConflict());
  }

  @Test
  @DisplayName("다른 사용자의 카드 거부는 404")
  void reject_othersProposal_returns404() throws Exception {
    long id = record("calendar.delete_event", "회의 삭제", "{\"id\":987654321}");
    long other = seedUser();
    String otherToken = jwtTokenProvider.generateAccessToken(other, "user-" + other);

    mockMvc
        .perform(
            post("/api/v1/home/proposals/" + id + "/reject").header(auth(), "Bearer " + otherToken))
        .andExpect(status().isNotFound());
  }

  // ── 헬퍼 ──────────────────────────────────────────────────────────────

  private long record(String actionType, String summary, String paramsJson) throws Exception {
    JsonNode actions =
        om.readTree(
            "[{\"actionType\":\"%s\",\"summary\":\"%s\",\"params\":%s}]"
                .formatted(actionType, summary, paramsJson));
    return proposalService.record(owner, sid, actions).get(0).id();
  }

  /** 전역 USER + 테넌트#1 USER 역할(calendar:write 포함) 커밋. */
  private long seedUser() {
    long uid = TestFixtures.createHuman(dsl);
    userIds.add(uid);
    TenantContext.set(1L);
    new TransactionTemplate(txManager)
        .execute(
            status -> {
              Long roleId =
                  dsl.select(ROLE.ID).from(ROLE).where(ROLE.NAME.eq("USER")).fetchOne(ROLE.ID);
              dsl.insertInto(USER_ROLE)
                  .set(USER_ROLE.USER_ID, uid)
                  .set(USER_ROLE.ROLE_ID, roleId)
                  .execute();
              return null;
            });
    return uid;
  }

  private static String auth() {
    return "Authorization";
  }

  private String bearer() {
    return "Bearer " + token;
  }
}
