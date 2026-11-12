package com.workplace.wiki.report;

import static org.jooq.impl.DSL.field;
import static org.jooq.impl.DSL.name;
import static org.jooq.impl.DSL.table;

import com.workplace.issue.report.PersonalReportKind;
import com.workplace.issue.report.PersonalReportPeriod;
import com.workplace.issue.report.ReportCadence;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.jooq.Condition;
import org.jooq.DSLContext;
import org.jooq.Field;
import org.jooq.Record;
import org.jooq.Table;
import org.springframework.stereotype.Repository;

/**
 * 개인 보고 회차(personal_report, V290) 저장소(WP-1486). 같은 회차를 「새로 만들기」로 여러 편 만들 수 있어 행 unique 는 걸지 않고, 부분
 * unique 두 개로 동시성만 막는다 — 진행 중(PENDING)은 회차당 하나, 자동(AUTO) 일일은 날마다 한 번(비-PENDING 기록이 있으면 다시 안 만듦).
 *
 * <p>상태: PENDING(생성 중 예약) → GENERATED(페이지 만듦) / SKIPPED(한 일 없음 — 페이지 없이 기록만) / FAILED(포기). 실패하면
 * {@link #release} 로 PENDING 을 풀어(페이지가 없으면 행 삭제, 있으면 바로 이어받게) 재시도가 페이지를 또 만들지 않게 한다.
 *
 * <p>jOOQ 코드 생성 없이 이름(DSL.name)으로 다룬다 — {@code trigger} 컬럼은 따옴표 처리된다. 모든 메서드는 트랜잭션 안에서 불러야 한다.
 */
@Repository
@RequiredArgsConstructor
public class PersonalReportRepository {

  /** PENDING 예약을 다른 실행이 이어받을 수 있게 되는 시간(분) — 생성이 이보다 오래 걸리면 실행 중 파드가 죽은 것으로 본다. */
  static final long STALE_PENDING_MINUTES = 30;

  private static final String TBL = "personal_report";
  private static final Table<?> T = table(name(TBL));
  private static final Field<Long> ID = field(name(TBL, "id"), Long.class);
  private static final Field<Long> USER_ID = field(name(TBL, "user_id"), Long.class);
  private static final Field<String> KIND = field(name(TBL, "kind"), String.class);
  private static final Field<LocalDate> PERIOD_START =
      field(name(TBL, "period_start"), LocalDate.class);
  private static final Field<LocalDate> PERIOD_END =
      field(name(TBL, "period_end"), LocalDate.class);
  private static final Field<String> TRIGGER = field(name(TBL, "trigger"), String.class);
  private static final Field<String> STATUS = field(name(TBL, "status"), String.class);
  private static final Field<Long> PAGE_ID = field(name(TBL, "page_id"), Long.class);
  private static final Field<Integer> COMPLETED = field(name(TBL, "completed"), Integer.class);
  private static final Field<Integer> CREATED = field(name(TBL, "created"), Integer.class);
  private static final Field<Integer> STATUS_CHANGED =
      field(name(TBL, "status_changed"), Integer.class);
  private static final Field<String> ERROR = field(name(TBL, "error"), String.class);
  private static final Field<OffsetDateTime> RESERVED_AT =
      field(name(TBL, "reserved_at"), OffsetDateTime.class);
  private static final Field<OffsetDateTime> CREATED_AT =
      field(name(TBL, "created_at"), OffsetDateTime.class);

  private static final Table<?> PAGE = table(name("wiki_page"));
  private static final Field<Long> PAGE_PK = field(name("wiki_page", "id"), Long.class);
  private static final Field<String> PAGE_TITLE = field(name("wiki_page", "title"), String.class);

  /** 푼 예약의 reserved_at — 30분 조건과 상관없이 바로 이어받게 아주 옛날로 둔다. */
  private static final OffsetDateTime RELEASED_AT = OffsetDateTime.parse("1970-01-01T00:00:00Z");

  private static final String PENDING = "PENDING";
  private static final String GENERATED = "GENERATED";
  private static final String SKIPPED = "SKIPPED";
  private static final String FAILED = "FAILED";
  private static final String AUTO = "AUTO";
  private static final String MANUAL = "MANUAL";

  /** 사람별 수동 만들기 잠금 classId — 다른 advisory lock 네임스페이스와 겹치지 않게 이슈 번호로. */
  private static final int USER_LOCK_CLASS = 1486;

  private final DSLContext dsl;

