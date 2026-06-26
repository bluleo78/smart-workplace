package com.workplace.mail;

import com.workplace.mail.dto.EmailAccountResponse;
import com.workplace.mail.dto.OutgoingMail;
import com.workplace.mail.outbound.GraphApiClient;
import com.workplace.mail.repository.EmailAccountRepository;
import com.workplace.mail.service.GraphTokenService;
import com.workplace.mail.service.MailMimeBuilder;
import com.workplace.support.IntegrationTestBase;
import java.io.ByteArrayOutputStream;
import java.time.Instant;
import java.util.Base64;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Disabled;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

/**
 * 라이브 스레딩 게이트(수동). 실 M365 계정으로 raw MIME 답장을 1건 발송하고, 사람이 Outlook 에서 원문과 같은 대화로 묶이는지 육안 확인한다.
 *
 * <p>실행 전제: (1) 대상 계정을 Mail.Send scope 포함으로 재연결, (2) 아래 env 주입. LIVE_USER_ID / LIVE_ACCOUNT_ID /
 * LIVE_TO / LIVE_PARENT_RFC_MESSAGE_ID
 *
 * <p>통과 기준: 발송 성공 + Outlook 에서 같은 대화(conversation)에 답장이 표시. 실패 시 createReply 폴백으로 설계 전환.
 *
 * <p>수동 실행 명령:
 *
 * <pre>
 * LIVE_USER_ID=.. LIVE_ACCOUNT_ID=.. LIVE_TO=.. LIVE_PARENT_RFC_MESSAGE_ID=.. \
 *   SPRING_FLYWAY_OUT_OF_ORDER=true SPRING_FLYWAY_VALIDATE_ON_MIGRATE=false \
 *   ./gradlew test --tests "com.workplace.mail.LiveGraphSendSmokeTest" \
 *   -Djunit.jupiter.conditions.deactivate=org.junit.*DisabledCondition
 * </pre>
 */
@Disabled("수동 라이브 게이트 — 실 M365 자격증명 필요. -Djunit.jupiter.conditions.deactivate 로 개별 실행")
class LiveGraphSendSmokeTest extends IntegrationTestBase {

  @Autowired MailMimeBuilder mimeBuilder;

  @Autowired GraphTokenService tokenService;

  @Autowired GraphApiClient graphApiClient;

  @Autowired EmailAccountRepository accountRepo;

  /**
   * raw MIME 답장 1건을 Graph로 발송하고, Outlook 에서 원문과 같은 대화로 묶이는지 사람이 확인한다.
   *
   * <p>In-Reply-To / References 헤더가 Outlook 스레딩에 존중되면 PASS → Task 5(전송 계층 추상화) 진행. 별개 대화로 뜨면 FAIL →
   * createReply 폴백 설계 전환 필요.
   */
  @Test
  void liveReplyThreadsInOutlook() throws Exception {
    // env 에서 라이브 실행 파라미터 주입
    long userId = Long.parseLong(System.getenv("LIVE_USER_ID"));
    long accountId = Long.parseLong(System.getenv("LIVE_ACCOUNT_ID"));
    String to = System.getenv("LIVE_TO");
    String parentRfcId = System.getenv("LIVE_PARENT_RFC_MESSAGE_ID"); // 원문 RFC Message-ID (꺾쇠 제외)

    // 실 테넌트 ID 로 교체 — TenantContext.set(실테넌트ID)
    com.workplace.global.tenant.TenantContext.set(1L);
    try {
      // 메일 계정 조회 (GraphTokenService.getAccessToken 도 내부적으로 동일 repo 사용)
      EmailAccountResponse account = accountRepo.findByIdAndUser(userId, accountId).orElseThrow();

      // 발송 메일 구성 — inReplyTo/references 로 스레딩 헤더 설정
      OutgoingMail mail =
          new OutgoingMail(
              UUID.randomUUID() + "@iacloud.kr", // messageId (꺾쇠 없는 정규화 id)
              parentRfcId, // threadId (OutgoingMail 에서 threadId 필드 — 의미 없음, parentRfcId 재사용)
              account.emailAddress(), // fromAddress
              account.displayName(), // fromName
              List.of(to), // to
              List.of(), // cc
              List.of(), // bcc
              "RE: [라이브게이트] 스레딩 확인", // subject
              "raw MIME 답장 스레딩 테스트", // bodyText
              "<p>raw MIME 답장 스레딩 테스트</p>", // bodyHtml
              parentRfcId, // inReplyTo (꺾쇠 없음 — MailMimeBuilder 가 <> 추가)
              "<" + parentRfcId + ">", // references (꺾쇠 포함 원문, 파서 저장 규칙 일치)
              "테스트", // snippet
              Instant.now() // sentAt
              );

      // MIME 조립 → base64 인코딩
      ByteArrayOutputStream out = new ByteArrayOutputStream();
      mimeBuilder.build(account, mail).writeTo(out);
      String base64 = Base64.getEncoder().encodeToString(out.toByteArray());

      // 토큰 취득 (만료 임박 시 갱신 포함)
      String token = tokenService.getAccessToken(userId, accountId);

      // Graph POST /me/sendMail — 성공 시 2xx, 실패 시 MailSendException
      graphApiClient.sendMail(token, base64);

      // → Outlook 에서 원문과 같은 대화(conversation)로 묶이는지 사람이 육안 확인.
      // PASS: 같은 대화 → Task 5 전송 계층 추상화 진행
      // FAIL: 별개 대화 → createReply 폴백으로 설계 전환
    } finally {
      com.workplace.global.tenant.TenantContext.clear();
    }
  }
}
