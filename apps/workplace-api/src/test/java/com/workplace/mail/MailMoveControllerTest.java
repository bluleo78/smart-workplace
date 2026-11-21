package com.workplace.mail;

import static com.workplace.jooq.Tables.EMAIL_MESSAGE;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workplace.global.security.EncryptionService;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.mail.outbound.GraphApiClient;
import com.workplace.mail.outbound.GraphBatchRequest;
import com.workplace.mail.outbound.GraphBatchResponse;
import com.workplace.mail.repository.EmailAccountRepository;
import com.workplace.mail.repository.EmailFolderRepository;
import com.workplace.mail.service.GraphTokenService;
import com.workplace.mail.service.MailServerErrors;
import com.workplace.support.ExternalClientMockedTestBase;
import com.workplace.support.TestFixtures;
import java.util.List;
import java.util.stream.LongStream;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.json.JsonMapper;

/** WP-962 메일 옮기기 API — 요청 형태 검증(400)·소유 검증(404)·보낸 기록(400)·응답 모양. 서버 I/O 는 Graph 스텁. */
@Transactional
class MailMoveControllerTest extends ExternalClientMockedTestBase {

  private static final ObjectMapper JSON = JsonMapper.builderWithJackson2Defaults().build();

  @Autowired MockMvc mvc;
  @Autowired DSLContext dsl;
  @Autowired JwtTokenProvider jwtTokenProvider;
  @Autowired EmailFolderRepository folderRepo;
  @Autowired EmailAccountRepository accountRepo;
  @Autowired EncryptionService encryption;

  @Autowired GraphApiClient graphApiClient;
  @Autowired GraphTokenService graphTokenService;

  private String token(long userId) {
    return "Bearer " + jwtTokenProvider.generateAccessToken(userId, "user-" + userId);
  }

  private long message(long accountId, String folder, String providerId) {
    long folderId = folderRepo.ensureFolder(accountId, folder).id();
    return dsl.insertInto(EMAIL_MESSAGE)
        .set(EMAIL_MESSAGE.ACCOUNT_ID, accountId)
        .set(EMAIL_MESSAGE.FOLDER_ID, folderId)
        .set(EMAIL_MESSAGE.PROVIDER_MESSAGE_ID, providerId)
        .set(EMAIL_MESSAGE.THREAD_ID, "t-" + providerId)
        .set(EMAIL_MESSAGE.SEEN, false)
        .returning(EMAIL_MESSAGE.ID)
        .fetchOne()
        .getId();
  }

  private org.springframework.test.web.servlet.ResultActions move(
      long user, long accountId, String body) throws Exception {
    return mvc.perform(
        post("/api/v1/mail/accounts/{a}/messages/move", accountId)
            .header("Authorization", token(user))
            .contentType(MediaType.APPLICATION_JSON)
            .content(body));
  }

  @Test
  void move_returnsPerMessageResults() throws Exception {
    long user = TestFixtures.createHuman(dsl);
    long accountId = MailTestSupport.seedGraphAccount(dsl, user);
    long id = message(accountId, "INBOX", "G1");
    when(graphTokenService.getAccessToken(anyLong(), anyLong())).thenReturn("T");
    when(graphApiClient.batch(eq("T"), any()))
        .thenAnswer(
            inv -> {
              List<GraphBatchRequest> reqs = inv.getArgument(1);
              return reqs.stream()
                  .map(
                      r ->
                          new GraphBatchResponse(
                              r.id(), 201, JSON.createObjectNode().put("id", "N")))
                  .toList();
            });

    move(user, accountId, "{\"messageIds\":[" + id + "],\"target\":{\"kind\":\"TRASH\"}}")
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.results[0].messageId").value(id))
        .andExpect(jsonPath("$.results[0].ok").value(true))
        .andExpect(jsonPath("$.undo").doesNotExist());
  }

  @Test
  void invalidBodies_are400_othersAccount404_sent400() throws Exception {
    long user = TestFixtures.createHuman(dsl);
    long accountId = MailTestSupport.seedGraphAccount(dsl, user);
    long id = message(accountId, "INBOX", "G1");
    long sent = message(accountId, "SENT", "S1");

    move(user, accountId, "{\"messageIds\":[],\"target\":{\"kind\":\"INBOX\"}}")
        .andExpect(status().isBadRequest());
    String tooMany =
        LongStream.rangeClosed(1, 101).mapToObj(Long::toString).reduce((a, b) -> a + "," + b).get();
    move(user, accountId, "{\"messageIds\":[" + tooMany + "],\"target\":{\"kind\":\"INBOX\"}}")
        .andExpect(status().isBadRequest());
    move(user, accountId, "{\"messageIds\":[" + id + "],\"target\":{}}")
        .andExpect(status().isBadRequest());
    move(user, accountId, "{\"messageIds\":[" + sent + "],\"target\":{\"kind\":\"TRASH\"}}")
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.message").value("보낸 메일은 옮길 수 없습니다"));

    long other = TestFixtures.createHuman(dsl);
    move(other, accountId, "{\"messageIds\":[" + id + "],\"target\":{\"kind\":\"TRASH\"}}")
        .andExpect(status().isNotFound());
  }

  /**
   * WP-1892 — 저장된 비밀번호를 복호화하지 못하면(형식 오류·키 불일치·Base64 오류) 500/400 이 아니라 502 와 한국어 안내로 응답한다. 서버에 접속하기
   * 전에 실패하므로 GreenMail 이 필요 없다.
   */
  @ParameterizedTest
  @ValueSource(
      strings = {"not-encrypted", "AAAAAAAAAAAAAAAA:QUJDREVGR0hJSktMTU5PUFFSU1RVVldY", "!!!:???"})
  void imapCredentialUnreadable_is502WithKoreanMessage(String stored) throws Exception {
    long user = TestFixtures.createHuman(dsl);
    long accountId = MailTestSupport.insertAccount(accountRepo, encryption, user, false);
    MailTestSupport.setStoredPassword(dsl, accountId, stored);
    long id = message(accountId, "INBOX", "I1");

    move(user, accountId, "{\"messageIds\":[" + id + "],\"target\":{\"kind\":\"TRASH\"}}")
        .andExpect(status().isBadGateway())
        .andExpect(jsonPath("$.message").value(MailServerErrors.CREDENTIAL_UNREADABLE));
  }
}