  /** 예약 결과 종류 — RESERVED 면 이 실행이 그 회차를 만든다. */
  public enum ReserveStatus {
    /** 새로 예약했거나 30분 넘게 묵은 PENDING 을 이어받았다. */
    RESERVED,
    /** 자동인데 그날은 이미 처리됐거나 살아 있는 보고가 있다 — 만들지 않는다. */
    DUPLICATE,
    /** 같은 회차를 다른 실행이 만드는 중(30분 안의 PENDING)이다. */
    IN_PROGRESS
  }

  /**
   * 예약 결과.
   *
   * @param id 예약한(또는 진행 중인) 행 id — DUPLICATE 면 null
   */
  public record Reservation(ReserveStatus status, Long id) {}

  /** 회차 한 행. */
  public record ReportRow(
      long id,
      long userId,
      PersonalReportKind kind,
      LocalDate start,
      LocalDate end,
      String trigger,
      String status,
      Long pageId,
      String error,
      OffsetDateTime createdAt) {}

  /** 이미 만든 보고(살아 있는 페이지가 있는 GENERATED) — 「이미 있음 — {제목}」 안내용. */
  public record Existing(long id, long pageId, String title, OffsetDateTime createdAt) {}

  /**
   * 회차를 예약한다. 순서: (1) 같은 회차 PENDING 이 있으면 30분 넘은 것은 이어받고(RESERVED) 아니면 IN_PROGRESS, (2) AUTO 는 같은 날
   * AUTO 비-PENDING 행이나 그날이 끝난 뒤 만든 살아 있는 수동 GENERATED 가 있으면 DUPLICATE({@link #autoDayClosed}), (3)
   * 아니면 PENDING 행을 넣는다 — 동시 insert 에서 진 쪽은 IN_PROGRESS. 수동은 SKIPPED 날도 다시 만들 수 있다(건너뜀 규칙은 자동 전용).
   */
  public Reservation reserve(
      long userId, PersonalReportPeriod p, String trigger, OffsetDateTime now) {
    Optional<Long> pending = pendingId(userId, p);
    if (pending.isPresent()) return takeOverOrBusy(pending.get(), now);

    if (AUTO.equals(trigger) && autoDayClosed(userId, p)) {
      return new Reservation(ReserveStatus.DUPLICATE, null);
    }

    Optional<Long> inserted =
        dsl.insertInto(T)
            .columns(
                USER_ID, KIND, PERIOD_START, PERIOD_END, TRIGGER, STATUS, RESERVED_AT, CREATED_AT)
            .values(userId, p.kind().name(), p.start(), p.end(), trigger, PENDING, now, now)
            .onConflictDoNothing()
            .returning(ID)
            .fetchOptional()
            .map(r -> r.get(ID));
    if (inserted.isPresent()) return new Reservation(ReserveStatus.RESERVED, inserted.get());

    // 충돌 — 동시에 같은 회차를 예약한 쪽이 있다(PENDING unique). 그 행을 알려 준다.
    return pendingId(userId, p)
        .map(id -> new Reservation(ReserveStatus.IN_PROGRESS, id))
        .orElseGet(() -> new Reservation(ReserveStatus.DUPLICATE, null));
  }

  /**
   * 이 사람의 수동 만들기를 한 줄로 세우는 트랜잭션 advisory 락(WP-1486) — 하루 상한(20번)의 「세기 → 예약 insert」가 동시 요청 사이에 끼어들어
   * 21번째가 들어가지 않게 세기 전에 잡는다. 2-인자 pg_advisory_xact_lock(classId, userId) 꼴이며 트랜잭션이 끝나면 풀린다.
   */
  public void lockUser(long userId) {
    dsl.execute("SELECT pg_advisory_xact_lock(?, ?)", USER_LOCK_CLASS, (int) userId);
  }

  /** 남의 id 면 비어 있다 — 사용자 화면(폴링)용. */
  public Optional<ReportRow> find(long userId, long id) {
    return select().where(ID.eq(id)).and(USER_ID.eq(userId)).fetchOptional(r -> toRow(r));
  }

  /** 사용자 확인 없이 id 로만 — 실행기 스레드용(요청 스레드가 이미 소유를 확인했다). */
  public Optional<ReportRow> findById(long id) {
    return select().where(ID.eq(id)).fetchOptional(r -> toRow(r));
  }

