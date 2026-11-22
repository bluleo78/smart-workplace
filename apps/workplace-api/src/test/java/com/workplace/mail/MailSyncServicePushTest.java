package com.workplace.mail;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.ArgumentMatchers.notNull;
import static org.mockito.Mockito.doCallRealMethod;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;

import com.icegreen.greenmail.configuration.GreenMailConfiguration;
import com.icegreen.greenmail.junit5.GreenMailExtension;
import com.workplace.global.security.EncryptionService;
import com.workplace.mail.dto.MailSyncResult;
import com.workplace.mail.repository.EmailAccountRepository;
import com.workplace.mail.repository.EmailMessageRepository;
import com.workplace.mail.service.MailBackfillService;
import com.workplace.mail.service.MailPushService;
import com.workplace.mail.service.MailPushService.NewMailPush;
import com.workplace.mail.service.MailSyncProgress;
import com.workplace.mail.service.MailSyncService;
import com.workplace.notify.push.PushCategory;
import com.workplace.notify.push.PushDispatcher;
import com.workplace.notify.push.PushMessage;
import com.workplace.support.TestFixtures;
import java.util.List;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.RegisterExtension;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.transaction.annotation.Transactional;

/**
 * MailSyncService ↔ MailPushService 연결(WP-1739) 통합 테스트 — 동기화 전 경계(maxInboxId) 확보, 커밋 뒤 발송, 첫 동기화
 * 제외를 GreenMail 실제 동기화로 검증한다.
 *
 * <p>MailSyncTestSupport 가 본문 보충·선제 요약을 목으로 바꾸므로 진행 상태는 테스트가 직접 끊는다(진행 중 가드 해제). 발송 단위는
 * PushDispatcher 목으로 잡아 수신자·태그·url 을 단언한다 — 실푸시(HTTP)는 나가지 않는다.
 *
 * <p>본문 보충을 띄우면 발송은 보충이 끝난 뒤로 미뤄진다(자동 발송 판정이 본문을 받을 때 정해지므로). IMAP 동기화는 본문을 받지 않아 늘 보충을 띄우므로, 동기화
 * 직후 발송 경로(경계·형식·계정 격리·best-effort)를 보는 케이스는 「미적재 본문 0건」으로 고정한다({@link #noMissingBodies}). 보충 뒤로
 * 미루는 경로는 아래 두 케이스가, 보충이 끝난 뒤의 실제 발송은 MailBackfillPushTest 가 본다.
 */
@Transactional
class MailSyncServicePushTest extends MailSyncTestSupport {

  @RegisterExtension
  static GreenMailExtension greenMail =
      new MailTestGreenMail()
          .withConfiguration(
              GreenMailConfiguration.aConfig().withUser("box@test.local", "box@test.local", "pw"));

  @Autowired DSLContext dsl;
  @Autowired MailSyncService syncService;
  @Autowired EmailAccountRepository accountRepo;

  /** 미적재 본문 수(countMissingBody)만 바꿔 보충 유무를 고르는 스파이 — 나머지 조회는 실제 동작. */
  @MockitoSpyBean EmailMessageRepository messageRepo;

  /** 공통 기반(MailSyncTestSupport)의 목 — 보충에 넘긴 발송 정보(계정·경계)를 확인한다. */
  @Autowired MailBackfillService backfillService;

  @Autowired EncryptionService encryption;
  @Autowired MailSyncProgress progress;

  /** 발송 단위 포착용 목 — 발송 자체가 커밋 뒤에 호출되는지·어떤 내용으로 가는지 는 여기서 확인한다. */
  @MockitoBean PushDispatcher pushDispatcher;

  /** 발송 콜백 예외 주입용 스팈 — 따로 스텁하지 않으면 실제 동작이라 나머지 케이스가 그대로 흐른다. */
  @MockitoSpyBean MailPushService mailPushService;

