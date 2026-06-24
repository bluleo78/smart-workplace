package com.workplace.messaging;

import static com.workplace.jooq.Tables.CHANNEL;
import static com.workplace.jooq.Tables.CHANNEL_MEMBER;
import static com.workplace.jooq.Tables.ISSUE;
import static com.workplace.jooq.Tables.ISSUE_ASSIGNEE;
import static com.workplace.jooq.Tables.ISSUE_HISTORY;
import static com.workplace.jooq.Tables.MESSAGE;
import static com.workplace.jooq.Tables.PROJECT;
import static com.workplace.jooq.Tables.PROJECT_ISSUE_SEQUENCE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.global.tenant.TenantContext;
import com.workplace.issue.service.IssueService;
import com.workplace.messaging.dto.CreateProposalRequest;
import com.workplace.messaging.exception.ProposalNotDelegatorException;
import com.workplace.messaging.repository.ChannelMemberRepository;
import com.workplace.messaging.repository.ChannelRepository;
import com.workplace.messaging.service.MessagingProposalService;
import com.workplace.project.service.PersonalProjectProvisioner;
import com.workplace.support.IntegrationTestBase;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.mock.mockito.MockBean;

/**
 * MessagingProposalService.confirm/reject 통합 테스트 (L3 위임 슬라이스 1, Task 4).
 *
 * <p>non-@Transactional — PersonalProjectProvisioner.ensureDefaultPersonal 은 REQUIRES_NEW 에서 실제
 * 커밋하므로 클래스-레벨 롤백과 격리되지 않는다. 커밋된 row 는 @AfterEach 에서 직접 회수한다.
 */
class MessagingProposalConfirmTest extends IntegrationTestBase {

  @Autowired MessagingProposalService proposalService;
  @Autowired IssueService issueService;
  @Autowired PersonalProjectProvisioner provisioner;
  @Autowired ChannelRepository channelRepo;
  @Autowired ChannelMemberRepository memberRepo;
  @Autowired DSLContext dsl;

  // AiAgentMessagingClient 모킹 — MessagingAttentionDispatcher 차단.
  @MockBean com.workplace.messaging.outbound.AiAgentMessagingClient aiClient;

  // 테스트 격리: 생성된 id 추적 → AfterEach 회수.
  private final List<Long> createdUserIds = new ArrayList<>();
  private final List<Long> createdChannelIds = new ArrayList<>();

  private long human;
  private long otherHuman;
  private long agentId;
  private long channelId;

  @BeforeEach
  void setUp() {
    // ThreadLocal TenantContext — REQUIRES_NEW 서브 트랜잭션의 GUC 재주입에 필수.
    TenantContext.set(1L);
    dsl.execute("set app.tenant_id='1'");

    human = seedUser("confirm_human", "HUMAN");
    otherHuman = seedUser("confirm_other", "HUMAN");
    agentId = seedUser("confirm_agent", "AGENT");

    channelId = channelRepo.insertPublic("confirm-ch-" + UUID.randomUUID(), human);
    createdChannelIds.add(channelId);
    memberRepo.add(channelId, human, "MEMBER");
    memberRepo.add(channelId, otherHuman, "MEMBER");
    memberRepo.add(channelId, agentId, "MEMBER");

    // 위임자(human)의 기본 개인 프로젝트 프로비저닝 (REQUIRES_NEW 서브 트랜잭션으로 커밋됨).
    provisioner.ensureDefaultPersonal(human);
  }