  /** 그 회차의 가장 최근 GENERATED(페이지가 살아 있는 것) — 제목은 노트 제목. 페이지를 지웠으면 없다고 본다. */
  public Optional<Existing> latestGenerated(long userId, PersonalReportPeriod p) {
    return dsl.select(ID, PAGE_ID, PAGE_TITLE, CREATED_AT)
        .from(T)
        .join(PAGE)
        .on(PAGE_PK.eq(PAGE_ID))
        .where(USER_ID.eq(userId))
        .and(isPeriod(p))
        .and(STATUS.eq(GENERATED))
        .and(PAGE_ID.isNotNull())
        .orderBy(CREATED_AT.desc(), ID.desc())
        .limit(1)
        .fetchOptional(
            r -> new Existing(r.get(ID), r.get(PAGE_ID), r.get(PAGE_TITLE), r.get(CREATED_AT)));
  }

  /** 「(n)」 번호용 — 그 회차에 만든 페이지 수(GENERATED 는 페이지가 지워졌어도 세고, FAILED 는 페이지를 남긴 것만 센다). */
  public int countGenerated(long userId, PersonalReportPeriod p) {
    return dsl.fetchCount(
        T,
        USER_ID
            .eq(userId)
            .and(isPeriod(p))
            .and(STATUS.eq(GENERATED).or(STATUS.eq(FAILED).and(PAGE_ID.isNotNull()))));
  }

  /** 하루 상한용 — since 이후 만든 수동 회차 수. */
  public int countManualSince(long userId, OffsetDateTime since) {
    return dsl.fetchCount(T, USER_ID.eq(userId).and(TRIGGER.eq(MANUAL)).and(CREATED_AT.ge(since)));
  }

  /** 예약한 회차에 방금 만든 페이지를 적는다 — 이후 실패해도 재시도가 이 페이지를 다시 쓴다. */
  public void attachPage(long id, long pageId) {
    dsl.update(T).set(PAGE_ID, pageId).where(ID.eq(id)).and(STATUS.eq(PENDING)).execute();
  }

  /** 예약 중 회차에 이미 만든 페이지(앞선 시도가 만든 뒤 실패했을 때). */
  public Optional<Long> pendingPageId(long id) {
    return dsl.select(PAGE_ID)
        .from(T)
        .where(ID.eq(id))
        .and(STATUS.eq(PENDING))
        .and(PAGE_ID.isNotNull())
        .fetchOptional(PAGE_ID);
  }

  /**
   * 만듦 기록 — 페이지·숫자·만든 시각(부른 쪽의 「지금」 — 시각을 받는 판·테스트가 같은 기준을 쓰게 DB·JVM 시계를 따로 읽지 않는다). 아래 세 mark 는 모두
   * PENDING 행만 바꾼다 — 느린 실행이 30분 뒤 다른 실행에 이어받혀 그쪽이 이미 끝낸 행을 뒤늦게 뒤집지 않게.
   */
  public void markGenerated(
      long id, long pageId, int completed, int created, int statusChanged, OffsetDateTime now) {
    dsl.update(T)
        .set(STATUS, GENERATED)
        .set(PAGE_ID, pageId)
        .set(COMPLETED, completed)
        .set(CREATED, created)
        .set(STATUS_CHANGED, statusChanged)
        .set(CREATED_AT, now)
        .where(ID.eq(id))
        .and(STATUS.eq(PENDING))
        .execute();
  }

  /** 한 일 없음 기록 — 페이지 없이 숫자만 남긴다(자동 일일이 건너뛴 날). */
  public void markSkipped(
      long id, int completed, int created, int statusChanged, OffsetDateTime now) {
    dsl.update(T)
        .set(STATUS, SKIPPED)
        .setNull(PAGE_ID)
        .set(COMPLETED, completed)
        .set(CREATED, created)
        .set(STATUS_CHANGED, statusChanged)
        .set(CREATED_AT, now)
        .where(ID.eq(id))
        .and(STATUS.eq(PENDING))
        .execute();
  }

  /** 포기 기록 — 오류 문구(앞 500자). 페이지가 있으면 남긴다. PENDING 행만(이미 끝난 행은 그대로). */
  public void markFailed(long id, String error, OffsetDateTime now) {
    dsl.update(T)
        .set(STATUS, FAILED)
        .set(ERROR, ReportErrors.trim(error))
        .set(CREATED_AT, now)
        .where(ID.eq(id))
        .and(STATUS.eq(PENDING))
        .execute();
  }

