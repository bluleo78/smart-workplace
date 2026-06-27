package com.workplace.mail;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

import com.icegreen.greenmail.configuration.GreenMailConfiguration;
import com.icegreen.greenmail.junit5.GreenMailExtension;
import com.icegreen.greenmail.user.GreenMailUser;
import com.icegreen.greenmail.util.GreenMailUtil;
import com.icegreen.greenmail.util.ServerSetupTest;
import com.workplace.global.security.EncryptionService;
import com.workplace.mail.dto.EmailMessageDetail;
import com.workplace.mail.dto.EmailMessageSummary;
import com.workplace.mail.dto.MailSyncResult;
import com.workplace.mail.exception.EmailAccountNotFoundException;
import com.workplace.mail.outbound.AiAgentMailClient;
import com.workplace.mail.repository.EmailAccountRepository;
import com.workplace.mail.repository.EmailMessageRepository;
import com.workplace.mail.service.MailBackfillService;
import com.workplace.mail.service.MailSummaryBackfillService;
import com.workplace.mail.service.MailSyncProgress;
import com.workplace.mail.service.MailSyncService;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import jakarta.mail.Flags;
import jakarta.mail.Message;
import jakarta.mail.MessagingException;
import jakarta.mail.Part;
import jakarta.mail.Session;
import jakarta.mail.internet.InternetAddress;
import jakarta.mail.internet.MimeBodyPart;
import jakarta.mail.internet.MimeMessage;
import jakarta.mail.internet.MimeMultipart;
import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Date;
import java.util.List;
import java.util.Properties;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.RegisterExtension;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.transaction.annotation.Transactional;

/**
 * MailSyncService 통합 테스트 — GreenMail(IMAP 3143)로 실제 INBOX 를 채우고 메타 전용 동기화를 검증한다. 동기화는 본문을 저장하지
 * 않으며(메타만), 본문/첨부/분류는 백그라운드 보충(MailBackfillService) 또는 OnDemand 적재로 이관됐다 — 본 테스트에서 backfillService
 * 를 목킹해 메타전용 단언을 결정적으로 만든다. 검증 포인트: 신규 메타 페치/저장, 2차 동기화 멱등(no-op), 스레드 그룹핑(루트 Message-ID), 소유
 * 격리(404), 동시성 가드, 본문 미저장.
 */
@Transactional
class MailSyncServiceTest extends IntegrationTestBase {

  @RegisterExtension
  static GreenMailExtension greenMail =
      new GreenMailExtension(ServerSetupTest.SMTP_IMAP)
          .withConfiguration(
              GreenMailConfiguration.aConfig().withUser("box@test.local", "box@test.local", "pw"));

  @Autowired DSLContext dsl;
  @Autowired MailSyncService syncService;
  @Autowired EmailAccountRepository accountRepo;
  @Autowired EmailMessageRepository messageRepo;
  @Autowired EncryptionService encryption;
  @Autowired MailSyncProgress progress;

  /** 비동기 본문 보충을 목킹 — sync 의 백필 트리거를 무동작으로 만들어 메타전용 단언을 결정적으로 만든다. */
  @MockitoBean MailBackfillService backfillService;

  /** 선제 요약 백필을 목킹 — sync 완료 후 호출 여부만 검증하고 실제 LLM/IMAP 은 실행하지 않는다. */
  @MockitoBean MailSummaryBackfillService summaryBackfillService;

  /** ai-agent 실호출 차단 — 더미 응답으로 고정. */
  @MockitoBean AiAgentMailClient mailClient;

  /** box@test.local 을 가리키는 계정을 직접 삽입(연결테스트 우회). 동기화 대상 accountId 반환. */
  private long insertAccount(long userId) {
    return insertAccount(userId, false);
  }

  /** box@test.local 계정 삽입 with aiEnabled 옵션. AI 분류 테스트에서 aiEnabled=true 로 생성할 때 사용. */
  private long insertAccount(long userId, boolean aiEnabled) {
    return MailTestSupport.insertAccount(accountRepo, encryption, userId, aiEnabled);
  }

