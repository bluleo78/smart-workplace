package com.workplace.messaging;

import static com.workplace.jooq.Tables.CHANNEL;
import static com.workplace.jooq.Tables.CHANNEL_MEMBER;
import static com.workplace.jooq.Tables.MESSAGE;
import static com.workplace.jooq.Tables.PROJECT;
import static com.workplace.jooq.Tables.PROJECT_MEMBER;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.global.tenant.TenantContext;
import com.workplace.messaging.dto.CreateMessageRequest;
import com.workplace.messaging.dto.CreateProposalRequest;
import com.workplace.messaging.exception.ChannelNotMemberException;
import com.workplace.messaging.exception.InvalidThreadParentException;
import com.workplace.messaging.repository.ChannelMemberRepository;
import com.workplace.messaging.repository.ChannelRepository;
import com.workplace.messaging.service.MessageService;
import com.workplace.messaging.service.MessagingProposalService;
import com.workplace.project.dto.AddMemberRequest;
import com.workplace.project.repository.ProjectMemberRepository;
import com.workplace.project.repository.ProjectRepository;
import com.workplace.project.service.PersonalProjectProvisioner;
import com.workplace.project.service.ProjectService;
import com.workplace.support.ExternalClientMockedTestBase;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

/**
 * MessagingProposalService.propose 통합 테스트 (L3 위임 슬라이스 1, Task 3).
 *
 * <p>PersonalProjectProvisioner.ensureDefaultPersonal 은 REQUIRES_NEW 서브 트랜잭션에서 실제 커밋하므로
 * 클래스-레벨 @Transactional 롤백과 격리되지 않는다. 따라서 이 테스트는 @Transactional 없이(non-Tx) 동작하고, 커밋된 row
 * 를 @AfterEach 에서 직접 회수한다.
 *
 * <p>tenant 는 TenantContext(ThreadLocal) 로 주입 — REQUIRES_NEW 서브 트랜잭션 doBegin 에서 GUC 재설정에 사용.
 */
class MessagingProposalServiceTest extends ExternalClientMockedTestBase {

  @Autowired MessagingProposalService proposalService;
  @Autowired MessageService messageService;
  @Autowired PersonalProjectProvisioner provisioner;
  @Autowired ProjectRepository projectRepo;
  @Autowired ProjectMemberRepository projectMemberRepo;
  @Autowired ProjectService projectService;
  @Autowired ChannelRepository channelRepo;
  @Autowired ChannelMemberRepository memberRepo;
  @Autowired DSLContext dsl;

  @Autowired com.workplace.messaging.outbound.AiAgentMessagingClient aiClient;

  // 테스트 격리: 생성된 user/channel id 추적 → AfterEach 회수.
  private final List<Long> createdUserIds = new ArrayList<>();
  private final List<Long> createdChannelIds = new ArrayList<>();

  private long human;
  private long agentId;
  private long channelId;

  @BeforeEach
  void setUp() {
    // ThreadLocal TenantContext 설정 — REQUIRES_NEW 서브 트랜잭션의 GUC 재주입에 필수.
    TenantContext.set(1L);
    // 세션 GUC 도 동일하게 설정(동일 커넥션에서 실행되는 쿼리용).
    dsl.execute("set app.tenant_id='1'");

    // HUMAN 위임자 생성.
    human = seedUser("proposal_human", "HUMAN");
    // AGENT 생성 (IntegrationTestBase.createAgentUser 재사용 불가 — createdUserIds 추적 필요).
    agentId = seedUser("proposal_agent", "AGENT");
    // 채널 생성 + 두 사용자 멤버 추가.
    channelId = channelRepo.insertPublic("proposal-ch-" + UUID.randomUUID(), human);
    createdChannelIds.add(channelId);
    memberRepo.add(channelId, human, "MEMBER");
    memberRepo.add(channelId, agentId, "MEMBER");

    // 위임자(human)의 기본 개인 프로젝트 프로비저닝 (REQUIRES_NEW 서브 트랜잭션으로 커밋됨).
    provisioner.ensureDefaultPersonal(human);
    // 개인 프로젝트에 AI 멤버 추가 — 개인 자동 포함 없음, 명시 추가 필수(#418 정책 통일).
    String humanPersonalKey = projectRepo.findDefaultPersonal(human).orElseThrow().key();
    projectService.addMember(human, humanPersonalKey, new AddMemberRequest(agentId, "MEMBER"));
  }