  /**
   * 예약을 푼다(실패). 페이지가 없으면 PENDING 행을 지우고, 있으면 행을 두고 예약 시각만 아주 옛날로 돌려 다음 시도가 바로 이어받게 한다 — 지우면 재시도가
   * 페이지를 또 만든다.
   */
  public void release(long id) {
    dsl.deleteFrom(T).where(ID.eq(id)).and(STATUS.eq(PENDING)).and(PAGE_ID.isNull()).execute();
    dsl.update(T)
        .set(RESERVED_AT, RELEASED_AT)
        .where(ID.eq(id))
        .and(STATUS.eq(PENDING))
        .and(PAGE_ID.isNotNull())
        .execute();
  }

  /**
   * 자동 3회째 실패로 그날을 닫는다 — release 가 페이지 없는 PENDING 행을 지웠을 때 AUTO·FAILED 행을 남겨 {@code
   * uq_personal_report_auto} 로 그날을 다시 만들지 않게 한다. 이미 그날 AUTO 기록이 있으면 건드리지 않는다.
   */
  public void insertFailed(long userId, PersonalReportPeriod p, String error, OffsetDateTime now) {
    dsl.insertInto(T)
        .columns(
            USER_ID,
            KIND,
            PERIOD_START,
            PERIOD_END,
            TRIGGER,
            STATUS,
            ERROR,
            RESERVED_AT,
            CREATED_AT)
        .values(
            userId,
            p.kind().name(),
            p.start(),
            p.end(),
            AUTO,
            FAILED,
            ReportErrors.trim(error),
            now,
            now)
        .onConflictDoNothing()
        .execute();
  }

  /** 30분 넘게 묵은 PENDING 이면 이어받고(RESERVED), 아니면 다른 실행이 만드는 중이다(IN_PROGRESS). */
  private Reservation takeOverOrBusy(long id, OffsetDateTime now) {
    int taken =
        dsl.update(T)
            .set(RESERVED_AT, now)
            .where(ID.eq(id))
            .and(STATUS.eq(PENDING))
            .and(RESERVED_AT.lt(now.minusMinutes(STALE_PENDING_MINUTES)))
            .execute();
    return new Reservation(taken == 1 ? ReserveStatus.RESERVED : ReserveStatus.IN_PROGRESS, id);
  }

  /**
   * 자동 일일이 이미 닫힌 날인가 — 그날 AUTO 비-PENDING 기록이 있거나, 그날이 끝난 뒤(period_end 다음 날 0시 KST 이후) 만든 살아 있는 수동
   * GENERATED 가 있다. 그날 낮에 수동으로 만든 일일은 하루가 끝나기 전 내용이라 자동 일일을 막지 않는다(컨트롤러 판정).
   */
  public boolean autoDayClosed(long userId, PersonalReportPeriod p) {
    OffsetDateTime dayOver = p.end().plusDays(1).atStartOfDay(ReportCadence.KST).toOffsetDateTime();
    Condition autoDone =
        USER_ID
            .eq(userId)
            .and(KIND.eq(p.kind().name()))
            .and(PERIOD_START.eq(p.start()))
            .and(TRIGGER.eq(AUTO))
            .and(STATUS.ne(PENDING));
    Condition liveGenerated =
        USER_ID
            .eq(userId)
            .and(isPeriod(p))
            .and(STATUS.eq(GENERATED))
            .and(PAGE_ID.isNotNull())
            .and(CREATED_AT.ge(dayOver));
    return dsl.fetchExists(T, autoDone.or(liveGenerated));
  }

  private Optional<Long> pendingId(long userId, PersonalReportPeriod p) {
    return dsl.select(ID)
        .from(T)
        .where(USER_ID.eq(userId))
        .and(isPeriod(p))
        .and(STATUS.eq(PENDING))
        .fetchOptional(ID);
  }

  private org.jooq.SelectJoinStep<? extends Record> select() {
    return dsl.select(
            ID,
            USER_ID,
            KIND,
            PERIOD_START,
            PERIOD_END,
            TRIGGER,
            STATUS,
            PAGE_ID,
            ERROR,
            CREATED_AT)
        .from(T);
  }

  private static Condition isPeriod(PersonalReportPeriod p) {
    return KIND.eq(p.kind().name()).and(PERIOD_START.eq(p.start())).and(PERIOD_END.eq(p.end()));
  }

  private static ReportRow toRow(Record r) {
    return new ReportRow(
        r.get(ID),
        r.get(USER_ID),
        PersonalReportKind.valueOf(r.get(KIND)),
        r.get(PERIOD_START),
        r.get(PERIOD_END),
        r.get(TRIGGER),
        r.get(STATUS),
        r.get(PAGE_ID),
        r.get(ERROR),
        r.get(CREATED_AT));
  }
}