  @AfterEach
  void cleanup() {
    TenantContext.clear();
    // 이슈 관련 행 회수 — issue_assignee/issue_history → issue → project_issue_sequence (FK 순서).
    if (!createdUserIds.isEmpty()) {
      List<Long> projectIds =
          dsl.select(PROJECT.ID)
              .from(PROJECT)
              .where(PROJECT.OWNER_ID.in(createdUserIds))
              .fetchInto(Long.class);
      if (!projectIds.isEmpty()) {
        List<Long> issueIds =
            dsl.select(ISSUE.ID)
                .from(ISSUE)
                .where(ISSUE.PROJECT_ID.in(projectIds))
                .fetchInto(Long.class);
        if (!issueIds.isEmpty()) {
          dsl.deleteFrom(ISSUE_ASSIGNEE).where(ISSUE_ASSIGNEE.ISSUE_ID.in(issueIds)).execute();
          dsl.deleteFrom(ISSUE_HISTORY).where(ISSUE_HISTORY.ISSUE_ID.in(issueIds)).execute();
          dsl.deleteFrom(ISSUE).where(ISSUE.ID.in(issueIds)).execute();
        }
        dsl.deleteFrom(PROJECT_ISSUE_SEQUENCE)
            .where(PROJECT_ISSUE_SEQUENCE.PROJECT_ID.in(projectIds))
            .execute();
      }
    }
    // channel 관련 행 회수 (proposal → message → channel_member → channel).
    if (!createdChannelIds.isEmpty()) {
      dsl.deleteFrom(com.workplace.jooq.tables.MessageActionProposal.MESSAGE_ACTION_PROPOSAL)
          .where(
              com.workplace.jooq.tables.MessageActionProposal.MESSAGE_ACTION_PROPOSAL.CHANNEL_ID.in(
                  createdChannelIds))
          .execute();
      dsl.deleteFrom(MESSAGE).where(MESSAGE.CHANNEL_ID.in(createdChannelIds)).execute();
      dsl.deleteFrom(CHANNEL_MEMBER)
          .where(CHANNEL_MEMBER.CHANNEL_ID.in(createdChannelIds))
          .execute();
      dsl.deleteFrom(CHANNEL).where(CHANNEL.ID.in(createdChannelIds)).execute();
    }
    // project → user_role → user 회수.
    if (!createdUserIds.isEmpty()) {
      dsl.deleteFrom(PROJECT).where(PROJECT.OWNER_ID.in(createdUserIds)).execute();
      dsl.deleteFrom(USER_ROLE).where(USER_ROLE.USER_ID.in(createdUserIds)).execute();
      dsl.deleteFrom(USER).where(USER.ID.in(createdUserIds)).execute();
    }
    createdUserIds.clear();
    createdChannelIds.clear();
  }

  // ── 헬퍼 ──────────────────────────────────────────────────────────────────

  /** UUID suffix 유니크 유저 INSERT. USER_ROLE("USER") 함께 부여. */
  private long seedUser(String prefix, String kind) {
    String suffix = UUID.randomUUID().toString().replace("-", "").substring(0, 8);
    Long id =
        dsl.insertInto(USER)
            .set(USER.USERNAME, prefix + "_" + suffix)
            .set(USER.PASSWORD, "pw")
            .set(USER.NAME, prefix)
            .set(USER.EMAIL, prefix + "_" + suffix + "@example.com")
            .set(USER.KIND, kind)
            .returning(USER.ID)
            .fetchOne()
            .getId();
    Long roleId =
        dsl.select(com.workplace.jooq.Tables.ROLE.ID)
            .from(com.workplace.jooq.Tables.ROLE)
            .where(com.workplace.jooq.Tables.ROLE.NAME.eq("USER"))
            .fetchOne(com.workplace.jooq.Tables.ROLE.ID);
    dsl.insertInto(USER_ROLE).set(USER_ROLE.USER_ID, id).set(USER_ROLE.ROLE_ID, roleId).execute();
    createdUserIds.add(id);
    return id;
  }

  /** 채널 내 메시지 수 조회. */
  private long countMessages(long chId) {
    return dsl.selectCount()
        .from(MESSAGE)
        .where(MESSAGE.CHANNEL_ID.eq(chId))
        .fetchOne(0, Long.class);
  }

  /** human 소유 프로젝트 내 이슈 수 조회 — 공유 DB 에서 전체 COUNT 는 병렬 세션과 충돌하므로 프로젝트 범위로 한정. */
  private long countIssues() {
    List<Long> projectIds =
        dsl.select(PROJECT.ID)
            .from(PROJECT)
            .where(PROJECT.OWNER_ID.in(createdUserIds))
            .fetchInto(Long.class);
    if (projectIds.isEmpty()) return 0L;
    return dsl.selectCount()
        .from(ISSUE)
        .where(ISSUE.PROJECT_ID.in(projectIds))
        .fetchOne(0, Long.class);
  }

  /** 채널의 마지막 메시지 authorKind + body 조회 (id DESC 첫 번째). */
  private LastMsgInfo lastMessage(long chId) {
    return dsl.select(MESSAGE.AUTHOR_ID, MESSAGE.BODY)
        .from(MESSAGE)
        .where(MESSAGE.CHANNEL_ID.eq(chId))
        .orderBy(MESSAGE.ID.desc())
        .limit(1)
        .fetchOne(
            r -> {
              String kind =
                  dsl.select(USER.KIND)
                      .from(USER)
                      .where(USER.ID.eq(r.get(MESSAGE.AUTHOR_ID)))
                      .fetchOne(USER.KIND);
              return new LastMsgInfo(kind, r.get(MESSAGE.BODY));
            });
  }

