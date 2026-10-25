package com.workplace.mail.service;

import static com.workplace.jooq.Tables.EMAIL_ACCOUNT;
import static com.workplace.jooq.Tables.EMAIL_FOLDER;
import static com.workplace.jooq.Tables.EMAIL_MESSAGE;
import static com.workplace.jooq.Tables.ISSUE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.global.tenant.TenantContext;
import com.workplace.issue.repository.IssueRepository;
import com.workplace.mail.dto.PromoteToIssueRequest;
import com.workplace.mail.dto.PromotedIssue;
import com.workplace.mail.exception.MailAlreadyPromotedException;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.service.ProjectService;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

/** #520 메일→이슈 승격 — 사용자 권한 생성 + source 스탬프 + 멤버십 가드. */
class MailIssueServiceTest extends IntegrationTestBase {

  @Autowired MailIssueService mailIssueService;
  @Autowired IssueRepository issueRepository;
  @Autowired ProjectService projectService;
  @Autowired DSLContext dsl;
  @Autowired com.workplace.issue.service.IssueService issueService;
  @Autowired com.workplace.issue.repository.IssueTypeRepository typeRepository;
  @Autowired com.workplace.label.service.LabelService labelService;
  @Autowired com.workplace.watcher.repository.IssueWatcherRepository watcherRepository;
  @Autowired MailSenderReporter senderReporter;

  /** AfterEach 에서 RLS-safe 정리용 — 생성된 이슈 id 기록. */
  private final java.util.List<Long> createdIssueIds = new java.util.ArrayList<>();

  /** AfterEach 에서 정리용 — 생성된 메일 계정 id 기록. */
  private final java.util.List<Long> createdAccountIds = new java.util.ArrayList<>();

  private long callerId;
  private String projectKey;

  @BeforeEach
  void setUp() {
    callerId = TestFixtures.createHuman(dsl);
    TenantContext.set(1L);
    String suffix = UUID.randomUUID().toString().replaceAll("-", "").toUpperCase().substring(0, 4);
    String raw = "MI" + suffix;
    projectKey = raw.substring(0, Math.min(10, raw.length()));
    // projectService.create 는 @Transactional — TenantContext.set 아래에서 GUC 주입
    projectService.create(callerId, new CreateProjectRequest(projectKey, "메일이슈 테스트", "x"));
  }

  @AfterEach
  void tearDown() {
    // 공유 test DB 누수 방지 — RLS-안전 정리
    cleanupInTenant(
        1L,
        () -> {
          if (!createdIssueIds.isEmpty()) {
            dsl.deleteFrom(ISSUE).where(ISSUE.ID.in(createdIssueIds)).execute();
          }
          if (!createdAccountIds.isEmpty()) {
            dsl.deleteFrom(EMAIL_MESSAGE)
                .where(EMAIL_MESSAGE.ACCOUNT_ID.in(createdAccountIds))
                .execute();
            dsl.deleteFrom(EMAIL_FOLDER)
                .where(EMAIL_FOLDER.ACCOUNT_ID.in(createdAccountIds))
                .execute();
            dsl.deleteFrom(EMAIL_ACCOUNT).where(EMAIL_ACCOUNT.ID.in(createdAccountIds)).execute();
          }
        });
    TenantContext.clear();
  }

  /**
   * 테스트용 메일 메시지를 caller 소유 계정에 삽입하고 messageId 반환.
   *
   * <p>MailIssueService 는 messageId 소유 검증을 수행하지 않으므로(Task 4 에서 추가 예정) 메시지 행 삽입만으로 충분하다. 향후 소유 검증
   * 추가를 대비해 caller 소유 계정으로 삽입한다. cleanupInTenant tx 안에서 삽입해 GUC(tenant_id)를 주입한다.
   */
  private long seedMailMessage(long userId) {
    return seedMailMessage(userId, null);
  }