  @AfterEach
  void cleanup() {
    TenantContext.clear();
    // channel_member, message, channel 회수 (FK 순서 준수).
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
    // project_member → project → user_role → user 회수 (FK 순서).
    if (!createdUserIds.isEmpty()) {
      // project_member 먼저 삭제(FK: project_member.project_id → project.id).
      dsl.deleteFrom(PROJECT_MEMBER)
          .where(
              PROJECT_MEMBER.PROJECT_ID.in(
                  dsl.select(PROJECT.ID).from(PROJECT).where(PROJECT.OWNER_ID.in(createdUserIds))))
          .execute();
      dsl.deleteFrom(PROJECT).where(PROJECT.OWNER_ID.in(createdUserIds)).execute();
      dsl.deleteFrom(USER_ROLE).where(USER_ROLE.USER_ID.in(createdUserIds)).execute();
      dsl.deleteFrom(USER).where(USER.ID.in(createdUserIds)).execute();
    }
    createdUserIds.clear();
    createdChannelIds.clear();
  }

  // ── 헬퍼 ──────────────────────────────────────────────────────────────────

  /** UUID suffix 유니크 유저 INSERT. USER_ROLE("USER") 함께 부여 — RLS 권한 분기 통과. */
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
    // 테넌트#1 ACTIVE 멤버십 — MembershipGuard(#713) 가 addMember 대상의 테넌트 소속을 검증하므로 필요.
    dsl.insertInto(com.workplace.jooq.Tables.MEMBERSHIP)
        .set(com.workplace.jooq.Tables.MEMBERSHIP.USER_ID, id)
        .set(com.workplace.jooq.Tables.MEMBERSHIP.TENANT_ID, 1L)
        .set(com.workplace.jooq.Tables.MEMBERSHIP.STATUS, "ACTIVE")
        .execute();
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

  /** 위임자 기본 개인 프로젝트명 조회. */
  private String defaultPersonalProjectName(long userId) {
    return projectRepo.findDefaultPersonal(userId).orElseThrow().name();
  }

  /** human 이 채널에 일반 메시지 작성 후 메시지 id 반환. */
  private long postMessage(long userId, long chId, String body) {
    return messageService.create(userId, chId, new CreateMessageRequest(body)).id();
  }

  // ── 테스트 ────────────────────────────────────────────────────────────────

  /** propose() 호출 시 AGENT 메시지 1건이 추가되고, proposal 이 enrich 돼 반환된다. 위임자 개인 프로젝트가 기본값으로 설정된다. */
  @Test
  void propose_postsAgentMessageAndProposalRow_withDefaultPersonalProject() {
    long messageBefore = countMessages(channelId);
    var resp =
        proposalService.propose(
            agentId,
            channelId,
            new CreateProposalRequest(
                "CREATE_ISSUE",
                "로그인 버그 고치기",
                "상세 본문",
                "HIGH",
                null,
                human,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null));

    // 메시지 1건(AGENT 작성) 추가됨.
    assertThat(countMessages(channelId)).isEqualTo(messageBefore + 1);
    assertThat(resp.authorKind()).isEqualTo("AGENT");
    // proposal enrich 됨.
    assertThat(resp.proposal()).isNotNull();
    assertThat(resp.proposal().status()).isEqualTo("PENDING");
    assertThat(resp.proposal().title()).isEqualTo("로그인 버그 고치기");
    assertThat(resp.proposal().proposedByUserId()).isEqualTo(human);
    // 프로젝트 기본값 = 위임자 개인 프로젝트명.
    assertThat(resp.proposal().projectName()).isEqualTo(defaultPersonalProjectName(human));
  }

