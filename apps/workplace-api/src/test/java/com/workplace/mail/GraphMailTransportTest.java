package com.workplace.mail;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.workplace.global.security.EncryptionService;
import com.workplace.mail.dto.EmailAccountResponse;
import com.workplace.mail.dto.OutgoingMail;
import com.workplace.mail.dto.OutgoingMail.AttachmentPart;
import com.workplace.mail.exception.MailSendException;
import com.workplace.mail.outbound.GraphApiClient;
import com.workplace.mail.outbound.GraphApiClient.DraftRef;
import com.workplace.mail.repository.EmailAccountRepository;
import com.workplace.mail.service.GraphMailTransport;
import com.workplace.mail.service.GraphTokenService;
import com.workplace.mail.service.MailMimeBuilder;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.time.Instant;
import java.util.Base64;
import java.util.List;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.mockito.InOrder;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.transaction.annotation.Transactional;

/** GraphMailTransport — 토큰 획득 후 base64 MIME(스레딩 헤더 포함)을 sendMail 로 전달하는지 검증. */
@Transactional
class GraphMailTransportTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired GraphMailTransport transport;
  @Autowired MailMimeBuilder mimeBuilder;
  @Autowired EmailAccountRepository accountRepo;
  @Autowired EncryptionService encryption;

  /** 실제 Graph HTTP 호출 차단 — void 반환이므로 기본 do-nothing 스텁으로 충분. */
  @MockitoBean GraphApiClient graphApiClient;

  /** 실제 AAD 토큰 갱신 차단 — "FAKE_TOKEN" 반환. */
  @MockitoBean GraphTokenService graphTokenService;

  @Test
  void transmit_sendsBase64MimeWithThreadingHeaders() throws Exception {
    // M365_GRAPH 계정을 test DB 에 삽입하고 레포지토리로 실제 DTO 조회
    long user = TestFixtures.createHuman(dsl);
    long accountId = MailTestSupport.seedGraphAccount(dsl, encryption, user);
    when(graphTokenService.getAccessToken(user, accountId)).thenReturn("FAKE_TOKEN");
    EmailAccountResponse account = accountRepo.findByIdAndUser(user, accountId).orElseThrow();

    OutgoingMail mail =
        new OutgoingMail(
            "n@iacloud.kr",
            "t@iacloud.kr",
            account.emailAddress(),
            account.displayName(),
            List.of("peer@example.com"),
            List.of(),
            List.of(),
            "RE: x",
            "b",
            "<p>b</p>",
            "parent@example.com",
            "<parent@example.com>",
            "b",
            Instant.now(),
            List.of(),
            List.of());

    transport.transmit(user, account, mimeBuilder.build(account, mail), mail);

    // sendMail 이 호출됐고 base64 페이로드에 스레딩 헤더가 포함되는지 검증
    ArgumentCaptor<String> body = ArgumentCaptor.forClass(String.class);
    verify(graphApiClient).sendMail(eq("FAKE_TOKEN"), body.capture());
    String decoded = new String(Base64.getDecoder().decode(body.getValue()));
    assertThat(decoded).contains("In-Reply-To:").contains("parent@example.com");
  }

  // ---- WP-574: 큰 메일(첨부) — 초안 → 첨부/업로드 세션 → send ----

  private OutgoingMail mailWith(EmailAccountResponse account, List<AttachmentPart> attachments) {
    return new OutgoingMail(
        "big@iacloud.kr",
        "t@iacloud.kr",
        account.emailAddress(),
        account.displayName(),
        List.of("peer@example.com"),
        List.of(),
        List.of("hidden@example.com"),
        "RE: 큰 첨부",
        "b",
        "<p>b</p>",
        "parent@example.com",
        "<parent@example.com>",
        "b",
        Instant.now(),
        List.of(),
        attachments);
  }

  private static byte[] bytes(int size) {
    byte[] b = new byte[size];
    for (int i = 0; i < size; i++) {
      b[i] = (byte) (i % 251);
    }
    return b;
  }

  /** 첨부가 있어도 인코딩된 MIME 이 작으면 기존 sendMail 한 번(초안 API 를 쓰지 않는다). */
  @Test
  void transmit_smallMailWithAttachment_usesSendMail() throws Exception {
    long user = TestFixtures.createHuman(dsl);
    long accountId = MailTestSupport.seedGraphAccount(dsl, encryption, user);
    when(graphTokenService.getAccessToken(user, accountId)).thenReturn("FAKE_TOKEN");
    EmailAccountResponse account = accountRepo.findByIdAndUser(user, accountId).orElseThrow();
    OutgoingMail mail =
        mailWith(account, List.of(new AttachmentPart("작은.pdf", "application/pdf", bytes(1000))));

    transport.transmit(user, account, mimeBuilder.build(account, mail), mail);

    ArgumentCaptor<String> body = ArgumentCaptor.forClass(String.class);
    verify(graphApiClient).sendMail(eq("FAKE_TOKEN"), body.capture());
    assertThat(new String(Base64.getDecoder().decode(body.getValue()))).contains("multipart/mixed");
    verify(graphApiClient, never()).createDraftFromMime(any(), any());
  }

  /**
   * 큰 메일 — 첨부를 뺀 MIME(스레딩·Bcc 유지)으로 초안 → 3MB 미만은 attachments API, 이상은 업로드 세션 조각 PUT(320KiB 배수 조각) →
   * 초안 send 순서. sendMail 은 쓰지 않는다.
   */
  @Test
  void transmit_largeMail_draftThenAttachmentsThenSend() throws Exception {
    long user = TestFixtures.createHuman(dsl);
    long accountId = MailTestSupport.seedGraphAccount(dsl, encryption, user);
    when(graphTokenService.getAccessToken(user, accountId)).thenReturn("FAKE_TOKEN");
    when(graphApiClient.createDraftFromMime(eq("FAKE_TOKEN"), anyString()))
        .thenReturn(new DraftRef("D1", null));
    when(graphApiClient.createAttachmentUploadSession(
            eq("FAKE_TOKEN"), eq("D1"), anyString(), anyString(), anyLong()))
        .thenReturn("https://upload.example/session");
    EmailAccountResponse account = accountRepo.findByIdAndUser(user, accountId).orElseThrow();
    byte[] small = bytes(1024 * 1024);
    byte[] big = bytes(7 * 1024 * 1024); // 조각 3개(3,200KiB·3,200KiB·나머지)
    OutgoingMail mail =
        mailWith(
            account,
            List.of(
                new AttachmentPart("작은.pdf", "application/pdf", small),
                new AttachmentPart("큰 영상.mp4", "video/mp4", big)));

    transport.transmit(user, account, mimeBuilder.build(account, mail), mail);

    InOrder order = inOrder(graphApiClient);
    ArgumentCaptor<String> draft = ArgumentCaptor.forClass(String.class);
    order.verify(graphApiClient).createDraftFromMime(eq("FAKE_TOKEN"), draft.capture());
    order
        .verify(graphApiClient)
        .addFileAttachment("FAKE_TOKEN", "D1", "작은.pdf", "application/pdf", small);
    order
        .verify(graphApiClient)
        .createAttachmentUploadSession("FAKE_TOKEN", "D1", "큰 영상.mp4", "video/mp4", big.length);
    order
        .verify(graphApiClient)
        .uploadAttachmentChunk("https://upload.example/session", big, 0, 3_276_800);
    order
        .verify(graphApiClient)
        .uploadAttachmentChunk("https://upload.example/session", big, 3_276_800, 6_553_600);
    order
        .verify(graphApiClient)
        .uploadAttachmentChunk("https://upload.example/session", big, 6_553_600, big.length);
    order.verify(graphApiClient).sendDraft("FAKE_TOKEN", "D1");
    verify(graphApiClient, never()).sendMail(any(), any());
    verify(graphApiClient, never()).delete(any(), any());

    // 초안 MIME: 첨부 없음 + 스레딩 헤더·Bcc 유지
    String decoded = new String(Base64.getDecoder().decode(draft.getValue()));
    assertThat(decoded).contains("In-Reply-To:").contains("parent@example.com");
    assertThat(decoded).contains("Bcc:").contains("hidden@example.com");
    assertThat(decoded).doesNotContain("multipart/mixed");
    assertThat(draft.getValue().length()).isLessThan(100_000);
  }

  /** 첨부 단계에서 실패하면 만든 초안을 지우고 사용자 오류(MailSendException)로 끝낸다 — send 는 부르지 않는다. */
  @Test
  void transmit_largeMail_failureDeletesDraft() throws Exception {
    long user = TestFixtures.createHuman(dsl);
    long accountId = MailTestSupport.seedGraphAccount(dsl, encryption, user);
    when(graphTokenService.getAccessToken(user, accountId)).thenReturn("FAKE_TOKEN");
    when(graphApiClient.createDraftFromMime(eq("FAKE_TOKEN"), anyString()))
        .thenReturn(new DraftRef("D2", null));
    when(graphApiClient.createAttachmentUploadSession(any(), any(), any(), any(), anyLong()))
        .thenReturn("https://upload.example/s2");
    doThrow(new MailSendException("Graph uploadChunk 실패: 500"))
        .when(graphApiClient)
        .uploadAttachmentChunk(anyString(), any(), anyInt(), anyInt());
    EmailAccountResponse account = accountRepo.findByIdAndUser(user, accountId).orElseThrow();
    OutgoingMail mail =
        mailWith(account, List.of(new AttachmentPart("큰.bin", null, bytes(5 * 1024 * 1024))));

    assertThatThrownBy(
            () -> transport.transmit(user, account, mimeBuilder.build(account, mail), mail))
        .isInstanceOf(MailSendException.class)
        .hasMessageContaining("첨부가 큰 메일");

    verify(graphApiClient, times(1)).uploadAttachmentChunk(anyString(), any(), anyInt(), anyInt());
    verify(graphApiClient).delete("FAKE_TOKEN", "/me/messages/D2");
    verify(graphApiClient, never()).sendDraft(any(), any());
    verify(graphApiClient, never()).sendMail(any(), any());
  }

  /** 초안 생성부터 실패하면 지울 초안이 없다 — delete 를 부르지 않는다. */
  @Test
  void transmit_largeMail_draftCreateFails_noDelete() throws Exception {
    long user = TestFixtures.createHuman(dsl);
    long accountId = MailTestSupport.seedGraphAccount(dsl, encryption, user);
    when(graphTokenService.getAccessToken(user, accountId)).thenReturn("FAKE_TOKEN");
    when(graphApiClient.createDraftFromMime(any(), any()))
        .thenThrow(new MailSendException("Graph createDraft 실패: 413"));
    EmailAccountResponse account = accountRepo.findByIdAndUser(user, accountId).orElseThrow();
    OutgoingMail mail =
        mailWith(account, List.of(new AttachmentPart("큰.bin", null, bytes(5 * 1024 * 1024))));

    assertThatThrownBy(
            () -> transport.transmit(user, account, mimeBuilder.build(account, mail), mail))
        .isInstanceOf(MailSendException.class);
    verify(graphApiClient, never()).delete(any(), any());
  }

  /**
   * Exchange 가 초안에 자체 internetMessageId 를 붙였으면(생성 응답에 있음) 그 값(꺾쇠 제외)을 돌려준다 — 로컬 SENT 행이 답장과 스레드로
   * 묶인다.
   */
  @Test
  void transmit_largeMail_returnsExchangeMessageIdFromDraftResponse() throws Exception {
    long user = TestFixtures.createHuman(dsl);
    long accountId = MailTestSupport.seedGraphAccount(dsl, encryption, user);
    when(graphTokenService.getAccessToken(user, accountId)).thenReturn("FAKE_TOKEN");
    when(graphApiClient.createDraftFromMime(eq("FAKE_TOKEN"), anyString()))
        .thenReturn(new DraftRef("D3", "<EX-1@prod.outlook.com>"));
    EmailAccountResponse account = accountRepo.findByIdAndUser(user, accountId).orElseThrow();
    OutgoingMail mail =
        mailWith(account, List.of(new AttachmentPart("큰.bin", null, bytes(4 * 1024 * 1024))));

    String actual = transport.transmit(user, account, mimeBuilder.build(account, mail), mail);

    assertThat(actual).isEqualTo("EX-1@prod.outlook.com");
    verify(graphApiClient, never()).getInternetMessageId(any(), any());
  }

  /** 생성 응답에 없으면 send 전에 한 번 읽고, MIME 값과 같으면 null(바꿀 것 없음). */
  @Test
  void transmit_largeMail_readsMessageIdBeforeSend_nullWhenSame() throws Exception {
    long user = TestFixtures.createHuman(dsl);
    long accountId = MailTestSupport.seedGraphAccount(dsl, encryption, user);
    when(graphTokenService.getAccessToken(user, accountId)).thenReturn("FAKE_TOKEN");
    when(graphApiClient.createDraftFromMime(eq("FAKE_TOKEN"), anyString()))
        .thenReturn(new DraftRef("D4", null));
    when(graphApiClient.getInternetMessageId("FAKE_TOKEN", "D4")).thenReturn("<big@iacloud.kr>");
    EmailAccountResponse account = accountRepo.findByIdAndUser(user, accountId).orElseThrow();
    OutgoingMail mail =
        mailWith(account, List.of(new AttachmentPart("큰.bin", null, bytes(4 * 1024 * 1024))));

    String actual = transport.transmit(user, account, mimeBuilder.build(account, mail), mail);

    assertThat(actual).isEqualTo("big@iacloud.kr"); // 늘 실제로 나간 값을 돌려준다
    InOrder order = inOrder(graphApiClient);
    order.verify(graphApiClient).getInternetMessageId("FAKE_TOKEN", "D4");
    order.verify(graphApiClient).sendDraft("FAKE_TOKEN", "D4");
  }
}
