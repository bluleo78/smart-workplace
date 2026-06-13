package com.workplace.tenant;

import static com.workplace.jooq.Tables.CHAT_MESSAGE;
import static com.workplace.jooq.Tables.CHAT_THREAD;
import static com.workplace.jooq.Tables.CHAT_THREAD_MEMBER;
import static com.workplace.jooq.Tables.ISSUE;
import static com.workplace.jooq.Tables.ISSUE_TYPE_DEF;
import static com.workplace.jooq.Tables.PROJECT;
import static com.workplace.jooq.Tables.TENANT;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.chat.dto.ChatMessagePage;
import com.workplace.chat.repository.ChatThreadMemberRepository;
import com.workplace.chat.service.ChatMessageService;
import com.workplace.support.IntegrationTestBase;
import java.util.List;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * V63/V64 chat 도메인(chat_thread / chat_thread_member / chat_message) RLS 격리 증명.
 *
 * <p>전체를 롤백되는 단일 트랜잭션으로 수행 → 공유 DB 무오염 (app_tenant 는 tenant 행 DELETE 불가, V46; 롤백으로 미커밋
 * tenant/project/issue/chat 행 모두 사라짐).
 *
 * <p>마스킹 주의: application-test.yml 이 세션 GUC app.tenant_id=1 을 풀 커넥션마다 고정하므로, tenant#1 만 쓰는 격리 테스트는
 * 버그가 있어도 거짓-통과한다. 따라서 신규 tenant#2 를 트랜잭션 내에 삽입하고 setGuc(...) 로 트랜잭션-로컬 GUC 를 전환해 검증한다. chat_* 삽입 시
 * tenant_id 는 설정하지 않고 GUC DEFAULT 가 채우게 둔다 (생성된 jOOQ 의 baseline 에는 chat_* tenant_id 필드가 없으므로 의존할 수도
 * 없다).
 *
 * <p>chat_thread.issue_id 는 NOT NULL + FK + UNIQUE 이므로, tid2 컨텍스트에서 project→issue_type_def→issue
 * 체인을 먼저 만들고 그 issue 를 참조하는 chat_thread 를 삽입한다 (IssueDomainRlsTest 와 동일한 체인).
 */
class ChatDomainRlsTest extends IntegrationTestBase {

  @Autowired private DSLContext dsl;
  @Autowired private PlatformTransactionManager txManager;
  @Autowired private ChatThreadMemberRepository memberRepo;
  @Autowired private ChatMessageService messageService;

  /** tenant#2 GUC 로 삽입한 chat_thread 는 tenant#1 컨텍스트에서 비가시. */
  @Test
  void chatThread_isolatedAcrossTenants() {
    new TransactionTemplate(txManager)
        .execute(
            status -> {
              Long tid2 = insertTenant("rls-ct");
              Long userId = insertUser("rls-ct");

              setGuc(tid2);
              long issueId = insertIssueChain(tid2, userId);

              // chat_thread 삽입 — tenant_id 는 GUC DEFAULT(tid2)로 자동 세팅
              Long threadId =
                  dsl.insertInto(CHAT_THREAD)
                      .set(CHAT_THREAD.ISSUE_ID, issueId)
                      .returning(CHAT_THREAD.ID)
                      .fetchOne()
                      .getId();

              // tid2 컨텍스트에서는 가시
              assertThat(
                      dsl.fetchCount(
                          dsl.selectFrom(CHAT_THREAD).where(CHAT_THREAD.ID.eq(threadId))))
                  .isEqualTo(1);

              // tenant#1 컨텍스트 → 비가시 (RLS USING 차단)
              setGuc(1L);
              assertThat(
                      dsl.fetchCount(
                          dsl.selectFrom(CHAT_THREAD).where(CHAT_THREAD.ID.eq(threadId))))
                  .isZero();

              status.setRollbackOnly();
              return null;
            });
  }

  /** tenant#2 GUC 로 삽입한 chat_thread_member 는 tenant#1 컨텍스트에서 비가시. */
  @Test
  void chatThreadMember_isolatedAcrossTenants() {
    new TransactionTemplate(txManager)
        .execute(
            status -> {
              Long tid2 = insertTenant("rls-ctm");
              Long userId = insertUser("rls-ctm");

              setGuc(tid2);
              long issueId = insertIssueChain(tid2, userId);
              long threadId = insertThread(issueId);

              // 실제 prod 경로(insertIgnoreConflict raw SQL)로 멤버 삽입 — tenant_id 는 GUC DEFAULT
              memberRepo.insertIgnoreConflict(threadId, List.of(userId));

              // tid2 컨텍스트에서는 가시
              assertThat(
                      dsl.fetchCount(
                          dsl.selectFrom(CHAT_THREAD_MEMBER)
                              .where(CHAT_THREAD_MEMBER.THREAD_ID.eq(threadId))))
                  .isEqualTo(1);

              // tenant#1 컨텍스트 → 비가시
              setGuc(1L);
              assertThat(
                      dsl.fetchCount(
                          dsl.selectFrom(CHAT_THREAD_MEMBER)
                              .where(CHAT_THREAD_MEMBER.THREAD_ID.eq(threadId))))
                  .isZero();

              status.setRollbackOnly();
              return null;
            });
  }