  /** 기본은 「본문이 이미 다 있음」 — 보충을 띄우지 않아 동기화 직후 바로 보내는 경로를 탄다. */
  @BeforeEach
  void noMissingBodies() {
    doReturn(0).when(messageRepo).countMissingBody(anyLong());
  }

  /** 미적재 본문 수를 실제 값으로 되돌린다 — IMAP 동기화는 본문을 받지 않으므로 새 메일마다 보충이 뜬다. */
  private void realMissingBodies() {
    doCallRealMethod().when(messageRepo).countMissingBody(anyLong());
  }

  /**
   * box@test.local 계정 삽입(연결 테스트 우회). 알림 범위는 DB 기본값 WORK, AI 분류는 꺼 둔다(꺼진 계정은 WORK 를 ALL 로 판정 — 보통
   * 메일의 발송 경로만 보는 이 클래스엔 영향 없음).
   */
  private long insertAccount(long userId) {
    return MailTestSupport.insertAccount(accountRepo, encryption, userId, false);
  }

  /**
   * 첫 동기화로 기존 메일 1건을 적재하고 진행 상태를 끊는다 — 백필이 목이라 진행 상태가 자동 종료되지 않아, 이어지는 다음 동기화가 진행 중 가드에 막히지 않게 하려고
   * 한다(현행 MailSyncTestSupport 패턴).
   */
  private long firstSyncWithOneMail(long userId) {
    long accountId = insertAccount(userId);
    MailTestPorts.sendText("box@test.local", "alice@example.com", "기존 메일", "본문");
    greenMail.waitForIncomingEmail(1);
    syncService.sync(userId, accountId);
    progress.discardForTest(accountId);
    return accountId;
  }

  /**
   * 첫 동기화(lastSyncedAt 없음) + 새 안 읽은 메일 → 발송 0회. 경계가 없어 기존 미읽음 받은편지함 전체가 한꺼번에 후보가 되는 것을 막는 첫 동기화 제외
   * 설계 지침.
   */
  @Test
  void 첫_동기화에서는_새_안_읽은_메일도_푸시하지_않는다() {
    long user = TestFixtures.createHuman(dsl);
    long accountId = insertAccount(user);
    MailTestPorts.sendText("box@test.local", "alice@example.com", "첫 메일", "본문");
    greenMail.waitForIncomingEmail(1);

    MailSyncResult result = syncService.sync(user, accountId);

    assertThat(result.saved()).isEqualTo(1); // 적재는 성공 — 발송만 생략한다
    verify(pushDispatcher, never()).dispatchMail(any(), any());
  }

  /** 두 번째 동기화 + 새 안 읽은 메일 1건 → 1회, tag 는 계정 단위, url 은 그 메일을 가리키는 messageId 쿼리를 갖는다. */
  @Test
  void 두_번째_동기화의_새_안_읽은_메일을_한_번_보낸다() {
    long user = TestFixtures.createHuman(dsl);
    long accountId = firstSyncWithOneMail(user);
    verify(pushDispatcher, never()).dispatchMail(any(), any()); // 첫 동기화는 발송 없음

    MailTestPorts.sendText("box@test.local", "bob@example.com", "새 메일", "새 본문");
    greenMail.waitForIncomingEmail(2);
    syncService.sync(user, accountId);

    ArgumentCaptor<PushMessage> message = ArgumentCaptor.forClass(PushMessage.class);
    verify(pushDispatcher, times(1)).dispatchMail(eq(List.of(user)), message.capture());
    PushMessage sent = message.getValue();
    assertThat(sent.category()).isEqualTo(PushCategory.MAIL);
    assertThat(sent.tag()).isEqualTo("mail-" + accountId);
    assertThat(sent.url()).contains("?messageId=");
  }

