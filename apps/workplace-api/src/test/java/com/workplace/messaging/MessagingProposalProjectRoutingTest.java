package com.workplace.messaging;

import static com.workplace.jooq.Tables.CHANNEL;
import static com.workplace.jooq.Tables.CHANNEL_MEMBER;
import static com.workplace.jooq.Tables.ISSUE;
import static com.workplace.jooq.Tables.ISSUE_ASSIGNEE;
import static com.workplace.jooq.Tables.ISSUE_HISTORY;
import static com.workplace.jooq.Tables.MESSAGE;
import static com.workplace.jooq.Tables.PROJECT;
import static com.workplace.jooq.Tables.PROJECT_ISSUE_SEQUENCE;
import static com.workplace.jooq.Tables.PROJECT_MEMBER;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.global.tenant.TenantContext;
import com.workplace.issue.service.IssueService;
import com.workplace.issue.service.IssueTypeService;
import com.workplace.messaging.dto.CreateProposalRequest;
import com.workplace.messaging.dto.ProjectCandidateDto;
import com.workplace.messaging.exception.InvalidDelegationProjectException;
import com.workplace.messaging.exception.NoDelegationCandidateException;
import com.workplace.messaging.repository.ChannelMemberRepository;
import com.workplace.messaging.repository.ChannelRepository;
import com.workplace.messaging.service.MessagingProposalService;
import com.workplace.project.dto.AddMemberRequest;
import com.workplace.project.repository.ProjectIssueSequenceRepository;
import com.workplace.project.repository.ProjectMemberRepository;
import com.workplace.project.repository.ProjectRepository;
import com.workplace.project.service.PersonalProjectProvisioner;
import com.workplace.project.service.ProjectService;
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
 * L3 위임 후보 프로젝트 계산 — candidateProjects(delegatorId, agentId) 통합 테스트.
 *
 * <p>PersonalProjectProvisioner.ensureDefaultPersonal 은 REQUIRES_NEW 서브 트랜잭션에서 실제 커밋하므로
 * 클래스-레벨 @Transactional 롤백과 격리되지 않는다. 따라서 이 테스트는 @Transactional 없이(non-Tx) 동작하고, 커밋된 row
 * 를 @AfterEach 에서 직접 회수한다.
 */
class MessagingProposalProjectRoutingTest extends IntegrationTestBase {

  @Autowired MessagingProposalService proposalService;
  @Autowired IssueService issueService;
  @Autowired IssueTypeService issueTypeService;
  @Autowired ProjectIssueSequenceRepository issueSequenceRepo;
  @Autowired PersonalProjectProvisioner provisioner;
  @Autowired ProjectRepository projectRepo;
  @Autowired ProjectMemberRepository projectMemberRepo;
  @Autowired ProjectService projectService;
  @Autowired ChannelRepository channelRepo;
  @Autowired ChannelMemberRepository channelMemberRepo;
  @Autowired DSLContext dsl;

  // AiAgentMessagingClient 가 MessagingAttentionDispatcher 에서 호출될 수 있으므로 모킹으로 차단.
  @MockBean com.workplace.messaging.outbound.AiAgentMessagingClient aiClient;

  // 테스트 격리: 생성된 user/project/channel id 추적 → AfterEach 회수.
  private final List<Long> createdUserIds = new ArrayList<>();
  private final List<Long> createdProjectIds = new ArrayList<>();
  private final List<Long> createdChannelIds = new ArrayList<>();

  // 공통 픽스처: 위임자(delegator), AI 에이전트(agentId), 제3의 사용자(other), 채널(channelId)
  private long delegator;
  private long agentId;
  private long other;
  private long channelId;

  @BeforeEach
  void setUp() {
    // ThreadLocal TenantContext 설정 — REQUIRES_NEW 서브 트랜잭션의 GUC 재주입에 필수.
    TenantContext.set(1L);
    // 세션 GUC 도 동일하게 설정(동일 커넥션에서 실행되는 쿼리용).
    dsl.execute("set app.tenant_id='1'");

    delegator = seedUser("routing_delegator", "HUMAN");
    agentId = seedUser("routing_agent", "AGENT");
    other = seedUser("routing_other", "HUMAN");

    // propose() 호출에 필요한 채널 — delegator + agentId 모두 멤버로 추가.
    channelId = channelRepo.insertPublic("routing-ch-" + UUID.randomUUID(), delegator);
    createdChannelIds.add(channelId);
    channelMemberRepo.add(channelId, delegator, "MEMBER");
    channelMemberRepo.add(channelId, agentId, "MEMBER");
  }