  /** 보낸 사람 주소를 지정해 메일을 심는다(WP-954 — 보고자 「보낸 사람」). */
  private long seedMailMessage(long userId, String fromAddress) {
    // baseDsl 로 직접 삽입 — MailTestSupport.seedUnseenGraphMessage 패턴 참조
    // EMAIL_ACCOUNT 의 tenant_id 는 GUC DEFAULT; cleanupInTenant 가 GUC 주입 tx 를 제공
    long[] ids = new long[2]; // [0]=accountId, [1]=messageId
    cleanupInTenant(
        1L,
        () -> {
          String suffix = UUID.randomUUID().toString().substring(0, 8);
          long accountId =
              dsl.insertInto(EMAIL_ACCOUNT)
                  .set(EMAIL_ACCOUNT.USER_ID, userId)
                  .set(EMAIL_ACCOUNT.EMAIL_ADDRESS, "seed-" + suffix + "@test.local")
                  .set(EMAIL_ACCOUNT.DISPLAY_NAME, "씨드계정")
                  .returning(EMAIL_ACCOUNT.ID)
                  .fetchOne()
                  .getId();
          createdAccountIds.add(accountId);
          ids[0] = accountId;

          long folderId =
              dsl.insertInto(EMAIL_FOLDER)
                  .set(EMAIL_FOLDER.ACCOUNT_ID, accountId)
                  .set(EMAIL_FOLDER.NAME, "INBOX")
                  .onConflictDoNothing()
                  .returning(EMAIL_FOLDER.ID)
                  .fetchOne()
                  .getId();

          long messageId =
              dsl.insertInto(EMAIL_MESSAGE)
                  .set(EMAIL_MESSAGE.ACCOUNT_ID, accountId)
                  .set(EMAIL_MESSAGE.FOLDER_ID, folderId)
                  .set(EMAIL_MESSAGE.PROVIDER_MESSAGE_ID, "msg-" + suffix + "@test.local")
                  .set(EMAIL_MESSAGE.THREAD_ID, "thread-" + suffix)
                  .set(EMAIL_MESSAGE.SEEN, false)
                  .set(EMAIL_MESSAGE.FROM_ADDRESS, fromAddress)
                  .returning(EMAIL_MESSAGE.ID)
                  .fetchOne()
                  .getId();
          ids[1] = messageId;
        });
    return ids[1];
  }

  @Test
  void promoteToIssue_createsIssueAndStampsMailSource() {
    long messageId = seedMailMessage(callerId);

    PromotedIssue result =
        mailIssueService.promoteToIssue(
            callerId,
            messageId,
            new PromoteToIssueRequest(projectKey, "정산 자료 검토", "메일 요청 정리", "HIGH", List.of()));

    assertThat(result.issueKey()).startsWith(projectKey + "-");
    assertThat(issueRepository.findSourceIssueKey("MAIL", messageId)).contains(result.issueKey());

    mailIssueIds(messageId); // AfterEach 정리 대상으로 등록
  }

  /** WP-356 — 승격 요청의 유형·라벨이 생성과 같은 경로(IssueService.create)로 함께 저장된다. */
  @Test
  void promoteToIssue_withTypeAndLabels_appliesBoth() {
    long messageId = seedMailMessage(callerId);
    var projectId = projectService.get(callerId, projectKey).id();
    var bugType = typeRepository.findByProjectAndName(projectId, "BUG").orElseThrow();
    var label =
        labelService.create(
            callerId, projectKey, new com.workplace.label.dto.CreateLabelRequest("메일", "BLUE"));

    PromotedIssue result =
        mailIssueService.promoteToIssue(
            callerId,
            messageId,
            new PromoteToIssueRequest(
                projectKey,
                "유형 라벨",
                null,
                "MID",
                List.of(),
                bugType.id(),
                List.of(label.id()),
                null));
    mailIssueIds(messageId); // AfterEach 정리 대상으로 등록

    int number = Integer.parseInt(result.issueKey().substring(projectKey.length() + 1));
    var detail = issueService.get(callerId, projectKey, number);
    assertThat(detail.summary().type().name()).isEqualTo("BUG");
    assertThat(detail.summary().labels()).extracting(l -> l.name()).containsExactly("메일");
  }

