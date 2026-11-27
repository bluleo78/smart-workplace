package com.workplace.airun.capacity;

import static com.workplace.jooq.Tables.AGENT_ACCOUNT;
import static com.workplace.jooq.Tables.AGENT_WORK;
import static com.workplace.jooq.Tables.AI_CAPACITY_SAMPLE;
import static com.workplace.jooq.Tables.EMAIL_ACCOUNT;
import static com.workplace.jooq.Tables.EMAIL_CONTENT;
import static com.workplace.jooq.Tables.FILE;
import static com.workplace.jooq.Tables.FILE_EXTRACTION;
import static com.workplace.jooq.Tables.ISSUE;
import static com.workplace.jooq.Tables.ISSUE_ASSIGNEE;
import static com.workplace.jooq.Tables.ISSUE_LABEL;
import static com.workplace.jooq.Tables.LABEL;
import static com.workplace.jooq.Tables.PROJECT;
import static com.workplace.jooq.Tables.TENANT;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.support.TestFixtures.uniqueProjectKey;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.within;
import static org.mockito.Mockito.when;

import com.workplace.agentaccount.usage.AgentAccountUsageRepository;
import com.workplace.agentaccount.usage.UsageSnapshot;
import com.workplace.agentaccount.usage.UsageWindow;
import com.workplace.auth.service.AssistantResolver;
import com.workplace.auth.service.AssistantSpec;
import com.workplace.issue.dto.CreateIssueRequest;
import com.workplace.issue.service.IssueService;
import com.workplace.mail.repository.EmailContentRepository;
import com.workplace.mail.service.MailAnalysisFixtures;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.dto.ProjectResponse;
import com.workplace.project.service.ProjectService;
import com.workplace.support.ExternalClientMockedTestBase;
import com.workplace.support.TestFixtures;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/**
 * WP-1830 AI 처리 1분 표본 수집기 통합 테스트. 수집기는 테넌트 트랜잭션 안에서 도는 비-@Transactional 흐름이라 시드는 커밋하고 @AfterEach 로
 * 지운다. 테스트 DB 는 클래스끼리 공유되므로(테넌트 1 에 다른 AI·계정·메일이 있을 수 있다) 수치는 시드 전 기준 표본 대비 증가분으로 확인한다.
 */
class AiCapacitySamplerTest extends ExternalClientMockedTestBase {

  @Autowired AiCapacitySampler sampler;
  @Autowired DSLContext dsl;
  @Autowired ObjectMapper om;
  @Autowired IssueService issueService;
  @Autowired ProjectService projectService;
  @Autowired EmailContentRepository contentRepo;
  @Autowired AgentAccountUsageRepository usageRepo;

  /** 테스트 공통 목(mock) — 워크스페이스 비서 유무를 테스트마다 정한다(기본은 비서 없음). */
  @Autowired AssistantResolver assistantResolver;

  /** 정리 대상 id — 시드하면서 모아 @AfterEach 가 지운다. */
  private final List<Long> agents = new ArrayList<>();

  private final List<Long> humans = new ArrayList<>();
  private final List<Long> projects = new ArrayList<>();
  private final List<Long> accounts = new ArrayList<>();
  private final List<Long> mailAccounts = new ArrayList<>();
  private final List<Long> contents = new ArrayList<>();
  private final List<Long> files = new ArrayList<>();
  private final List<OffsetDateTime> sampledTimes = new ArrayList<>();