  /** tenant#2 GUC 로 삽입한 chat_message 는 tenant#1 컨텍스트에서 비가시. */
  @Test
  void chatMessage_isolatedAcrossTenants() {
    new TransactionTemplate(txManager)
        .execute(
            status -> {
              Long tid2 = insertTenant("rls-cm");
              Long userId = insertUser("rls-cm");

              setGuc(tid2);
              long issueId = insertIssueChain(tid2, userId);
              long threadId = insertThread(issueId);

              // chat_message 삽입 — tenant_id 는 GUC DEFAULT(tid2)로 자동 세팅
              Long msgId =
                  dsl.insertInto(CHAT_MESSAGE)
                      .set(CHAT_MESSAGE.THREAD_ID, threadId)
                      .set(CHAT_MESSAGE.AUTHOR_ID, userId)
                      .set(CHAT_MESSAGE.BODY, "rls-chat-message")
                      .returning(CHAT_MESSAGE.ID)
                      .fetchOne()
                      .getId();

              // tid2 컨텍스트에서는 가시
              assertThat(
                      dsl.fetchCount(dsl.selectFrom(CHAT_MESSAGE).where(CHAT_MESSAGE.ID.eq(msgId))))
                  .isEqualTo(1);

              // tenant#1 컨텍스트 → 비가시
              setGuc(1L);
              assertThat(
                      dsl.fetchCount(dsl.selectFrom(CHAT_MESSAGE).where(CHAT_MESSAGE.ID.eq(msgId))))
                  .isZero();

              status.setRollbackOnly();
              return null;
            });
  }

  /**
   * 디스패처-수정 회귀 가드(마스킹 회피): tid2 컨텍스트에서 thread+member 를 삽입한 뒤, 실제 prod 쿼리인 {@link
   * ChatThreadMemberRepository#findMemberIds(long)} 를 tid2 GUC 에서 호출하면 멤버를 반환하고, GUC 를 tenant#1 로
   * 뒤집으면 EMPTY 를 반환함을 증명한다. 즉 findMemberIds 결과는 GUC(테넌트)에 의존한다 — 이것이 바로 ChatSseDispatcher 의
   * AFTER_COMMIT/typing 핸들러가 REQUIRES_NEW 로 tid2 GUC 를 재확립해야 하는 이유다. (커밋 후/비-Tx 스레드에서 GUC 가 없으면
   * findMemberIds 가 빈 fan-out → 아무에게도 안 보냄.)
   */
  @Test
  void findMemberIds_underReinjectedGuc_returnsMembers() {
    new TransactionTemplate(txManager)
        .execute(
            status -> {
              Long tid2 = insertTenant("rls-fmi");
              Long userId = insertUser("rls-fmi");

              setGuc(tid2);
              long issueId = insertIssueChain(tid2, userId);
              long threadId = insertThread(issueId);
              memberRepo.insertIgnoreConflict(threadId, List.of(userId));

              // tid2 GUC → 멤버 보임 (정상 fan-out 가능)
              assertThat(memberRepo.findMemberIds(threadId)).containsExactly(userId);

              // tenant#1 GUC → RLS 가 tid2 멤버를 차단 → EMPTY (GUC 의존성 증명)
              setGuc(1L);
              assertThat(memberRepo.findMemberIds(threadId)).isEmpty();

              status.setRollbackOnly();
              return null;
            });
  }

  /**
   * 비-Tx 읽기 경로 회귀 가드: ChatMessageService.list 는 ensureMember(chat_thread_member)와
   * findPage(chat_message)가 모두 RLS 보호 테이블이므로, @Transactional(readOnly) 가 없으면 local/prod(세션 GUC
   * 없음)에서 GUC 미주입 → ensureMember fail-closed(NotMember 예외) 한다. 본 테스트는 tid2 컨텍스트의
   * TransactionTemplate 안에서 list 를 호출 — list 의 readOnly 트랜잭션이 이 tx(및 tid2 GUC)에 합류하므로, GUC 의존 멤버십
   * 조회가 성공해 메시지를 반환함을 증명한다. (어노테이션이 빠지면 prod 에서 깨지는 정확한 경로지만, 테스트 세션 GUC=1 마스킹 때문에 tid2 컨텍스트로만 의미가
   * 있다.)
   *
   * <p>한계: 이 테스트는 바깥 tid2 트랜잭션에 합류하므로 @Transactional 어노테이션이 없어도 통과한다(트랜잭션이 이미 열려 있어 GUC 가 살아 있음).
   * 어노테이션의 prod 필요성은 GUC-flip 테스트인 {@link #findMemberIds_underReinjectedGuc_returnsMembers} 가 간접
   * 증명한다(GUC 없으면 멤버십 조회가 빈 결과 → fail-closed).
   */
  @Test
  void list_underTenantContext_returnsThreadMessages() {
    new TransactionTemplate(txManager)
        .execute(
            status -> {
              Long tid2 = insertTenant("rls-list");
              Long userId = insertUser("rls-list");

              setGuc(tid2);
              long issueId = insertIssueChain(tid2, userId);
              long threadId = insertThread(issueId);
              memberRepo.insertIgnoreConflict(threadId, List.of(userId));
              dsl.insertInto(CHAT_MESSAGE)
                  .set(CHAT_MESSAGE.THREAD_ID, threadId)
                  .set(CHAT_MESSAGE.AUTHOR_ID, userId)
                  .set(CHAT_MESSAGE.BODY, "rls-list-message")
                  .execute();

              // list 는 @Transactional(readOnly) — 현재 tid2 tx 에 합류해 GUC 의존 ensureMember/findPage 성공
              ChatMessagePage page = messageService.list(userId, threadId, null, 20);
              assertThat(page.items()).hasSize(1);
              assertThat(page.items().get(0).body()).isEqualTo("rls-list-message");

              status.setRollbackOnly();
              return null;
            });
  }

