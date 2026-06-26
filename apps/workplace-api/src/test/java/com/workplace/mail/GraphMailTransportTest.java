package com.workplace.mail;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.workplace.global.security.EncryptionService;
import com.workplace.mail.dto.EmailAccountResponse;
import com.workplace.mail.dto.OutgoingMail;
import com.workplace.mail.outbound.GraphApiClient;
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
            Instant.now());

    transport.transmit(user, account, mimeBuilder.build(account, mail), mail);

    // sendMail 이 호출됐고 base64 페이로드에 스레딩 헤더가 포함되는지 검증
    ArgumentCaptor<String> body = ArgumentCaptor.forClass(String.class);
    verify(graphApiClient).sendMail(eq("FAKE_TOKEN"), body.capture());
    String decoded = new String(Base64.getDecoder().decode(body.getValue()));
    assertThat(decoded).contains("In-Reply-To:").contains("parent@example.com");
  }
}
