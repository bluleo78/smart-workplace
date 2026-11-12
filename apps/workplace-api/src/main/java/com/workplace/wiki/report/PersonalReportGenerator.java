package com.workplace.wiki.report;

import com.workplace.auth.service.AssistantResolver;
import com.workplace.auth.service.AssistantSpec;
import com.workplace.issue.outbound.AiAgentIssueClient;
import com.workplace.issue.outbound.dto.PersonalReportAiRequest;
import com.workplace.issue.outbound.dto.PersonalReportAiResult;
import com.workplace.issue.report.PersonalReportFacts;
import com.workplace.issue.report.PersonalReportFactsService;
import com.workplace.issue.report.PersonalReportKind;
import com.workplace.issue.report.PersonalReportPeriod;
import com.workplace.issue.report.ReportTableRow;
import com.workplace.user.dto.UserResponse;
import com.workplace.user.repository.UserRepository;
import com.workplace.wiki.dto.WikiPageDetail;
import com.workplace.wiki.report.PersonalReportRepository.ReportRow;
import com.workplace.wiki.report.PersonalReportRepository.Reservation;
import com.workplace.wiki.report.PersonalReportRepository.ReserveStatus;
import com.workplace.wiki.report.PersonalReportSettingRepository.SettingRow;
import com.workplace.wiki.report.ReportErrors.ReportFailure;
import com.workplace.wiki.service.WikiSystemPageWriter;
import com.workplace.wiki.service.WikiSystemPageWriter.PersonalReportsHome;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.time.YearMonth;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Stream;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 개인 보고 한 편(WP-1486) — 계산값과 내 노트의 템플릿으로 AI 에게 일일·주간·월간 보고를 받아 내 노트 › 「보고」 › 「2026년 11월」 아래 새 페이지로
 * 남긴다. 프로젝트 리포트 생성기(WP-1483)와 같은 순서(계산값 → 템플릿 → AI → 지시 상자·h1·링크 정리 → 표 숫자 대조 → 페이지 → 「AI 작성」 표지)를
 * 따르되, 작성자는 언제나 본인이고(개인 공간은 소유자 한 명뿐이라 AI 계정을 넣지 않는다) 저장 위치는 입력으로 받지 않는다 — 공간은 언제나 본인의 PERSONAL
 * 공간이다.
 *
 * <p>두 입구:
 *
 * <ul>
 *   <li>{@link #runDaily} — 자동 일일(실행기). tx 점유(next_run_at 을 내일 같은 시각으로 밀며 잡음) → AUTO 예약(그날 이미 처리됐으면
 *       {@link Outcome#DUPLICATE}) → 비서 확인 → 생성. 「한 일이 없는 날은 건너뜀」이 켜져 있고 끝냄·새로 만듦·상태 바꿈이 모두 0 이면
 *       페이지 없이 SKIPPED. 실패는 예약을 풀고 30분 뒤 재시도, 연속 {@link #MAX_FAILURES} 번째면 그날을 FAILED 로 닫고 다음 날로
 *       넘긴다.
 *   <li>{@link #runManual} — 「보고서 만들기」. 요청 스레드가 예약한 PENDING 행을 받아 생성한다(건너뜀 규칙 없음). 실패하면 행을 FAILED +
 *       오류(앞 500자)로 닫는다 — 이미 만든 페이지는 남긴다.
 * </ul>
 *
 * <p>노트 본문 쓰기는 동기화 서버 위임 경로라 트랜잭션 밖에서 부른다 — 그래서 이 클래스는 {@code @Transactional} 이 아니고 단계마다 {@link
 * TransactionTemplate} 으로 짧게 연다. 호출자가 TenantContext 를 세운다(실행기·수동 실행기).
 */
@Slf4j
@Service
public class PersonalReportGenerator {

  /** 이 횟수째 연속 실패면 그날을 버리고 다음 날로 넘긴다(프로젝트 리포트와 같은 값). */
  static final int MAX_FAILURES = ProjectReportGenerator.MAX_FAILURES;

  /** 실패 뒤 같은 날을 다시 시도하기까지. */
  static final Duration RETRY_DELAY = ProjectReportGenerator.RETRY_DELAY;

  /** AI 에 보내는 템플릿 상한(코드 포인트) — 생성 비용 상한(프로젝트 리포트와 같은 값). */
  static final int TEMPLATE_MAX = ProjectReportGenerator.TEMPLATE_MAX;

  /** AI 출력 상한(코드 포인트) — 넘으면 잘린 글이라 실패로 본다(프로젝트 리포트·ai-agent PERSONAL_REPORT_MAX 와 같은 값). */
  static final int OUTPUT_MAX = ProjectReportGenerator.OUTPUT_MAX;

  /** 비서가 없을 때 수동 회차에 남기는 문구(화면이 그대로 보여 준다). */
  static final String NO_ASSISTANT = PersonalReportConflictException.NO_ASSISTANT;

  private static final String AUTO = "AUTO";

  /** 월 폴더 제목 꼴 — 「2026년 11월」. */
  private static final Pattern MONTH_FOLDER = Pattern.compile("(\\d{4})년 (\\d{1,2})월");

  /** 한 회의 결과 — 실행기가 회차 로그에 센다. */
  public enum Outcome {
    /** 보고 페이지를 새로 만들었다. */
    GENERATED,
    /** 한 일이 없는 날이라 페이지 없이 기록만 했다(자동 일일 + 「한 일이 없는 날은 건너뜀」). */
    SKIPPED_EMPTY,
    /** 그날을 이미 처리했거나 다른 실행이 만드는 중이다. */
    DUPLICATE,
    /** 실행권을 잡지 못했다 — 꺼짐·아직 때가 아님·다른 실행이 잡음. */
    NOT_DUE,
    /** 비서가 없어 AI 를 부르지 않았다(설정 상태). */
    SKIPPED_NO_ASSISTANT,
    /** 실패 — 자동은 30분 뒤 재시도하거나(3회째면) 다음 날로 넘겼고, 수동은 회차를 FAILED 로 닫았다. */
    FAILED
  }

  /** 잡은 실행권 — 그때의 설정과, 점유가 밀어 둔 다음 시각(3회째 실패 때 그리로 넘긴다). */
  private record Claim(SettingRow setting, OffsetDateTime next) {}

  private final PersonalReportSettingRepository settings;
  private final PersonalReportRepository reports;
  private final PersonalReportFactsService factsService;
  private final WikiSystemPageWriter writer;
  private final PersonalReportTemplate template;
  private final ReportPageWriter pageWriter;
  private final AssistantResolver assistantResolver;
  private final AiAgentIssueClient client;
  private final UserRepository users;
  private final TransactionTemplate tx;
  private final String issueUrlPrefix;

  public PersonalReportGenerator(
      PersonalReportSettingRepository settings,
      PersonalReportRepository reports,
      PersonalReportFactsService factsService,
      WikiSystemPageWriter writer,
      PersonalReportTemplate template,
      ReportPageWriter pageWriter,
      AssistantResolver assistantResolver,
      AiAgentIssueClient client,
      UserRepository users,
      PlatformTransactionManager txManager,
      @Value("${workplace.public-base-url:}") String publicBaseUrl) {
    this.settings = settings;
    this.reports = reports;
    this.factsService = factsService;
    this.writer = writer;
    this.template = template;
    this.pageWriter = pageWriter;
    this.assistantResolver = assistantResolver;
    this.client = client;
    this.users = users;
    this.tx = new TransactionTemplate(txManager);
    // 공개 주소가 없으면 링크 다듬기를 건너뛴다 — 경고는 프로젝트 리포트 생성기가 기동 때 이미 한 번 남긴다(같은 설정값).
    this.issueUrlPrefix = ProjectReportGenerator.issueUrlPrefix(publicBaseUrl);
  }

  /**
   * 자동 일일 보고 한 회 — 때가 됐으면 그 시각 슬롯의 전날(서울)을 만든다.
   *
   * @param userId 보고 주인(실행기가 고른 사람)
   * @param now 「지금」 — 점유·대상 날짜·계산값·다음 시각의 기준
   */
  public Outcome runDaily(long userId, OffsetDateTime now) {
    Optional<Claim> claim = tx.execute(s -> claim(userId, now));
    if (claim == null || claim.isEmpty()) return Outcome.NOT_DUE;
    SettingRow setting = claim.get().setting();

    PersonalReportPeriod period =
        PersonalReportPeriod.daily(PersonalReportPeriod.dailyTarget(setting.timeOfDay(), now));
    // 점유가 next_run_at 을 이미 내일로 밀었으므로, 예약·비서 확인에서 난 오류도 생성 실패와 똑같이 처리해야 그날이 조용히 사라지지 않는다.
    Long reportId = null;
    try {
      Reservation reserved = tx.execute(s -> reports.reserve(userId, period, AUTO, now));
      if (reserved == null || reserved.status() != ReserveStatus.RESERVED) {
        // 그날은 이미 닫혔다(또는 다른 실행이 만든다) — 앞선 재시도의 실패 수를 남기면 다음 날 첫 실패가 곧바로 상한에 걸린다.
        clearFailures(userId, setting);
        return Outcome.DUPLICATE;
      }
      long id = reserved.id();
      reportId = id;

      Optional<AssistantSpec> spec = tx.execute(s -> assistantResolver.resolveOrEmpty(userId));
      if (spec == null || spec.isEmpty()) {
        // 설정 상태라 실패로 세지 않는다 — 행을 남기지 않아 비서를 붙인 뒤 다음 날부터 정상으로 돈다.
        log.debug("비서가 없어 개인 일일 보고를 건너뜀 userId={}", userId);
        tx.executeWithoutResult(s -> reports.release(id));
        // 그날을 버리므로 앞선 재시도의 실패 수도 지운다(다음 날로 넘어가지 않게).
        clearFailures(userId, setting);
        return Outcome.SKIPPED_NO_ASSISTANT;
      }

      Optional<Long> pendingPageId = tx.execute(s -> reports.pendingPageId(id));
      return generate(
          userId, period, id, spec.get(), pendingPageId, setting.skipEmpty(), true, now);
    } catch (RuntimeException e) {
      failDaily(userId, claim.get(), period, reportId, now, e);
      return Outcome.FAILED;
    }
  }

  /**
   * 수동 보고 한 편 — 요청 스레드가 예약한 PENDING 회차를 만든다(건너뜀 규칙 없음). 실패하면 회차를 FAILED + 오류로 닫는다(이미 만든 페이지는 남김).
   *
   * @param reportId 예약한 회차 행 id
   * @param now 「지금」 — 계산값·표지 시각의 기준
   */
  public Outcome runManual(long reportId, OffsetDateTime now) {
    // 회차 조회·비서 확인을 포함해 어디서 난 오류든 회차를 FAILED 로 닫는다 — 남겨 두면 화면이 30분 동안 「만드는 중…」에 머문다.
    try {
      return runManualOrThrow(reportId, now);
    } catch (RuntimeException e) {
      String error = ReportErrors.message(e);
      try {
        tx.executeWithoutResult(s -> reports.markFailed(reportId, error, now));
      } catch (RuntimeException markError) {
        // 기록마저 실패하면 PENDING 이 남지만 30분 뒤 이어받을 수 있다 — 실행기 스레드로 예외를 올리지 않는다.
        log.error("개인 보고(수동) 실패 기록 실패 reportId={}", reportId, markError);
      }
      log.warn("개인 보고(수동) 생성 실패 reportId={}: {}", reportId, e.toString());
      return Outcome.FAILED;
    }
  }

  /** {@link #runManual} 본문 — 실패는 예외로 올린다(바깥이 FAILED 로 닫는다). */
  private Outcome runManualOrThrow(long reportId, OffsetDateTime now) {
    Optional<ReportRow> found = tx.execute(s -> reports.findById(reportId));
    if (found == null || found.isEmpty()) {
      log.warn("개인 보고 회차가 없어 만들지 않음 reportId={}", reportId);
      return Outcome.FAILED;
    }
    ReportRow row = found.get();
    if (!"PENDING".equals(row.status())) {
      // 이미 끝난 회차(다른 실행이 처리) — 다시 만들지 않는다.
      return Outcome.DUPLICATE;
    }
    long userId = row.userId();
    PersonalReportPeriod period = new PersonalReportPeriod(row.start(), row.end(), row.kind());

    Optional<AssistantSpec> spec = tx.execute(s -> assistantResolver.resolveOrEmpty(userId));
    if (spec == null || spec.isEmpty()) {
      tx.executeWithoutResult(s -> reports.markFailed(reportId, NO_ASSISTANT, now));
      return Outcome.SKIPPED_NO_ASSISTANT;
    }

    Optional<Long> pendingPageId = tx.execute(s -> reports.pendingPageId(reportId));
    return generate(userId, period, reportId, spec.get(), pendingPageId, false, false, now);
  }

  /** 그날을 실패 아닌 이유(이미 닫힘·비서 없음)로 끝낼 때 — 앞선 재시도가 남긴 연속 실패 수가 있으면 지운다. */
  private void clearFailures(long userId, SettingRow setting) {
    if (setting.consecutiveFailures() > 0) {
      tx.executeWithoutResult(s -> settings.resetFailures(userId));
    }
  }

  /** tx 점유 — 켜져 있고 때가 됐을 때만 next_run_at 을 다음 그 시각(내일 같은 시각, KST)으로 밀어 실행권을 잡는다. */
  private Optional<Claim> claim(long userId, OffsetDateTime now) {
    Optional<SettingRow> row = settings.find(userId);
    if (row.isEmpty()) return Optional.empty();
    SettingRow s = row.get();
    OffsetDateTime next = PersonalReportPeriod.nextRun(s.timeOfDay(), now);
    return settings.claim(userId, now, next) ? Optional.of(new Claim(s, next)) : Optional.empty();
  }

  /**
   * 예약한 회차를 만든다(스펙 8절) — 계산값 → (건너뜀) → 「보고」·템플릿 → 템플릿 본문 → AI(tx 밖) → 정리·표 대조 → 월 폴더 → 페이지 → 표지 →
   * GENERATED. 실패는 예외로 알린다.
   *
   * @param pendingPageId 앞선 시도가 이미 만든 페이지(있으면 새로 만들지 않고 다시 쓴다)
   * @param skipEmpty 한 일이 없으면 건너뛸지(자동 일일의 설정 값, 수동은 false)
   * @param auto 자동 일일 회차인지 — 자동만 끝날 때 자동 실패 수·마지막 오류를 지운다(수동 성공이 자동 실패 기록을 가리지 않게)
   */
  private Outcome generate(
      long userId,
      PersonalReportPeriod period,
      long reportId,
      AssistantSpec spec,
      Optional<Long> pendingPageId,
      boolean skipEmpty,
      boolean auto,
      OffsetDateTime now) {
    PersonalReportFacts facts = tx.execute(s -> factsService.compute(userId, period, now));
    // 앞선 시도가 페이지를 만든 재시도면 한 일이 없어도 건너뛰지 않고 그 페이지에 이어 쓴다(프로젝트와 같은 규칙).
    if (skipEmpty && facts.isEmpty() && pendingPageId.isEmpty()) {
      tx.executeWithoutResult(
          s -> {
            reports.markSkipped(
                reportId, facts.completed(), facts.created(), facts.statusChanged(), now);
            if (auto) settings.resetFailures(userId);
          });
      return Outcome.SKIPPED_EMPTY;
    }

    String userName = tx.execute(s -> users.findById(userId).map(UserResponse::name).orElse(""));

    // 노트 자리 — 공간·「보고」·템플릿은 지워졌거나 옮겨졌으면 다시 만든다(본문 쓰기라 tx 밖).
    PersonalReportsHome home = writer.ensurePersonalReportsHome(userId);
    long templateId = template.ensure(userId, home, period.kind());
    String templateMarkdown = template.readBodyOrDefault(templateId, period.kind());
    if (ReportPageWriter.codePoints(templateMarkdown) > TEMPLATE_MAX) {
      throw new ReportFailure("보고 템플릿이 " + TEMPLATE_MAX + "자를 넘어요.");
    }

    // tx 밖 AI — 커넥션을 붙잡지 않는다.
    PersonalReportAiResult result =
        client.writePersonalReport(request(userName, period, facts, templateMarkdown, spec));
    String markdown = result == null || result.markdown() == null ? "" : result.markdown().strip();
    if (markdown.isEmpty()) throw new ReportFailure("AI 가 빈 보고를 돌려줬어요.");
    if (ReportPageWriter.codePoints(markdown) > OUTPUT_MAX) {
      throw new ReportFailure("AI 보고가 " + OUTPUT_MAX + "자를 넘어요.");
    }

    // 지시 상자·h1·이슈 링크 정리 → 숫자 표를 계산값으로(템플릿에서 사람이 표를 뺐으면 넣지 않는다).
    List<String> lines = ReportMarkdown.clean(markdown, issueUrlPrefix);
    ReportMarkdown.fixTable(
        lines,
        facts.table(),
        ReportMarkdown.hasTable(templateMarkdown, facts.table().headFirstCell()));
    String body = ReportMarkdown.render(lines);

    writePage(userId, home, period, reportId, facts, body, pendingPageId, auto, now);
    return Outcome.GENERATED;
  }

  /**
   * AI 요청 — 템플릿은 지시 상자를 담은 그대로, 이슈는 계산값이 상한(40)까지 고른 그대로. 일일은 「어제 숫자」 한 줄(칸을 「 | 」 로 이음)만, 주간·월간은
   * 비교 표 행만 싣는다.
   */
  private PersonalReportAiRequest request(
      String userName,
      PersonalReportPeriod period,
      PersonalReportFacts facts,
      String templateMarkdown,
      AssistantSpec spec) {
    boolean daily = period.kind() == PersonalReportKind.DAILY;
    ReportTableSpec table = facts.table();
    List<ReportTableRow> tableRows =
        daily
            ? List.of()
            : table.body().stream()
                .map(r -> new ReportTableRow(r.get(0), r.get(1), r.get(2)))
                .toList();
    return new PersonalReportAiRequest(
        userName,
        period.kind().name(),
        period.kind().label(),
        period.title(),
        period.label(),
        templateMarkdown,
        tableRows,
        daily ? numbersLine(table) : null,
        facts.issues(),
        facts.omittedByGroup(),
        spec.agentUserId(),
        spec.model(),
        spec.maxTurns(),
        // 비서 예산(기본 60초)이 아니라 리포트 전용 예산 — 긴 입력·출력이라 모자란다(프로젝트 리포트와 같은 값).
        AiAgentIssueClient.PROJECT_REPORT_TIMEOUT_MS);
  }

  /** 일일 표 한 줄 — 머리 칸과 값을 「끝냄 4 · 기한 내 3 | 새로 만듦 1 | …」 로 잇는다. */
  static String numbersLine(ReportTableSpec table) {
    List<String> head = table.headCells();
    List<String> values = table.body().get(0);
    List<String> cells = new ArrayList<>();
    for (int i = 0; i < head.size(); i++) {
      cells.add(head.get(i) + " " + (i < values.size() ? values.get(i) : ""));
    }
    return String.join(" | ", cells);
  }

  /**
   * tx 밖 페이지 쓰기 — 월 폴더(「보고」 안 템플릿 다음 자리, 최신 달이 위)를 보장하고, 새 페이지를 만들어 곧바로 회차에 적은 뒤(짧은 tx) 본문을 AI 글로
   * 쓰고 폴더 맨 위로 옮겨 「AI 작성」 표지를 남긴다. 작성자는 본인이다. 앞선 시도가 만든 페이지가 남아 있으면 새로 만들지 않고 그 페이지를 다시 쓴다.
   */
  private void writePage(
      long userId,
      PersonalReportsHome home,
      PersonalReportPeriod period,
      long reportId,
      PersonalReportFacts facts,
      String body,
      Optional<Long> pendingPageId,
      boolean auto,
      OffsetDateTime now) {
    String folderTitle = period.monthFolderTitle();
    int templates = templatesUnder(userId, home);
    long folderId =
        writer.ensureChildFolder(
            home.spaceId(),
            home.reportsPageId(),
            folderTitle,
            userId,
            siblings -> monthFolderPosition(siblings, folderTitle, templates));
    Optional<WikiPageDetail> reused = pendingPageId.flatMap(writer::findPage);
    WikiPageDetail page;
    if (reused.isPresent()) {
      page = reused.get();
    } else {
      // 같은 회차 두 번째(「새로 만들기」)부터는 제목 끝에 「(n)」 — 앞 보고는 덮지 않는다.
      int n = tx.execute(s -> reports.countGenerated(userId, period)) + 1;
      page = writer.createPage(userId, home.spaceId(), folderId, period.titleWithCopy(n));
      long createdId = page.id();
      tx.executeWithoutResult(s -> reports.attachPage(reportId, createdId));
    }
    long pageId = page.id();
    pageWriter.writeAndMark(userId, page, body, folderId, 0, now);
    tx.executeWithoutResult(
        s -> {
          reports.markGenerated(
              reportId, pageId, facts.completed(), facts.created(), facts.statusChanged(), now);
          if (auto) settings.resetFailures(userId);
        });
  }

  /**
   * 새 월 폴더 자리 — 「보고」 아래는 템플릿 다음에 월 폴더가 최신 달부터 놓인다(스펙 8절 6단계). 형제 중 이 달보다 오래된 첫 월 폴더 바로 앞에 두고, 오래된
   * 달이 없으면 마지막 더 최신 월 폴더 바로 뒤, 월 폴더가 하나도 없으면 템플릿 바로 다음(templates)에 둔다. 월 폴더가 아닌 형제(사람이 만든 페이지)는
   * 건드리지 않는다.
   *
   * @param siblings 「보고」 의 기존 자식 제목(화면 순서)
   * @param title 새 월 폴더 제목(「2026년 11월」)
   * @param templates 「보고」 바로 아래 남아 있는 템플릿 수
   */
  static int monthFolderPosition(List<String> siblings, String title, int templates) {
    Optional<YearMonth> mine = parseMonthFolder(title);
    if (mine.isEmpty()) return templates;
    int afterNewer = -1;
    for (int i = 0; i < siblings.size(); i++) {
      Optional<YearMonth> other = parseMonthFolder(siblings.get(i));
      if (other.isEmpty()) continue;
      if (other.get().isBefore(mine.get())) return i;
      afterNewer = i + 1;
    }
    return afterNewer >= 0 ? afterNewer : templates;
  }

  /** 「2026년 11월」 꼴 제목을 연월로 읽는다(PersonalReportPeriod.monthFolderTitle 의 역). 다른 제목이면 empty. */
  static Optional<YearMonth> parseMonthFolder(String title) {
    if (title == null) return Optional.empty();
    Matcher m = MONTH_FOLDER.matcher(title);
    if (!m.matches()) return Optional.empty();
    int month = Integer.parseInt(m.group(2));
    if (month < 1 || month > 12) return Optional.empty();
    return Optional.of(YearMonth.of(Integer.parseInt(m.group(1)), month));
  }

  /** 「보고」 바로 아래 남아 있는 템플릿 수(0~2) — 새 월 폴더를 템플릿 다음 자리에 두려고 센다. */
  private int templatesUnder(long userId, PersonalReportsHome home) {
    Optional<SettingRow> row = tx.execute(s -> settings.find(userId));
    if (row == null || row.isEmpty()) return 0;
    return (int)
        Stream.of(row.get().dailyTemplatePageId(), row.get().weeklyTemplatePageId())
            .filter(id -> id != null && writer.existsUnder(id, home.reportsPageId()))
            .count();
  }

  /**
   * 자동 일일 실패 처리(예약·비서 확인·생성 어디서 났든) — 예약이 있으면(reportId 가 null 이 아니면) 풀고(페이지가 없으면 행을 지우고, 있으면 남겨
   * 재시도가 그 페이지를 다시 쓰게) 연속 실패 수·오류를 적고 30분 뒤 다시 시도한다. {@link #MAX_FAILURES} 번째면 그날을 닫는다 — 행이 남아 있으면
   * FAILED 로, 지워졌으면 AUTO·FAILED 행을 넣어 그날을 다시 만들지 않게 하고 점유 때 정한 다음 날 그 시각으로 넘긴다(실패 수 0).
   */
  private void failDaily(
      long userId,
      Claim claim,
      PersonalReportPeriod period,
      Long reportId,
      OffsetDateTime now,
      RuntimeException e) {
    String error = ReportErrors.message(e);
    tx.executeWithoutResult(
        s -> {
          if (reportId != null) reports.release(reportId);
          int failures = settings.recordFailure(userId, now.plus(RETRY_DELAY), error);
          if (failures >= MAX_FAILURES) {
            if (reportId != null && reports.findById(reportId).isPresent()) {
              reports.markFailed(reportId, error, now);
            } else {
              reports.insertFailed(userId, period, error, now);
            }
            settings.skipToNext(userId, claim.next(), error);
          }
        });
    log.warn("개인 일일 보고 생성 실패 userId={} day={}: {}", userId, period.start(), e.toString());
  }
}