  // ----------------------------------------------------------------
  // 헬퍼 (IntegrationTestBase 에 없으므로 로컬 정의 — RbacDomainRlsTest 와 동일 패턴)
  // ----------------------------------------------------------------

  /**
   * 현재 GUC(tid2 가정) 컨텍스트에서 project→issue_type_def→issue 체인을 만들고 issue.id 반환. chat_thread.issue_id 가
   * NOT NULL + FK 이므로 실제 issue 가 필요하다. tenant_id 는 GUC DEFAULT 로 채워지므로 명시하지 않는다.
   */
  private long insertIssueChain(Long tid2, Long userId) {
    long pid =
        dsl.insertInto(PROJECT)
            .set(PROJECT.KEY, "CHT" + (System.nanoTime() % 100000))
            .set(PROJECT.NAME, "RLS Chat Test Project")
            .set(PROJECT.OWNER_ID, userId)
            .set(PROJECT.TENANT_ID, tid2)
            .returning(PROJECT.ID)
            .fetchOne()
            .getId();

    long typeId =
        dsl.insertInto(ISSUE_TYPE_DEF)
            .set(ISSUE_TYPE_DEF.PROJECT_ID, pid)
            .set(ISSUE_TYPE_DEF.NAME, "TASK")
            .set(ISSUE_TYPE_DEF.COLOR_TOKEN, "BLUE")
            .set(ISSUE_TYPE_DEF.ICON, "Circle")
            .returning(ISSUE_TYPE_DEF.ID)
            .fetchOne()
            .getId();

    return dsl.insertInto(ISSUE)
        .set(ISSUE.PROJECT_ID, pid)
        .set(ISSUE.NUMBER, 1)
        .set(ISSUE.TITLE, "rls-chat-issue")
        .set(ISSUE.STATUS, "TODO")
        .set(ISSUE.PRIORITY, "MID")
        .set(ISSUE.REPORTER_ID, userId)
        .set(ISSUE.TYPE_ID, typeId)
        .set(ISSUE.TENANT_ID, tid2)
        .returning(ISSUE.ID)
        .fetchOne()
        .getId();
  }

  /** 현재 GUC 컨텍스트에서 chat_thread 삽입(tenant_id 는 GUC DEFAULT) 후 id 반환. */
  private long insertThread(long issueId) {
    return dsl.insertInto(CHAT_THREAD)
        .set(CHAT_THREAD.ISSUE_ID, issueId)
        .returning(CHAT_THREAD.ID)
        .fetchOne()
        .getId();
  }

  /** 신규 테넌트(tid)를 트랜잭션 내에 삽입하고 id 반환. */
  private Long insertTenant(String prefix) {
    return dsl.insertInto(TENANT)
        .set(TENANT.SLUG, prefix + "-" + System.nanoTime())
        .set(TENANT.NAME, prefix.toUpperCase())
        .set(TENANT.STATUS, "ACTIVE")
        .returning(TENANT.ID)
        .fetchOne()
        .getId();
  }

  /** 임시 user 삽입(kind 기본 HUMAN, 고유 username/email)하고 id 반환. user 는 전역 — RLS 비대상. */
  private Long insertUser(String prefix) {
    String suffix = prefix + "-" + System.nanoTime();
    return dsl.insertInto(USER)
        .set(USER.USERNAME, suffix)
        .set(USER.NAME, "Chat RLS User")
        .set(USER.EMAIL, suffix + "@example.com")
        .set(USER.KIND, "HUMAN")
        .returning(USER.ID)
        .fetchOne()
        .getId();
  }

  /** 트랜잭션-로컬 GUC 직접 설정 헬퍼. */
  private void setGuc(Long tenantId) {
    dsl.execute("SELECT set_config('app.tenant_id', '" + tenantId + "', true)");
  }
}
