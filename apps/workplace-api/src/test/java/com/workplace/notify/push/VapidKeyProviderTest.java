package com.workplace.notify.push;

import static com.workplace.jooq.Tables.PUSH_VAPID_KEY;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.global.security.EncryptionService;
import com.workplace.support.IntegrationTestBase;
import java.security.KeyPair;
import java.security.interfaces.ECPrivateKey;
import java.security.interfaces.ECPublicKey;
import java.time.Duration;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/** VAPID 키 로딩 우선순위(env → DB → 생성)와 재기동 시 동일 키 유지 검증. provider 는 테스트마다 새로 만든다(캐시 격리). */
@Transactional
class VapidKeyProviderTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired PushVapidKeyRepository repo;
  @Autowired EncryptionService encryption;

  private PushProperties props(String pub, String priv) {
    return new PushProperties(true, true, "mailto:t@example.com", Duration.ofSeconds(5), pub, priv);
  }

  @Test
  void generatesOnce_thenReusesFromDb() {
    dsl.deleteFrom(PUSH_VAPID_KEY).execute();
    VapidKeys first = new VapidKeyProvider(props("", ""), repo, encryption).get();
    VapidKeys second = new VapidKeyProvider(props("", ""), repo, encryption).get(); // "재기동"

    assertThat(second.publicKeyBase64Url()).isEqualTo(first.publicKeyBase64Url());
    assertThat(EcKeys.b64d(first.publicKeyBase64Url())).hasSize(65);
    // DB 에는 평문 개인키가 저장되지 않는다.
    String enc = repo.find().orElseThrow()[1];
    assertThat(enc).doesNotContain(EcKeys.b64e(EcKeys.encodePrivate(first.privateKey())));
  }

  @Test
  void envKeys_takePrecedence() {
    KeyPair kp = EcKeys.generate();
    String pub = EcKeys.b64e(EcKeys.encodePublic((ECPublicKey) kp.getPublic()));
    String priv = EcKeys.b64e(EcKeys.encodePrivate((ECPrivateKey) kp.getPrivate()));

    VapidKeys keys = new VapidKeyProvider(props(pub, priv), repo, encryption).get();

    assertThat(keys.publicKeyBase64Url()).isEqualTo(pub);
  }
}
