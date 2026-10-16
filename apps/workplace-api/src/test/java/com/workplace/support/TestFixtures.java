package com.workplace.support;

import static com.workplace.jooq.Tables.MEMBERSHIP;
import static com.workplace.jooq.Tables.TENANT;
import static com.workplace.jooq.Tables.USER;

import com.workplace.auth.service.AiAgentCredentialService;
import com.workplace.user.dto.UserKind;
import java.util.UUID;
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
   * 지정 상태의 테넌트를 새로 만든다(slug 는 UUID 접미사로 유일). 영구 삭제 등 테넌트 단위 테스트용.
   *
   * @return 생성된 tenant id
   */
  public static long createTenant(DSLContext dsl, String status) {
    return dsl.insertInto(TENANT)
        .set(TENANT.NAME, "fixture-tenant")
        .set(TENANT.SLUG, "fixture-" + UUID.randomUUID().toString().substring(0, 8))
        .set(TENANT.STATUS, status)
        .returning(TENANT.ID)
        .fetchOne()
        .getId();
  }

  /** 사용자를 테넌트 MEMBER 로 추가한다(membership 직접 INSERT). */
  public static void addMember(DSLContext dsl, long userId, long tenantId) {
    dsl.insertInto(MEMBERSHIP)
        .set(MEMBERSHIP.USER_ID, userId)
        .set(MEMBERSHIP.TENANT_ID, tenantId)
        .set(MEMBERSHIP.ROLE, "MEMBER")
        .execute();
  }

  /** WP-417: (user, tenant) 멤버십을 정지(SUSPENDED)로 바꾼다 — 워크스페이스 관리자가 「활성 상태」를 끈 상태를 직접 시드할 때. */
  public static void suspendMember(DSLContext dsl, long userId, long tenantId) {
    dsl.update(MEMBERSHIP)
        .set(MEMBERSHIP.STATUS, "SUSPENDED")
        .where(MEMBERSHIP.USER_ID.eq(userId).and(MEMBERSHIP.TENANT_ID.eq(tenantId)))
        .execute();
  }

  /** WP-417: (user, tenant) 멤버십 상태(ACTIVE/SUSPENDED). 멤버가 아니면 null. */
  public static String membershipStatus(DSLContext dsl, long userId, long tenantId) {
    return dsl.select(MEMBERSHIP.STATUS)
        .from(MEMBERSHIP)
        .where(MEMBERSHIP.USER_ID.eq(userId).and(MEMBERSHIP.TENANT_ID.eq(tenantId)))
        .fetchOne(MEMBERSHIP.STATUS);
  }

  /** 비밀번호 로그인이 가능한 HUMAN 사용자 — id 와 로그인 아이디. */
  public record LoginableHuman(long id, String username) {}

  /**
   * 비밀번호 로그인이 가능한 HUMAN 사용자 1명 생성(멤버십 없음). 로그인이 검증하는 인코더로 미리 인코딩한 비밀번호를 받는다 — {@link #createHuman}
   * 은 평문 더미라 로그인 테스트에 못 쓴다.
   */
  public static LoginableHuman createLoginableHuman(DSLContext dsl, String encodedPassword) {
    while (true) {
      String username = "login-" + SEQ.incrementAndGet() + "@example.com";
      var rec =
          dsl.insertInto(USER)
              .set(USER.USERNAME, username)
              .set(USER.NAME, username)
              .set(USER.EMAIL, username)
              .set(USER.PASSWORD, encodedPassword)
              .set(USER.KIND, UserKind.HUMAN)
              .onConflictDoNothing()
              .returning(USER.ID)
              .fetchOne();
      if (rec != null) {
        return new LoginableHuman(rec.getId(), username);
      }
    }
  }

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
   * 지정 이메일로 HUMAN 사용자 생성 — 외부 캘린더 참석자 매칭 테스트용.
   *
   * @return 생성된 user id
   */
  public static long createHumanWithEmail(DSLContext dsl, String email) {
    // SELECT-first: 이전 실행이 남긴 행이 있으면 재사용(onConflictDoNothing + returning 은 기존 행 있으면 null 반환).
    Long existing = dsl.select(USER.ID).from(USER).where(USER.EMAIL.eq(email)).fetchOne(USER.ID);
    if (existing != null) return existing;
    Long inserted =
        dsl.insertInto(USER)
            .set(USER.USERNAME, email)
            .set(USER.EMAIL, email)
            .set(USER.NAME, "Member " + email)
            .set(USER.PASSWORD, "pw")
            .set(USER.KIND, UserKind.HUMAN)
            .onConflictDoNothing()
            .returning(USER.ID)
            .fetchOne(USER.ID);
    // 레이스 조건(SELECT 후 다른 tx 가 먼저 INSERT) 방어 — 다시 조회.
    if (inserted != null) return inserted;
    return dsl.select(USER.ID).from(USER).where(USER.EMAIL.eq(email)).fetchOne(USER.ID);
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
    credentialService.register(
        creatorId, agentId, "anthropic", "sk-ant-oat-" + "x".repeat(40), "test", null);
    return agentId;
  }

  /**
   * 메일 envelope 를 본문 적재·검증 완료로 표시한다(WP-130). 공유 content 의 본문·스니펫·AI 값은 fetched_at 이 있는 envelope 에만
   * 노출되므로, content 에 본문을 직접 시드한 테스트는 이 표시를 해야 실제 적재 후 상태와 같아진다.
   */
  public static void markMailFetched(DSLContext dsl, long envelopeId) {
    dsl.update(com.workplace.jooq.Tables.EMAIL_MESSAGE)
        .set(com.workplace.jooq.Tables.EMAIL_MESSAGE.FETCHED_AT, java.time.OffsetDateTime.now())
        .where(com.workplace.jooq.Tables.EMAIL_MESSAGE.ID.eq(envelopeId))
        .execute();
  }

  /** 메일 사용자 1명 + 계정 + INBOX 폴더(테넌트#1)를 만들고 [userId, accountId, folderId] 를 반환한다. */
  public static long[] seedMailbox(DSLContext dsl, String address) {
    var account = com.workplace.jooq.Tables.EMAIL_ACCOUNT;
    var folder = com.workplace.jooq.Tables.EMAIL_FOLDER;
    long uid = createHuman(dsl);
    long acc =
        dsl.insertInto(account, account.USER_ID, account.EMAIL_ADDRESS, account.TENANT_ID)
            .values(uid, address, 1L)
            .returning(account.ID)
            .fetchOne()
            .getId();
    long fld =
        dsl.insertInto(folder, folder.ACCOUNT_ID, folder.NAME, folder.TENANT_ID)
            .values(acc, "INBOX", 1L)
            .returning(folder.ID)
            .fetchOne()
            .getId();
    return new long[] {uid, acc, fld};
  }
}
