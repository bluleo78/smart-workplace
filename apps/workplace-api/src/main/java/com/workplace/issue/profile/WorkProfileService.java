package com.workplace.issue.profile;

import com.workplace.auth.service.AssistantResolver;
import com.workplace.auth.service.AssistantSpec;
import com.workplace.global.util.AfterCommit;
import com.workplace.global.util.Texts;
import com.workplace.issue.dto.IssueDueWindow;
import com.workplace.issue.dto.MeOverviewPeriod;
import com.workplace.issue.metrics.ClosedIssueFact;
import com.workplace.issue.metrics.IssueMetricsService;
import com.workplace.issue.metrics.MetricsPeriod;
import com.workplace.issue.outbound.AiAgentIssueClient;
import com.workplace.issue.outbound.dto.WorkProfileAiRequest;
import com.workplace.issue.outbound.dto.WorkProfileAiResult;
import com.workplace.issue.profile.WorkProfileAnalyzeResponse.Outcome;
import com.workplace.issue.profile.WorkProfileCalc.Tally;
import com.workplace.issue.profile.WorkProfileInputRepository.IssueBrief;
import com.workplace.issue.profile.WorkProfileRepository.WorkProfileReady;
import com.workplace.issue.repository.IssueLabelRepository;
import com.workplace.label.dto.LabelSummary;
import java.time.Clock;
import java.time.Duration;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.concurrent.Executor;
import java.util.stream.Collectors;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.core.task.TaskRejectedException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 업무 프로파일(WP-1485) — 한 사람이 기간 안에 끝낸 이슈를 AI 로 분류해 「무슨 일을 주로 했는지」를 만들고 사람×기간 한 행(work_profile)에 저장한다.
 *
 * <p><b>흐름:</b> 카드 조회({@link #get})는 저장 행을 그대로 돌려주고, 행이 없는데 끝낸 이슈가 있으면 PENDING 으로 점유한 뒤 커밋 뒤 워커에
 * 분석을 맡긴다. 「다시 분석」({@link #analyze})은 하루 상한·중복·입력 지문을 따져 필요할 때만 워커를 띄운다. 주기 갱신은 {@link
 * #refreshScheduled}. 워커 본체는 {@link #runAnalysis}.
 *
 * <p><b>비용 가드:</b> 대상은 닫힌 시각 최신 {@link #ANALYZE_CAP} 건, 본문·코멘트는 잘라 보낸다. 대상 이슈의 (id, 수정 시각) 지문이 지난
 * 분석과 같으면 AI 를 부르지 않는다.
 *
 * <p><b>점유 토큰:</b> PENDING 으로 점유할 때 쓴 {@code pending_since} 값(마이크로초로 자른 「지금」)이 그 분석의 소유 표시다. 워커는 이
 * 토큰을 들고 다니며 결과를 「아직 내 점유일 때」만 저장한다 — 10분이 지나 다른 요청이 다시 점유하면 늦게 끝난 옛 워커의 결과는 버려진다.
 *
 * <p><b>RLS/tx:</b> AI HTTP 는 항상 트랜잭션 밖(커넥션 비점유). 워커 경로는 self-invoke {@code @Transactional} 대신
 * {@link TransactionTemplate} 을 쓴다 — 프록시를 거치지 않아 GUC 가 주입되지 않기 때문(IssueAiSummaryService 와 같은 이유).
 * 워커 executor 는 TenantContext 를 전파한다.
 */
@Slf4j
@Service
public class WorkProfileService {

  /** 한 번에 AI 에 보내는 최대 이슈 수 — ai-agent 요청 스키마 상한(100)과 같다. */
  static final int ANALYZE_CAP = 100;

  /** 「다시 분석」 사람×기간 하루(서울 날짜) 상한. */
  static final int DAILY_MANUAL_LIMIT = 10;

  /** 이보다 오래된 PENDING 은 워커가 죽은 것으로 보고 다시 점유한다. */
  static final Duration STALE_PENDING = Duration.ofMinutes(10);

  /** 이슈 본문을 AI 에 보내는 최대 글자 수 — 분류에는 앞부분이면 충분하다. */
  static final int BODY_CHARS = 300;

  /** 마지막 코멘트를 AI 에 보내는 최대 글자 수. */
  static final int COMMENT_CHARS = 200;

  /** 저장하는 요약 최대 글자 수. */
  static final int SUMMARY_CHARS = 500;

  static final String ERROR_NO_ASSISTANT = "AI 비서가 설정되지 않아 분석할 수 없어요";
  static final String ERROR_ANALYZE = "분석하지 못했어요. 잠시 후 다시 분석해 주세요";
  static final String ERROR_BUSY = "분석이 몰려 있어요. 잠시 후 다시 분석해 주세요";

  private final IssueMetricsService metricsService;
  private final WorkProfileRepository repository;
  private final WorkProfileInputRepository inputRepository;
  private final IssueLabelRepository labelRepository;
  private final AssistantResolver assistantResolver;
  private final AiAgentIssueClient client;
  private final Executor executor;
  private final TransactionTemplate txTemplate;

  /** 커밋 뒤(afterCommit) 콜백에서 쓰는 새 트랜잭션 — 그 시점엔 끝난 트랜잭션 자원이 아직 묶여 있어 REQUIRED 로는 참여가 꼬인다. */
  private final TransactionTemplate newTxTemplate;

  /** 「오늘」의 기준 시계 — 서울 날짜로 바꿔 쓴다(JVM 기본 zone 이 UTC). */
  private final Clock clock = Clock.systemUTC();

  public WorkProfileService(
      IssueMetricsService metricsService,
      WorkProfileRepository repository,
      WorkProfileInputRepository inputRepository,
      IssueLabelRepository labelRepository,
      AssistantResolver assistantResolver,
      AiAgentIssueClient client,
      @Qualifier("workProfileExecutor") Executor executor,
      PlatformTransactionManager txManager) {
    this.metricsService = metricsService;
    this.repository = repository;
    this.inputRepository = inputRepository;
    this.labelRepository = labelRepository;
    this.assistantResolver = assistantResolver;
    this.client = client;
    this.executor = executor;
    this.txTemplate = new TransactionTemplate(txManager);
    this.newTxTemplate = new TransactionTemplate(txManager);
    this.newTxTemplate.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
  }

  /** 분석 한 회의 결과 — 매일 갱신 로그가 실제로 무슨 일이 있었는지 세는 데 쓴다. */
  public enum RunResult {
    /** 새 내용을 저장했다(AI 결과 또는 대상 0건의 빈 결과). */
    REFRESHED,
    /** 입력 지문이 그대로라 기간·건수만 갱신했다(AI 호출 없음). */
    UNCHANGED,
    /** 실패로 기록했다(이전 내용 유지). */
    FAILED,
    /** 그 사이 다른 요청이 다시 점유해 결과를 버렸다. */
    SUPERSEDED,
    /** 이미 다른 분석이 돌고 있어 점유하지 못해 하지 않았다. */
    SKIPPED
  }

  // ── 카드 조회 ──────────────────────────────────────────────────────────────

  /** 카드 조회 — 지금 시각 기준. */
  @Transactional
  public WorkProfileResponse get(long userId, MeOverviewPeriod period) {
    return get(userId, period, OffsetDateTime.now(clock));
  }

  /**
   * 카드 조회 — 시각을 받는 판(테스트가 같은 패키지에서 부른다). 행이 있으면 그대로, 없으면 끝낸 이슈를 세어 0 이면 NONE(행을 만들지 않음), 있으면
   * PENDING 으로 점유하고 커밋 뒤 분석을 맡긴다. 10분 넘게 버려진 PENDING 행과, 주·달이 바뀌어 지난 기간을 담고 있는 행도 같은 길로 다시 점유한다. 자동
   * 시작이라 하루 상한을 세지 않는다.
   */
  @Transactional
  WorkProfileResponse get(long userId, MeOverviewPeriod period, OffsetDateTime now) {
    OffsetDateTime token = claimToken(now);
    LocalDate today = IssueDueWindow.seoulDate(token);
    OffsetDateTime staleBefore = token.minus(STALE_PENDING);
    MetricsPeriod range = period.resolve(today);
    Optional<WorkProfileRow> row = repository.find(userId, period);
    if (row.isPresent()) {
      // 재기동·롤아웃으로 워커가 사라져 버려진 PENDING(10분 넘음), 그리고 주·달이 바뀌었는데 08:00 갱신 전이라 지난 기간을 담은 행은 사람이
      // 누르지 않아도 다시 점유해 새 분석을 띄운다 — 첫 자동 시작과 같은 경로라 하루 상한은 세지 않는다. 그 밖의 행은 그대로 돌려준다.
      if (!isStalePending(row.get(), staleBefore) && !isRolledOver(row.get(), range)) {
        return WorkProfileResponse.of(row.get());
      }
    } else if (closedFacts(userId, range).isEmpty()) {
      return WorkProfileResponse.none(period, range);
    }

    if (repository.claimPending(userId, period, token, staleBefore)) {
      submitAfterCommit(userId, period, today, token);
    }
    return WorkProfileResponse.of(repository.find(userId, period).orElseThrow());
  }

  /** PENDING 인데 점유 시각이 staleBefore 보다 오래됐는가 — 워커가 죽어 버려진 점유. claimPending 의 다시 점유 조건과 같다. */
  private static boolean isStalePending(WorkProfileRow row, OffsetDateTime staleBefore) {
    return row.status() == WorkProfileStatus.PENDING
        && row.pendingSince() != null
        && row.pendingSince().isBefore(staleBefore);
  }

  /**
   * PENDING 이고 점유가 아직 살아 있는가(staleBefore 이후 점유) — 지금 다른 분석이 돌고 있다. PENDING 은 항상 pending_since 가
   * 있다(점유 때 함께 쓴다). {@link #isStalePending} 의 반대편이라 두 조건이 한 곳에서 맞물린다.
   */
  private static boolean isLivePending(WorkProfileRow row, OffsetDateTime staleBefore) {
    return row.status() == WorkProfileStatus.PENDING
        && row.pendingSince() != null
        && !row.pendingSince().isBefore(staleBefore);
  }

  /**
   * 저장 행이 지난 기간을 담고 있는가 — 기간 시작(주 월요일·달 1일 등)이 지금 기간과 다르면 주·달이 바뀐 것. 기간 끝은 날마다 움직이므로 보지 않는다. 분석
   * 중(PENDING)이거나 기간을 한 번도 적지 못한 행은 아니다. 실패(FAILED)도 점유한 기간을 적으므로, 새 기간 분석이 실패한 행은 다음 조회에서 다시 점유되지
   * 않는다 — 카드를 열 때마다 다시 분석하지 않게.
   */
  private static boolean isRolledOver(WorkProfileRow row, MetricsPeriod range) {
    return row.status() != WorkProfileStatus.PENDING
        && row.periodFrom() != null
        && !row.periodFrom().equals(range.from());
  }

  /** 점유 토큰 — DB(timestamptz) 정밀도인 마이크로초로 자른 「지금」. 그래야 저장 조건에서 같은 값으로 비교된다. */
  private static OffsetDateTime claimToken(OffsetDateTime now) {
    return now.truncatedTo(ChronoUnit.MICROS);
  }

  // ── 다시 분석 ──────────────────────────────────────────────────────────────

  /** 「다시 분석」 — 지금 시각 기준. */
  @Transactional
  public WorkProfileAnalyzeResponse analyze(long userId, MeOverviewPeriod period) {
    return analyze(userId, period, OffsetDateTime.now(clock));
  }

  /**
   * 「다시 분석」 — 시각을 받는 판. 행을 잠근 채 ① 하루 상한 ② 이미 분석 중 ③ 입력 지문이 그대로인지 순서로 따지고, 어디에도 걸리지 않으면 PENDING 으로
   * 점유한 뒤 커밋 뒤 분석을 맡긴다. 상한에 걸린 경우를 뺀 모든 호출은 하루 계수에 들어간다(같은 버튼을 연타해도 상한이 지켜지게). 단, 행이 없고 기간 안 끝낸 이슈도
   * 없으면 분석할 것이 없으므로 행을 만들지 않고 NONE·UNCHANGED 로 돌려준다(계수도 세지 않는다).
   *
   * @throws WorkProfileDailyLimitException 오늘 이미 {@link #DAILY_MANUAL_LIMIT} 번 눌렀을 때
   */
  @Transactional
  WorkProfileAnalyzeResponse analyze(long userId, MeOverviewPeriod period, OffsetDateTime now) {
    OffsetDateTime token = claimToken(now);
    LocalDate today = IssueDueWindow.seoulDate(token);
    OffsetDateTime staleBefore = token.minus(STALE_PENDING);
    Optional<WorkProfileRow> locked = repository.findForUpdate(userId, period);
    if (locked.isEmpty()) {
      // 행도 끝낸 이슈도 없으면 분석할 것이 없다 — 행을 만들면 빈 프로파일이 매일 갱신 대상으로 남고 하루 상한만 쓴다.
      MetricsPeriod range = period.resolve(today);
      if (closedFacts(userId, range).isEmpty()) {
        return new WorkProfileAnalyzeResponse(
            Outcome.UNCHANGED, WorkProfileResponse.none(period, range));
      }
    } else {
      WorkProfileRow row = locked.get();
      if (today.equals(row.manualDate()) && row.manualCount() >= DAILY_MANUAL_LIMIT) {
        throw new WorkProfileDailyLimitException();
      }
      if (isLivePending(row, staleBefore)) {
        return counted(userId, period, today, Outcome.ALREADY_RUNNING);
      }
      if (row.status() == WorkProfileStatus.READY
          && row.analyzedAt() != null
          && snapshot(userId, period, today).fingerprint().equals(row.fingerprint())) {
        return counted(userId, period, today, Outcome.UNCHANGED);
      }
    }
    if (!repository.claimPending(userId, period, token, staleBefore)) {
      // 잠근 뒤에 행이 없었는데 그 사이 다른 요청이 먼저 점유한 경우.
      return counted(userId, period, today, Outcome.ALREADY_RUNNING);
    }
    WorkProfileAnalyzeResponse res = counted(userId, period, today, Outcome.STARTED);
    submitAfterCommit(userId, period, today, token);
    return res;
  }

  /** 하루 계수를 올리고 처리 뒤 행으로 응답을 만든다. */
  private WorkProfileAnalyzeResponse counted(
      long userId, MeOverviewPeriod period, LocalDate today, Outcome outcome) {
    repository.countManualRun(userId, period, today);
    return new WorkProfileAnalyzeResponse(
        outcome, WorkProfileResponse.of(repository.find(userId, period).orElseThrow()));
  }

  // ── 주기 갱신 ──────────────────────────────────────────────────────────────

  /**
   * 스케줄러용 갱신 — 점유되면 호출한 스레드에서 바로(동기) 분석한다. 매일 갱신이 저장 행 전부를 워커 풀(2스레드·큐 100)에 한꺼번에 넣으면 넘친 행이
   * ERROR_BUSY 로 FAILED 가 되므로, 스케줄러 스레드가 한 건씩 차례로 돈다. 점유는 짧은 트랜잭션으로 커밋하고 AI HTTP 는 {@link
   * #runAnalysis} 가 트랜잭션 밖에서 부른다. 사람이 누른 것이 아니라 하루 상한을 세지 않는다. 호출자가 TenantContext 를 세운다.
   *
   * @return 이번 회차에 실제로 일어난 일(이미 분석 중이면 {@link RunResult#SKIPPED})
   */
  public RunResult refreshScheduled(long userId, MeOverviewPeriod period) {
    OffsetDateTime token = claimToken(OffsetDateTime.now(clock));
    LocalDate today = IssueDueWindow.seoulDate(token);
    Boolean claimed =
        txTemplate.execute(
            s -> repository.claimPending(userId, period, token, token.minus(STALE_PENDING)));
    if (!Boolean.TRUE.equals(claimed)) return RunResult.SKIPPED;
    return runAnalysis(userId, period, today, token);
  }

  // ── 워커 본체 ──────────────────────────────────────────────────────────────

  /**
   * 분석 한 회(워커 본체, 패키지 공개 — 테스트가 직접 부른다).
   *
   * <ol>
   *   <li>tx: 기간 범위·끝낸 이슈(최신 {@link #ANALYZE_CAP} 건)·표시 정보·지문·저장 행
   *   <li>지난 분석과 지문이 같으면 기간만 갱신하고 끝(AI 호출 없음)
   *   <li>대상이 없으면 빈 결과로 READY
   *   <li>비서가 없으면 FAILED
   *   <li>같은 tx 에서 라벨·구성요소·마지막 코멘트를 한 번에 읽어 요청을 만든다
   *   <li>tx 밖: AI 호출 — 빈 요약은 실패로 본다
   *   <li>어느 단계든 RuntimeException 이면 FAILED(이전 내용 유지, PENDING 을 남기지 않는다)
   *   <li>tx: 세기·역량 정리 결과로 READY
   * </ol>
   *
   * <p>모든 저장은 점유 토큰이 맞을 때만 한다 — 그 사이 다른 요청이 다시 점유했으면 결과를 버리고 {@link RunResult#SUPERSEDED}.
   *
   * @param token 이 분석을 띄운 점유의 {@code pending_since}
   */
  RunResult runAnalysis(
      long userId, MeOverviewPeriod period, LocalDate today, OffsetDateTime token) {
    try {
      return analyzeOnce(userId, period, today, token);
    } catch (RuntimeException e) {
      // 어느 단계(입력 모으기·비서 해석·AI 호출·빈 요약·저장)가 터져도 PENDING 이 남지 않게 FAILED 로 둔다 — 이전 내용은 유지된다.
      log.warn("업무 프로파일 분석 실패 userId={} period={}: {}", userId, period, e.toString());
      try {
        // 점유한 기간도 적는다 — 지난 기간이 남으면 카드 조회가 매번 다시 점유한다(markFailed 참조).
        MetricsPeriod range = period.resolve(today);
        Boolean written =
            txTemplate.execute(
                s -> repository.markFailed(userId, period, token, range, ERROR_ANALYZE));
        return written(Boolean.TRUE.equals(written), RunResult.FAILED, userId, period);
      } catch (RuntimeException markError) {
        // 실패 기록마저 안 되면 행은 PENDING 으로 남지만 10분 뒤 다시 점유된다(get·analyze·주기 갱신).
        log.error("업무 프로파일 실패 기록도 실패 userId={} period={}", userId, period, markError);
        return RunResult.FAILED;
      }
    }
  }

  /** 점유를 잃어 저장이 0행이면 결과를 버린 것으로 본다 — 새 점유의 분석이 결과를 채운다. */
  private static RunResult written(
      boolean written, RunResult ok, long userId, MeOverviewPeriod period) {
    if (written) return ok;
    log.debug("업무 프로파일 점유를 잃어 결과를 버림 userId={} period={} result={}", userId, period, ok);
    return RunResult.SUPERSEDED;
  }

  /** {@link #runAnalysis} 의 본체 — 실패는 예외로 올려 보내 호출부가 한 곳에서 FAILED 로 정리한다. */
  private RunResult analyzeOnce(
      long userId, MeOverviewPeriod period, LocalDate today, OffsetDateTime token) {
    Prepared prepared = txTemplate.execute(s -> prepare(userId, period, today, token));
    if (prepared.done() != null) return prepared.done();

    // tx 밖 — AI HTTP 는 커넥션을 붙잡지 않는다.
    WorkProfileAiResult result = client.analyzeWorkProfile(prepared.request());
    if (result == null || result.summary() == null || result.summary().isBlank()) {
      throw new IllegalStateException("AI 가 빈 요약을 반환했어요");
    }

    Snapshot snap = prepared.snapshot();
    // briefs 는 대상(targets)과 같은 이슈만 담는다 — snapshot 이 briefs 에 있는 이슈만 대상으로 삼는다.
    Set<String> keys =
        snap.briefs().values().stream().map(IssueBrief::key).collect(Collectors.toSet());
    Tally tally = WorkProfileCalc.tally(result.items(), keys);
    WorkProfileReady ready =
        new WorkProfileReady(
            snap.range(),
            snap.fingerprint(),
            snap.total(),
            snap.targets().size(),
            Texts.headUtf16(result.summary().trim(), SUMMARY_CHARS),
            tally.tasks(),
            tally.areas(),
            WorkProfileCalc.skills(result.skills()),
            OffsetDateTime.now(clock));
    Boolean saved = txTemplate.execute(s -> repository.saveReady(userId, period, token, ready));
    return written(Boolean.TRUE.equals(saved), RunResult.REFRESHED, userId, period);
  }

  /**
   * 워커 1단계(트랜잭션 안) — AI 를 불러야 하면 요청을 돌려주고, 그 전에 끝나면(그대로·빈 대상·비서 없음) 행을 정리하고 그 결과({@link
   * Prepared#done})를 돌려준다.
   */
  private Prepared prepare(
      long userId, MeOverviewPeriod period, LocalDate today, OffsetDateTime token) {
    Snapshot snap = snapshot(userId, period, today);
    Optional<WorkProfileRow> row = repository.find(userId, period);
    if (row.isPresent()
        && row.get().analyzedAt() != null
        && snap.fingerprint().equals(row.get().fingerprint())) {
      boolean ok = repository.markUnchanged(userId, period, token, snap.range(), snap.total());
      return Prepared.done(written(ok, RunResult.UNCHANGED, userId, period));
    }
    if (snap.targets().isEmpty()) {
      boolean ok =
          repository.saveReady(
              userId,
              period,
              token,
              new WorkProfileReady(
                  snap.range(),
                  snap.fingerprint(),
                  snap.total(),
                  0,
                  null,
                  List.of(),
                  List.of(),
                  List.of(),
                  OffsetDateTime.now(clock)));
      return Prepared.done(written(ok, RunResult.REFRESHED, userId, period));
    }
    Optional<AssistantSpec> spec = assistantResolver.resolveOrEmpty(userId);
    if (spec.isEmpty()) {
      boolean ok = repository.markFailed(userId, period, token, snap.range(), ERROR_NO_ASSISTANT);
      return Prepared.done(written(ok, RunResult.FAILED, userId, period));
    }
    return new Prepared(snap, toRequest(period, snap, spec.get()), null);
  }

  /** 대상 이슈의 라벨·구성요소·마지막 코멘트를 종류마다 한 번에 읽어 AI 요청을 만든다(닫힌 시각 내림차순 유지). */
  private WorkProfileAiRequest toRequest(
      MeOverviewPeriod period, Snapshot snap, AssistantSpec spec) {
    List<Long> ids = snap.targets().stream().map(ClosedIssueFact::issueId).toList();
    Map<Long, List<LabelSummary>> labels = labelRepository.findLabelsByIssueIds(ids);
    Map<Long, List<String>> components = inputRepository.findComponentNames(ids);
    Map<Long, String> comments = inputRepository.findLastComments(ids);
    List<WorkProfileAiRequest.Item> items =
        snap.targets().stream()
            .map(
                f -> {
                  IssueBrief b = snap.briefs().get(f.issueId());
                  String comment = comments.get(f.issueId());
                  return new WorkProfileAiRequest.Item(
                      b.key(),
                      b.title(),
                      b.body() == null ? "" : Texts.headUtf16(b.body(), BODY_CHARS),
                      b.typeName(),
                      labels.getOrDefault(f.issueId(), List.of()).stream()
                          .map(LabelSummary::name)
                          .toList(),
                      b.epicTitle(),
                      b.projectName(),
                      components.getOrDefault(f.issueId(), List.of()),
                      comment == null ? null : Texts.headUtf16(comment, COMMENT_CHARS),
                      WorkProfileCalc.dueResult(f));
                })
            .toList();
    return new WorkProfileAiRequest(
        periodLabel(period),
        items,
        spec.agentUserId(),
        spec.model(),
        spec.maxTurns(),
        spec.timeoutMs());
  }

  /** 프롬프트에 쓰는 기간 이름 — 화면 기간 고르기와 같은 말. */
  private static String periodLabel(MeOverviewPeriod period) {
    return switch (period) {
      case WEEK -> "이번 주";
      case MONTH -> "이번 달";
      case QUARTER -> "최근 3개월";
    };
  }

  // ── 입력 모으기 ────────────────────────────────────────────────────────────

  /**
   * 분석 대상 스냅숏(트랜잭션 안에서 부른다) — 기간 안 끝낸 이슈 전부를 세고, 최신 {@link #ANALYZE_CAP} 건 중 지금도 지워지지 않은 이슈를 대상으로
   * 삼아 지문을 만든다.
   */
  private Snapshot snapshot(long userId, MeOverviewPeriod period, LocalDate today) {
    MetricsPeriod range = period.resolve(today);
    List<ClosedIssueFact> facts = closedFacts(userId, range);
    List<ClosedIssueFact> capped = facts.stream().limit(ANALYZE_CAP).toList();
    Map<Long, IssueBrief> briefs =
        inputRepository.findBriefs(capped.stream().map(ClosedIssueFact::issueId).toList());
    List<ClosedIssueFact> targets =
        capped.stream().filter(f -> briefs.containsKey(f.issueId())).toList();
    String fingerprint =
        WorkProfileCalc.fingerprint(targets.stream().map(f -> briefs.get(f.issueId())).toList());
    return new Snapshot(range, facts.size(), targets, briefs, fingerprint);
  }

  /** 기간 안 내가 담당으로 끝낸 이슈(닫힌 시각 내림차순) — 「완료」 정의는 지표 모듈 하나로 맞춘다(지난 기간·칸 묶음은 계산하지 않는 좁은 진입점). */
  private List<ClosedIssueFact> closedFacts(long userId, MetricsPeriod range) {
    return metricsService.closedIssuesForMe(userId, range);
  }

  // ── 제출 ───────────────────────────────────────────────────────────────────

  /**
   * 분석을 워커에 맡긴다. 트랜잭션 안이면 커밋 뒤에 제출한다 — 워커가 커밋된 PENDING 행을 봐야 하고, 롤백되면 돌 이유가 없다(커밋하지 않는
   * {@code @Transactional} 테스트에서는 워커가 돌지 않는다). 풀이 넘쳐 거절되면 행을 FAILED 로 둬 PENDING 이 남지 않게 한다.
   */
  private void submitAfterCommit(
      long userId, MeOverviewPeriod period, LocalDate today, OffsetDateTime token) {
    // AfterCommit 은 「미룬 일은 DB 를 쓰지 않는다」가 원칙이지만, 여기서 DB 를 쓰는 건 풀이 넘친 드문 거절 경로뿐이고 REQUIRES_NEW 로 따로
    // 쓴다.
    AfterCommit.run(() -> submit(userId, period, today, token));
  }

  /**
   * 실제 제출 — 거절이면 새 트랜잭션으로 FAILED 기록(afterCommit 안에서도 안전하게). 이 기록마저 실패해도 예외를 올리지 않는다 — 점유는 이미 커밋돼
   * HTTP 호출자에게 500 을 줄 이유가 없고, 남은 PENDING 은 10분 뒤 다시 점유된다.
   */
  void submit(long userId, MeOverviewPeriod period, LocalDate today, OffsetDateTime token) {
    try {
      executor.execute(() -> runAnalysis(userId, period, today, token));
    } catch (TaskRejectedException e) {
      log.warn("업무 프로파일 분석 제출 거절 userId={} period={}", userId, period);
      try {
        newTxTemplate.executeWithoutResult(
            s -> repository.markFailed(userId, period, token, period.resolve(today), ERROR_BUSY));
      } catch (RuntimeException markError) {
        log.error("업무 프로파일 거절 기록 실패 userId={} period={}", userId, period, markError);
      }
    }
  }

  /**
   * 분석 대상 스냅숏.
   *
   * @param total 기간 안 끝낸 이슈 전체 수(상한 전)
   * @param targets 실제 AI 에 보낼 이슈(최신 상한 건 중 지워지지 않은 것, 닫힌 시각 내림차순)
   * @param briefs 대상 표시 정보
   * @param fingerprint 대상 지문
   */
  private record Snapshot(
      MetricsPeriod range,
      int total,
      List<ClosedIssueFact> targets,
      Map<Long, IssueBrief> briefs,
      String fingerprint) {}

  /**
   * 워커 1단계 결과 — AI 를 불러야 할 때의 스냅숏과 요청. AI 없이 끝났으면 snapshot·request 는 null 이고 {@code done} 에 결과가 있다.
   */
  private record Prepared(Snapshot snapshot, WorkProfileAiRequest request, RunResult done) {

    /** AI 없이 끝난 경우. */
    static Prepared done(RunResult result) {
      return new Prepared(null, null, result);
    }
  }
}
