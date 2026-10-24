package com.workplace.notify.controller;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workplace.global.security.JwtTokenProvider;
import com.workplace.notify.push.EcKeys;
import com.workplace.notify.push.PushSubscriptionRepository;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.security.interfaces.ECPublicKey;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

/**
 * /api/v1/push/* 통합 테스트 — 실제 JWT(테넌트 미선택 토큰 포함)로 호출. 구독 upsert·소유자 이전·본인만 삭제·20개 제한·키/endpoint 검증,
 * config 응답.
 */
@Transactional
class PushControllerTest extends IntegrationTestBase {

  @Autowired MockMvc mvc;
  @Autowired DSLContext dsl;
  @Autowired JwtTokenProvider jwt;
  @Autowired PushSubscriptionRepository subs;

  long userA;
  long userB;
  String tokenA; // 테넌트 미선택(2-인자) 토큰 — 구독은 글로벌이라 이 토큰으로도 동작해야 한다.
  String tokenB;
  String p256dh;
  final String auth = EcKeys.b64e(new byte[16]);

  @BeforeEach
  void setUp() {
    userA = TestFixtures.createHuman(dsl);
    userB = TestFixtures.createHuman(dsl);
    tokenA = jwt.generateAccessToken(userA, "a");
    tokenB = jwt.generateAccessToken(userB, "b");
    p256dh = EcKeys.b64e(EcKeys.encodePublic((ECPublicKey) EcKeys.generate().getPublic()));
  }

  private String body(String endpoint) {
    return """
        {"endpoint":"%s","keys":{"p256dh":"%s","auth":"%s"}}"""
        .formatted(endpoint, p256dh, auth);
  }

  private String ep() {
    return "https://203.0.113.10/push/" + UUID.randomUUID();
  }

  @Test
  void config_returnsEnabledAndPublicKey() throws Exception {
    mvc.perform(get("/api/v1/push/config").header("Authorization", "Bearer " + tokenA))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.enabled").value(true))
        .andExpect(jsonPath("$.vapidPublicKey").isString());
  }

  @Test
  void register_thenUnregister() throws Exception {
    String ep = ep();
    mvc.perform(
            post("/api/v1/push/subscriptions")
                .header("Authorization", "Bearer " + tokenA)
                .contentType(MediaType.APPLICATION_JSON)
                .content(body(ep)))
        .andExpect(status().isNoContent());
    assertThat(subs.findOwner(ep)).contains(userA);

    mvc.perform(
            delete("/api/v1/push/subscriptions")
                .header("Authorization", "Bearer " + tokenA)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"endpoint\":\"" + ep + "\"}"))
        .andExpect(status().isNoContent());
    assertThat(subs.findOwner(ep)).isEmpty();
  }

  @Test
  void register_sameEndpoint_transfersOwnership() throws Exception {
    String ep = ep();
    for (String t : List.of(tokenA, tokenB)) {
      mvc.perform(
              post("/api/v1/push/subscriptions")
                  .header("Authorization", "Bearer " + t)
                  .contentType(MediaType.APPLICATION_JSON)
                  .content(body(ep)))
          .andExpect(status().isNoContent());
    }
    assertThat(subs.findOwner(ep)).contains(userB);
    assertThat(subs.findByUserIds(List.of(userA))).isEmpty();
  }

  @Test
  void unregister_othersEndpoint_isNoop() throws Exception {
    String ep = ep();
    subs.upsert(userA, ep, p256dh, auth, null);
    mvc.perform(
            delete("/api/v1/push/subscriptions")
                .header("Authorization", "Bearer " + tokenB)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"endpoint\":\"" + ep + "\"}"))
        .andExpect(status().isNoContent());
    assertThat(subs.findOwner(ep)).contains(userA);
  }

  @Test
  void register_keepsAtMost20PerUser() throws Exception {
    for (int i = 0; i < 21; i++) {
      mvc.perform(
              post("/api/v1/push/subscriptions")
                  .header("Authorization", "Bearer " + tokenA)
                  .contentType(MediaType.APPLICATION_JSON)
                  .content(body(ep())))
          .andExpect(status().isNoContent());
    }
    assertThat(subs.findByUserIds(List.of(userA))).hasSize(20);
  }

  @Test
  void register_internalEndpoint_returns400() throws Exception {
    mvc.perform(
            post("/api/v1/push/subscriptions")
                .header("Authorization", "Bearer " + tokenA)
                .contentType(MediaType.APPLICATION_JSON)
                .content(body("https://169.254.169.254/latest")))
        .andExpect(status().isBadRequest());
  }

  @Test
  void register_invalidKeys_returns400() throws Exception {
    String bad =
        """
        {"endpoint":"%s","keys":{"p256dh":"%s","auth":"%s"}}"""
            .formatted(ep(), EcKeys.b64e(new byte[10]), auth);
    mvc.perform(
            post("/api/v1/push/subscriptions")
                .header("Authorization", "Bearer " + tokenA)
                .contentType(MediaType.APPLICATION_JSON)
                .content(bad))
        .andExpect(status().isBadRequest());
    String notB64 =
        """
        {"endpoint":"%s","keys":{"p256dh":"%s","auth":"%%%%"}}"""
            .formatted(ep(), p256dh);
    mvc.perform(
            post("/api/v1/push/subscriptions")
                .header("Authorization", "Bearer " + tokenA)
                .contentType(MediaType.APPLICATION_JSON)
                .content(notB64))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.message").value("푸시 키가 올바른 base64url 형식이 아닙니다"));
    // WP-565 — base64 가 아닌 공개키도 JDK 내부 영어 문구(「Illegal base64 character 21」) 대신 한국어로 답한다.
    String badPub =
        """
        {"endpoint":"%s","keys":{"p256dh":"!!!","auth":"###"}}"""
            .formatted(ep());
    mvc.perform(
            post("/api/v1/push/subscriptions")
                .header("Authorization", "Bearer " + tokenA)
                .contentType(MediaType.APPLICATION_JSON)
                .content(badPub))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.message").value("푸시 키가 올바른 base64url 형식이 아닙니다"));
  }

  @Test
  void unauthenticated_returns401() throws Exception {
    mvc.perform(get("/api/v1/push/config")).andExpect(status().isUnauthorized());
  }
}
