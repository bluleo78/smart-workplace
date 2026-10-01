package com.workplace.notify.push;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyMap;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.security.KeyPair;
import java.security.interfaces.ECPublicKey;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.transaction.annotation.Transactional;

/** PushSender — 설정 필터, 헤더, 상태코드별 구독 처리(성공 초기화·410 삭제·5회 실패 삭제), 한 구독 실패 격리. */
@Transactional
@ExtendWith(OutputCaptureExtension.class)
class PushSenderTest extends IntegrationTestBase {

  @MockitoBean PushGateway gateway;
  @Autowired PushSender sender;
  @Autowired PushSubscriptionRepository subs;
  @Autowired NotificationPreferenceRepository prefs;
  @Autowired DSLContext dsl;
  @Autowired ObjectMapper om;

  long user;
  final String auth = EcKeys.b64e(new byte[16]);
  String p256dh;

  static PushMessage msg() {
    return new PushMessage(
        1L, PushCategory.DM, "박OO", "PR 리뷰 부탁드려요", "/chat/dms/42", "ch-42", "high", 86400);
  }

  @BeforeEach
  void seed() {
    user = TestFixtures.createHuman(dsl);
    KeyPair ua = EcKeys.generate();
    p256dh = EcKeys.b64e(EcKeys.encodePublic((ECPublicKey) ua.getPublic()));
  }

  private String addSub() {
    String ep = "https://203.0.113.10/push/" + UUID.randomUUID();
    subs.upsert(user, ep, p256dh, auth, null);
    return ep;
  }

  @Test
  void send_success_setsHeaders_andResetsFailure() {
    String ep = addSub();
    when(gateway.deliver(eq(ep), any(), anyMap())).thenReturn(PushGateway.Result.of(201));

    sender.send(List.of(user), msg());

    @SuppressWarnings("unchecked")
    ArgumentCaptor<Map<String, String>> headers = ArgumentCaptor.forClass(Map.class);
    verify(gateway).deliver(eq(ep), any(), headers.capture());
    assertThat(headers.getValue())
        .containsEntry("TTL", "86400")
        .containsEntry("Urgency", "high")
        .containsEntry("Content-Encoding", "aes128gcm")
        .containsEntry("Content-Type", "application/octet-stream");
    assertThat(headers.getValue().get("Authorization")).startsWith("vapid t=");
  }

  @Test
  void send_gone_deletesSubscription() {
    String ep = addSub();
    when(gateway.deliver(eq(ep), any(), anyMap())).thenReturn(PushGateway.Result.of(410));
    sender.send(List.of(user), msg());
    assertThat(subs.findOwner(ep)).isEmpty();
  }

  /** 같은 host 의 거부는 구독마다가 아니라 발송 1회당 (host, status) 1줄로 사유와 건수를 남기고, 구독 토큰 경로는 남기지 않는다(WP-152). */
  @Test
  void send_rejections_loggedOncePerHostAndStatus(CapturedOutput output) {
    String a = addSub();
    String b = addSub();
    when(gateway.deliver(anyString(), any(), anyMap()))
        .thenReturn(new PushGateway.Result(403, "{\"reason\":\"BadJwtToken\"}"));

    sender.send(List.of(user), msg());

    assertThat(output)
        .containsOnlyOnce(
            "[push] 발송 실패 host=203.0.113.10 status=403 count=2 reason={\"reason\":\"BadJwtToken\"}")
        .doesNotContain(a.substring(a.lastIndexOf('/')))
        .doesNotContain(b.substring(b.lastIndexOf('/')));
  }

  @Test
  void send_transientFailure5Times_deletes() {
    String ep = addSub();
    when(gateway.deliver(eq(ep), any(), anyMap())).thenReturn(PushGateway.Result.of(503));
    for (int i = 0; i < 4; i++) sender.send(List.of(user), msg());
    assertThat(subs.findOwner(ep)).isPresent();
    sender.send(List.of(user), msg());
    assertThat(subs.findOwner(ep)).isEmpty();
  }

  @Test
  void send_dnsUnresolved_doesNotDeleteButCountsAsFailure() {
    // RFC 2606 예약 TLD(.invalid) — 실제로는 절대 등록되지 않아 DNS 조회가 결정적으로 실패(UnknownHostException)한다.
    // 내부 주소로 재해석된 것(BLOCKED)이 아니라 조회 자체가 실패한 것(UNRESOLVED)이므로 곧바로 삭제되면 안 되고,
    // 다른 일시적 발송 실패(5xx 등)와 같은 방식으로 5회 누적돼야 삭제된다.
    String ep = "https://dns-fail.invalid/push/" + UUID.randomUUID();
    subs.upsert(user, ep, p256dh, auth, null);

    for (int i = 0; i < 4; i++) sender.send(List.of(user), msg());
    assertThat(subs.findOwner(ep)).isPresent();
    verify(gateway, never()).deliver(eq(ep), any(), anyMap());

    sender.send(List.of(user), msg());
    assertThat(subs.findOwner(ep)).isEmpty();
  }

