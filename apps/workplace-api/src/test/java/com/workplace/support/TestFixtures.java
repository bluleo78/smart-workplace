package com.workplace.support;

import static com.workplace.jooq.Tables.USER;

import com.workplace.auth.service.AiAgentCredentialService;
import com.workplace.user.dto.UserKind;
import java.util.concurrent.atomic.AtomicLong;
import org.jooq.DSLContext;

/**
 * 통합 테스트용 공용 픽스처 헬퍼. 여러 태스크(resolver/service 테스트)가 재사용한다.
 *
 * <p>username/email 유니크는 프로세스 단위 {@link AtomicLong} 카운터로 접미사를 만들어 보장한다 — Date.now 같은 시계 의존 없이
 * 결정적·단조 증가. 카운터는 매 JVM 실행마다 0에서 시작하므로, 이전 실행이 정리하지 못하고 남긴 행(비-@Transactional 테스트가 commit 한 user
 * 등)과 낮은 번호에서 충돌할 수 있다 → INSERT 를 onConflictDoNothing + 재시도로 감싸 잔존 행을 건너뛴다 (테스트 DB 재생성에 의존하지 않는다).
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
    while (true) {
      long n = SEQ.incrementAndGet();
      String username = "human-" + n;
      // 충돌 내성: 이전 실행이 정리되지 않고 남긴 행과 username/email 이 겹치면(카운터는 매 JVM 0에서 시작)
      // onConflictDoNothing 으로 0행 → 카운터를 올려 재시도. 잔존 행이 몇 개든 단조 증가로 곧 통과한다.
      var rec =
          dsl.insertInto(USER)
              .set(USER.USERNAME, username)
              .set(USER.NAME, username)
              .set(USER.EMAIL, username + "@example.com")
              .set(USER.PASSWORD, "pw")
              .set(USER.KIND, UserKind.HUMAN)
              .onConflictDoNothing()
              .returning(USER.ID)
              .fetchOne();
      if (rec != null) {
        return rec.getId();
      }
    }
  }

  /**
   * AGENT 사용자 1명 생성 (password=null, kind=AGENT). OAuth 토큰은 등록하지 않는다.
   *
   * @return 생성된 user id
   */
  public static long createAgentNoToken(DSLContext dsl) {
    while (true) {
      long n = SEQ.incrementAndGet();
      String username = "agent-" + n;
      // 충돌 내성: createHuman 과 동일 — 잔존 행과 겹치면 카운터를 올려 재시도.
      var rec =
          dsl.insertInto(USER)
              .set(USER.USERNAME, username)
              .set(USER.NAME, username)
              .set(USER.EMAIL, username + "@example.com")
              .set(USER.KIND, UserKind.AGENT)
              .setNull(USER.PASSWORD)
              .onConflictDoNothing()
              .returning(USER.ID)
              .fetchOne();
      if (rec != null) {
        return rec.getId();
      }
    }
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
