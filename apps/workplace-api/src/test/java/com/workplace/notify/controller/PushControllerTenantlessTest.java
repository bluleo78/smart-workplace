package com.workplace.notify.controller;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workplace.global.security.JwtTokenProvider;
import com.workplace.notify.push.EcKeys;
import com.workplace.notify.push.PushSubscriptionRepository;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.security.interfaces.ECPublicKey;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

/**
 * push_subscription/notification_preference 가 실제로 tenant GUC(app.tenant_id) 없이 동작하는지 DB 계층까지 검증하는
 * 회귀 테스트(#864 리뷰 지적).
 *
 * <p>{@link PushControllerTest} 는 {@link IntegrationTestBase}의 {@code @BeforeTransaction} 이 {@code
 * defaultTenantId()}(기본 1L)를 트랜잭션 시작 전에 심어주므로, 실제로는 항상 GUC 가 주입된 상태에서 돈다. 그 결과 "테넌트 미선택 토큰으로도
 * 동작한다"는 주장이 시큐리티 필터(2-인자 토큰이 인증을 통과한다) 수준에서만 증명되고, {@code TenantAwareTransactionManager .doBegin}
 * 이 실제로 null tenant 를 받았을 때 저장소 쿼리가 깨지지 않는지는 가려져 있었다.
 *
 * <p>이 클래스는 {@link #defaultTenantId()} 를 {@code null} 로 오버라이드해 GUC 주입 자체를 차단한 채로 구독 등록과 설정 조회/수정을
 * 수행한다. {@code push_subscription}/{@code notification_preference} 는 RLS 가 없는 글로벌
 * 테이블이라(V137__web_push.sql 참고) GUC 없이도 정상 동작해야 하며, 이 테스트가 그 사실을 고정한다 — 다른 RLS 재발 사례(#444, #492,
 * #630)처럼 조용히 깨지는 것을 막는다.
 */
@Transactional
@AutoConfigureMockMvc
class PushControllerTenantlessTest extends IntegrationTestBase {

  @Override
  protected Long defaultTenantId() {
    // 테넌트 GUC 자체를 심지 않는다 — TenantAwareTransactionManager.doBegin 이 null 을 보고
    // set_config 를 건너뛰는 경로를 그대로 태운다.
    return null;
  }

  @Autowired MockMvc mvc;
  @Autowired DSLContext dsl;
  @Autowired JwtTokenProvider jwt;
  @Autowired PushSubscriptionRepository subs;

  long userId;
  String token; // 테넌트 미선택(2-인자) 토큰
  String p256dh;
  final String auth = EcKeys.b64e(new byte[16]);

  @BeforeEach
  void setUp() {
    userId = TestFixtures.createHuman(dsl);
    token = jwt.generateAccessToken(userId, "u");
    p256dh = EcKeys.b64e(EcKeys.encodePublic((ECPublicKey) EcKeys.generate().getPublic()));
  }

  private String ep() {
    return "https://203.0.113.20/push/" + UUID.randomUUID();
  }

  @Test
  void register_worksWithoutTenantGuc() throws Exception {
    String ep = ep();
    mvc.perform(
            post("/api/v1/push/subscriptions")
                .header("Authorization", "Bearer " + token)
                .contentType(MediaType.APPLICATION_JSON)
                .content(
                    """
                    {"endpoint":"%s","keys":{"p256dh":"%s","auth":"%s"}}"""
                        .formatted(ep, p256dh, auth)))
        .andExpect(status().isNoContent());
    assertThat(subs.findOwner(ep)).contains(userId);
  }

  @Test
  void preferences_getAndUpdate_workWithoutTenantGuc() throws Exception {
    mvc.perform(get("/api/v1/push/preferences").header("Authorization", "Bearer " + token))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.DM").value(true))
        .andExpect(jsonPath("$.MENTION").value(true))
        .andExpect(jsonPath("$.ISSUE").value(true))
        .andExpect(jsonPath("$.CALENDAR").value(true));

    mvc.perform(
            put("/api/v1/push/preferences")
                .header("Authorization", "Bearer " + token)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"DM\":false}"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.DM").value(false))
        .andExpect(jsonPath("$.CALENDAR").value(true));
  }
}
