package com.workplace.tenant;

import static com.workplace.jooq.Tables.CHANNEL;
import static com.workplace.jooq.Tables.CHANNEL_MEMBER;
import static com.workplace.jooq.Tables.FILE;
import static com.workplace.jooq.Tables.MESSAGE;
import static com.workplace.jooq.Tables.TENANT;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.file.dto.FileUploadResponse;
import com.workplace.file.service.FileUploadService;
import com.workplace.global.tenant.TenantContext;
import com.workplace.messaging.dto.MessagePage;
import com.workplace.messaging.service.MessageService;
import com.workplace.support.IntegrationTestBase;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 비-트랜잭션 RLS 읽기 fail-closed 회귀 가드 (#230).
 *
 * <p><b>방어 대상 버그</b>: 런타임은 RLS 적용 롤(app_tenant)로 접속하고, 테넌트 GUC(app.tenant_id)는 {@code
 * TenantAwareTransactionManager.doBegin} 이 <i>트랜잭션-로컬</i>(LOCAL)로만 주입한다. 따라서 RLS 테이블을 읽는
 * <b>비-{@code @Transactional} public 서비스 메서드</b>는 GUC 가 없어 모든 행이 RLS 로 걸러져 빈 결과 → 거짓 404(local/prod
 * fail-closed)를 낸다.
 *
 * <p><b>왜 tenant#2 + 비-트랜잭션 테스트가 마스킹을 깨는가</b>: 테스트 프로파일(application-test.yml)은 풀 커넥션 세션 GUC 를
 * {@code set_config('app.tenant_id','1',false)} (SESSION) 로 박아 둔다. 이 세션 디폴트가 비-tx 읽기를 tenant#1
 * 컨텍스트로 "마스킹"해, 누락된 {@code @Transactional} 이 일반 테스트에서는 드러나지 않는다. 그러나 <b>트랜잭션-로컬 GUC 는 세션 GUC 를
 * 오버라이드</b>한다. 그래서 이 가드는:
 *
 * <ol>
 *   <li>세션 디폴트(1)와 <b>다른</b> tenant#2 에 데이터를 <b>커밋</b>해 두고(서비스가 자기 트랜잭션으로 열어 읽으므로 커밋 필요),
 *   <li>{@code TenantContext.set(tenant#2)} 후,
 *   <li>호출 스레드에 <b>주변 트랜잭션이 없는 상태</b>(이 테스트 클래스/메서드는 {@code @Transactional} 아님)로 서비스 메서드를 호출한다.
 * </ol>
 *
 * <p>서비스 메서드에 {@code @Transactional} 이 있으면 doBegin 이 GUC=2 를 LOCAL 주입 → tenant#2 데이터가 보여 단언 통과.
 * 어노테이션이 <b>빠지면</b> 메서드는 세션 GUC=1 로 읽어 tenant#2 데이터를 못 봐 단언 실패 → CI 에서 적발. 즉 대상 메서드에서
 * {@code @Transactional} 을 제거하면 이 테스트가 red 가 된다.
 *
 * <p><b>커버 엔드포인트</b>: 두 도메인 대표 경로 — {@link FileUploadService#getFileInfo}(file, 단순) 와 {@link
 * MessageService#list}(messaging, #214 케이스). 후자는 어노테이션이 빠지면 {@code ensureMember} 가 멤버를 못 봐 더 빠르게
 * 실패한다.
 *
 * <p><b>#230 에서 수정된 14개 메서드</b>(같은 패턴으로 확장 가능): messaging — ChannelService.list/discover/getDetail,
 * ChannelMemberService.listMembers, DmService.listMyDms, MessageService.list/listThread; mail —
 * MailMessageService.get, MailAttachmentService.download, MailAiService.summarize/replyDraft,
 * MailSyncService.sync; file — FileUploadService.getFileInfo/getFileContent.
 *
 * <p><b>공유 DB 무오염</b>: 시드는 고정 슬러그 fixture 테넌트(app_tenant 는 tenant DELETE 권한 없음 — V46, 누적 방지 위해
 * find-or-create 로 1행 유지) 아래에 커밋하고, {@code @AfterEach} 가 GUC=2 컨텍스트에서 도메인/USER 행을 캡처한 id 로 모두
 * 삭제한다(스코프 테이블은 RLS 라 GUC=2 에서만 보이고 지워진다). fixture 테넌트 1행만 영구 잔존(다른 통합 테스트가 USER 등을 남기는 것과 동일한
 * 공유-DB 철학상 무해).
 */
class NonTransactionalRlsReadGuardTest extends IntegrationTestBase {

  /** 세션 디폴트(1)와 다른, 가드용 고정-슬러그 fixture 테넌트. */
  private static final String FIXTURE_TENANT_SLUG = "rls-guard-fixture-tenant";

  @Autowired private DSLContext dsl;
  @Autowired private PlatformTransactionManager txManager;
  @Autowired private FileUploadService fileUploadService;
  @Autowired private MessageService messageService;

  // @AfterEach 정리용 — 시드에서 채운다.
  private Long tid2;
  private Long userId;
  private Long fileId;
  private Long channelId;
  private Long messageId;

  /** file 가드: tenant#2 에 커밋된 FILE 을 비-tx 서비스 호출로 읽을 수 있어야 한다(=어노테이션 살아있음). */
  @Test
  void getFileInfo_seesTenant2FileOnly_whenServiceOpensOwnTx() {
    seedFileFixture();

    // 호출 스레드에 주변 트랜잭션 없음 — 서비스의 @Transactional 이 GUC=2 를 LOCAL 주입해야만 보인다.
    TenantContext.set(tid2);
    FileUploadResponse info = fileUploadService.getFileInfo(fileId, userId);

    assertThat(info).isNotNull();
    assertThat(info.id()).isEqualTo(fileId);
  }

  /** messaging 가드(#214 케이스): tenant#2 channel/member/message 를 비-tx 서비스 호출로 읽을 수 있어야 한다. */
  @Test
  void messageList_seesTenant2Messages_whenServiceOpensOwnTx() {
    seedMessagingFixture();

    TenantContext.set(tid2);
    // 어노테이션이 빠지면 ensureMember 가 멤버를 못 봐(GUC=1) ChannelNotMemberException 으로 실패.
    MessagePage page = messageService.list(userId, channelId, null, 50);

    assertThat(page.items()).extracting(m -> m.id()).contains(messageId);
  }

  /** fixture 테넌트 + 임시 USER 를 커밋(USER 는 RLS 비대상). */
  private void seedCommonFixture() {
    tid2 = ensureFixtureTenant();
    String suffix = String.valueOf(System.nanoTime() % 1_000_000_000L);
    userId =
        dsl.insertInto(USER)
            .set(USER.USERNAME, "rls-guard-" + suffix)
            .set(USER.NAME, "RLS Guard User")
            .set(USER.EMAIL, "rls-guard-" + suffix + "@example.com")
            .set(USER.KIND, "HUMAN")
            .returning(USER.ID)
            .fetchOne()
            .getId();
  }

  /** file 가드 시드 — GUC=2 컨텍스트에서 FILE 을 커밋(tenant_id 는 컬럼 DEFAULT 가 GUC=2 로 채움). */
  private void seedFileFixture() {
    new TransactionTemplate(txManager)
        .execute(
            status -> {
              seedCommonFixture();
              setGuc(tid2);
              fileId =
                  dsl.insertInto(FILE)
                      .set(FILE.ORIGINAL_NAME, "guard.txt")
                      .set(FILE.STORED_NAME, "guard.txt")
                      .set(FILE.MIME_TYPE, "text/plain")
                      .set(FILE.SIZE_BYTES, 3L)
                      .set(FILE.CATEGORY, "TEXT")
                      .set(FILE.STORAGE_PATH, "/tmp/rls-guard-" + System.nanoTime() + ".txt")
                      .set(FILE.UPLOADED_BY, userId)
                      .returning(FILE.ID)
                      .fetchOne()
                      .getId();
              return null; // 커밋(롤백 안 함)
            });
  }

  /** messaging 가드 시드 — GUC=2 컨텍스트에서 channel/channel_member(caller)/message 를 커밋. */
  private void seedMessagingFixture() {
    new TransactionTemplate(txManager)
        .execute(
            status -> {
              seedCommonFixture();
              setGuc(tid2);
              channelId =
                  dsl.insertInto(CHANNEL)
                      .set(CHANNEL.KIND, "CHANNEL")
                      .set(CHANNEL.VISIBILITY, "PUBLIC")
                      .set(CHANNEL.CREATED_BY, userId)
                      .returning(CHANNEL.ID)
                      .fetchOne()
                      .getId();
              // caller 를 멤버로 — list 의 ensureMember 통과에 필요(ROLE 은 DEFAULT 'MEMBER').
              dsl.insertInto(CHANNEL_MEMBER)
                  .set(CHANNEL_MEMBER.CHANNEL_ID, channelId)
                  .set(CHANNEL_MEMBER.USER_ID, userId)
                  .execute();
              messageId =
                  dsl.insertInto(MESSAGE)
                      .set(MESSAGE.CHANNEL_ID, channelId)
                      .set(MESSAGE.AUTHOR_ID, userId)
                      .set(MESSAGE.BODY, "rls-guard message")
                      .returning(MESSAGE.ID)
                      .fetchOne()
                      .getId();
              return null; // 커밋(롤백 안 함)
            });
  }

  /** 고정 슬러그로 fixture 테넌트를 find-or-create(커밋). app_tenant 는 tenant DELETE 불가(V46) → 1행 누적 방지. */
  private long ensureFixtureTenant() {
    Long existing =
        dsl.select(TENANT.ID)
            .from(TENANT)
            .where(TENANT.SLUG.eq(FIXTURE_TENANT_SLUG))
            .fetchOne(TENANT.ID);
    if (existing != null) {
      return existing;
    }
    return dsl.insertInto(TENANT)
        .set(TENANT.SLUG, FIXTURE_TENANT_SLUG)
        .set(TENANT.NAME, "RLS Guard Fixture Tenant")
        .set(TENANT.STATUS, "ACTIVE")
        .returning(TENANT.ID)
        .fetchOne()
        .getId();
  }

  /** 트랜잭션-로컬 GUC 직접 설정 헬퍼. */
  private void setGuc(Long tenantId) {
    dsl.execute("SELECT set_config('app.tenant_id', '" + tenantId + "', true)");
  }

  /** 커밋된 도메인/USER 행을 GUC=2 컨텍스트에서 캡처 id 로 삭제(공유 DB 무오염). fixture 테넌트만 영구 잔존(V46). */
  @AfterEach
  void cleanup() {
    TenantContext.clear();
    if (tid2 == null) {
      return;
    }
    new TransactionTemplate(txManager)
        .execute(
            status -> {
              setGuc(tid2); // 스코프 테이블은 RLS — GUC=2 에서만 보이고 삭제된다.
              if (messageId != null) {
                dsl.deleteFrom(MESSAGE).where(MESSAGE.ID.eq(messageId)).execute();
              }
              if (channelId != null) {
                dsl.deleteFrom(CHANNEL_MEMBER)
                    .where(CHANNEL_MEMBER.CHANNEL_ID.eq(channelId))
                    .execute();
                dsl.deleteFrom(CHANNEL).where(CHANNEL.ID.eq(channelId)).execute();
              }
              if (fileId != null) {
                dsl.deleteFrom(FILE).where(FILE.ID.eq(fileId)).execute();
              }
              if (userId != null) {
                dsl.deleteFrom(USER).where(USER.ID.eq(userId)).execute(); // USER 는 RLS 비대상
              }
              return null;
            });
    tid2 = null;
    userId = null;
    fileId = null;
    channelId = null;
    messageId = null;
  }
}
