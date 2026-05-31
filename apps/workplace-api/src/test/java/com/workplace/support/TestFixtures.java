package com.workplace.support;

import static com.workplace.jooq.Tables.USER;

import com.workplace.auth.service.AiAgentCredentialService;
import com.workplace.user.dto.UserKind;
import java.util.concurrent.atomic.AtomicLong;
import org.jooq.DSLContext;

/**
 * 통합 테스트용 공용 픽스처 헬퍼. 여러 태스크(resolver/service 테스트)가 재사용한다.
 *
 * <p>username/email 유니크 충돌을 피하기 위해 프로세스 단위 {@link AtomicLong} 카운터로 접미사를 만든다 — Date.now 같은 시계 의존 없이
 * 결정적이고 단조 증가한다.
 */
public final class TestFixtures {

  /** 테스트 전반에서 username/email 유니크를 보장하는 프로세스-와이드 카운터. */
  private static final AtomicLong SEQ = new AtomicLong();

  private TestFixtures() {}

  /**
   * HUMAN 사용자 1명 생성 (password 더미). admin/reporter 등 행위 주체 용도.
   *
   * @return 생성된 user id
   */
  public static long createHuman(DSLContext dsl) {
    long n = SEQ.incrementAndGet();
    String username = "human-" + n;
    return dsl.insertInto(USER)
        .set(USER.USERNAME, username)
        .set(USER.NAME, username)
        .set(USER.EMAIL, username + "@example.com")
        .set(USER.PASSWORD, "pw")
        .set(USER.KIND, UserKind.HUMAN)
        .returning(USER.ID)
        .fetchOne()
        .getId();
  }

  /**
   * AGENT 사용자 1명 생성 (password=null, kind=AGENT). OAuth 토큰은 등록하지 않는다.
   *
   * @return 생성된 user id
   */
  public static long createAgentNoToken(DSLContext dsl) {
    long n = SEQ.incrementAndGet();
    String username = "agent-" + n;
    return dsl.insertInto(USER)
        .set(USER.USERNAME, username)
        .set(USER.NAME, username)
        .set(USER.EMAIL, username + "@example.com")
        .set(USER.KIND, UserKind.AGENT)
        .setNull(USER.PASSWORD)
        .returning(USER.ID)
        .fetchOne()
        .getId();
  }

  /**
   * AGENT 사용자 1명 생성 후 active OAuth 토큰을 등록한다. 비서 실행에 필요한 토큰을 갖춘 AGENT 가 필요한 테스트용.
   *
   * @param creatorId 토큰을 등록하는 행위 주체(보통 HUMAN admin) id
   * @return 생성된 AGENT user id
   */
  public static long createAgentWithToken(
      DSLContext dsl, AiAgentCredentialService credentialService, long creatorId) {
    long agentId = createAgentNoToken(dsl);
    // 토큰 형식은 Claude CLI OAuth(sk-ant-oat-...) 를 모사 — 길이만 충족하면 된다.
    credentialService.register(creatorId, agentId, "sk-ant-oat-" + "x".repeat(40), "test");
    return agentId;
  }
}