  @Test
  void sync_fetchesAndSavesNewMessages() {
    long user = TestFixtures.createHuman(dsl);
    long accountId = insertAccount(user);
    GreenMailUtil.sendTextEmailTest("box@test.local", "alice@example.com", "안녕하세요", "본문입니다");
    GreenMailUtil.sendTextEmailTest("box@test.local", "bob@example.com", "두번째", "두번째 본문");
    greenMail.waitForIncomingEmail(2);

    MailSyncResult result = syncService.sync(user, accountId);

    assertThat(result.fetched()).isEqualTo(2);
    assertThat(result.saved()).isEqualTo(2);
    List<EmailMessageSummary> list = messageRepo.listByAccount(accountId, null, 50);
    assertThat(list).hasSize(2);
    assertThat(list).extracting(EmailMessageSummary::subject).contains("안녕하세요", "두번째");
    assertThat(list).allSatisfy(m -> assertThat(m.fromAddress()).isNotBlank());
  }

  /**
   * 첫 동기화는 최근 {@code INITIAL_WINDOW_DAYS}(7)일로 한정된다 — searchRecent 가 {@code ReceivedDateTerm(GE,
   * now-7d)} 로 IMAP INTERNALDATE 기준 SEARCH 하기 때문. INTERNALDATE 가 8일 전인 메시지와 방금 수신한 메시지를 IMAP APPEND
   * 로 직접 넣고(=appendMessage 의 Date 인자가 INTERNALDATE 를 결정), 첫 sync 후 최근 1건만 저장됨을 검증한다. 두 건 모두
   * 저장되면(size 2) 7일 컷오프가 동작하지 않는 것이므로, size 1 자체가 8일 전 메시지 제외의 증거다.
   */
  @Test
  void sync_firstSync_limitsToLast7Days() throws Exception {
    long user = TestFixtures.createHuman(dsl);
    long accountId = insertAccount(user);

    GreenMailUser box = greenMail.getUserManager().getUser("box@test.local");
    // appendMessage 의 세 번째 인자(Date)가 INTERNALDATE 를 결정한다(setSentDate 로는 안 바뀜).
    var inbox = greenMail.getManagers().getImapHostManager().getInbox(box);
    inbox.appendMessage(
        textMessage("<old@test>", null, null, "오래된 메일", "8일 전 본문"),
        new Flags(),
        Date.from(Instant.now().minus(8, ChronoUnit.DAYS)));
    inbox.appendMessage(
        textMessage("<new@test>", null, null, "최근 메일", "최근 본문"), new Flags(), new Date());

    MailSyncResult result = syncService.sync(user, accountId);

    // 7일 컷오프로 8일 전 메시지는 SEARCH 결과에서 빠져 최근 1건만 페치·저장된다.
    assertThat(result.fetched()).isEqualTo(1);
    assertThat(result.saved()).isEqualTo(1);
    List<EmailMessageSummary> list = messageRepo.listByAccount(accountId, null, 50);
    assertThat(list).hasSize(1);
    assertThat(list.get(0).subject()).isEqualTo("최근 메일");
  }

  @Test
  void sync_secondRunIsNoOp() {
    long user = TestFixtures.createHuman(dsl);
    long accountId = insertAccount(user);
    GreenMailUtil.sendTextEmailTest("box@test.local", "alice@example.com", "한건", "본문");
    greenMail.waitForIncomingEmail(1);

    MailSyncResult first = syncService.sync(user, accountId);
    // 백필이 목킹돼 첫 sync 의 진행 상태가 finish 되지 않으므로(가드 유지), 2차 sync 가 가드가 아닌
    // UID 증분 경로를 실제로 타도록 진행 상태를 수동 종료한다.
    progress.finish(accountId);
    MailSyncResult second = syncService.sync(user, accountId);

    assertThat(first.saved()).isEqualTo(1);
    // 새 메일이 없으면 LASTUID 클램핑으로 끌려온 마지막 1건도 커서로 걸러져 저장 0
    assertThat(second.fetched()).isZero();
    assertThat(second.saved()).isZero();
    assertThat(messageRepo.listByAccount(accountId, null, 50)).hasSize(1);
  }