  @AfterEach
  void cleanup() {
    cleanupInTenant(
        1L,
        () -> {
          dsl.deleteFrom(AI_CAPACITY_SAMPLE)
              .where(AI_CAPACITY_SAMPLE.SAMPLED_AT.in(sampledTimes))
              .execute();
          dsl.deleteFrom(AI_CAPACITY_SAMPLE)
              .where(
                  AI_CAPACITY_SAMPLE.SAMPLED_AT.ge(
                      OffsetDateTime.now().truncatedTo(ChronoUnit.MINUTES).minusSeconds(1)))
              .execute();
          dsl.deleteFrom(AGENT_WORK).where(AGENT_WORK.WORKER_ID.in(agents)).execute();
          dsl.deleteFrom(ISSUE_LABEL)
              .where(
                  ISSUE_LABEL.ISSUE_ID.in(
                      dsl.select(ISSUE.ID).from(ISSUE).where(ISSUE.PROJECT_ID.in(projects))))
              .execute();
          dsl.deleteFrom(ISSUE_ASSIGNEE)
              .where(
                  ISSUE_ASSIGNEE.ISSUE_ID.in(
                      dsl.select(ISSUE.ID).from(ISSUE).where(ISSUE.PROJECT_ID.in(projects))))
              .execute();
          dsl.deleteFrom(ISSUE).where(ISSUE.PROJECT_ID.in(projects)).execute();
          dsl.deleteFrom(LABEL).where(LABEL.PROJECT_ID.in(projects)).execute();
          dsl.deleteFrom(PROJECT).where(PROJECT.ID.in(projects)).execute();
          dsl.deleteFrom(AGENT_ACCOUNT).where(AGENT_ACCOUNT.ID.in(accounts)).execute();
          dsl.deleteFrom(EMAIL_ACCOUNT).where(EMAIL_ACCOUNT.ID.in(mailAccounts)).execute();
          dsl.deleteFrom(EMAIL_CONTENT).where(EMAIL_CONTENT.ID.in(contents)).execute();
          dsl.deleteFrom(FILE_EXTRACTION).where(FILE_EXTRACTION.FILE_ID.in(files)).execute();
          dsl.deleteFrom(FILE).where(FILE.ID.in(files)).execute();
          dsl.deleteFrom(USER).where(USER.ID.in(agents)).execute();
          dsl.deleteFrom(USER).where(USER.ID.in(humans)).execute();
        });
  }

  /** 테넌트 1 에서 표본 한 건을 만들고 그 행을 읽는다. */
  private AiCapacitySampleRow sampleAndRead(OffsetDateTime at) {
    sampledTimes.add(at);
    return callInTenant(
        1L,
        () -> {
          sampler.sampleTenant(1L, at);
          return readRow(at);
        });
  }

  private AiCapacitySampleRow readRow(OffsetDateTime at) {
    var r =
        dsl.selectFrom(AI_CAPACITY_SAMPLE).where(AI_CAPACITY_SAMPLE.SAMPLED_AT.eq(at)).fetchOne();
    try {
      return new AiCapacitySampleRow(
          r.getSlotUsed(),
          r.getSlotLimit(),
          r.getQueueWaiting(),
          r.getQueueOldestWaitSec(),
          om.readTree(r.getAccountUsage().data()),
          om.readTree(r.getBacklog().data()));
    } catch (Exception e) {
      throw new IllegalStateException(e);
    }
  }

  private record AiCapacitySampleRow(
      int slotUsed,
      int slotLimit,
      int queueWaiting,
      Integer oldestWaitSec,
      JsonNode accountUsage,
      JsonNode backlog) {}