  /** WP-394 — 승격 요청의 이름 라벨은 이슈와 같은 트랜잭션에서 만들어 붙는다. 이미 승격된 메일이면 이슈도 라벨도 만들지 않는다. */
  @Test
  void promoteToIssue_withLabelNames_createsLabelOnlyWhenIssueIsCreated() {
    // 실제 사용자처럼 USER 역할(label:manage 포함)을 준다 — 이름 라벨로 새 라벨을 만드는 경로가 이 권한을 본다.
    grantUserRole(callerId);
    // WP-420: 역할 권한(label:manage)은 테넌트 ACTIVE 멤버일 때만 유효하다.
    withMembership(callerId);
    long messageId = seedMailMessage(callerId);
    var req =
        new PromoteToIssueRequest(
            projectKey, "이름 라벨", null, "MID", List.of(), null, null, List.of("메일-요청"));

    PromotedIssue result = mailIssueService.promoteToIssue(callerId, messageId, req);
    mailIssueIds(messageId); // AfterEach 정리 대상으로 등록
    int number = Integer.parseInt(result.issueKey().substring(projectKey.length() + 1));
    assertThat(issueService.get(callerId, projectKey, number).summary().labels())
        .extracting(l -> l.name())
        .containsExactly("메일-요청");

    var again =
        new PromoteToIssueRequest(
            projectKey, "다시", null, "MID", List.of(), null, null, List.of("두번째-라벨"));
    assertThatThrownBy(() -> mailIssueService.promoteToIssue(callerId, messageId, again))
        .isInstanceOf(MailAlreadyPromotedException.class);
    assertThat(labelService.list(callerId, projectKey))
        .extracting(l -> l.name())
        .containsExactly("메일-요청");
  }

  @Test
  void findLinkedIssue_afterPromote_returnsKey() {
    long messageId = seedMailMessage(callerId);
    var promoted =
        mailIssueService.promoteToIssue(
            callerId,
            messageId,
            new PromoteToIssueRequest(projectKey, "t", null, "MID", List.of()));

    mailIssueIds(messageId); // AfterEach 정리 대상으로 등록

    assertThat(mailIssueService.findLinkedIssue(callerId, messageId).issueKey())
        .isEqualTo(promoted.issueKey());
  }

  @Test
  void findLinkedIssue_none_returnsNull() {
    long messageId = seedMailMessage(callerId);
    assertThat(mailIssueService.findLinkedIssue(callerId, messageId).issueKey()).isNull();
  }

  @Test
  void promoteToIssue_nonMemberProject_rejected() {
    long messageId = seedMailMessage(callerId);

    assertThatThrownBy(
            () ->
                mailIssueService.promoteToIssue(
                    callerId,
                    messageId,
                    new PromoteToIssueRequest("NOPE", "x", null, "MID", List.of())))
        .isInstanceOf(RuntimeException.class); // accessGuard.assertMember → 권한/404 계열
  }

  /** 이 메일로 만들어진 이슈 id 전부(삭제분 포함)를 돌려주고 AfterEach 정리 대상으로 등록한다 — 개수 단언과 정리에 함께 쓴다. */
  private List<Long> mailIssueIds(long messageId) {
    List<Long> ids = new java.util.ArrayList<>();
    cleanupInTenant(
        1L,
        () ->
            ids.addAll(
                dsl.select(ISSUE.ID)
                    .from(ISSUE)
                    .where(ISSUE.SOURCE_TYPE.eq("MAIL").and(ISSUE.SOURCE_ID.eq(messageId)))
                    .fetchInto(Long.class)));
    createdIssueIds.addAll(ids);
    return ids;
  }