  /** parentMessageId 를 지정하면 스레드 미러 — 응답의 parentMessageId 가 루트와 일치해야 한다. */
  /** WP-589: 제안 카드는 AI 만 만든다 — 사람이 다른 멤버를 위임자로 「AI 제안」을 만들면 위임자가 AI 제안으로 믿고 승인하게 된다. */
  @Test
  void propose_byHuman_isRejected() {
    long other = seedUser("proposal_other", "HUMAN");
    memberRepo.add(channelId, other, "MEMBER");
    var req =
        new CreateProposalRequest(
            "CREATE_ISSUE",
            "사람이 만든 제안",
            null,
            null,
            null,
            human,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null);

    assertThatThrownBy(() -> proposalService.propose(other, channelId, req))
        .isInstanceOf(com.workplace.messaging.exception.ProposalAgentOnlyException.class)
        .hasMessage("AI 제안은 AI 만 만들 수 있습니다");
    assertThatThrownBy(() -> proposalService.candidateProjectsForAgent(other, human))
        .isInstanceOf(com.workplace.messaging.exception.ProposalAgentOnlyException.class);
  }

  @Test
  void propose_inThread_mirrorsParent() {
    long root = postMessage(human, channelId, "스레드 루트");
    var resp =
        proposalService.propose(
            agentId,
            channelId,
            new CreateProposalRequest(
                "CREATE_ISSUE",
                "T",
                null,
                null,
                null,
                human,
                root,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null));
    assertThat(resp.parentMessageId()).isEqualTo(root);
  }

  /**
   * Fix 1: proposedByUserId 가 채널 비멤버이면 ChannelNotMemberException 을 던져야 한다.
   *
   * <p>outsider 는 채널에 join 하지 않은 상태이므로 채널 밖 위임자 스푸핑 방어가 동작함을 검증한다.
   */
  @Test
  void propose_nonMemberDelegator_throwsChannelNotMemberException() {
    // 채널에 가입하지 않은 외부 사용자.
    long outsider = seedUser("outsider_human", "HUMAN");
    // outsider 는 provisioner 호출 없음 — 멤버십 검사가 프로비저닝 이전에 차단해야 한다.

    assertThatThrownBy(
            () ->
                proposalService.propose(
                    agentId,
                    channelId,
                    new CreateProposalRequest(
                        "CREATE_ISSUE",
                        "T",
                        null,
                        null,
                        null,
                        outsider,
                        null,
                        null,
                        null,
                        null,
                        null,
                        null,
                        null,
                        null,
                        null)))
        .isInstanceOf(ChannelNotMemberException.class);
  }

  /**
   * AI 가 멤버인 개인 프로젝트가 있으면 propose() 가 성공해야 한다.
   *
   * <p>Task 2: 개인 자동 포함 폐기 — AI 가 명시적으로 멤버 추가된 경우에만 후보가 되어 propose 성공. 미추가 시
   * NoDelegationCandidateException.
   */
  @Test
  void propose_delegatorPersonalProjectWithAgentMember_succeeds() {
    // setUp() 에서 human 의 프로젝트를 프로비저닝하고 AI 를 멤버로 추가했으므로 별도의 신규 사용자를 생성해 독립 검증.
    long freshHuman = seedUser("fresh_human", "HUMAN");
    memberRepo.add(channelId, freshHuman, "MEMBER");
    // freshHuman 의 기본 개인 프로젝트 프로비저닝 + AI 명시 추가.
    provisioner.ensureDefaultPersonal(freshHuman);
    String freshPersonalKey = projectRepo.findDefaultPersonal(freshHuman).orElseThrow().key();
    projectService.addMember(freshHuman, freshPersonalKey, new AddMemberRequest(agentId, "MEMBER"));

    var resp =
        proposalService.propose(
            agentId,
            channelId,
            new CreateProposalRequest(
                "CREATE_ISSUE",
                "AI 멤버 프로젝트 테스트",
                null,
                null,
                null,
                freshHuman,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null));

    // 제안이 성공하고 AI 가 멤버인 개인 프로젝트가 사용되어야 한다.
    assertThat(resp.proposal()).isNotNull();
    assertThat(resp.proposal().status()).isEqualTo("PENDING");
    assertThat(resp.proposal().projectName())
        .isEqualTo(projectRepo.findDefaultPersonal(freshHuman).orElseThrow().name());
  }