  @Test
  void sync_groupsThreadByRootMessageId() throws Exception {
    long user = TestFixtures.createHuman(dsl);
    long accountId = insertAccount(user);
    GreenMailUser box = greenMail.setUser("box@test.local", "box@test.local", "pw");
    box.deliver(textMessage("<root@test>", null, null, "원문", "원문 본문"));
    box.deliver(textMessage("<reply@test>", "<root@test>", "<root@test>", "Re: 원문", "답장 본문"));

    syncService.sync(user, accountId);

    List<EmailMessageSummary> list = messageRepo.listByAccount(accountId, null, 50);
    assertThat(list).hasSize(2);
    assertThat(list).extracting(EmailMessageSummary::threadId).containsOnly("root@test");
  }

  /**
   * 멀티파트(본문+첨부) 메시지도 메타 전용 동기화는 헤더/봉투만 저장한다 — 본문/첨부 플래그는 미설정(본문 적재 단계에서 확정). 첨부 메타·본문 추출은
   * MailBodyFetcher/MailBackfillService 가 담당한다.
   */
  @Test
  void sync_multipartMessage_savesMetadataOnly() throws Exception {
    long user = TestFixtures.createHuman(dsl);
    long accountId = insertAccount(user);
    GreenMailUser box = greenMail.setUser("box@test.local", "box@test.local", "pw");
    box.deliver(multipartWithAttachment());

    syncService.sync(user, accountId);

    EmailMessageSummary summary = messageRepo.listByAccount(accountId, null, 50).get(0);
    assertThat(summary.subject()).isEqualTo("첨부 메일");
    assertThat(summary.fromAddress()).isNotBlank();
    // 메타 전용: 본문/첨부 플래그는 아직 미설정
    assertThat(summary.hasAttachment()).isFalse();
    EmailMessageDetail detail = messageRepo.findDetailByIdAndUser(user, summary.id()).orElseThrow();
    assertThat(detail.bodyText()).isNull();
    assertThat(detail.attachments()).isEmpty();
  }

  /**
   * 메타 전용 동기화는 본문 디코드를 하지 않으므로 깨진 charset 메시지도 메타(헤더/봉투)는 정상 저장된다 — 본문 디코드 실패는 이제 동기화가 아닌 백그라운드 본문
   * 보충 단계에서만 표면화된다. 따라서 정상 1건 + 깨진 charset 1건 모두 저장돼 saved=2 가 된다.
   */
  @Test
  void sync_metadataRobustToBadCharset_savesBoth() throws Exception {
    long user = TestFixtures.createHuman(dsl);
    long accountId = insertAccount(user);
    GreenMailUser box = greenMail.setUser("box@test.local", "box@test.local", "pw");
    box.deliver(textMessage("<good@test>", null, null, "정상 메일", "정상 본문"));
    // 디코딩 불가한 charset 을 선언한 메시지(원본 바이트 보존 위해 raw 로 구성). 메타 파싱은 본문을 건드리지 않으므로 성공한다.
    box.deliver(rawMessage("text/plain; charset=\"no-such-charset-xyz\"", "broken"));

    MailSyncResult result = syncService.sync(user, accountId);

    assertThat(result.fetched()).isEqualTo(2);
    assertThat(result.saved()).isEqualTo(2);
    List<EmailMessageSummary> list = messageRepo.listByAccount(accountId, null, 50);
    assertThat(list).extracting(EmailMessageSummary::subject).contains("정상 메일", "raw");
    // 메타 전용이므로 두 건 모두 본문 미적재(백그라운드 보충 대상)
    assertThat(messageRepo.countMissingBody(accountId)).isEqualTo(2);
  }

  @Test
  void sync_searchFiltersBySubjectAndSender() {
    long user = TestFixtures.createHuman(dsl);
    long accountId = insertAccount(user);
    GreenMailUtil.sendTextEmailTest("box@test.local", "alice@example.com", "프로젝트 회의", "본문");
    GreenMailUtil.sendTextEmailTest("box@test.local", "bob@example.com", "점심 메뉴", "본문");
    greenMail.waitForIncomingEmail(2);
    syncService.sync(user, accountId);

    assertThat(messageRepo.listByAccount(accountId, "회의", 50)).hasSize(1);
    assertThat(messageRepo.listByAccount(accountId, "alice", 50)).hasSize(1);
    assertThat(messageRepo.listByAccount(accountId, "없는검색어", 50)).isEmpty();
  }