  /** #859 — 이미 전환한 메일을 다시 전환하면 409(기존 이슈 키 포함)이고 이슈는 1건만 남는다. */
  @Test
  void promoteToIssue_twice_rejectedWithExistingKey() {
    long messageId = seedMailMessage(callerId);
    var req = new PromoteToIssueRequest(projectKey, "중복", null, "MID", List.of());
    PromotedIssue first = mailIssueService.promoteToIssue(callerId, messageId, req);

    assertThatThrownBy(() -> mailIssueService.promoteToIssue(callerId, messageId, req))
        .isInstanceOfSatisfying(
            MailAlreadyPromotedException.class,
            e -> assertThat(e.issueKey()).isEqualTo(first.issueKey()));
    assertThat(mailIssueIds(messageId)).hasSize(1);
  }

  /** #859 — 연결된 이슈가 삭제되면 연결이 끊긴 것으로 보고 다시 전환할 수 있다. */
  @Test
  void promoteToIssue_afterIssueDeleted_allowed() {
    long messageId = seedMailMessage(callerId);
    var req = new PromoteToIssueRequest(projectKey, "재전환", null, "MID", List.of());
    mailIssueService.promoteToIssue(callerId, messageId, req);
    cleanupInTenant(
        1L,
        () ->
            dsl.update(ISSUE)
                .set(ISSUE.DELETED_AT, java.time.OffsetDateTime.now())
                .where(ISSUE.SOURCE_TYPE.eq("MAIL").and(ISSUE.SOURCE_ID.eq(messageId)))
                .execute());

    PromotedIssue again = mailIssueService.promoteToIssue(callerId, messageId, req);

    assertThat(issueRepository.findSourceIssueKey("MAIL", messageId)).contains(again.issueKey());
    assertThat(mailIssueIds(messageId)).hasSize(2);
  }

  /** 보고자 「보낸 사람」 요청 — 9번째 인자만 다른 승격 요청. */
  private PromoteToIssueRequest senderRequest(String key, String title) {
    return new PromoteToIssueRequest(
        key, title, null, "MID", List.of(), null, null, null, "SENDER");
  }

  /**
   * WP-954 — 보고자를 보낸 사람으로 고르면 보낸 사람(이 워크스페이스 구성원·프로젝트 멤버)이 보고자가 되고, 이력에는 실제로 만든 사람이 행위자로 남으며, 만든
   * 사람과 보낸 사람 둘 다 watcher 다.
   */
  @Test
  void promoteToIssue_reporterSender_setsSenderAsReporter() {
    long sender = withMembership(TestFixtures.createHuman(dsl));
    withMembership(callerId);
    projectService.addMember(
        callerId, projectKey, new com.workplace.project.dto.AddMemberRequest(sender, "MEMBER"));
    String senderEmail =
        dsl.select(com.workplace.jooq.Tables.USER.EMAIL)
            .from(com.workplace.jooq.Tables.USER)
            .where(com.workplace.jooq.Tables.USER.ID.eq(sender))
            .fetchOne(com.workplace.jooq.Tables.USER.EMAIL);
    long messageId = seedMailMessage(callerId, "  " + senderEmail.toUpperCase() + " ");

    PromotedIssue result =
        mailIssueService.promoteToIssue(callerId, messageId, senderRequest(projectKey, "보낸 사람 보고"));
    mailIssueIds(messageId);

    int number = Integer.parseInt(result.issueKey().substring(projectKey.length() + 1));
    var detail = issueService.get(callerId, projectKey, number);
    assertThat(detail.reporter().id()).isEqualTo(sender);
    assertThat(detail.history())
        .anyMatch(h -> "REPORTER_CHANGED".equals(h.eventType()) && h.actorId().equals(callerId));
    assertThat(watcherRepository.findUserIdsByIssue(detail.summary().id()))
        .contains(callerId, sender);
  }

