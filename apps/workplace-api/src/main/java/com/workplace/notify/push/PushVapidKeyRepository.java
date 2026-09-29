package com.workplace.notify.push;

import static com.workplace.jooq.Tables.PUSH_VAPID_KEY;

import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.springframework.stereotype.Repository;

/** push_vapid_key(id=1 단일 행) 접근. 다중 인스턴스 동시 기동 시 먼저 들어간 키만 남도록 ON CONFLICT DO NOTHING. */
@Repository
@RequiredArgsConstructor
public class PushVapidKeyRepository {

  private static final short SINGLETON_ID = 1;
  private final DSLContext dsl;

  /** 저장된 키. [0]=공개키(base64url), [1]=암호화된 개인키. */
  public Optional<String[]> find() {
    return dsl.select(PUSH_VAPID_KEY.PUBLIC_KEY, PUSH_VAPID_KEY.PRIVATE_KEY_ENC)
        .from(PUSH_VAPID_KEY)
        .where(PUSH_VAPID_KEY.ID.eq(SINGLETON_ID))
        .fetchOptional(
            r ->
                new String[] {
                  r.get(PUSH_VAPID_KEY.PUBLIC_KEY), r.get(PUSH_VAPID_KEY.PRIVATE_KEY_ENC)
                });
  }

  /** 키가 없을 때만 저장. 경합에서 진 쪽은 조용히 무시되고 호출자가 find() 로 승자 키를 읽는다. */
  public void insertIfAbsent(String publicKey, String privateKeyEnc) {
    dsl.insertInto(PUSH_VAPID_KEY)
        .set(PUSH_VAPID_KEY.ID, SINGLETON_ID)
        .set(PUSH_VAPID_KEY.PUBLIC_KEY, publicKey)
        .set(PUSH_VAPID_KEY.PRIVATE_KEY_ENC, privateKeyEnc)
        .onConflictDoNothing()
        .execute();
  }
}
