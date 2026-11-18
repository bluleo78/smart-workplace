package com.workplace.mail;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workplace.global.security.JwtTokenProvider;
import com.workplace.mail.dto.MailTrashCountResponse;
import com.workplace.mail.exception.MailSyncException;
import com.workplace.mail.outbound.GraphApiClient;
import com.workplace.mail.repository.EmailFolderRepository;
import com.workplace.mail.service.GraphTokenService;
import com.workplace.mail.service.graph.GraphMailFolder;
import com.workplace.mail.service.trash.MailTrashService;
import com.workplace.support.ExternalClientMockedTestBase;
import com.workplace.support.TestFixtures;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.ObjectMapper;

/**
 * 휴지통 메일 수 실시간 조회(WP-1708) Outlook(Graph) 통합 테스트 — {@link GraphApiClient}·{@link GraphTokenService}
 * 를 스텁하고({@code MailPermanentDeleteGraphTest} 방식) 휴지통 폴더 조회 응답의 {@code totalItemCount} 를 그대로 받는다. 수
 * 가 없는 응답은 수를 모른다 — 로컬 값으로 대신하지 않고 {@link MailSyncException}(502)으로 멈춘다.
 */
@Transactional
class MailTrashCountGraphTest extends ExternalClientMockedTestBase {

  private static final String TOKEN = "FAKE_TOKEN";

  /** 휴지통 메일 수 조회 경로 — 지우개가 {@code id} 와 함께 {@code totalItemCount} 를 받는다. */
  private static final String COUNT_PATH = "/me/mailFolders/deleteditems?$select=id,totalItemCount";

  @Autowired DSLContext dsl;
  @Autowired MailTrashService trashService;
  @Autowired EmailFolderRepository folderRepo;
  @Autowired GraphApiClient graphApiClient;
  @Autowired GraphTokenService graphTokenService;
  @Autowired ObjectMapper mapper;
  @Autowired MockMvc mvc;
  @Autowired JwtTokenProvider jwtTokenProvider;

  /** Graph 의 {@code totalItemCount} 를 그대로 받는다 — 확인 창의 수는 앱 목록이 아니라 서버 값이다. */
  @Test
  void trashCount_returnsGraphTotalItemCount() {
    long[] s = setup();
    stubCountJson("{\"id\":\"FOLDER-DELETED\",\"totalItemCount\":302}");

    MailTrashCountResponse res = trashService.trashCount(s[0], s[1]);

    assertThat(res.count()).isEqualTo(302);
    verify(graphApiClient).get(eq(TOKEN), eq(COUNT_PATH), eq(GraphMailFolder.class));
  }

  /** {@code totalItemCount} 없는 응답은 수를 모른다 — 502(로컬 값으로 대신하지 않는다). */
  @Test
  void trashCount_withoutTotalItemCount_throwsMailSyncException_502() throws Exception {
    long[] s = setup();
    stubCountJson("{\"id\":\"FOLDER-DELETED\"}");

    assertThatThrownBy(() -> trashService.trashCount(s[0], s[1]))
        .isInstanceOf(MailSyncException.class);

    mvc.perform(
            get("/api/v1/mail/accounts/{a}/trash/count", s[1]).header("Authorization", token(s[0])))
        .andExpect(status().isBadGateway());
  }

  // ===== 헬퍼 =====

  /** [user, account] — Graph 계정과 휴지통(role TRASH) 행, 토큰 스텁. */
  private long[] setup() {
    long user = TestFixtures.createHuman(dsl);
    long accountId = MailTestSupport.seedGraphAccount(dsl, user);
    folderRepo.upsertServerFolder(
        accountId, "id-trash", "id-trash", "Deleted Items", "TRASH", true, null, null, null);
    when(graphTokenService.getAccessToken(anyLong(), anyLong())).thenReturn(TOKEN);
    return new long[] {user, accountId};
  }

  /** 스텁 — 휴지통 폴더 GET 이 주신 JSON 응답을 실제 파서로 {@link GraphMailFolder} 로 바꿔 돌려준다. */
  private void stubCountJson(String json) {
    when(graphApiClient.get(eq(TOKEN), eq(COUNT_PATH), eq(GraphMailFolder.class)))
        .thenAnswer(inv -> mapper.readValue(json, GraphMailFolder.class));
  }

  private String token(long userId) {
    return "Bearer " + jwtTokenProvider.generateAccessToken(userId, "user-" + userId);
  }
}