  @Test
  void send_blockedInternalAddress_deletesImmediately() {
    // register() 검증을 거치지 않고 직접 저장(재바인딩 등으로 이미 등록된 뒤 내부 주소로 재해석되는 상황 재현) —
    // BLOCKED 는 UNRESOLVED 와 달리 즉시 삭제되고, 발송 시도(gateway.deliver) 자체가 없어야 한다.
    String ep = "https://127.0.0.1/push/" + UUID.randomUUID();
    subs.upsert(user, ep, p256dh, auth, null);

    sender.send(List.of(user), msg());

    assertThat(subs.findOwner(ep)).isEmpty();
    verify(gateway, never()).deliver(eq(ep), any(), anyMap());
  }

  @Test
  void send_categoryDisabled_skips() {
    addSub();
    prefs.upsert(user, PushCategory.DM, false);
    sender.send(List.of(user), msg());
    verify(gateway, never()).deliver(any(), any(), anyMap());
  }

  @Test
  void send_oneSubscriptionThrows_othersStillDelivered() {
    // 잘못 저장된 키(검증 우회 데이터) — 길이부터 틀린 값은 EcKeys.decodePublic 에서, 길이는 맞지만 곡선 위에 없는 값은
    // WebPushEncryptor.encrypt 내부 ECDH 단계(IllegalStateException)에서 각각 예외가 난다. 두 경우 모두 다른 구독
    // 발송을 막지 않고, 연속 실패로 집계되어 5회째 삭제되는지까지 확인한다.
    String tooShort = "https://203.0.113.10/push/broken-short-" + UUID.randomUUID();
    String offCurve = "https://203.0.113.10/push/broken-curve-" + UUID.randomUUID();
    subs.upsert(user, tooShort, "AAAA", auth, null);
    subs.upsert(user, offCurve, EcKeys.b64e(offCurvePoint()), auth, null);
    String ok = addSub();
    when(gateway.deliver(eq(ok), any(), anyMap())).thenReturn(PushGateway.Result.of(201));

    for (int i = 0; i < 5; i++) sender.send(List.of(user), msg());

    verify(gateway, times(5)).deliver(eq(ok), any(), anyMap());
    assertThat(subs.findOwner(tooShort)).isEmpty();
    assertThat(subs.findOwner(offCurve)).isEmpty();
  }

  /** 65바이트 비압축점 형식(0x04‖X‖Y)은 맞지만 P-256 곡선 위에 있지 않은 점(X=Y=1) — ECDH 단계에서만 걸러진다. */
  private static byte[] offCurvePoint() {
    byte[] raw = new byte[65];
    raw[0] = 0x04;
    raw[32] = 1; // X = 1
    raw[64] = 1; // Y = 1
    return raw;
  }

  @Test
  void payload_json_hasContract() throws Exception {
    byte[] json = sender.payload(msg());
    JsonNode n = om.readTree(json);
    assertThat(n.get("v").asInt()).isEqualTo(1);
    assertThat(n.get("tenantId").asLong()).isEqualTo(1L);
    assertThat(n.get("category").asText()).isEqualTo("DM");
    assertThat(n.get("title").asText()).isEqualTo("박OO");
    assertThat(n.get("url").asText()).isEqualTo("/chat/dms/42");
    assertThat(n.get("tag").asText()).isEqualTo("ch-42");
    assertThat(json.length).isLessThan(3000);
  }

  @Test
  void redacted_hidesContent() {
    PushMessage r = msg().redacted();
    assertThat(r.title()).isEqualTo("새 메시지");
    assertThat(r.body()).isEqualTo("새 메시지가 있습니다");
    assertThat(r.url()).isEqualTo("/chat/dms/42");
    PushMessage issue =
        new PushMessage(
                1L,
                PushCategory.ISSUE,
                "SW-1 제목",
                "배정",
                "/projects/SW/issues/1",
                "issue-1",
                "normal",
                259200)
            .redacted();
    assertThat(issue.title()).isEqualTo("새 알림");
    assertThat(issue.body()).isEqualTo("새 알림이 있습니다");
  }
}
