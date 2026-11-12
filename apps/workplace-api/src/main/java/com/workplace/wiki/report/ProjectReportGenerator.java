package com.workplace.wiki.report;

import com.workplace.auth.service.AssistantResolver;
import com.workplace.auth.service.AssistantSpec;
import com.workplace.global.util.CapabilityTokens;
import com.workplace.issue.outbound.AiAgentIssueClient;
import com.workplace.issue.outbound.dto.ProjectReportAiRequest;
import com.workplace.issue.outbound.dto.ProjectReportAiResult;
import com.workplace.issue.report.ProjectReportFacts;
import com.workplace.issue.report.ProjectReportFactsService;
import com.workplace.issue.report.ReportCadence;
import com.workplace.issue.report.ReportPeriod;
import com.workplace.issue.report.ReportSnapshot;
import com.workplace.project.dto.ProjectRow;
import com.workplace.project.repository.ProjectRepository;
import com.workplace.wiki.dto.WikiPageDetail;
import com.workplace.wiki.report.ProjectReportRepository.Reserve;
import com.workplace.wiki.report.ProjectReportSettingRepository.SettingRow;
import com.workplace.wiki.repository.ProjectNoteSpaceRepository;
import com.workplace.wiki.service.WikiSystemPageWriter;
import com.workplace.wiki.service.WikiSystemPageWriter.ReportsHome;
import java.time.DayOfWeek;
import java.time.Duration;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.OffsetDateTime;
import java.time.ZonedDateTime;
import java.time.temporal.TemporalAdjusters;
import java.util.List;
import java.util.Optional;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 프로젝트 리포트 한 회(WP-1483) — 실행권을 잡고, 회차를 예약하고, 계산값과 템플릿으로 AI 에게 리포트를 받아 「리포트」 아래 노트 페이지로 남긴다.
 *
 * <p>흐름(설계 「생성 순서」, WP-1479 {@code ProjectStatusSummaryService.refresh} 와 같은 짧은 트랜잭션 여러 개):
 *
 * <ol>
 *   <li>tx 점유: 켜져 있고 next_run_at 이 지났을 때만 다음 예정으로 미는 조건부 UPDATE — 못 잡으면 {@link Outcome#NOT_DUE}. 여러
 *       파드에서 한 번만.
 *   <li>tx 예약: 실행 전에 끝난 가장 최근 완전 회차를 PENDING 으로 예약 — 이미 있으면 {@link Outcome#DUPLICATE}. 서버가 오래 꺼졌다
 *       켜져도 밀린 회차를 여러 편 만들지 않는다.
 *   <li>공통 비서가 없으면 예약을 풀고 {@link Outcome#SKIPPED_NO_ASSISTANT}. 계산값이 「변화 없음」이면 페이지 없이 SKIPPED 로
 *       기록({@link Outcome#SKIPPED_NO_CHANGE}) — 단 앞선 시도가 이미 페이지를 만든 재시도면 그 페이지에 이어 쓴다.
 *   <li>노트 자리 보장(공간·「리포트」·템플릿 — 지워졌으면 다시 만든다) → 템플릿 본문 읽기(20,000자 상한).
 *   <li>tx 밖 AI → 출력 상한(20,000자) → {@link ReportMarkdown#finish} 로 지시 상자·h1·배지·표 숫자·이슈 링크를 바로잡는다.
 *   <li>tx 밖 페이지 쓰기(작성자 = 「리포트」와 같은 규칙 — 소유자가 멤버면 소유자, 아니면 가장 작은 OWNER id): createPage →
 *       writeBody(ai) → moveTo(템플릿 바로 아래 = 최신이 위) → markAiReport.
 *   <li>tx 저장: 회차 GENERATED(페이지·배지·스냅숏), 실패 수 0.
 * </ol>
 *
 * <p>실패(AI 오류·빈 글·상한 초과·노트 쓰기 실패)는 예약을 지우고 연속 실패 수를 올려 30분 뒤 같은 회차를 다시 시도한다. 연속 {@link
 * #MAX_FAILURES} 번째면 그 회차를 버리고 다음 예정으로 넘긴다(카운터 0). 페이지를 만든 뒤 실패하면 페이지는 남기고 회차는 FAILED 로 닫아 중복을
 * 막는다(리포트가 아니라 카드·지난 배지에 쓰지 않는다).
 *
 * <p>노트 본문 쓰기는 동기화 서버 위임 경로라 트랜잭션 밖에서 부른다 — 그래서 이 클래스는 {@code @Transactional} 이 아니고 단계마다 {@link
 * TransactionTemplate} 으로 짧게 연다. 호출자가 TenantContext 를 세운다(실행기).
 */
@Slf4j
@Service
public class ProjectReportGenerator {

  /** 이 횟수째 연속 실패면 그 회차를 버리고 다음 예정으로 넘긴다. */
  static final int MAX_FAILURES = 3;

  /** 실패 뒤 같은 회차를 다시 시도하기까지. */
  static final Duration RETRY_DELAY = Duration.ofMinutes(30);

  /** AI 에 보내는 템플릿 상한(코드 포인트) — 생성 비용 상한. */
  static final int TEMPLATE_MAX = 20_000;

  /** AI 출력 상한(코드 포인트) — 넘으면 잘린 글이라 실패로 본다(ai-agent PROJECT_REPORT_MAX 와 같은 값). */
  static final int OUTPUT_MAX = 20_000;

  /** 한 회의 결과 — 실행기가 회차 로그에 센다. */
  public enum Outcome {
    /** 리포트 페이지를 새로 만들었다. */
    GENERATED,
    /** 회차에 완료·새로 생김이 없어 페이지 없이 기록만 했다. */
    SKIPPED_NO_CHANGE,
    /** 그 회차를 이미 만들었거나 다른 실행이 만드는 중이다. */
    DUPLICATE,
    /** 실행권을 잡지 못했다 — 꺼짐·아직 때가 아님·다른 실행이 잡음·프로젝트 없음. */
    NOT_DUE,
    /** 워크스페이스 공통 비서가 없어 AI 를 부르지 않았다(실패가 아니라 설정 상태). */
    SKIPPED_NO_ASSISTANT,
    /** 실패 — 30분 뒤 재시도하거나(3회째면) 다음 예정으로 넘겼다. */
    FAILED
  }

  /** 잡은 실행권 — 그때의 설정과, 점유가 밀어 둔 다음 예정 시각(3회째 실패 때 그리로 넘긴다). */
  private record Claim(SettingRow setting, OffsetDateTime next) {}

  /** 「실패」로 처리할 생성 단계의 문제(상한 초과·빈 글·자리 없음). */
  static final class ReportFailure extends RuntimeException {
    ReportFailure(String message) {
      super(message);
    }
  }

  private final ProjectRepository projectRepository;
  private final ProjectReportSettingRepository settings;
  private final ProjectReportRepository reports;
  private final ProjectReportFactsService factsService;
  private final ProjectNoteSpaceRepository noteSpaces;
  private final WikiSystemPageWriter writer;
  private final ProjectReportTemplate template;
  private final AssistantResolver assistantResolver;
  private final AiAgentIssueClient client;
  private final TransactionTemplate tx;
  private final String issueUrlPrefix;

  public ProjectReportGenerator(
      ProjectRepository projectRepository,
      ProjectReportSettingRepository settings,
      ProjectReportRepository reports,
      ProjectReportFactsService factsService,
      ProjectNoteSpaceRepository noteSpaces,
      WikiSystemPageWriter writer,
      ProjectReportTemplate template,
      AssistantResolver assistantResolver,
      AiAgentIssueClient client,
      PlatformTransactionManager txManager,
      @Value("${workplace.public-base-url:}") String publicBaseUrl) {
    this.projectRepository = projectRepository;
    this.settings = settings;
    this.reports = reports;
    this.factsService = factsService;
    this.noteSpaces = noteSpaces;
    this.writer = writer;
    this.template = template;
    this.assistantResolver = assistantResolver;
    this.client = client;
    this.tx = new TransactionTemplate(txManager);
    this.issueUrlPrefix = issueUrlPrefix(publicBaseUrl);
    if (this.issueUrlPrefix.isEmpty()) {
      // 공개 주소가 없으면 리포트의 이슈 주소가 상대 경로가 되고 링크 다듬기도 꺼진다 — 조용히 나빠지지 않게 기동 때 한 번 알린다.
      log.warn(
          "workplace.public-base-url(WEB_BASE_URL)이 비어 있어 프로젝트 리포트의 이슈 링크가 상대 주소가 되고 링크 다듬기를 건너뜁니다.");
    }
  }

  /** 앱 이슈 주소 접두 {@code {base}/projects/} — 공개 주소가 없으면 빈 값(링크를 건드리지 않는다). */
  private static String issueUrlPrefix(String baseUrl) {
    String base = CapabilityTokens.normalizeBaseUrl(baseUrl);
    return base.isEmpty() ? "" : base + "/projects/";
  }

  /**
   * 프로젝트 하나의 리포트를 (때가 됐으면) 만든다.
   *
   * @param projectId 대상 프로젝트
   * @param now 「지금」 — 점유·회차·계산값·다음 예정의 기준
   */
  public Outcome run(long projectId, OffsetDateTime now) {
    Optional<ProjectRow> found = tx.execute(s -> projectRepository.findById(projectId));
    if (found == null || found.isEmpty() || found.get().isPersonal()) return Outcome.NOT_DUE;
    ProjectRow project = found.get();

    Optional<Claim> claim = tx.execute(s -> claim(projectId, now));
    if (claim == null || claim.isEmpty()) return Outcome.NOT_DUE;

    ReportPeriod period = ReportPeriod.lastComplete(claim.get().setting().cadence(), now);
    Reserve reserved = tx.execute(s -> reports.reserve(projectId, period, now));
    if (reserved != Reserve.RESERVED) return Outcome.DUPLICATE;

    try {
      return generate(project, period, now);
    } catch (RuntimeException e) {
      fail(projectId, claim.get(), period, now, e);
      return Outcome.FAILED;
    }
  }

  /**
   * tx 점유 — 켜져 있고 때가 됐을 때만 다음 예정으로 밀어 실행권을 잡는다. 격주의 「지난 예정」은 next_run_at 이 든 예정 칸(요일·시각)으로 맞춘다 —
   * 30분 재시도 시각을 기준으로 삼아 격주 칸이 밀리지 않게.
   */
  private Optional<Claim> claim(long projectId, OffsetDateTime now) {
    Optional<SettingRow> row = settings.find(projectId);
    if (row.isEmpty()) return Optional.empty();
    SettingRow s = row.get();
    if (!s.enabled() || s.nextRunAt() == null || s.nextRunAt().isAfter(now)) {
      return Optional.empty();
    }
    OffsetDateTime anchor = slotAtOrBefore(s.weekday(), s.timeOfDay(), s.nextRunAt());
    OffsetDateTime next = s.cadence().nextRun(s.weekday(), s.timeOfDay(), now, anchor);
    return settings.claim(projectId, now, next)
        ? Optional.of(new Claim(s, next))
        : Optional.empty();
  }

  /** at 이하에서 가장 가까운 「그 요일·그 시각」(KST). */
  static OffsetDateTime slotAtOrBefore(DayOfWeek weekday, LocalTime time, OffsetDateTime at) {
    ZonedDateTime kst = at.atZoneSameInstant(ReportCadence.KST);
    LocalDate day = kst.toLocalDate().with(TemporalAdjusters.previousOrSame(weekday));
    ZonedDateTime slot = ZonedDateTime.of(day, time, ReportCadence.KST);
    if (slot.isAfter(kst)) slot = slot.minusWeeks(1);
    return slot.toOffsetDateTime();
  }

  /** 예약한 회차를 만든다 — 비서 확인 → 계산값 → 노트 자리·템플릿 → AI → 후처리 → 페이지. 실패는 예외로 알린다. */
  private Outcome generate(ProjectRow project, ReportPeriod period, OffsetDateTime now) {
    long projectId = project.id();
    Optional<AssistantSpec> spec = tx.execute(s -> assistantResolver.resolveWorkspaceOrEmpty());
    if (spec == null || spec.isEmpty()) {
      log.debug("공통 비서가 없어 프로젝트 리포트를 건너뜀 projectId={}", projectId);
      tx.executeWithoutResult(s -> reports.release(projectId, period));
      return Outcome.SKIPPED_NO_ASSISTANT;
    }

    ProjectReportFacts facts = tx.execute(s -> computeFacts(project, period, now));
    // 앞선 시도가 이미 페이지를 만들었으면(재시도) 「변화 없음」이어도 건너뛰지 않고 그 페이지에 이어 쓴다 — 건너뛰면 쓰던 페이지가 회차와 끊긴 채
    // 남는다(코드 리뷰 #1).
    Optional<Long> pendingPageId = tx.execute(s -> reports.pendingPageId(projectId, period));
    if (facts.noChange() && pendingPageId.isEmpty()) {
      // 변화 없는 기간은 노트를 건드리지 않고 스냅숏만 남긴다(다음 회차 「변화」 기준).
      tx.executeWithoutResult(
          s -> {
            reports.markSkipped(projectId, period, facts.snapshot(), now);
            settings.resetFailures(projectId);
          });
      return Outcome.SKIPPED_NO_CHANGE;
    }

    // 노트 자리 — 지워졌거나 이름이 바뀐 「리포트」·템플릿은 다시 만든다(본문 쓰기라 tx 밖).
    long author = tx.execute(s -> noteSpaces.findReportAuthor(projectId, project.ownerId()));
    ReportsHome home =
        writer
            .ensureReportsHome(projectId, author)
            .orElseThrow(() -> new ReportFailure("리포트를 둘 노트 공간을 만들 수 없어요."));
    long templateId = template.ensureTemplate(project, home, author);
    String templateMarkdown = writer.readBody(templateId).orElse("");
    if (codePoints(templateMarkdown) > TEMPLATE_MAX) {
      throw new ReportFailure("리포트 템플릿이 " + TEMPLATE_MAX + "자를 넘어요.");
    }

    // tx 밖 AI — 커넥션을 붙잡지 않는다.
    ProjectReportAiResult result =
        client.writeProjectReport(request(project, period, facts, templateMarkdown, spec.get()));
    String markdown = result == null || result.markdown() == null ? "" : result.markdown().strip();
    if (markdown.isEmpty()) throw new ReportFailure("AI 가 빈 리포트를 돌려줬어요.");
    if (codePoints(markdown) > OUTPUT_MAX) {
      throw new ReportFailure("AI 리포트가 " + OUTPUT_MAX + "자를 넘어요.");
    }
    String body =
        ReportMarkdown.finish(
            markdown, facts, ReportMarkdown.hasReportTable(templateMarkdown), issueUrlPrefix);

    return writePage(projectId, author, home, templateId, period, facts, body, pendingPageId, now);
  }

  /**
   * tx — 계산값. 「지난 리포트 이후」 변화는 지난 GENERATED/SKIPPED 스냅숏과, 「지난 배지」는 지난 GENERATED 회차의 배지와 견준다(변화 없음으로
   * 건너뛴 회차는 리포트가 아니라서).
   */
  private ProjectReportFacts computeFacts(
      ProjectRow project, ReportPeriod period, OffsetDateTime now) {
    Optional<String> generatedBadge = reports.lastGeneratedBadge(project.id(), period.start());
    Optional<ReportSnapshot> last =
        reports
            .lastSnapshot(project.id(), period.start())
            .map(
                s ->
                    new ReportSnapshot(
                        s.completed(),
                        s.created(),
                        s.openIssues(),
                        s.overdue(),
                        generatedBadge.orElse(null)));
    return factsService.compute(project, period, last, now);
  }

  /**
   * AI 요청 — 템플릿은 지시 상자를 담은 그대로(AI 가 따르고 출력하지 않는다), 이슈는 상한까지(넘친 것은 에픽별 건수로). 이슈 상한({@link
   * ProjectReportFactsService#ISSUE_LIMIT})과 에픽별 건수는 계산값({@link
   * ProjectReportFactsService#compute})이 이미 지키므로 그대로 싣는다.
   */
  private ProjectReportAiRequest request(
      ProjectRow project,
      ReportPeriod period,
      ProjectReportFacts facts,
      String templateMarkdown,
      AssistantSpec spec) {
    return new ProjectReportAiRequest(
        project.name(),
        period.title(),
        period.label(),
        period.cadence().label(),
        templateMarkdown,
        facts.badge().name(),
        facts.previousBadge() == null ? null : facts.previousBadge().name(),
        facts.rows(),
        facts.issues(),
        facts.omittedByEpic(),
        spec.agentUserId(),
        spec.model(),
        spec.maxTurns(),
        // 비서 예산(기본 60초)이 아니라 리포트 전용 예산 — 긴 입력·출력이라 모자라고, API 읽기 시간 제한(210초)도 이에 맞췄다.
        AiAgentIssueClient.PROJECT_REPORT_TIMEOUT_MS);
  }

  /**
   * tx 밖 페이지 쓰기 — 만들고(「리포트」 끝) 곧바로 회차에 페이지를 적은 뒤(짧은 tx), 본문을 AI 글로 쓰고, 템플릿 바로 아래(템플릿이 맨 위가 아니면 맨
   * 위)로 옮기고, 마지막에 「AI 작성」 표지를 남긴다(그 뒤 수정 시각이 더 늦으면 사람이 고친 것).
   *
   * <p>앞선 시도가 페이지를 만든 뒤 실패했으면({@code pendingPageId} — 회차에 적힌 페이지가 아직 있음) 새로 만들지 않고 그 페이지를 다시 쓴다 —
   * 회차당 페이지는 하나. 이 안의 실패는 다른 실패와 같이 호출자({@link #run})가 기록하고 재시도한다(회차 행은 지우지 않는다).
   */
  private Outcome writePage(
      long projectId,
      long author,
      ReportsHome home,
      long templateId,
      ReportPeriod period,
      ProjectReportFacts facts,
      String body,
      Optional<Long> pendingPageId,
      OffsetDateTime now) {
    Optional<WikiPageDetail> reused = pendingPageId.flatMap(writer::findPage);
    WikiPageDetail page;
    if (reused.isPresent()) {
      page = reused.get();
    } else {
      page = writer.createPage(author, home.spaceId(), home.reportsPageId(), period.title());
      long createdId = page.id();
      tx.executeWithoutResult(s -> reports.attachPage(projectId, period, createdId));
    }
    long pageId = page.id();
    writer.writeBody(author, pageId, page.version(), body, true, false);
    // 자리는 이 페이지를 뺀 형제 순서로 정한다(다시 쓰는 페이지가 이미 그 자리에 있어도 같은 답).
    List<Long> others =
        writer.childIdsOrdered(home.reportsPageId()).stream().filter(id -> id != pageId).toList();
    int position = !others.isEmpty() && others.get(0) == templateId ? 1 : 0;
    writer.moveTo(pageId, home.reportsPageId(), position);
    writer.markAiReport(pageId, markTime(pageId, now));
    tx.executeWithoutResult(
        s -> {
          reports.markGenerated(
              projectId, period, pageId, facts.badge().name(), facts.snapshot(), now);
          settings.resetFailures(projectId);
        });
    return Outcome.GENERATED;
  }

  /**
   * 「AI 작성」 표지 시각 — 페이지 마지막 수정 시각보다 이르지 않게(쓰기·옮기기가 DB 시각으로 updated_at 을 적으므로, 실행 시각만 쓰면 방금 만든 리포트가
   * 「수정됨」으로 보인다).
   */
  private OffsetDateTime markTime(long pageId, OffsetDateTime now) {
    OffsetDateTime updated = writer.findPage(pageId).map(WikiPageDetail::updatedAt).orElse(null);
    return updated != null && updated.isAfter(now) ? updated : now;
  }

  /**
   * 실패 처리 — 예약을 풀고(페이지가 아직 없으면 행을 지우고, 있으면 행을 남겨 재시도가 그 페이지를 다시 쓰게) 연속 실패 수·오류를 기록한다. {@link
   * #MAX_FAILURES} 번째 미만이면 30분 뒤 같은 회차를 다시, 그 이상이면 그 회차를 버리고 점유 때 정한 다음 예정으로 넘긴다(카운터 0) — 페이지가 이미
   * 있으면 그 페이지는 남기고 회차를 FAILED 로 닫아 중복을 막는다(카드·지난 배지는 GENERATED 만 본다).
   */
  private void fail(
      long projectId, Claim claim, ReportPeriod period, OffsetDateTime now, RuntimeException e) {
    String error = e.getMessage() == null ? e.toString() : e.getMessage();
    tx.executeWithoutResult(
        s -> {
          reports.release(projectId, period);
          // 30분 뒤 재시도로 적고 올린 실패 수를 받는다 — 상한이면 같은 tx 에서 다음 예정으로 덮어 그 회차를 버린다.
          int failures = settings.recordFailure(projectId, now.plus(RETRY_DELAY), error);
          if (failures >= MAX_FAILURES) {
            reports.closeWithPage(projectId, period, now);
            settings.skipToNext(projectId, claim.next(), error);
          }
        });
    log.warn(
        "프로젝트 리포트 생성 실패 projectId={} period={}~{}: {}",
        projectId,
        period.start(),
        period.end(),
        e.toString());
  }

  private static int codePoints(String s) {
    return s.codePointCount(0, s.length());
  }
}
