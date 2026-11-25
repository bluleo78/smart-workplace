package com.workplace.wiki.report;

import com.workplace.airun.context.AiRunContext;
import com.workplace.airun.context.AiRunKinds;
import com.workplace.airun.context.AiRunScope;
import com.workplace.airun.service.AiRunRecorder;
import com.workplace.airun.service.AiRunSkips;
import com.workplace.auth.service.AssistantLimitGuard;
import com.workplace.auth.service.AssistantResolution;
import com.workplace.auth.service.AssistantResolver;
import com.workplace.auth.service.AssistantSpec;
import com.workplace.global.outbound.AiAgentProperties;
import com.workplace.global.util.CapabilityTokens;
import com.workplace.issue.exception.IssueAiException;
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
import com.workplace.wiki.report.ProjectReportRepository.Takeover;
import com.workplace.wiki.report.ProjectReportSettingRepository.SettingRow;
import com.workplace.wiki.report.ReportErrors.ReportFailure;
import com.workplace.wiki.report.dto.ProjectReportGenerateResponse;
import com.workplace.wiki.repository.ProjectNoteSpaceRepository;
import com.workplace.wiki.service.WikiSystemPageWriter;
import java.time.DayOfWeek;
import java.time.Duration;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.OffsetDateTime;
import java.time.ZonedDateTime;
import java.time.temporal.TemporalAdjusters;
import java.util.Objects;
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
 *   <li>노트 자리 보장(WP-1654) — 저장 위치({@link ProjectReportLocation}: 고른 페이지, 아니면 「리포트」 — 지워졌으면 다시 만든다)와
 *       템플릿(「템플릿」 › 「정기 리포트」, id 로 따라가고 없으면 다시 만든다) → 템플릿 본문 읽기(20,000자 상한, 빈 본문이면 기본 원문).
 *   <li>tx 밖 AI → 출력 상한(20,000자) → {@link ReportMarkdown#finish} 로 지시 상자·h1·배지(진행 상태 줄)·표 숫자(참고 지표
 *       포함)·이슈 링크를 바로잡고 일정 도표를 넣는다(WP-1629).
 *   <li>tx 밖 페이지 쓰기(작성자 = 「리포트」와 같은 규칙 — 소유자가 멤버면 소유자, 아니면 가장 작은 OWNER id): createPage →
 *       writeBody(ai) → moveTo(저장 위치 맨 위 = 최신이 위) → markAiReport. 다시 쓰는 페이지가 지금 저장 위치 밖이면(위치를 바꿨거나
 *       사람이 옮김) 옮기지 않고 그 자리에서 다시 쓴다 — 이미 만든 리포트는 옮기지 않는다.
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
    /** 공통 비서 자격이 사용 한도 대기 중이라 AI 를 부르지 않았다(WP-2108) — 대기가 풀리면 같은 회차를 다시 잡는다. */
    SKIPPED_LIMIT_WAIT,
    /** 실패 — 30분 뒤 재시도하거나(3회째면) 다음 예정으로 넘겼다. */
    FAILED
  }

  /** 잡은 실행권 — 그때의 설정과, 점유가 밀어 둔 다음 예정 시각(3회째 실패 때 그리로 넘긴다). */
  private record Claim(SettingRow setting, OffsetDateTime next) {}

  /** 한 회차를 만든 결과 — 리포트 페이지를 썼으면 그 id(건너뛰었으면 null), 이미 있던 페이지를 다시 썼는지. */
  private record Written(Outcome outcome, Long pageId, boolean replaced) {}

  private final ProjectRepository projectRepository;
  private final ProjectReportSettingRepository settings;
  private final ProjectReportRepository reports;
  private final ProjectReportFactsService factsService;
  private final ProjectNoteSpaceRepository noteSpaces;
  private final WikiSystemPageWriter writer;
  private final ProjectReportTemplate template;
  private final ProjectReportLocation location;
  private final ReportPageWriter pageWriter;
  private final AssistantResolver assistantResolver;
  private final AssistantLimitGuard limitGuard;
  private final AiAgentIssueClient client;
  private final AiAgentProperties aiAgentProperties;
  private final AiRunRecorder aiRunRecorder;
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
      ProjectReportLocation location,
      AssistantResolver assistantResolver,
      AssistantLimitGuard limitGuard,
      AiAgentIssueClient client,
      AiAgentProperties aiAgentProperties,
      AiRunRecorder aiRunRecorder,
      PlatformTransactionManager txManager,
      @Value("${workplace.public-base-url:}") String publicBaseUrl) {
    this.projectRepository = projectRepository;
    this.settings = settings;
    this.reports = reports;
    this.factsService = factsService;
    this.noteSpaces = noteSpaces;
    this.writer = writer;
    this.template = template;
    this.location = location;
    // 쓰기 뼈대는 받은 writer 로 만든다 — 테스트가 넘기는 스파이 writer 가 쓰기 단계에도 그대로 쓰이게(빈 주입이 아니라).
    this.pageWriter = new ReportPageWriter(writer);
    this.assistantResolver = assistantResolver;
    this.limitGuard = limitGuard;
    this.client = client;
    this.aiAgentProperties = aiAgentProperties;
    this.aiRunRecorder = aiRunRecorder;
    this.tx = new TransactionTemplate(txManager);
    this.issueUrlPrefix = issueUrlPrefix(publicBaseUrl);
    if (this.issueUrlPrefix.isEmpty()) {
      // 공개 주소가 없으면 리포트의 이슈 주소가 상대 경로가 되고 링크 다듬기도 꺼진다 — 조용히 나빠지지 않게 기동 때 한 번 알린다.
      log.warn(
          "workplace.public-base-url(WEB_BASE_URL)이 비어 있어 프로젝트 리포트의 이슈 링크가 상대 주소가 되고 링크 다듬기를 건너뜁니다.");
    }
  }

  /** 앱 이슈 주소 접두 {@code {base}/projects/} — 공개 주소가 없으면 빈 값(링크를 건드리지 않는다). 개인 보고 생성기도 쓴다. */
  static String issueUrlPrefix(String baseUrl) {
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
    if (reserved != Reserve.RESERVED) {
      // 「지금 생성」이 그 회차를 만드는 중이면 점유가 다음 예정으로 민 것을 30분 뒤 재시도로 되돌린다 — 그 실행이 실패해 행을 풀어도 이 회차를
      // 잃지 않게(만들었으면 재시도는 DUPLICATE 로 끝나고 다음 예정으로 간다).
      tx.executeWithoutResult(
          s -> {
            if (reports.inProgress(projectId, period, now)) {
              settings.retryAt(projectId, now.plus(RETRY_DELAY));
            }
          });
      return Outcome.DUPLICATE;
    }

    try {
      AssistantResolution resolution = workspaceResolution();
      // WP-2108: 한도 대기면 건너뛰고 기록.
      Optional<AssistantSpec> spec =
          limitGuard.specOrSkip(
              resolution, AiRunKinds.PROJECT_REPORT, aiRunContext(project, now, false));
      if (resolution.isWaiting()) {
        // 한도 대기 — 그 회차를 버리지 않는다. 예약을 풀고 점유가 민 다음 예정을 대기가 풀리는 시각으로 되돌려, 풀린 뒤 같은 회차를 다시 잡게 한다.
        log.debug("공통 비서가 한도 대기 중이라 프로젝트 리포트를 미룸 projectId={}", projectId);
        OffsetDateTime retryAt =
            OffsetDateTime.ofInstant(resolution.limitWaitUntil(), now.getOffset());
        tx.executeWithoutResult(
            s -> {
              reports.release(projectId, period);
              settings.retryAt(projectId, retryAt);
            });
        return Outcome.SKIPPED_LIMIT_WAIT;
      }
      if (spec.isEmpty()) {
        log.debug("공통 비서가 없어 프로젝트 리포트를 건너뜀 projectId={}", projectId);
        tx.executeWithoutResult(s -> reports.release(projectId, period));
        AiRunSkips.record(
            aiRunRecorder,
            AiRunSkips.PROJECT_REPORT,
            aiRunContext(project, now, false),
            AiRunSkips.NO_ASSISTANT);
        return Outcome.SKIPPED_NO_ASSISTANT;
      }
      return generate(project, period, now, spec.get(), false).outcome();
    } catch (RuntimeException e) {
      fail(projectId, claim.get(), period, now, e);
      return Outcome.FAILED;
    }
  }

  /**
   * 「지금 생성」(WP-1630) — 다음 회차를 기다리지 않고 직전에 끝난 회차 하나를 지금 만든다. 정기 실행과 같은 생성 단계(계산값 → 템플릿 → AI → 후처리 →
   * 페이지)를 쓰되 셋이 다르다:
   *
   * <ul>
   *   <li>실행권은 next_run_at 점유가 아니라 회차 행 예약({@link ProjectReportRepository#reserveNow}) — 정기 일정·실패
   *       수를 건드리지 않고, 꺼져 있어도 만든다. 정기 실행이 그 회차를 만드는 중이면 409. 회차는 {@link #manualPeriod} 로 정한다.
   *   <li>같은 회차 리포트가 있으면 그 페이지에 새 판을 쓰고 직전 본문은 수정 기록에 남긴다. 「변화 없음」이어도 만든다(사람이 눌렀으니).
   *   <li>실패는 재시도로 미루지 않고 맡기 전 상태로 되돌린 뒤 이유와 함께 알린다 — 있던 리포트는 그대로다.
   * </ul>
   *
   * <p>호출자가 권한·개인 프로젝트를 걸렀고 TenantContext 를 세웠다. 트랜잭션 밖에서 부른다(본문 쓰기).
   *
   * @param setting 설정(행이 없으면 기본값) — 회차를 정한다
   * @throws ProjectReportGenerateException AI 연동 꺼짐·비서 없음·만드는 중(409), 생성 실패(502)
   */
  public ProjectReportGenerateResponse runNow(
      ProjectRow project, SettingRow setting, OffsetDateTime now) {
    long projectId = project.id();
    // AI 연동이 꺼져 있으면 예약·계산·노트 쓰기 전에 거절한다(WP-1639).
    if (!aiAgentProperties.enabled()) throw ProjectReportGenerateException.aiDisabled();
    AssistantResolution resolution = workspaceResolution();
    // 직접 요청은 대기 중이면 곧바로 한도 안내로 거절한다(WP-2108) — 「비서 없음」 이 아니다.
    resolution.throwIfWaiting();
    AssistantSpec spec =
        resolution.readySpec().orElseThrow(ProjectReportGenerateException::noAssistant);
    ReportPeriod period = manualPeriod(setting, now);
    Optional<Takeover> reserved = tx.execute(s -> reports.reserveNow(projectId, period, now));
    if (reserved == null || reserved.isEmpty()) throw ProjectReportGenerateException.busy();
    Takeover takeover = reserved.get();
    Written written;
    try {
      written = generate(project, period, now, spec, true);
    } catch (RuntimeException e) {
      try {
        tx.executeWithoutResult(s -> reports.restoreNow(projectId, period, takeover));
      } catch (RuntimeException restoreError) {
        // 되돌리기마저 실패해도 원래 실패 이유를 알린다 — 행은 PENDING 으로 남아 30분 뒤 묵은 예약으로 이어받힌다.
        log.warn("프로젝트 리포트 지금 생성 되돌리기 실패 projectId={}: {}", projectId, restoreError.toString());
      }
      log.warn(
          "프로젝트 리포트 지금 생성 실패 projectId={} period={}~{}: {}",
          projectId,
          period.start(),
          period.end(),
          e.toString());
      throw ProjectReportGenerateException.failed(failureReason(e));
    }
    return new ProjectReportGenerateResponse(written.pageId(), period.title(), written.replaced());
  }

  /**
   * 「지금 생성」의 회차 — 직전에 끝난 완전 회차. 격주는 정기 회차와 칸이 어긋나지 않게(쉬는 주에 눌러 두 회차에 걸친 14일이 생기지 않게) 지금 이하의 가장 최근
   * 정기 예정 칸을 기준으로 잡는다 — 켜져 있고 다음 예정이 있을 때만 칸을 안다(꺼져 있으면 지금 기준). 매주·매월은 실행 날짜만으로 정해져 지금 기준과 같다.
   */
  static ReportPeriod manualPeriod(SettingRow s, OffsetDateTime now) {
    OffsetDateTime base = now;
    if (s.cadence() == ReportCadence.BIWEEKLY && s.enabled() && s.nextRunAt() != null) {
      OffsetDateTime slot = slotAtOrBefore(s.weekday(), s.timeOfDay(), s.nextRunAt());
      while (slot.isAfter(now)) slot = slot.minusWeeks(2);
      base = slot;
    }
    return ReportPeriod.lastComplete(s.cadence(), base);
  }

  /**
   * 화면에 보일 실패 이유 — 생성 단계가 사람이 읽을 문구로 던진 실패(상한·빈 글·자리 없음·AI 요청 실패)는 그대로, 그 밖(예상 못 한 예외)은 내부 문구를 드러내지
   * 않고 다시 시도를 권한다.
   */
  static String failureReason(RuntimeException e) {
    if (e instanceof ReportFailure || e instanceof IssueAiException) {
      return ReportErrors.message(e);
    }
    return "예상하지 못한 오류가 났어요. 잠시 뒤 다시 시도해 주세요.";
  }

  /** AI 처리 기록의 호출 맥락(WP-1829) — 대상은 이 프로젝트. 정기 회차는 AUTO + sourceAt=now, 수동은 주체를 비워 요청자로 정한다. */
  private static AiRunContext aiRunContext(ProjectRow project, OffsetDateTime now, boolean manual) {
    return new AiRunContext(
        "PROJECT",
        String.valueOf(project.id()),
        project.name(),
        manual ? null : "AUTO",
        null,
        manual ? null : now);
  }

  /** 워크스페이스 공통 비서 해석 결과(없음·준비됨·한도 대기) — 짧은 tx 로 읽는다. */
  private AssistantResolution workspaceResolution() {
    AssistantResolution r = tx.execute(s -> assistantResolver.workspaceResolution());
    return r == null ? AssistantResolution.none() : r;
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

  /**
   * 예약한 회차를 만든다 — 계산값 → 노트 자리·템플릿 → AI → 후처리 → 페이지. 실패는 예외로 알린다.
   *
   * @param spec 공통 비서(호출자가 확인했다)
   * @param manual 「지금 생성」 — 「변화 없음」이어도 만들고, 다시 쓰는 페이지의 직전 본문을 수정 기록에 남기고, 정기 일정의 실패 수는 건드리지 않는다
   */
  private Written generate(
      ProjectRow project,
      ReportPeriod period,
      OffsetDateTime now,
      AssistantSpec spec,
      boolean manual) {
    long projectId = project.id();
    ProjectReportFacts facts = tx.execute(s -> computeFacts(project, period, now));
    // 앞선 시도가 이미 페이지를 만들었으면(재시도) 「변화 없음」이어도 건너뛰지 않고 그 페이지에 이어 쓴다 — 건너뛰면 쓰던 페이지가 회차와 끊긴 채
    // 남는다(코드 리뷰 #1).
    Optional<Long> pendingPageId = tx.execute(s -> reports.pendingPageId(projectId, period));
    if (!manual && facts.noChange() && pendingPageId.isEmpty()) {
      // 변화 없는 기간은 노트를 건드리지 않고 스냅숏만 남긴다(다음 회차 「변화」 기준).
      tx.executeWithoutResult(
          s -> {
            reports.markSkipped(projectId, period, facts.snapshot(), now);
            settings.resetFailures(projectId);
          });
      AiRunSkips.record(
          aiRunRecorder,
          AiRunSkips.PROJECT_REPORT,
          aiRunContext(project, now, false),
          AiRunSkips.NO_CHANGE);
      return new Written(Outcome.SKIPPED_NO_CHANGE, null, false);
    }

    // 노트 자리 — 저장 위치(고른 페이지, 아니면 「리포트」)와 템플릿. 지워졌거나 이름이 바뀐 「리포트」·템플릿은 다시 만든다(본문 쓰기라 tx 밖).
    long author = tx.execute(s -> noteSpaces.findReportAuthor(projectId, project.ownerId()));
    ProjectReportLocation.Resolved target = location.resolveForWrite(project, author);
    long templateId = template.ensureTemplate(project, target.spaceId(), author);
    // 빈 본문(다른 호출이 템플릿을 막 만들고 본문을 아직 못 쓴 틈)이면 기본 원문으로 대신한다(WP-1654).
    String templateMarkdown = template.readBodyOrDefault(templateId, project);
    if (ReportPageWriter.codePoints(templateMarkdown) > TEMPLATE_MAX) {
      throw new ReportFailure("리포트 템플릿이 " + TEMPLATE_MAX + "자를 넘어요.");
    }

    // tx 밖 AI — 커넥션을 붙잡지 않는다.
    // 한도로 실패하면 그 자격을 대기로 건다(WP-2108) — 실패 처리 흐름은 그대로(같은 예외가 올라간다).
    ProjectReportAiResult result =
        limitGuard.call(
            spec,
            () ->
                AiRunScope.call(
                    aiRunContext(project, now, manual),
                    () ->
                        client.writeProjectReport(
                            request(project, period, facts, templateMarkdown, spec))));
    String markdown = result == null || result.markdown() == null ? "" : result.markdown().strip();
    if (markdown.isEmpty()) throw new ReportFailure("AI 가 빈 리포트를 돌려줬어요.");
    if (ReportPageWriter.codePoints(markdown) > OUTPUT_MAX) {
      throw new ReportFailure("AI 리포트가 " + OUTPUT_MAX + "자를 넘어요.");
    }
    String body =
        ReportMarkdown.finish(
            markdown,
            facts,
            ReportMarkdown.hasReportTable(templateMarkdown),
            ReportMarkdown.hasMetricsTable(templateMarkdown),
            issueUrlPrefix);

    return writePage(projectId, author, target, period, facts, body, pendingPageId, manual, now);
  }

  /**
   * tx — 계산값. 「지난 리포트 이후」 변화는 지난 GENERATED/SKIPPED 스냅숏과, 「지난 배지」는 지난 GENERATED 회차의 배지와 견준다(변화 없음으로
   * 건너뛴 회차는 리포트가 아니라서). 그 회차가 바로 앞 기간({@link ReportPeriod#previous})이 아니면(건너뛴·실패한 회차가 끼었거나 주기가 바뀜)
   * 진행 상태 줄의 견줌 낱말을 「지난주」 대신 「지난 리포트」로 쓰게 표시한다(WP-1629 리뷰).
   */
  private ProjectReportFacts computeFacts(
      ProjectRow project, ReportPeriod period, OffsetDateTime now) {
    Optional<ProjectReportRepository.LastReport> lastReport =
        reports.lastGenerated(project.id(), period.start());
    Optional<String> generatedBadge = lastReport.map(ProjectReportRepository.LastReport::badge);
    boolean lastIsPreviousPeriod =
        lastReport.map(r -> r.periodStart().equals(period.previous().start())).orElse(true);
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
    return factsService
        .compute(project, period, last, now)
        .withPreviousFromPreviousPeriod(lastIsPreviousPeriod);
  }

  /**
   * AI 요청 — 템플릿은 지시 상자를 담은 그대로(AI 가 따르고 출력하지 않는다). 계산값({@link ProjectReportFactsService#compute})의
   * 에픽 집계(WP-1629)를 이슈 60건 목록 대신 싣는다. 프로젝트 소유자 이름은 집계 안({@code epics.projectOwner})에만 둔다 — ai-agent
   * 가 그 값으로 프롬프트의 「프로젝트 소유자」 줄을 만든다. 옛 ai-agent 와의 롤링 배포 호환용 빈 {@code issues}·{@code omittedByEpic}
   * 은 {@link ProjectReportAiRequest} 의 보조 생성자가 채운다.
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
        facts.epics(),
        spec.agentUserId(),
        spec.model(),
        spec.maxTurns(),
        // 비서 예산(기본 60초)이 아니라 리포트 전용 예산 — 긴 입력·출력이라 모자라고, API 읽기 시간 제한(210초)도 이에 맞췄다.
        AiAgentIssueClient.PROJECT_REPORT_TIMEOUT_MS);
  }

  /**
   * tx 밖 페이지 쓰기 — 저장 위치 아래에 만들고(끝) 곧바로 회차에 페이지를 적은 뒤(짧은 tx), 본문을 AI 글로 쓰고, 저장 위치 맨 위(0번 — 최신이 위)로
   * 옮기고, 마지막에 「AI 작성」 표지를 남긴다(그 뒤 수정 시각이 더 늦으면 사람이 고친 것). 템플릿은 「템플릿」 아래라 자리 계산에 끼지 않는다(WP-1654).
   *
   * <p>앞선 시도가 페이지를 만든 뒤 실패했으면({@code pendingPageId} — 회차에 적힌 페이지가 아직 있음) 새로 만들지 않고 그 페이지를 다시 쓴다 —
   * 회차당 페이지는 하나. 다시 쓰는 페이지가 지금 저장 위치 바로 아래면 맨 위로 정리하고, 아니면(위치를 바꿨거나 사람이 옮김) 옮기지 않고 그 자리에서 쓴다
   * (WP-1654 — 이미 만든 리포트는 옮기지 않는다). 이 안의 실패는 다른 실패와 같이 호출자({@link #run})가 기록하고 재시도한다(회차 행은 지우지
   * 않는다).
   *
   * @param manual 「지금 생성」 — 다시 쓰는 페이지의 직전 본문을 수정 기록에 남기고, 정기 일정의 실패 수는 건드리지 않는다
   */
  private Written writePage(
      long projectId,
      long author,
      ProjectReportLocation.Resolved target,
      ReportPeriod period,
      ProjectReportFacts facts,
      String body,
      Optional<Long> pendingPageId,
      boolean manual,
      OffsetDateTime now) {
    Optional<WikiPageDetail> reused = pendingPageId.flatMap(writer::findPage);
    WikiPageDetail page;
    if (reused.isPresent()) {
      page = reused.get();
    } else {
      page = writer.createPage(author, target.spaceId(), target.parentPageId(), period.title());
      long createdId = page.id();
      tx.executeWithoutResult(s -> reports.attachPage(projectId, period, createdId));
    }
    long pageId = page.id();
    boolean snapshot = manual && reused.isPresent();
    if (reused.isPresent() && !Objects.equals(page.parentId(), target.parentPageId())) {
      // 지금 저장 위치 밖의 페이지 — 옮기지 않고 그 자리에서 본문 → 「AI 작성」 표지.
      pageWriter.writeAndMarkInPlace(author, page, body, now, snapshot);
    } else {
      // 본문(AI) → 저장 위치 맨 위 → 「AI 작성」 표지 — 개인 보고와 나눠 쓰는 쓰기 뼈대(WP-1486).
      pageWriter.writeAndMark(author, page, body, target.parentPageId(), 0, now, snapshot);
    }
    tx.executeWithoutResult(
        s -> {
          reports.markGenerated(
              projectId, period, pageId, facts.badge().name(), facts.snapshot(), now);
          if (!manual) settings.resetFailures(projectId);
        });
    return new Written(Outcome.GENERATED, pageId, reused.isPresent());
  }

  /**
   * 실패 처리 — 예약을 풀고(페이지가 아직 없으면 행을 지우고, 있으면 행을 남겨 재시도가 그 페이지를 다시 쓰게) 연속 실패 수·오류를 기록한다. {@link
   * #MAX_FAILURES} 번째 미만이면 30분 뒤 같은 회차를 다시, 그 이상이면 그 회차를 버리고 점유 때 정한 다음 예정으로 넘긴다(카운터 0) — 페이지가 이미
   * 있으면 그 페이지는 남기고 회차를 FAILED 로 닫아 중복을 막는다(카드·지난 배지는 GENERATED 만 본다).
   */
  private void fail(
      long projectId, Claim claim, ReportPeriod period, OffsetDateTime now, RuntimeException e) {
    String error = ReportErrors.message(e);
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
}
