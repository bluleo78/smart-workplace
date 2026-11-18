package com.workplace.mail;

import static com.workplace.jooq.Tables.EMAIL_FOLDER;
import static com.workplace.jooq.Tables.EMAIL_MESSAGE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workplace.global.security.EncryptionService;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.mail.repository.EmailAccountRepository;
import com.workplace.mail.repository.EmailFolderRepository;
import com.workplace.mail.service.folder.FolderRole;
import com.workplace.mail.service.trash.MailTrashEmptyProgress;
import com.workplace.mail.service.trash.MailTrashService;
import com.workplace.support.ExternalClientMockedTestBase;
import com.workplace.support.TestFixtures;
import java.util.ArrayList;
import java.util.List;
import java.util.stream.LongStream;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.core.task.TaskExecutor;
import org.springframework.core.task.TaskRejectedException;
import org.springframework.http.MediaType;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.transaction.annotation.Transactional;

/**
 * WP-1682 휴지통 메일 완전히 삭제·비우기 API — 요청 형태 검증(400)·휴지통 밖 메일(400 + errors.code)·소유 검증(404), 비우기
 * 시작(202)·상태 조회(200)·실행기 포화(503). 서비스는 실제 빈이고, 이 경로들은 서버에 접속하기 전에 끝난다(서버 반영은 {@link
 * MailPermanentDeleteImapTest}· {@link MailTrashEmptyImapTest}). 비우기 실행기는 싱글턴 빈의 필드라 바꾼 뒤 {@link
 * #restoreExecutor()} 에서 되돌린다.
 */
@Transactional
class MailTrashControllerTest extends ExternalClientMockedTestBase {

  @Autowired MockMvc mvc;
  @Autowired DSLContext dsl;
  @Autowired JwtTokenProvider jwtTokenProvider;
  @Autowired EmailFolderRepository folderRepo;
  @Autowired EmailAccountRepository accountRepo;
  @Autowired EncryptionService encryption;
  @Autowired MailTrashService trashService;
  @Autowired MailTrashEmptyProgress progress;

  private Object originalExecutor;
  private final List<Long> startedAccounts = new ArrayList<>();

  @BeforeEach
  void rememberExecutor() {
    originalExecutor = ReflectionTestUtils.getField(trashService, "emptyExecutor");
  }

  @AfterEach
  void restoreExecutor() {
    ReflectionTestUtils.setField(trashService, "emptyExecutor", originalExecutor);
    startedAccounts.forEach(progress::release); // 진행 상태도 싱글턴 — 시작 전으로
  }

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

  private ResultActions permanentDelete(long user, long accountId, String body) throws Exception {
    return mvc.perform(
        post("/api/v1/mail/accounts/{a}/messages/permanent-delete", accountId)
            .header("Authorization", token(user))
            .contentType(MediaType.APPLICATION_JSON)
            .content(body));
  }

  @Test
  void permanentDelete_validation400_notInTrashCode_othersAccount404() throws Exception {
    long user = TestFixtures.createHuman(dsl);
    long accountId = MailTestSupport.seedGraphAccount(dsl, user);
    long inbox = message(accountId, "INBOX", "G1");

    permanentDelete(user, accountId, "{\"messageIds\":[]}").andExpect(status().isBadRequest());
    permanentDelete(user, accountId, "{}").andExpect(status().isBadRequest());
    String tooMany =
        LongStream.rangeClosed(1, 101).mapToObj(Long::toString).reduce((a, b) -> a + "," + b).get();
    permanentDelete(user, accountId, "{\"messageIds\":[" + tooMany + "]}")
        .andExpect(status().isBadRequest());

    permanentDelete(user, accountId, "{\"messageIds\":[" + inbox + "]}")
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.errors.code").value("NOT_IN_TRASH"))
        .andExpect(jsonPath("$.message").value("휴지통에 있는 메일만 완전히 삭제할 수 있습니다"));

    long other = TestFixtures.createHuman(dsl);
    permanentDelete(other, accountId, "{\"messageIds\":[" + inbox + "]}")
        .andExpect(status().isNotFound());
  }

  private ResultActions trashEmpty(long user, long accountId, boolean start) throws Exception {
    var req =
        start
            ? post("/api/v1/mail/accounts/{a}/trash/empty", accountId)
            : get("/api/v1/mail/accounts/{a}/trash/empty", accountId);
    return mvc.perform(req.header("Authorization", token(user)));
  }

  @Test
  void trashEmpty_post202_get200_othersAccount404_busy503() throws Exception {
    long user = TestFixtures.createHuman(dsl);
    long accountId = MailTestSupport.insertAccount(accountRepo, encryption, user, false);
    startedAccounts.add(accountId);
    long trash = folderRepo.ensureFolder(accountId, "Trash").id();
    dsl.update(EMAIL_FOLDER)
        .set(EMAIL_FOLDER.ROLE, FolderRole.TRASH.name())
        .where(EMAIL_FOLDER.ID.eq(trash))
        .execute();

    // 실행기 포화 — 503 이고 진행 상태는 시작 전으로 돌아간다
    TaskExecutor rejecting =
        task -> {
          throw new TaskRejectedException("가득 참");
        };
    ReflectionTestUtils.setField(trashService, "emptyExecutor", rejecting);
    trashEmpty(user, accountId, true)
        .andExpect(status().isServiceUnavailable())
        .andExpect(jsonPath("$.errors.code").value("TRASH_EMPTY_BUSY"))
        .andExpect(jsonPath("$.message").value("지금은 비울 수 없습니다 — 잠시 뒤 다시 시도해 주세요"));
    trashEmpty(user, accountId, false)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.state").value("IDLE"))
        .andExpect(jsonPath("$.deleted").value(0));

    // 받아 두기만 하고 돌리지 않는 실행기 — 202 + RUNNING, 상태 조회도 RUNNING
    List<Runnable> accepted = new ArrayList<>();
    ReflectionTestUtils.setField(trashService, "emptyExecutor", (TaskExecutor) accepted::add);
    trashEmpty(user, accountId, true)
        .andExpect(status().isAccepted())
        .andExpect(jsonPath("$.state").value("RUNNING"))
        .andExpect(jsonPath("$.startedAt").isNotEmpty());
    trashEmpty(user, accountId, false)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.state").value("RUNNING"));
    // 다시 눌러도 새 작업을 넘기지 않는다
    trashEmpty(user, accountId, true)
        .andExpect(status().isAccepted())
        .andExpect(jsonPath("$.state").value("RUNNING"));
    assertThat(accepted).hasSize(1);

    long other = TestFixtures.createHuman(dsl);
    trashEmpty(other, accountId, false).andExpect(status().isNotFound());
    trashEmpty(other, accountId, true).andExpect(status().isNotFound());
  }
}