  // ── WP-726: 제안의 스레드 부모·actionType 검증 ────────────────────────────────

  private CreateProposalRequest issueProposal(String actionType, Long parentMessageId) {
    return new CreateProposalRequest(
        actionType,
        "스레드 교차",
        null,
        null,
        null,
        human,
        parentMessageId,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null);
  }

  /** 다른 채널 메시지를 스레드 부모로 줄 수 없다 — 그 채널 멤버에게 비공개 채널의 제안 카드가 보였다. */
  @Test
  void propose_parentInOtherChannel_rejected() {
    long other = channelRepo.insertPublic("proposal-other-" + UUID.randomUUID(), human);
    createdChannelIds.add(other);
    memberRepo.add(other, human, "MEMBER");
    long foreignParent = postMessage(human, other, "다른 채널 글");
    long before = countMessages(channelId);

    assertThatThrownBy(
            () ->
                proposalService.propose(
                    agentId, channelId, issueProposal("CREATE_ISSUE", foreignParent)))
        .isInstanceOf(InvalidThreadParentException.class);
    assertThat(countMessages(channelId)).isEqualTo(before);
    assertThat(countMessages(other)).isEqualTo(1);
  }

  /** 답글을 부모로 줄 수도 없다(대댓글 금지 — 일반 메시지와 같은 규칙). 같은 채널 최상위 메시지는 그대로 된다. */
  @Test
  void propose_parentMustBeTopLevelInSameChannel() {
    long root = postMessage(human, channelId, "최상위 글");
    long reply =
        messageService
            .create(human, channelId, new CreateMessageRequest("답글", root, List.of(), List.of()))
            .id();

    assertThatThrownBy(
            () -> proposalService.propose(agentId, channelId, issueProposal("CREATE_ISSUE", reply)))
        .isInstanceOf(InvalidThreadParentException.class);
    var ok = proposalService.propose(agentId, channelId, issueProposal("CREATE_ISSUE", root));
    assertThat(ok.parentMessageId()).isEqualTo(root);
  }

  /** 스레드 답글 조회는 부모와 다른 채널의 답글을 내보내지 않는다(방어 — 예전에 잘못 붙은 행). */
  @Test
  void listThread_skipsRepliesFromOtherChannel() {
    long other = channelRepo.insertPublic("proposal-other-" + UUID.randomUUID(), human);
    createdChannelIds.add(other);
    memberRepo.add(other, human, "MEMBER");
    long root = postMessage(human, other, "다른 채널 글");
    // 예전 결함으로 채널 A 메시지가 채널 B 메시지의 답글로 붙은 상태를 직접 만든다.
    dsl.insertInto(MESSAGE)
        .set(MESSAGE.CHANNEL_ID, channelId)
        .set(MESSAGE.AUTHOR_ID, agentId)
        .set(MESSAGE.BODY, "비공개 채널 제안")
        .set(MESSAGE.PARENT_MESSAGE_ID, root)
        .execute();

    var page = messageService.listThread(human, root, null, 50);

    assertThat(page.items()).noneMatch(m -> m.channelId() == channelId);
  }

  /** actionType 은 CREATE_ISSUE·calendar.create_event 만 — 임의 값(DELETE_ALL)이 이슈 생성 제안으로 저장·승인됐다. */
  @Test
  void createProposalRequest_unknownActionType_invalid() {
    var validator = jakarta.validation.Validation.buildDefaultValidatorFactory().getValidator();
    assertThat(validator.validate(issueProposal("DELETE_ALL", null)))
        .anyMatch(v -> v.getPropertyPath().toString().equals("actionType"));
    assertThat(validator.validate(issueProposal("CREATE_ISSUE", null))).isEmpty();
    assertThat(validator.validate(issueProposal("calendar.create_event", null)))
        .noneMatch(v -> v.getPropertyPath().toString().equals("actionType"));
  }
}