  /** 마지막 메시지 검증용 간단 DTO. */
  record LastMsgInfo(String authorKind, String body) {}

  /**
   * issueKey("KEY-1") 로 이슈 상세 조회 헬퍼. IssueDetailResponse.summary().assignees() 참조. 마지막 '-' 앞이
   * projectKey.
   */
  private com.workplace.issue.dto.IssueDetailResponse getByKey(long callerId, String issueKey) {
    int lastDash = issueKey.lastIndexOf('-');
    String projectKey = issueKey.substring(0, lastDash);
    int number = Integer.parseInt(issueKey.substring(lastDash + 1));
    return issueService.get(callerId, projectKey, number);
  }

  // ── 테스트 ────────────────────────────────────────────────────────────────

  /** 위임자(human)가 승인하면 이슈 생성(AI 담당), 제안 CONFIRMED, 결과 메시지(AGENT) 게시. */
  @Test
  void confirm_byDelegator_createsIssueWithAiAssignee_andResultMessage() {
    var proposal =
        proposalService.propose(
            agentId,
            channelId,
            new CreateProposalRequest("CREATE_ISSUE", "로그인 버그", "본문", "HIGH", human, null));
    long proposalId = proposal.proposal().id();
    long messagesBefore = countMessages(channelId);

    var result = proposalService.confirm(human, proposalId);

    // 제안 상태 CONFIRMED.
    assertThat(result.proposal().status()).isEqualTo("CONFIRMED");
    // issueKey 생성됨.
    String key = result.proposal().resultIssueKey();
    assertThat(key).isNotNull();
    // 이슈에 AGENT 담당자 포함.
    var detail = getByKey(human, key);
    assertThat(detail.summary().assignees())
        .extracting(com.workplace.global.dto.UserSummary::id)
        .contains(agentId);
    // 결과 메시지(AGENT 작성, issueKey 포함) 추가됨.
    assertThat(countMessages(channelId)).isEqualTo(messagesBefore + 1);
    var last = lastMessage(channelId);
    assertThat(last.authorKind()).isEqualTo("AGENT");
    assertThat(last.body()).contains(key);
  }

  /** 위임자 아닌 사용자(otherHuman)의 승인 시도 → ProposalNotDelegatorException(403). */
  @Test
  void confirm_byNonDelegator_forbidden() {
    var proposal =
        proposalService.propose(
            agentId,
            channelId,
            new CreateProposalRequest("CREATE_ISSUE", "T", null, null, human, null));
    assertThatThrownBy(() -> proposalService.confirm(otherHuman, proposal.proposal().id()))
        .isInstanceOf(ProposalNotDelegatorException.class);
  }

  /** 이미 CONFIRMED 상태 → IllegalStateException. 이슈 중복 생성 없음. */
  @Test
  void confirm_alreadyResolved_isIdempotentNoDoubleIssue() {
    var proposal =
        proposalService.propose(
            agentId,
            channelId,
            new CreateProposalRequest("CREATE_ISSUE", "T", null, null, human, null));
    long id = proposal.proposal().id();
    proposalService.confirm(human, id);
    long issuesAfterFirst = countIssues();
    assertThatThrownBy(() -> proposalService.confirm(human, id))
        .isInstanceOf(IllegalStateException.class);
    assertThat(countIssues()).isEqualTo(issuesAfterFirst); // 중복 생성 없음.
  }

  /** 위임자 거부 → REJECTED, 결과 메시지 없음. */
  @Test
  void reject_byDelegator_marksRejected_noIssueNoResultMessage() {
    var proposal =
        proposalService.propose(
            agentId,
            channelId,
            new CreateProposalRequest("CREATE_ISSUE", "T", null, null, human, null));
    long messagesBefore = countMessages(channelId);
    var result = proposalService.reject(human, proposal.proposal().id());
    assertThat(result.proposal().status()).isEqualTo("REJECTED");
    assertThat(countMessages(channelId)).isEqualTo(messagesBefore); // 결과 메시지 없음.
  }
}
