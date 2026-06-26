package com.workplace.mail.service;

import com.workplace.mail.dto.EmailAccountResponse;
import com.workplace.mail.dto.MailProvider;
import com.workplace.mail.dto.OutgoingMail;
import com.workplace.mail.exception.MailSendException;
import com.workplace.mail.outbound.GraphApiClient;
import jakarta.mail.internet.MimeMessage;
import java.io.ByteArrayOutputStream;
import java.util.Base64;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

/**
 * M365_GRAPH 계정 전송기. 조립된 MIME 을 base64 로 직렬화해 Graph sendMail API 로 발송한다. 스레딩
 * 헤더(In-Reply-To/References)는 MailMimeBuilder 가 이미 포함하므로 직렬화만 담당. Graph 가 saveToSentItems 기본 동작으로
 * 서버 Sent 에 자동 저장하므로 별도 APPEND 가 없다.
 */
@Component
@RequiredArgsConstructor
public class GraphMailTransport implements MailTransport {

  private final GraphTokenService tokenService;
  private final GraphApiClient graphApiClient;

  @Override
  public MailProvider provider() {
    return MailProvider.M365_GRAPH;
  }

  @Override
  public void transmit(
      long userId, EmailAccountResponse account, MimeMessage message, OutgoingMail mail) {
    try {
      // Graph 는 raw MIME 의 Bcc 헤더를 받아 블라인드 발송 후 전달본에서 제거한다.
      // SMTP 는 envelope 로 처리하므로 공유 빌더엔 Bcc 를 넣지 않음 — Graph 전송기에서만 주입.
      if (mail.bcc() != null && !mail.bcc().isEmpty()) {
        jakarta.mail.Address[] bcc = new jakarta.mail.internet.InternetAddress[mail.bcc().size()];
        for (int i = 0; i < mail.bcc().size(); i++) {
          bcc[i] = new jakarta.mail.internet.InternetAddress(mail.bcc().get(i));
        }
        message.setRecipients(jakarta.mail.Message.RecipientType.BCC, bcc);
        message.saveChanges();
      }
      // MimeMessage → 바이트 배열 → base64 직렬화 후 Graph sendMail 호출
      ByteArrayOutputStream out = new ByteArrayOutputStream();
      message.writeTo(out);
      String base64 = Base64.getEncoder().encodeToString(out.toByteArray());
      String token = tokenService.getAccessToken(userId, account.id());
      graphApiClient.sendMail(token, base64);
    } catch (java.io.IOException | jakarta.mail.MessagingException e) {
      throw new MailSendException("Graph 메일 직렬화/발송 실패", e);
    }
  }
}