  /** WP-954 — 보낸 사람이 구성원이 아니면(외부 메일) 400 이고 이슈를 만들지 않는다. */
  @Test
  void promoteToIssue_reporterSender_externalSenderRejectedWithoutIssue() {
    long messageId = seedMailMessage(callerId, "partner@outside.example");

    assertThatThrownBy(
            () ->
                mailIssueService.promoteToIssue(
                    callerId, messageId, senderRequest(projectKey, "외부 발신")))
        .isInstanceOf(com.workplace.issue.exception.InvalidReporterException.class)
        .hasMessageContaining("구성원이 아니라");
    assertThat(issueRepository.findSourceIssueKey("MAIL", messageId)).isEmpty();
  }

  /** WP-954 — 내가 보낸 메일에 「보낸 사람」을 고르면 보낸 사람이 곧 나라 400 없이 내가 보고자로 남는다. */
  @Test
  void promoteToIssue_reporterSender_selfSentKeepsMe() {
    long messageId = seedMailMessage(callerId);
    cleanupInTenant(
        1L,
        () ->
            dsl.update(EMAIL_MESSAGE)
                .set(
                    EMAIL_MESSAGE.FROM_ADDRESS,
                    dsl.select(EMAIL_ACCOUNT.EMAIL_ADDRESS)
                        .from(EMAIL_ACCOUNT)
                        .where(EMAIL_ACCOUNT.ID.eq(EMAIL_MESSAGE.ACCOUNT_ID)))
                .where(EMAIL_MESSAGE.ID.eq(messageId))
                .execute());

    PromotedIssue result =
        mailIssueService.promoteToIssue(callerId, messageId, senderRequest(projectKey, "내가 보낸 메일"));
    mailIssueIds(messageId);

    int number = Integer.parseInt(result.issueKey().substring(projectKey.length() + 1));
    assertThat(issueService.get(callerId, projectKey, number).reporter().id()).isEqualTo(callerId);
  }

  /**
   * WP-954 — 초안 후보 판정: OPEN 프로젝트는 멤버가 아니어도 고를 수 있고 기본, TEAM 은 멤버면 기본·아니면 고를 수 없다. 외부 발신자는 어디서도 못
   * 고른다.
   */
  @Test
  void senderReporter_candidateFlags() {
    long sender = withMembership(TestFixtures.createHuman(dsl));
    withMembership(callerId);
    String openKey = projectKey.substring(0, Math.min(8, projectKey.length())) + "O";
    projectService.create(callerId, new CreateProjectRequest(openKey, "오픈", "x", "OPEN"));
    var team = projectService.get(callerId, projectKey);
    var open = projectService.get(callerId, openKey);
    cleanupInTenant(
        1L,
        () -> {
          var member =
              java.util.Optional.of(
                  new com.workplace.mail.repository.MailPeopleRepository.MemberMatch(
                      sender, "보낸이", null));
          var external =
              java.util.Optional
                  .<com.workplace.mail.repository.MailPeopleRepository.MemberMatch>empty();
          assertThat(senderReporter.candidate(open, member))
              .extracting(c -> c.senderSelectable(), c -> c.senderDefault())
              .containsExactly(true, true);
          assertThat(senderReporter.candidate(team, member))
              .extracting(c -> c.senderSelectable(), c -> c.senderDefault())
              .containsExactly(false, false);
          assertThat(senderReporter.candidate(open, external))
              .extracting(c -> c.senderSelectable(), c -> c.senderDefault())
              .containsExactly(false, false);
        });
    projectService.addMember(
        callerId, projectKey, new com.workplace.project.dto.AddMemberRequest(sender, "MEMBER"));
    cleanupInTenant(
        1L,
        () ->
            assertThat(
                    senderReporter.candidate(
                        team,
                        java.util.Optional.of(
                            new com.workplace.mail.repository.MailPeopleRepository.MemberMatch(
                                sender, "보낸이", null))))
                .extracting(c -> c.senderSelectable(), c -> c.senderDefault())
                .containsExactly(true, true));
  }
}
