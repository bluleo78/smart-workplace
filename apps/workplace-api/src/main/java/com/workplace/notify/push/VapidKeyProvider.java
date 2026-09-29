package com.workplace.notify.push;

import com.workplace.global.security.EncryptionService;
import java.security.KeyPair;
import java.security.interfaces.ECPrivateKey;
import java.security.interfaces.ECPublicKey;
import java.util.function.Supplier;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

/**
 * VAPID 키 제공. 우선순위: env(workplace.push.vapid-*) → DB(push_vapid_key) → 둘 다 없으면 생성해 DB 저장. 키가 바뀌면 기존
 * 구독이 모두 무효가 되므로 한 번 만든 키를 계속 쓴다. 다중 인스턴스 동시 생성은 insertIfAbsent + 재조회로 승자 키 하나로 수렴한다. 최초 get() 에서
 * 로드 후 메모리 캐시(설정이 enabled=false 면 아예 호출되지 않음).
 */
@Slf4j
@Component
public class VapidKeyProvider implements Supplier<VapidKeys> {

  private final PushProperties props;
  private final PushVapidKeyRepository repo;
  private final EncryptionService encryption;
  private volatile VapidKeys cached;

  public VapidKeyProvider(
      PushProperties props, PushVapidKeyRepository repo, EncryptionService encryption) {
    this.props = props;
    this.repo = repo;
    this.encryption = encryption;
  }

  /** 키 반환(최초 1회 로드/생성). */
  @Override
  public VapidKeys get() {
    VapidKeys k = cached;
    if (k != null) return k;
    synchronized (this) {
      if (cached == null) cached = load();
      return cached;
    }
  }

  private VapidKeys load() {
    if (props.hasEnvKeys()) {
      return toKeys(props.vapidPublicKey(), EcKeys.b64d(props.vapidPrivateKey()));
    }
    var stored = repo.find();
    if (stored.isEmpty()) {
      KeyPair kp = EcKeys.generate();
      String pub = EcKeys.b64e(EcKeys.encodePublic((ECPublicKey) kp.getPublic()));
      String privEnc =
          encryption.encrypt(EcKeys.b64e(EcKeys.encodePrivate((ECPrivateKey) kp.getPrivate())));
      repo.insertIfAbsent(pub, privEnc);
      log.info("[push] VAPID 키를 새로 생성했습니다");
      stored = repo.find();
    }
    String[] row = stored.orElseThrow(() -> new IllegalStateException("VAPID 키 저장 실패"));
    return toKeys(row[0], EcKeys.b64d(encryption.decrypt(row[1])));
  }

  private static VapidKeys toKeys(String pubB64, byte[] d) {
    KeyPair kp = EcKeys.fromRaw(EcKeys.b64d(pubB64), d);
    return new VapidKeys(pubB64, (ECPublicKey) kp.getPublic(), (ECPrivateKey) kp.getPrivate());
  }
}