  @Test
  void sync_otherUserAccount_throwsNotFound() {
    long owner = TestFixtures.createHuman(dsl);
    long other = TestFixtures.createHuman(dsl);
    long accountId = insertAccount(owner);

    assertThatThrownBy(() -> syncService.sync(other, accountId))
        .isInstanceOf(EmailAccountNotFoundException.class);
  }

  /** 동기화는 목록 메타만 저장하고 본문/스니펫은 비운다 — 본문은 백그라운드/OnDemand 적재 대상으로 남는다. */
  @Test
  void sync_savesMetadataOnly_noBody() {
    long user = TestFixtures.createHuman(dsl);
    long accountId = insertAccount(user, false);
    GreenMailUtil.sendTextEmailTest("box@test.local", "alice@example.com", "제목", "본문입니다");
    greenMail.waitForIncomingEmail(1);

    MailSyncResult result = syncService.sync(user, accountId);

    assertThat(result.saved()).isEqualTo(1);
    List<EmailMessageSummary> list = messageRepo.listByAccount(accountId, "INBOX", null, 50);
    assertThat(list).hasSize(1);
    EmailMessageDetail detail =
        messageRepo.findDetailByIdAndUser(user, list.get(0).id()).orElseThrow();
    assertThat(detail.bodyText()).isNull();
    assertThat(detail.bodyHtml()).isNull();
    // 본문 적재 대상(미적재)으로 잡힌다.
    assertThat(messageRepo.countMissingBody(accountId)).isEqualTo(1);
    // 미적재 본문이 있으므로 비동기 백필이 트리거된다.
    verify(backfillService).backfill(user, accountId);
  }

  @Test
  @org.junit.jupiter.api.DisplayName("동기화 성공 시 last_synced_at 이 갱신된다")
  void syncUpdatesLastSyncedAt() {
    long user = TestFixtures.createHuman(dsl);
    long accountId = insertAccount(user);
    GreenMailUtil.sendTextEmailTest("box@test.local", "sender@example.com", "제목", "본문");
    greenMail.waitForIncomingEmail(1);

    syncService.sync(user, accountId);

    // 동기화 성공 후 last_synced_at 이 기록됐는지 확인
    java.time.Instant lastSynced =
        accountRepo.findByIdAndUser(user, accountId).orElseThrow().lastSyncedAt();
    assertThat(lastSynced).isNotNull();
  }

  /** 진행 중 가드: progress.tryStart 가 false 면 sync 는 즉시 빈 결과를 반환한다(데드락 없음). */
  @Test
  void sync_secondCallWhileRunning_isGuarded() {
    long user = TestFixtures.createHuman(dsl);
    long accountId = insertAccount(user, false);
    progress.tryStart(accountId); // 강제로 진행 중 상태 진입

    MailSyncResult r = syncService.sync(user, accountId);

    assertThat(r.fetched()).isZero();
    assertThat(r.saved()).isZero();
    // 가드로 즉시 반환 — 네트워크 동기화도 백필 트리거도 일어나지 않는다.
    verify(backfillService, never()).backfill(anyLong(), anyLong());
    progress.finish(accountId);
  }

  /**
   * 메타 전용 동기화는 ai_enabled=true 라도 분류하지 않는다 — 분류는 본문 적재(MailBodyFetcher/MailBackfillService) 단계로
   * 이관됐다(해당 분류 커버리지는 MailBodyFetcherTest 등이 담당). sync 자체는 classify 를 호출하지 않음을 보장한다.
   */
  @Test
  void sync_doesNotClassify() {
    long user = TestFixtures.createHuman(dsl);
    long accountId = insertAccount(user, true);
    GreenMailUtil.sendTextEmailTest("box@test.local", "sender@example.com", "업무 보고", "보고서 내용");
    greenMail.waitForIncomingEmail(1);

    syncService.sync(user, accountId);

    // 메타 전용 — sync 경로에서는 ai 활성화 여부와 무관하게 classify 가 호출되지 않는다(분류는 본문 적재로 이관).
    org.mockito.Mockito.verify(mailClient, never()).classify(any());
  }