  @Test
  void sample_writesSlotQueueAccountBacklog() {
    OffsetDateTime now = OffsetDateTime.now().truncatedTo(ChronoUnit.MINUTES);
    // 두 번째 표본 시각(과거로 둬 다른 표본과 겹치지 않게). 대기열 라벨은 지금 기준 10분 전 — 기다린 시간은 수집 시점의 지금 시각으로 잰다.
    OffsetDateTime sampleAt = now.minusHours(2);
    // 워크스페이스 비서가 있는 테넌트 — 파일 요약 대기도 센다(비서가 없으면 요약기가 집지 않아 0).
    when(assistantResolver.resolveWorkspaceOrEmpty())
        .thenReturn(Optional.of(new AssistantSpec(777L, "test-model", "NORMAL", 8)));
    when(assistantResolver.hasWorkspaceAssistant()).thenReturn(true);
    var base = sampleAndRead(now.minusHours(3));

    // AI 둘(상한 기본 5+5) — 한 AI 에 진행 중(WORKING) 작업 1건.
    long agentA = agent("cap-a");
    agent("cap-b");
    long owner = human();
    ProjectResponse p = callInTenant(1L, () -> project(owner));
    long workIssue = callInTenant(1L, () -> issue(owner, p, "진행 중"));
    callInTenant(
        1L,
        () ->
            dsl.insertInto(AGENT_WORK)
                .set(AGENT_WORK.ISSUE_ID, workIssue)
                .set(AGENT_WORK.WORKER_ID, agentA)
                .set(AGENT_WORK.TOOL, "claude-code")
                .set(AGENT_WORK.STATE, "WORKING")
                .execute());

    // 대기열 이슈 1건 — 라벨 붙인 지 10분(기본 라벨 「AI 개발팀」).
    long queued = callInTenant(1L, () -> issue(owner, p, "대기열"));
    callInTenant(
        1L,
        () -> {
          long label =
              dsl.insertInto(LABEL)
                  .set(LABEL.PROJECT_ID, p.id())
                  .set(LABEL.NAME, "AI 개발팀")
                  .set(LABEL.COLOR_TOKEN, "blue")
                  .returning(LABEL.ID)
                  .fetchOne()
                  .getId();
          dsl.deleteFrom(ISSUE_ASSIGNEE).where(ISSUE_ASSIGNEE.ISSUE_ID.eq(queued)).execute();
          dsl.insertInto(ISSUE_LABEL)
              .set(ISSUE_LABEL.ISSUE_ID, queued)
              .set(ISSUE_LABEL.LABEL_ID, label)
              .set(ISSUE_LABEL.CREATED_AT, OffsetDateTime.now().minusMinutes(10))
              .execute();
          return null;
        });

    // AI 계정 1개 — 5h 42.00 · 7d 10.00.
    Instant observed = Instant.now().truncatedTo(ChronoUnit.SECONDS).minusSeconds(120);
    String accountLabel = "cap-acct-" + UUID.randomUUID().toString().substring(0, 8);
    callInTenant(
        1L,
        () -> {
          long acc =
              dsl.insertInto(AGENT_ACCOUNT)
                  .set(AGENT_ACCOUNT.PROVIDER, "claude")
                  .set(AGENT_ACCOUNT.LABEL, accountLabel)
                  .set(AGENT_ACCOUNT.ENCRYPTED_SECRET, "x")
                  .returning(AGENT_ACCOUNT.ID)
                  .fetchOne()
                  .getId();
          accounts.add(acc);
          usageRepo.saveSuccess(
              acc,
              List.of(
                  new UsageSnapshot(
                      UsageWindow.FIVE_HOUR, new BigDecimal("42.00"), null, null, observed),
                  new UsageSnapshot(
                      UsageWindow.WEEKLY, new BigDecimal("10.00"), null, null, observed)),
              false);
          return null;
        });

    // 미분류 메일 1 · 요약 대기 파일 1.
    callInTenant(
        1L,
        () -> {
          var box = MailAnalysisFixtures.mailbox(dsl, true);
          mailAccounts.add(box.accountId());
          humans.add(box.userId());
          long c =
              MailAnalysisFixtures.content(
                  dsl,
                  contentRepo,
                  MailAnalysisFixtures.SHORT_BODY,
                  MailAnalysisFixtures.SHORT_BODY);
          contents.add(c);
          MailAnalysisFixtures.envelope(dsl, box, c, "a@ext.com", box.address(), null);
          String s = UUID.randomUUID().toString().replace("-", "").substring(0, 12);
          long fileId =
              dsl.insertInto(FILE)
                  .set(FILE.ORIGINAL_NAME, "cap-" + s + ".txt")
                  .set(FILE.STORED_NAME, "stored_" + s)
                  .set(FILE.MIME_TYPE, "text/plain")
                  .set(FILE.SIZE_BYTES, 10L)
                  .set(FILE.STORAGE_PATH, "/data/uploads/" + s)
                  .set(FILE.UPLOADED_BY, owner)
                  .returning(FILE.ID)
                  .fetchOne()
                  .getId();
          files.add(fileId);
          dsl.insertInto(FILE_EXTRACTION)
              .set(FILE_EXTRACTION.FILE_ID, fileId)
              .set(FILE_EXTRACTION.STATUS, "TEXT_READY")
              .set(FILE_EXTRACTION.TENANT_ID, 1L)
              .execute();
          return null;
        });

    var after = sampleAndRead(sampleAt);

    assertThat(after.slotUsed() - base.slotUsed()).isEqualTo(1);
    assertThat(after.slotLimit() - base.slotLimit()).isEqualTo(10);
    assertThat(after.queueWaiting() - base.queueWaiting()).isEqualTo(1);
    // 기준 시점에 다른 대기열 이슈가 없으면 가장 오래 기다린 것이 이번 이슈(600초) — 있으면 그보다 길 수 있다.
    assertThat(after.oldestWaitSec()).isGreaterThanOrEqualTo(600 - 5);
    if (base.queueWaiting() == 0) {
      assertThat(after.oldestWaitSec()).isCloseTo(600, within(5));
    }
    List<JsonNode> mine = new ArrayList<>();
    after
        .accountUsage()
        .forEach(
            n -> {
              if (accountLabel.equals(n.get("label").asText())) mine.add(n);
            });
    assertThat(mine).hasSize(2);
    mine.sort(java.util.Comparator.comparing(n -> n.get("window").asText()));
    assertThat(mine.get(0).get("window").asText()).isEqualTo("5h");
    assertThat(mine.get(0).get("usedPercent").asDouble()).isEqualTo(42.0);
    assertThat(mine.get(1).get("window").asText()).isEqualTo("7d");
    assertThat(mine.get(1).get("usedPercent").asDouble()).isEqualTo(10.0);
    assertThat(Instant.parse(mine.get(0).get("observedAt").asText())).isEqualTo(observed);
    assertThat(Instant.parse(mine.get(1).get("observedAt").asText())).isEqualTo(observed);
    assertThat(
            after.backlog().get("MAIL_CLASSIFY").asInt()
                - base.backlog().get("MAIL_CLASSIFY").asInt())
        .isEqualTo(1);
    assertThat(
            after.backlog().get("FILE_SUMMARY").asInt()
                - base.backlog().get("FILE_SUMMARY").asInt())
        .isEqualTo(1);

    // 비서가 없으면 같은 TEXT_READY 파일이 있어도 파일 요약 대기는 늘지 않는다(요약기가 집지 않는다).
    when(assistantResolver.resolveWorkspaceOrEmpty()).thenReturn(Optional.empty());
    when(assistantResolver.hasWorkspaceAssistant()).thenReturn(false);
    var noAssistant = sampleAndRead(now.minusHours(1));
    assertThat(noAssistant.backlog().get("FILE_SUMMARY").asInt()).isZero();
  }

