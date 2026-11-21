package com.workplace.mail;

import static com.workplace.jooq.Tables.EMAIL_ACCOUNT;
import static com.workplace.jooq.Tables.EMAIL_ATTACHMENT;
import static com.workplace.jooq.Tables.EMAIL_MESSAGE;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workplace.global.security.JwtTokenProvider;
import com.workplace.mail.outbound.GraphApiClient;
import com.workplace.mail.repository.EmailFolderRepository;
import com.workplace.mail.service.MailServerErrors;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.time.OffsetDateTime;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

/**
 * WP-1907 — M365 토큰을 복호화하지 못하면 HTTP 응답이 500 이 아니라 502 와 「계정을 다시 연결」 안내다.
 *
 * <p>GraphTokenService 는 실제 빈이어야 하므로(ExternalClientMockedTestBase 는 이를 스텁한다) IntegrationTestBase 를
 * 상속하고 외부 호출 클라이언트인 GraphApiClient 만 스텁한다. 복호화는 서버 호출 전에 실패하므로 Graph 는 호출되지 않는다.
 */
@Transactional
class GraphTokenUnreadableControllerTest extends IntegrationTestBase {

  @Autowired MockMvc mvc;
  @Autowired DSLContext dsl;
  @Autowired JwtTokenProvider jwtTokenProvider;
  @Autowired EmailFolderRepository folderRepo;

  /** 실제 AAD·Graph 네트워크 대신 스텁으로 대체한다. */
  @MockitoBean GraphApiClient graphApiClient;

  /** refresh 토큰이 형식 오류이고 access 토큰이 만료된 계정으로 옮기기를 요청하면 502 + 다시 연결 안내가 온다. */
  @Test
  void graphTokenUnreadable_is502WithReconnectMessage() throws Exception {
    long user = TestFixtures.createHuman(dsl);
    long accountId = MailTestSupport.seedGraphAccount(dsl, user);
    dsl.update(EMAIL_ACCOUNT)
        .set(EMAIL_ACCOUNT.OAUTH_REFRESH_TOKEN, "not-encrypted")
        .set(EMAIL_ACCOUNT.OAUTH_ACCESS_TOKEN, (String) null)
        .set(EMAIL_ACCOUNT.OAUTH_TOKEN_EXPIRES_AT, OffsetDateTime.now().minusMinutes(1))
        .where(EMAIL_ACCOUNT.ID.eq(accountId))
        .execute();
    long folderId = folderRepo.ensureFolder(accountId, "INBOX").id();
    long id =
        dsl.insertInto(EMAIL_MESSAGE)
            .set(EMAIL_MESSAGE.ACCOUNT_ID, accountId)
            .set(EMAIL_MESSAGE.FOLDER_ID, folderId)
            .set(EMAIL_MESSAGE.PROVIDER_MESSAGE_ID, "G1")
            .set(EMAIL_MESSAGE.THREAD_ID, "t-G1")
            .set(EMAIL_MESSAGE.SEEN, false)
            .returning(EMAIL_MESSAGE.ID)
            .fetchOne()
            .getId();

    mvc.perform(
            post("/api/v1/mail/accounts/{a}/messages/move", accountId)
                .header(
                    "Authorization",
                    "Bearer " + jwtTokenProvider.generateAccessToken(user, "user-" + user))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"messageIds\":[" + id + "],\"target\":{\"kind\":\"TRASH\"}}"))
        .andExpect(status().isBadGateway())
        .andExpect(jsonPath("$.message").value(MailServerErrors.OAUTH_TOKEN_UNREADABLE));
  }

  /** M365 첨부 받기도 토큰을 읽지 못하면 500 으로 감싸지 않고 502 + 다시 연결 안내가 온다. */
  @Test
  void graphAttachmentDownload_tokenUnreadable_is502WithReconnectMessage() throws Exception {
    long user = TestFixtures.createHuman(dsl);
    long accountId = MailTestSupport.seedGraphAccount(dsl, user);
    dsl.update(EMAIL_ACCOUNT)
        .set(EMAIL_ACCOUNT.OAUTH_REFRESH_TOKEN, "not-encrypted")
        .set(EMAIL_ACCOUNT.OAUTH_ACCESS_TOKEN, (String) null)
        .set(EMAIL_ACCOUNT.OAUTH_TOKEN_EXPIRES_AT, OffsetDateTime.now().minusMinutes(1))
        .where(EMAIL_ACCOUNT.ID.eq(accountId))
        .execute();
    long folderId = folderRepo.ensureFolder(accountId, "INBOX").id();
    long messageId =
        dsl.insertInto(EMAIL_MESSAGE)
            .set(EMAIL_MESSAGE.ACCOUNT_ID, accountId)
            .set(EMAIL_MESSAGE.FOLDER_ID, folderId)
            .set(EMAIL_MESSAGE.PROVIDER_MESSAGE_ID, "G2")
            .set(EMAIL_MESSAGE.THREAD_ID, "t-G2")
            .set(EMAIL_MESSAGE.SEEN, false)
            .returning(EMAIL_MESSAGE.ID)
            .fetchOne()
            .getId();
    long attachmentId =
        dsl.insertInto(EMAIL_ATTACHMENT)
            .set(EMAIL_ATTACHMENT.MESSAGE_ID, messageId)
            .set(EMAIL_ATTACHMENT.PROVIDER_ATTACHMENT_ID, "A1")
            .returning(EMAIL_ATTACHMENT.ID)
            .fetchOne()
            .getId();

    mvc.perform(
            get("/api/v1/mail/attachments/{id}/content", attachmentId)
                .header(
                    "Authorization",
                    "Bearer " + jwtTokenProvider.generateAccessToken(user, "user-" + user)))
        .andExpect(status().isBadGateway())
        .andExpect(jsonPath("$.message").value(MailServerErrors.OAUTH_TOKEN_UNREADABLE));
  }
}