  /**
   * Message-ID/In-Reply-To/References 를 제어한 단순 텍스트 메시지. saveChanges 가 Message-ID 를 덮어쓰지 않도록 보존한다.
   */
  private MimeMessage textMessage(
      String messageId, String inReplyTo, String references, String subject, String body)
      throws MessagingException {
    MimeMessage msg =
        new MimeMessage(session()) {
          @Override
          protected void updateMessageID() throws MessagingException {
            if (getHeader("Message-ID") == null) {
              super.updateMessageID();
            }
          }
        };
    msg.setFrom(new InternetAddress("sender@example.com"));
    msg.setRecipient(Message.RecipientType.TO, new InternetAddress("box@test.local"));
    msg.setSubject(subject);
    msg.setText(body, "utf-8");
    msg.setHeader("Message-ID", messageId);
    if (inReplyTo != null) {
      msg.setHeader("In-Reply-To", inReplyTo);
    }
    if (references != null) {
      msg.setHeader("References", references);
    }
    msg.saveChanges();
    return msg;
  }

  /** 원본 RFC822 바이트로 구성한 메시지(헤더를 그대로 보존 — 깨진 charset 등 비정상 케이스 재현용). */
  private MimeMessage rawMessage(String contentType, String body) throws MessagingException {
    String raw =
        "From: sender@example.com\r\n"
            + "To: box@test.local\r\n"
            + "Subject: raw\r\n"
            + "Content-Type: "
            + contentType
            + "\r\n\r\n"
            + body;
    return new MimeMessage(
        session(), new ByteArrayInputStream(raw.getBytes(StandardCharsets.US_ASCII)));
  }

  /** text/plain 본문 + 파일 첨부를 가진 multipart/mixed 메시지. */
  private MimeMessage multipartWithAttachment() throws MessagingException {
    MimeMessage msg = new MimeMessage(session());
    msg.setFrom(new InternetAddress("sender@example.com"));
    msg.setRecipient(Message.RecipientType.TO, new InternetAddress("box@test.local"));
    msg.setSubject("첨부 메일");

    MimeBodyPart text = new MimeBodyPart();
    text.setText("멀티파트 본문", "utf-8");
    MimeBodyPart attachment = new MimeBodyPart();
    attachment.setText("file contents", "utf-8");
    attachment.setFileName("doc.txt");
    attachment.setDisposition(Part.ATTACHMENT);

    MimeMultipart mp = new MimeMultipart();
    mp.addBodyPart(text);
    mp.addBodyPart(attachment);
    msg.setContent(mp);
    msg.saveChanges();
    return msg;
  }

  /**
   * 동기화 정상 완료 후 선제 요약 백필이 트리거된다 — @Async 라 sync 의 짧은 TX 들이 모두 커밋된 뒤 별도 스레드에서 실행. 조기 반환 경로(진행 중
   * 가드)에서는 호출되지 않아야 한다. AI ON 계정(ai_enabled=true)에서만 트리거된다.
   */
  @Test
  void sync_완료후_선제요약_트리거() {
    long user = TestFixtures.createHuman(dsl);
    long accountId = insertAccount(user, true);
    GreenMailUtil.sendTextEmailTest("box@test.local", "sender@example.com", "요약 대상 메일", "본문입니다");
    greenMail.waitForIncomingEmail(1);

    syncService.sync(user, accountId);

    // 정상 완료 경로에서 선제 요약 백필이 호출된다
    verify(summaryBackfillService).summarizeRecentUnread(user, accountId);
  }

  /**
   * AI 꺼진 계정(ai_enabled=false)은 동기화가 정상 완료돼도 선제 요약 백필을 트리거하지 않는다 — 백필이 메시지마다 요약을 시도하다
   * MailAiUnavailableException 을 던져 스택트레이스 스팸 + 불필요한 IMAP 본문 fetch 를 유발하던 회귀 방지.
   */
  @Test
  void sync_aiOff_선제요약_미트리거() {
    long user = TestFixtures.createHuman(dsl);
    long accountId = insertAccount(user, false);
    GreenMailUtil.sendTextEmailTest("box@test.local", "sender@example.com", "요약 대상 메일", "본문입니다");
    greenMail.waitForIncomingEmail(1);

    syncService.sync(user, accountId);

    // AI OFF 계정은 선제 요약 백필이 호출되지 않는다
    verify(summaryBackfillService, never()).summarizeRecentUnread(anyLong(), anyLong());
  }

  private Session session() {
    return Session.getInstance(new Properties());
  }
}