  @AfterEach
  void cleanup() {
    TenantContext.clear();
    // channel 관련 FK: message_action_proposal → message → channel_member → channel
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
    // confirm() 호출로 생성된 이슈 회수 — issue_assignee/issue_history → issue → project_issue_sequence.
    if (!createdUserIds.isEmpty()) {
      List<Long> allProjectIds =
          dsl.select(PROJECT.ID)
              .from(PROJECT)
              .where(PROJECT.OWNER_ID.in(createdUserIds))
              .fetchInto(Long.class);
      allProjectIds.addAll(createdProjectIds);
      if (!allProjectIds.isEmpty()) {
        List<Long> issueIds =
            dsl.select(ISSUE.ID)
                .from(ISSUE)
                .where(ISSUE.PROJECT_ID.in(allProjectIds))
                .fetchInto(Long.class);
        if (!issueIds.isEmpty()) {
          dsl.deleteFrom(ISSUE_ASSIGNEE).where(ISSUE_ASSIGNEE.ISSUE_ID.in(issueIds)).execute();
          dsl.deleteFrom(ISSUE_HISTORY).where(ISSUE_HISTORY.ISSUE_ID.in(issueIds)).execute();
          dsl.deleteFrom(ISSUE).where(ISSUE.ID.in(issueIds)).execute();
        }
        dsl.deleteFrom(PROJECT_ISSUE_SEQUENCE)
            .where(PROJECT_ISSUE_SEQUENCE.PROJECT_ID.in(allProjectIds))
            .execute();
      }
    }
    // project_member → project 회수 (FK 순서 준수).
    if (!createdProjectIds.isEmpty()) {
      dsl.deleteFrom(PROJECT_MEMBER)
          .where(PROJECT_MEMBER.PROJECT_ID.in(createdProjectIds))
          .execute();
      dsl.deleteFrom(PROJECT).where(PROJECT.ID.in(createdProjectIds)).execute();
    }
    // user_role → user 회수.
    if (!createdUserIds.isEmpty()) {
      // provisioner 가 생성한 개인 프로젝트도 owner_id 기반으로 정리.
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
    createdProjectIds.clear();
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
    createdUserIds.add(id);
    return id;
  }

  /**
   * TEAM 프로젝트 생성 + 소유자(ownerId)를 OWNER 멤버로 추가 + 시스템 이슈 유형 시드(TASK 포함). confirm() 에서
   * IssueService.create 가 TASK 유형을 필요로 한다.
   *
   * @return 생성된 project id
   */
  private long createTeamProject(long ownerId, String name) {
    // project.key 는 varchar(10) — 최대 10자 이내로 생성.
    String key = "T" + UUID.randomUUID().toString().replace("-", "").substring(0, 9).toUpperCase();
    var row = projectRepo.insert(key, name, null, ownerId, "TEAM", false);
    projectMemberRepo.insert(row.id(), ownerId, "OWNER");
    // IssueService.create 는 TASK 시스템 유형 + 이슈 시퀀스 행이 필요 — PersonalProjectProvisioner 와 동일하게 초기화.
    issueSequenceRepo.initialize(row.id());
    issueTypeService.seedSystemTypes(row.id());
    createdProjectIds.add(row.id());
    return row.id();
  }

  /** 위임자 기본 개인 프로젝트명 조회. */
  private String defaultPersonalName(long userId) {
    return projectRepo.findDefaultPersonal(userId).orElseThrow().name();
  }

  /** 위임자 기본 개인 프로젝트 key 조회. */
  private String personalKey(long userId) {
    return projectRepo.findDefaultPersonal(userId).orElseThrow().key();
  }

  // ── 테스트 ────────────────────────────────────────────────────────────────

  /**
   * 후보 = 위임자 기본 개인 프로젝트(맨 앞) + (D·A 둘 다 멤버인 TEAM).
   *
   * <ul>
   *   <li>팀1 (D+A 공유) → 포함
   *   <li>팀2 (D만 멤버, A 없음) → 제외
   *   <li>팀3 (A만 멤버, D 오너 아님) → 제외
   * </ul>
   */
  @Test
  void candidateProjects_personalPlusSharedTeam_excludesNonSharedTeam() {
    // 위임자(delegator) 개인 프로젝트 보장 + AI 도 멤버로 추가(개인 자동 포함 없음, 명시 추가 필수).
    provisioner.ensureDefaultPersonal(delegator);
    projectService.addMember(
        delegator, personalKey(delegator), new AddMemberRequest(agentId, "MEMBER"));

    // 팀1: D, A 둘 다 멤버 → 후보 포함.
    long t1 = createTeamProject(delegator, "공유팀");
    projectMemberRepo.insert(t1, agentId, "MEMBER");

    // 팀2: D 만 멤버(A 없음) → 제외.
    long t2 = createTeamProject(delegator, "내전용팀");

    // 팀3: other 소유, A 만 멤버(D 미가입) → 제외.
    long t3 = createTeamProject(other, "남팀");
    projectMemberRepo.insert(t3, agentId, "MEMBER");
    // t3는 other 소유/멤버 + agentId멤버이지만 delegator는 미가입 → findAllForUser(delegator) 에 안 나옴.

    var cands = proposalService.candidateProjects(delegator, agentId);
    var names = cands.stream().map(ProjectCandidateDto::name).toList();

    // 공유팀은 포함.
    assertThat(names).contains("공유팀");
    // D만 멤버인 팀 및 D 미가입 팀은 제외.
    assertThat(names).doesNotContain("내전용팀", "남팀");
    // 개인 프로젝트도 AI 멤버이므로 후보에 포함 (순서는 updated_at 기준이라 위치 비보장).
    assertThat(names).contains(defaultPersonalName(delegator));
  }

  /**
   * Task 2: AI 가 후보에 있는 projectKey 를 지정하면 그 프로젝트가 사용되어야 한다. 후보 밖 키 또는 null 이면 개인 기본(첫 후보)으로 폴백.
   *
   * <ul>
   *   <li>유효 키(팀 프로젝트) → 해당 projectKey 가 응답에 포함
   *   <li>후보 밖 키 → 개인 기본 projectKey 로 폴백
   * </ul>
   */
  @Test
  void propose_aiProjectKeyInCandidates_usesIt_elseFallsBackToPersonal() {
    // 위임자 개인 프로젝트 보장 + AI 멤버 추가(개인도 명시 추가 필수).
    provisioner.ensureDefaultPersonal(delegator);
    projectService.addMember(
        delegator, personalKey(delegator), new AddMemberRequest(agentId, "MEMBER"));

    // 팀 프로젝트 생성 + AI(agentId) 도 멤버 추가 → 후보 포함 대상.
    long t1 = createTeamProject(delegator, "공유팀");
    channelMemberRepo.add(channelId, delegator, "OWNER"); // 이미 MEMBER 지만 멱등 허용
    projectMemberRepo.insert(t1, agentId, "MEMBER");
    String teamKey = projectRepo.findById(t1).get().key();

    // 유효 후보 키 지정 → 팀 프로젝트 사용.
    var r1 =
        proposalService.propose(
            agentId,
            channelId,
            new CreateProposalRequest(
                "CREATE_ISSUE",
                "T1",
                null,
                "MID",
                teamKey,
                delegator,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null));
    assertThat(r1.proposal().projectKey()).isEqualTo(teamKey);
    // candidates 배열에 팀 프로젝트 키가 포함되어야 한다.
    assertThat(r1.proposal().candidates()).extracting(ProjectCandidateDto::key).contains(teamKey);

    // 후보 밖 키 → 첫 후보(updated_at 최신)로 폴백 — 어떤 후보든 candidates 안에 있어야 한다.
    var r2 =
        proposalService.propose(
            agentId,
            channelId,
            new CreateProposalRequest(
                "CREATE_ISSUE",
                "T2",
                null,
                "MID",
                "NOPE-999",
                delegator,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null));
    assertThat(r2.proposal().candidates())
        .extracting(ProjectCandidateDto::key)
        .contains(r2.proposal().projectKey());
  }

  /**
   * Task 2: propose 응답에 candidates 가 노출되어야 한다 — null 키(선택 없음) 시 개인 기본을 사용하면서 candidates 에 후보 목록이
   * 담긴다.
   */
  @Test
  void propose_nullProjectKey_fallsBackToPersonal_candidatesExposed() {
    // 개인 프로젝트 보장 + AI 멤버 추가(개인도 명시 추가 필수).
    provisioner.ensureDefaultPersonal(delegator);
    projectService.addMember(
        delegator, personalKey(delegator), new AddMemberRequest(agentId, "MEMBER"));
    // 팀 프로젝트 생성 + AI 멤버 → 후보 2개 이상.
    long t1 = createTeamProject(delegator, "팀A");
    projectMemberRepo.insert(t1, agentId, "MEMBER");

    var resp =
        proposalService.propose(
            agentId,
            channelId,
            new CreateProposalRequest(
                "CREATE_ISSUE",
                "후보 노출 테스트",
                null,
                "MID",
                null,
                delegator,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null));

    String personalKey = projectRepo.findDefaultPersonal(delegator).get().key();
    // null 키 → 첫 후보 폴백 — 어느 후보든 candidates 안에 있어야 한다.
    assertThat(resp.proposal().candidates())
        .extracting(ProjectCandidateDto::key)
        .contains(resp.proposal().projectKey());
    // candidates 에 개인 + 팀 모두 포함.
    assertThat(resp.proposal().candidates()).hasSizeGreaterThanOrEqualTo(2);
    assertThat(resp.proposal().candidates())
        .extracting(ProjectCandidateDto::key)
        .contains(personalKey, projectRepo.findById(t1).get().key());
  }

  /**
   * Task 3: confirm 시 팀 프로젝트 override — 제안이 개인 프로젝트로 저장됐어도 팀 프로젝트 키로 승인 가능. 이슈가 팀 프로젝트에 생성되고 AI 가
   * 담당.
   */
  @Test
  void confirm_projectKeyOverride_createsInChosenTeamProject_withAiAssignee() {
    // 위임자 개인 프로젝트 보장 + AI 멤버 추가(개인도 명시 추가 필수).
    provisioner.ensureDefaultPersonal(delegator);
    projectService.addMember(
        delegator, personalKey(delegator), new AddMemberRequest(agentId, "MEMBER"));

    // 팀 프로젝트 생성 + delegator, agentId 둘 다 멤버 → 후보 포함.
    long t1 = createTeamProject(delegator, "공유팀");
    projectMemberRepo.insert(t1, agentId, "MEMBER");
    String teamKey = projectRepo.findById(t1).get().key();

    // 개인 프로젝트로 제안 생성(projectKey=null → 개인 기본, AI 멤버이므로 후보에 포함됨).
    var prop =
        proposalService.propose(
            agentId,
            channelId,
            new CreateProposalRequest(
                "CREATE_ISSUE",
                "팀 작업",
                null,
                "HIGH",
                null,
                delegator,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null));

    // confirm 시 teamKey 로 override.
    var res = proposalService.confirm(delegator, prop.proposal().id(), teamKey);

    // resultIssueKey 가 팀 프로젝트 키로 시작해야 한다.
    String issueKey = res.proposal().resultIssueKey();
    assertThat(issueKey).startsWith(teamKey + "-");

    // 이슈가 팀 프로젝트에 생성되고 AI(agentId) 가 담당자.
    int number = Integer.parseInt(issueKey.substring(issueKey.lastIndexOf('-') + 1));
    var issue = issueService.get(delegator, teamKey, number);
    assertThat(issue.summary().assignees())
        .extracting(com.workplace.global.dto.UserSummary::id)
        .contains(agentId);
  }

  /**
   * Task 3 (Review fix): override 없을 때도 저장 projectKey 재검증 — propose 후 팀 프로젝트에서 AGENT 를 제거하면 저장된
   * projectKey 가 스테일되어 InvalidDelegationProjectException 을 던져야 한다. (NoOverride 경로 일관성 보장)
   */
  @Test
  void confirm_storedProjectKeyStale_noOverride_throwsInvalidDelegationProjectException() {
    // 위임자 개인 프로젝트 보장(팀 제안 시 개인 미사용이라도 ensureDefaultPersonal 은 유지).
    provisioner.ensureDefaultPersonal(delegator);

    // 팀 프로젝트 생성 + delegator·agentId 둘 다 멤버 → 처음엔 후보 포함.
    long teamProjectId = createTeamProject(delegator, "스테일팀");
    projectMemberRepo.insert(teamProjectId, agentId, "MEMBER");
    String teamKey = projectRepo.findById(teamProjectId).get().key();

    // 팀 프로젝트 키로 제안 생성(제안 저장값 = teamKey).
    var prop =
        proposalService.propose(
            agentId,
            channelId,
            new CreateProposalRequest(
                "CREATE_ISSUE",
                "스테일 테스트 이슈",
                null,
                "MID",
                teamKey,
                delegator,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null));
    assertThat(prop.proposal().projectKey()).isEqualTo(teamKey);

    // propose → confirm 사이에 AGENT 를 팀 프로젝트에서 제거 → 저장된 teamKey 가 스테일됨.
    projectMemberRepo.delete(teamProjectId, agentId);

    // override 없이 confirm → 저장된 스테일 키가 후보 재검증에서 탈락 → InvalidDelegationProjectException.
    assertThatThrownBy(() -> proposalService.confirm(delegator, prop.proposal().id(), null))
        .isInstanceOf(InvalidDelegationProjectException.class);
  }

  /**
   * Task 2: candidateProjects — AI 가 멤버인 프로젝트만 후보. 개인 자동 포함 없음 — 명시 추가 후에만 후보.
   *
   * <ul>
   *   <li>AGENT 멤버 추가 전 → 빈 목록
   *   <li>개인 프로젝트에 AGENT 추가 후 → 개인 프로젝트 포함
   * </ul>
   */
  @Test
  void candidateProjects_onlyProjectsWhereAgentIsMember_personalIncludedWhenAgentMember() {
    // 개인 프로젝트 생성(AGENT 아직 멤버 아님).
    provisioner.ensureDefaultPersonal(delegator);

    // AGENT 멤버 추가 전 → 후보 없음.
    assertThat(proposalService.candidateProjects(delegator, agentId)).isEmpty();

    // 개인 프로젝트에 AGENT 명시 추가 → 후보에 개인 프로젝트 포함.
    projectService.addMember(
        delegator, personalKey(delegator), new AddMemberRequest(agentId, "MEMBER"));
    assertThat(proposalService.candidateProjects(delegator, agentId))
        .extracting(ProjectCandidateDto::key)
        .contains(personalKey(delegator));
  }

  /** Task 2: propose — AGENT 가 어느 프로젝트 멤버도 아니면 NoDelegationCandidateException(400) 반환. */
  @Test
  void propose_noCandidates_throwsNoDelegationCandidate() {
    // 개인 프로젝트는 있으나 AGENT 는 멤버 아님 → 후보 없음 → 위임 불가.
    provisioner.ensureDefaultPersonal(delegator);

    assertThatThrownBy(
            () ->
                proposalService.propose(
                    agentId,
                    channelId,
                    new CreateProposalRequest(
                        "CREATE_ISSUE",
                        "테스트",
                        null,
                        "MID",
                        null,
                        delegator,
                        null,
                        null,
                        null,
                        null,
                        null,
                        null,
                        null,
                        null)))
        .isInstanceOf(NoDelegationCandidateException.class);
  }

  /** Task 3: confirm 시 후보 밖 projectKey override → InvalidDelegationProjectException(400 상당). */
  @Test
  void confirm_projectKeyOutsideCandidates_throwsInvalidDelegationProjectException() {
    // 위임자 개인 프로젝트 보장 + AI 멤버 추가(개인도 명시 추가 필수).
    provisioner.ensureDefaultPersonal(delegator);
    projectService.addMember(
        delegator, personalKey(delegator), new AddMemberRequest(agentId, "MEMBER"));

    // 제안 생성(개인 기본 프로젝트, AI 멤버이므로 후보 포함됨).
    var prop =
        proposalService.propose(
            agentId,
            channelId,
            new CreateProposalRequest(
                "CREATE_ISSUE",
                "T",
                null,
                "MID",
                null,
                delegator,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null));

    // 후보 밖 키로 override → InvalidDelegationProjectException.
    assertThatThrownBy(() -> proposalService.confirm(delegator, prop.proposal().id(), "NOPE-999"))
        .isInstanceOf(InvalidDelegationProjectException.class);
  }
}