  @Test
  void sample_emptyTenant_zerosAndEmptyJson() {
    // 새 테넌트 — 다른 클래스가 남긴 AI·계정·메일과 섞이지 않는다.
    long tid = TestFixtures.createTenant(baseDsl, "ACTIVE");
    OffsetDateTime at = OffsetDateTime.now().truncatedTo(ChronoUnit.MINUTES).minusHours(4);
    try {
      var row =
          callInTenant(
              tid,
              () -> {
                sampler.sampleTenant(tid, at);
                return readRow(at);
              });

      assertThat(row.slotUsed()).isZero();
      assertThat(row.slotLimit()).isZero();
      assertThat(row.queueWaiting()).isZero();
      assertThat(row.oldestWaitSec()).isNull();
      assertThat(row.accountUsage().isArray()).isTrue();
      assertThat(row.accountUsage()).isEmpty();
      assertThat(row.backlog().get("MAIL_CLASSIFY").asInt()).isZero();
      assertThat(row.backlog().get("FILE_SUMMARY").asInt()).isZero();
      assertThat(row.backlog().size()).isEqualTo(2);
    } finally {
      cleanupInTenant(tid, () -> dsl.deleteFrom(AI_CAPACITY_SAMPLE).execute());
      // 런타임 롤은 tenant 행을 지울 수 없어(권한 없음) 비활성으로만 돌려 다른 테스트의 테넌트 순회에 끼지 않게 한다.
      baseDsl.update(TENANT).set(TENANT.STATUS, "DELETED").where(TENANT.ID.eq(tid)).execute();
    }
  }

  @Test
  void sample_runsForActiveTenants() {
    OffsetDateTime before = OffsetDateTime.now();

    sampler.sample();

    // 정리는 @AfterEach 가 이번 분 이후 표본을 지운다.
    OffsetDateTime sampledAt =
        callInTenant(
            1L,
            () ->
                dsl.select(AI_CAPACITY_SAMPLE.SAMPLED_AT)
                    .from(AI_CAPACITY_SAMPLE)
                    .orderBy(AI_CAPACITY_SAMPLE.SAMPLED_AT.desc())
                    .limit(1)
                    .fetchOne(AI_CAPACITY_SAMPLE.SAMPLED_AT));
    assertThat(sampledAt).isNotNull();
    assertThat(sampledAt.getSecond()).isZero();
    assertThat(sampledAt.getNano()).isZero();
    assertThat(sampledAt).isAfterOrEqualTo(before.truncatedTo(ChronoUnit.MINUTES));
  }

  // ── 시드 헬퍼 ─────────────────────────────────────────────────────────────────

  private long agent(String prefix) {
    long id = createAgentUserWithMembership(prefix);
    agents.add(id);
    return id;
  }

  private long human() {
    long id = TestFixtures.createHuman(baseDsl);
    grantUserRole(id);
    callInTenant(1L, () -> TestFixtures.activeMemberOfCurrentTenant(dsl, id));
    humans.add(id);
    return id;
  }

  private ProjectResponse project(long owner) {
    String key = uniqueProjectKey("CS");
    ProjectResponse p =
        projectService.create(owner, new CreateProjectRequest(key, "P-" + key, "x", "TEAM"));
    projects.add(p.id());
    return p;
  }

  private long issue(long owner, ProjectResponse p, String title) {
    return issueService
        .create(
            owner, p.key(), new CreateIssueRequest(title, "본문", null, null, null, null, null, null))
        .id();
  }
}