  /** 새 메일이지만 서버에서 이미 읽음 → 안 읽은 메일만 후보라 발송 0회(이미 읽은 메일을 새 메일로 또 알리지 않는다). */
  @Test
  void 경계_뒤_새_메일이_이미_읽음이면_푸시하지_않는다() throws Exception {
    long user = TestFixtures.createHuman(dsl);
    long accountId = firstSyncWithOneMail(user);

    MailTestPorts.sendText("box@test.local", "carol@example.com", "읽음 새 메일", "본문");
    greenMail.waitForIncomingEmail(2);
    // 외부 메일 앱에서 이미 읽은 상태 — 동기화가 이 행을 seen=true 로 넣는다.
    MailTestPorts.setServerSeen("읽음 새 메일", true);

    syncService.sync(user, accountId);

    verify(pushDispatcher, never()).dispatchMail(any(), any());
  }

  /** 경계(max id) 이후 새 메일이 없으면 후보가 없어 발송 0회. */
  @Test
  void 경계_뒤_새_메일이_없으면_푸시하지_않는다() {
    long user = TestFixtures.createHuman(dsl);
    long accountId = firstSyncWithOneMail(user);

    MailSyncResult result = syncService.sync(user, accountId);

    assertThat(result.saved()).isZero();
    verify(pushDispatcher, never()).dispatchMail(any(), any());
  }

  /** 새 메일 3통 → 발송은 1회(묶음), 제목은 「새 메일 3통」 요약 형식, url 은 계정 화면. */
  @Test
  void 새_메일_세_통을_한_번에_모아_보낸다() {
    long user = TestFixtures.createHuman(dsl);
    long accountId = firstSyncWithOneMail(user);
    MailTestPorts.sendText("box@test.local", "bob@example.com", "새 메일 1", "본문");
    MailTestPorts.sendText("box@test.local", "carol@example.com", "새 메일 2", "본문");
    MailTestPorts.sendText("box@test.local", "dave@example.com", "새 메일 3", "본문");
    greenMail.waitForIncomingEmail(4);

    syncService.sync(user, accountId);

    ArgumentCaptor<PushMessage> message = ArgumentCaptor.forClass(PushMessage.class);
    verify(pushDispatcher, times(1)).dispatchMail(eq(List.of(user)), message.capture());
    // 제목이 「새 메일 3통」 이라는 것 자체가 경계(기존 메일 1건)가 후보에 안 섞였고 3통만 집계됐다는 뜻이다.
    assertThat(message.getValue().title()).isEqualTo("새 메일 3통");
    assertThat(message.getValue().url()).isEqualTo("/mail/" + accountId);
  }

  /**
   * 같은 박스를 쓰는 다른 계정의 메일은 섞이지 않는다 — 계정 경계 위에 다른 계정 행이 있어도 발송 0회, 새 메일이 생겨도 자기 계정분만 1건 형식으로
   * 나간다(findNewUnreadInbox 의 accountId 범위 고정).
   */
  @Test
  void 같은_동기화에서_다른_계정의_새_메일은_섞이지_않는다() {
    long user1 = TestFixtures.createHuman(dsl);
    long user2 = TestFixtures.createHuman(dsl);
    long account1 = insertAccount(user1);
    long account2 = insertAccount(user2);

    // 같은 GreenMail 박스를 가리키는 두 계정 — 각자 첫 동기화로 같은 메일을 적재한다(첫 동기화라 발송 없음).
    MailTestPorts.sendText("box@test.local", "alice@example.com", "공용 메일", "본문");
    greenMail.waitForIncomingEmail(1);
    syncService.sync(user1, account1);
    progress.discardForTest(account1);
    syncService.sync(user2, account2);
    progress.discardForTest(account2);
    verify(pushDispatcher, never()).dispatchMail(any(), any());

    // account2 의 행이 account1 경계보다 크다 — 그래도 account1 동기화의 후보가 되면 안 된다(새 메일 없음).
    assertThat(messageRepo.maxInboxId(account2)).isGreaterThan(messageRepo.maxInboxId(account1));
    syncService.sync(user1, account1);
    progress.discardForTest(account1);
    verify(pushDispatcher, never()).dispatchMail(any(), any());

    // 새 메일이 생겨도 자기 계정분만 — 1건 형식(url 에 messageId)으로 나가야 account2 행이 안 섞인 것이다.
    MailTestPorts.sendText("box@test.local", "eve@example.com", "account1 새 메일", "본문");
    greenMail.waitForIncomingEmail(2);
    syncService.sync(user1, account1);

    ArgumentCaptor<PushMessage> message = ArgumentCaptor.forClass(PushMessage.class);
    verify(pushDispatcher, times(1)).dispatchMail(eq(List.of(user1)), message.capture());
    PushMessage sent = message.getValue();
    assertThat(sent.tag()).isEqualTo("mail-" + account1);
    assertThat(sent.url()).startsWith("/mail/" + account1 + "?messageId=");
    assertThat(sent.title()).isEqualTo("eve@example.com"); // 후보 1건 — 섞이면 「새 메일 2통」 요약이 된다
  }

