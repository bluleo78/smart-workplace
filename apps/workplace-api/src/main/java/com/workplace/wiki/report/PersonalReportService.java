package com.workplace.wiki.report;

import com.workplace.auth.service.AssistantResolver;
import com.workplace.global.util.AfterCommit;
import com.workplace.issue.report.PersonalReportKind;
import com.workplace.issue.report.PersonalReportPeriod;
import com.workplace.issue.report.ReportCadence;
import com.workplace.wiki.report.PersonalReportRepository.Existing;
import com.workplace.wiki.report.PersonalReportRepository.Reservation;
import com.workplace.wiki.report.PersonalReportRepository.ReserveStatus;
import com.workplace.wiki.report.dto.CreatePersonalReportRequest;
import com.workplace.wiki.report.dto.PersonalReportLookupResponse;
import com.workplace.wiki.report.dto.PersonalReportStatusResponse;
import com.workplace.wiki.service.WikiSystemPageWriter;
import java.time.Clock;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.YearMonth;
import java.time.format.DateTimeParseException;
import java.util.Optional;
import java.util.concurrent.Executor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.core.task.TaskRejectedException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 「보고서 만들기」(WP-1486) — 일일·주간·월간 보고를 사람이 눌러 만든다. 요청은 회차를 PENDING 으로 예약하고 202 로 바로 답하며, 생성(AI 1~3분)은
 * {@code personalReportExecutor} 가 트랜잭션 밖에서 한다(P15 — 화면은 3초마다 {@link #status} 로 묻고, 창을 닫아도 계속된다).
 * 대상은 언제나 호출자 본인이다.
 *
 * <p>만들기 순서: 기간(빠진 값·모르는 종류 400) → 미래 거절(400) → 비서 없음(409 NO_ASSISTANT) → 오늘(KST 0시부터) 수동 20번
 * 상한(429) → 같은 회차에 살아 있는 보고가 있고 「새로 만들기」가 아니면 409 REPORT_EXISTS(pageId·제목) → 예약(만드는 중이면 409
 * REPORT_IN_PROGRESS + 그 id) → 커밋 뒤 실행기에 맡김. 실행기가 꽉 차 거절하면 회차를 FAILED + 안내 문구로 닫는다.
 */
@Slf4j
@Service
public class PersonalReportService {

  /** 수동 만들기 사람별 하루(서울 날짜) 상한(P12). */
  static final int DAILY_MANUAL_LIMIT = 20;

  /** 실행기가 거절했을 때 회차에 남기는 문구. */
  static final String ERROR_BUSY = "지금은 보고를 만들 수 없어요. 잠시 뒤 다시 시도해 주세요.";

  private static final String MANUAL = "MANUAL";

  private final PersonalReportRepository reports;
  private final AssistantResolver assistantResolver;
  private final PersonalReportGenerator generator;
  private final WikiSystemPageWriter writer;
  private final Executor executor;
  private final TransactionTemplate tx;

  /** 커밋 뒤(afterCommit) 콜백에서도 안전한 새 트랜잭션 — 실행기 거절 기록용. */
  private final TransactionTemplate newTx;

  /** 「지금」의 기준 시계. */
  private final Clock clock = Clock.systemUTC();

  /**
   * 만들기 응답(202).
   *
   * @param id 예약한 회차 id — {@link #status} 로 묻는다
   * @param status 언제나 PENDING
   */
  public record CreateResult(long id, String status) {}

  public PersonalReportService(
      PersonalReportRepository reports,
      AssistantResolver assistantResolver,
      PersonalReportGenerator generator,
      WikiSystemPageWriter writer,
      @Qualifier("personalReportExecutor") Executor executor,
      PlatformTransactionManager txManager) {
    this.reports = reports;
    this.assistantResolver = assistantResolver;
    this.generator = generator;
    this.writer = writer;
    this.executor = executor;
    this.tx = new TransactionTemplate(txManager);
    this.newTx = new TransactionTemplate(txManager);
    this.newTx.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
  }

  /** 「보고서 만들기」 — 지금 시각 기준. */
  public CreateResult create(long userId, CreatePersonalReportRequest req) {
    return create(userId, req, OffsetDateTime.now(clock));
  }

  /**
   * 「보고서 만들기」(시각을 받는 판) — 클래스 설명의 순서대로 따지고 회차를 예약한다.
   *
   * @throws IllegalArgumentException 기간 값이 빠졌거나 틀렸거나 미래일 때(400)
   * @throws PersonalReportConflictException 비서 없음·이미 있음·만드는 중(409)
   * @throws PersonalReportDailyLimitException 오늘 이미 {@link #DAILY_MANUAL_LIMIT} 번 만들었을 때(429)
   */
  public CreateResult create(long userId, CreatePersonalReportRequest req, OffsetDateTime now) {
    PersonalReportPeriod period = period(req);
    LocalDate today = now.atZoneSameInstant(ReportCadence.KST).toLocalDate();
    period.requireNotFuture(today);
    boolean force = Boolean.TRUE.equals(req.force());
    OffsetDateTime since = today.atStartOfDay(ReportCadence.KST).toOffsetDateTime();

    long id =
        tx.execute(
            s -> {
              if (assistantResolver.resolveOrEmpty(userId).isEmpty()) {
                throw PersonalReportConflictException.noAssistant();
              }
              // 세기 전에 이 사람의 잠금을 잡는다 — 동시 요청이 둘 다 19번을 세고 함께 넣어 상한을 넘지 않게(예약 insert 까지 같은 트랜잭션).
              reports.lockUser(userId);
              if (reports.countManualSince(userId, since) >= DAILY_MANUAL_LIMIT) {
                throw new PersonalReportDailyLimitException();
              }
              if (!force) {
                Optional<Existing> existing = reports.latestGenerated(userId, period);
                if (existing.isPresent()) {
                  throw PersonalReportConflictException.exists(
                      existing.get().pageId(), existing.get().title());
                }
              }
              Reservation r = reports.reserve(userId, period, MANUAL, now);
              if (r.status() == ReserveStatus.IN_PROGRESS) {
                throw PersonalReportConflictException.inProgress(r.id());
              }
              // 수동은 그날 닫힘 규칙(자동 전용)을 쓰지 않아, DUPLICATE 는 같은 회차 PENDING 과 insert 가 부딪쳤는데 다시 보니 그 행이
              // 이미
              // 끝난 드문 경쟁뿐이다. 500 대신 「만드는 중」 409 로 답한다 — 이어 볼 id 가 없어 화면은 문구만 보이고, 다시 누르면 정상으로 돈다.
              if (r.status() != ReserveStatus.RESERVED) {
                log.warn(
                    "개인 보고 예약 경쟁 userId={} kind={} start={}",
                    userId,
                    period.kind(),
                    period.start());
                throw PersonalReportConflictException.inProgress(null);
              }
              return r.id();
            });
    submitAfterCommit(id);
    return new CreateResult(id, "PENDING");
  }

  /** 회차 상태 — 남의 id 면 비어 있다(404). */
  public Optional<PersonalReportStatusResponse> status(long userId, long id) {
    return tx.execute(
        s ->
            reports
                .find(userId, id)
                .map(
                    row -> {
                      String title =
                          row.pageId() == null ? null : writer.findTitle(row.pageId()).orElse(null);
                      return new PersonalReportStatusResponse(
                          row.id(), row.status(), row.pageId(), title, row.error());
                    }));
  }

  /** 그 날이 든 회차(하루·주·달)의 가장 최근 보고 노트 — 없거나 지웠으면 비어 있다(204). */
  public Optional<PersonalReportLookupResponse> lookup(
      long userId, PersonalReportKind kind, LocalDate date) {
    if (date == null) throw new IllegalArgumentException("날짜를 지정해 주세요");
    PersonalReportPeriod period = PersonalReportPeriod.of(kind, date);
    return tx.execute(
        s ->
            reports
                .latestGenerated(userId, period)
                .map(e -> new PersonalReportLookupResponse(e.pageId(), e.title(), e.createdAt())));
  }

  /** 요청 → 회차. 종류에 맞는 기간 값이 없거나 틀리면 IllegalArgumentException(400). */
  private static PersonalReportPeriod period(CreatePersonalReportRequest req) {
    PersonalReportKind kind = PersonalReportKind.parse(req.kind());
    return switch (kind) {
      case DAILY -> PersonalReportPeriod.daily(required(req.date(), "보고할 날짜를 지정해 주세요"));
      case WEEKLY -> PersonalReportPeriod.weekly(required(req.weekStart(), "보고할 주를 지정해 주세요"));
      case MONTHLY -> PersonalReportPeriod.monthly(month(req.month()));
    };
  }

  private static <T> T required(T value, String message) {
    if (value == null) throw new IllegalArgumentException(message);
    return value;
  }

  /** 「2026-10」 → 달. */
  private static YearMonth month(String value) {
    try {
      return YearMonth.parse(required(value, "보고할 달을 지정해 주세요"));
    } catch (DateTimeParseException e) {
      throw new IllegalArgumentException("달은 「2026-10」 모양으로 지정해 주세요");
    }
  }

  /**
   * 생성을 실행기에 맡긴다. 트랜잭션 동기화가 켜져 있으면 커밋 뒤에 맡긴다 — 워커가 커밋된 PENDING 행을 봐야 하고, 롤백되면 돌 이유가 없다(커밋하지 않는
   * {@code @Transactional} 테스트에서는 돌지 않는다). 동기화가 없으면(컨트롤러 경로 — 서비스가 스스로 트랜잭션을 닫았다) 바로 맡긴다.
   */
  private void submitAfterCommit(long id) {
    // AfterCommit 은 「미룬 일은 DB 를 쓰지 않는다」가 원칙이지만, 여기서 DB 를 쓰는 건 풀이 넘친 드문 거절 경로뿐이고 REQUIRES_NEW 로 따로
    // 쓴다(업무 프로파일과 같은 방식).
    AfterCommit.run(() -> submit(id));
  }

  /**
   * 실제 제출 — 워커는 트랜잭션 밖에서 생성기를 부른다(AI 호출·본문 쓰기를 트랜잭션에 묶지 않는다). 거절이면 새 트랜잭션으로 FAILED 를 적는다. 이 기록마저
   * 실패해도 예외를 올리지 않는다 — 남은 PENDING 은 30분 뒤 이어받을 수 있다.
   */
  private void submit(long id) {
    try {
      executor.execute(() -> generator.runManual(id, OffsetDateTime.now(clock)));
    } catch (TaskRejectedException e) {
      log.warn("개인 보고 생성 제출 거절 reportId={}", id);
      try {
        newTx.executeWithoutResult(
            s -> reports.markFailed(id, ERROR_BUSY, OffsetDateTime.now(clock)));
      } catch (RuntimeException markError) {
        log.error("개인 보고 거절 기록 실패 reportId={}", id, markError);
      }
    }
  }
}