  /**
   * 본문 보충을 띄운 동기화는 그 자리에서 보내지 않고, 동기화 전 경계와 계정을 보충에 넘긴다 — 자동 발송 판정(auto_generated)이 본문을 받을 때 정해지므로
   * 보충이 끝난 뒤 판정해야 대량·자동 발송이 업무 알림에서 빠진다.
   */
  @Test
  void 본문_보충을_띄우면_발송을_보충_뒤로_미룬다() {
    long user = TestFixtures.createHuman(dsl);
    long accountId = firstSyncWithOneMail(user);
    long boundary = messageRepo.maxInboxId(accountId);
    realMissingBodies();
    MailTestPorts.sendText("box@test.local", "bob@example.com", "보충 뒤 새 메일", "본문");
    greenMail.waitForIncomingEmail(2);

    syncService.sync(user, accountId);

    verify(pushDispatcher, never()).dispatchMail(any(), any());
    verify(mailPushService, never()).sendNewMail(anyLong(), any(), anyLong());
    ArgumentCaptor<NewMailPush> push = ArgumentCaptor.forClass(NewMailPush.class);
    verify(backfillService).backfill(eq(user), eq(accountId), push.capture(), notNull());
    assertThat(push.getValue().maxInboxId()).isEqualTo(boundary);
    assertThat(push.getValue().account().id()).isEqualTo(accountId);
  }

  /** 첫 동기화가 보충을 띄우면 발송 정보 없이 넘긴다 — 첫 동기화 제외 규칙이 보충 뒤에도 유지된다. */
  @Test
  void 첫_동기화의_본문_보충에는_발송_정보를_넘기지_않는다() {
    long user = TestFixtures.createHuman(dsl);
    long accountId = insertAccount(user);
    realMissingBodies();
    MailTestPorts.sendText("box@test.local", "alice@example.com", "첫 메일", "본문");
    greenMail.waitForIncomingEmail(1);

    syncService.sync(user, accountId);

    verify(backfillService).backfill(eq(user), eq(accountId), isNull(), notNull());
    verify(pushDispatcher, never()).dispatchMail(any(), any());
  }

  /** 발송 콜백이 예외를 던져도 sync 결과·예외에 영향 없음 — 연결부도 best-effort(예외 미전파)로 방어한다. */
  @Test
  void 발송이_예외를_던져도_동기화는_성공한다() {
    long user = TestFixtures.createHuman(dsl);
    long accountId = firstSyncWithOneMail(user);
    MailTestPorts.sendText("box@test.local", "bob@example.com", "푸시 실패 새 메일", "본문");
    greenMail.waitForIncomingEmail(2);
    doThrow(new IllegalStateException("푸시 실패 주입"))
        .when(mailPushService)
        .sendNewMail(anyLong(), any(), anyLong());

    MailSyncResult result = syncService.sync(user, accountId);

    assertThat(result.saved()).isEqualTo(1);
    // last_synced_at 갱신(마지막 트랜잭션)도 그대로 — 발송 예외가 동기화 성공을 뒤집지 않는다.
    assertThat(accountRepo.findByIdAndUser(user, accountId).orElseThrow().lastSyncedAt())
        .isNotNull();
  }
}
