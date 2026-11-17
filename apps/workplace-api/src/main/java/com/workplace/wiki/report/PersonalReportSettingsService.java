package com.workplace.wiki.report;

import com.workplace.auth.service.AssistantResolver;
import com.workplace.issue.report.PersonalReportKind;
import com.workplace.issue.report.PersonalReportPeriod;
import com.workplace.issue.report.ReportCadence;
import com.workplace.wiki.report.PersonalReportSettingRepository.SettingRow;
import com.workplace.wiki.report.dto.PersonalReportSettingsResponse;
import com.workplace.wiki.report.dto.UpdatePersonalReportSettingsRequest;
import com.workplace.wiki.service.WikiSystemPageWriter;
import java.time.Clock;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.OffsetDateTime;
import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.regex.Pattern;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 개인 보고 설정(WP-1486) — 「보고서 설정」 창의 읽기·저장·템플릿 되돌리기. 대상은 언제나 호출자 본인이다(사용자 id 를 요청에서 받지 않는다).
 *
 * <ul>
 *   <li>읽기: 행이 없으면 기본값(꺼짐·09:00·건너뜀 켬). 「보고」·공간은 찾기만 하고 만들지 않는다. 템플릿 id 는 내 노트 공간 안에 있을 때만
 *       낸다(WP-1655 — 공간 안 어디로 옮겨도 그대로, 경로는 실제 위치) — 지웠거나 다른 공간으로 옮겼으면 「켜면 노트에 만들어요」로 보이고 다음 켜기·생성 때
 *       「템플릿」 아래 다시 복사된다
 *   <li>저장: 켜면 「템플릿」 아래 일일·주간 템플릿을 보장하고(P16 — 켜는 순간 복사, 첫 보고는 다음 설정 시각, 「보고」는 첫 보고 때) 다음 실행 시각을 다음
 *       그 시각(KST)으로 정한다. 끄면 비운다. 비서가 없어도 켤 수는 있다(P10 — 만들 때 건너뜀)
 *   <li>되돌리기: 일일·주간 템플릿만(월간은 주간 템플릿을 쓴다 — 400)
 *   <li>저장 위치 바꾸기(WP-1655): 새 보고를 둘 내 노트 페이지를 고른다(검증은 {@link PersonalReportLocation})
 *   <li>모든 설정 쓰기(저장·되돌리기·위치 바꾸기)는 요청 검사(400)를 먼저 하고, 그다음 「템플릿을 다시 만들었어요」 알림을 지우고 옛 「보고」 아래 템플릿을 한 번
 *       「템플릿」으로 옮긴다(스펙 「다음 설정 저장·보고 만들기 때」) — 거절된 요청은 아무것도 바꾸지 않는다
 * </ul>
 *
 * <p>이 서비스는 일부러 {@code @Transactional} 이 아니다 — 템플릿 본문 쓰기가 동기화 서버 위임 경로라 트랜잭션 밖이어야 한다. 설정 행 읽기·쓰기만
 * 짧은 트랜잭션(RLS GUC 주입)으로 감싼다({@link ProjectReportSettingsService} 와 같은 방식).
 */
@Service
public class PersonalReportSettingsService {

  /** 정시(00:00~23:00)만 받는다. */
  private static final Pattern ON_THE_HOUR = Pattern.compile("^([01]\\d|2[0-3]):00$");

  static final String INVALID_TIME = "보고 시각은 정시(00:00~23:00)여야 해요";

  private static final DateTimeFormatter HH_MM = DateTimeFormatter.ofPattern("HH:mm");

  private final PersonalReportSettingRepository settings;
  private final PersonalReportRepository reports;
  private final PersonalReportTemplate template;
  private final PersonalReportLocation location;
  private final WikiSystemPageWriter writer;
  private final AssistantResolver assistantResolver;
  private final TransactionTemplate tx;

  /** 「지금」의 기준 시계. */
  private final Clock clock = Clock.systemUTC();

  public PersonalReportSettingsService(
      PersonalReportSettingRepository settings,
      PersonalReportRepository reports,
      PersonalReportTemplate template,
      PersonalReportLocation location,
      WikiSystemPageWriter writer,
      AssistantResolver assistantResolver,
      PlatformTransactionManager txManager) {
    this.settings = settings;
    this.reports = reports;
    this.template = template;
    this.location = location;
    this.writer = writer;
    this.assistantResolver = assistantResolver;
    this.tx = new TransactionTemplate(txManager);
  }

  /** 설정 읽기 — 행이 없으면 기본값. 아무것도 만들지 않는다. */
  public PersonalReportSettingsResponse get(long userId) {
    return tx.execute(s -> response(userId));
  }

  /** 설정 저장 — 지금 시각 기준. */
  public PersonalReportSettingsResponse update(
      long userId, UpdatePersonalReportSettingsRequest req) {
    return update(userId, req, OffsetDateTime.now(clock));
  }

  /**
   * 설정 저장(시각을 받는 판). 비운 필드는 지금 값(없으면 기본값)을 그대로 둔다. 켜져 있게 되면 템플릿을 매번 보장한다(트랜잭션 밖). 다음 실행 시각은 새로 켰거나
   * 시각이 바뀌었을 때만 다음 그 시각으로 다시 정하고(켜진 채 시각을 앞당겨 어제 몫을 건너뛰게 되면 지금으로 — {@link #missedSlotOpen}) 자동 실패
   * 수·오류를 지운다 — 건너뜀만 바꾸면 실행기가 정한 다음 예정·30분 재시도 시각을 덮지 않는다. 끄면 비운다.
   *
   * @throws IllegalArgumentException 시각이 정시가 아닐 때(400)
   */
  PersonalReportSettingsResponse update(
      long userId, UpdatePersonalReportSettingsRequest req, OffsetDateTime now) {
    if (req.timeOfDay() != null && !ON_THE_HOUR.matcher(req.timeOfDay()).matches()) {
      throw new IllegalArgumentException(INVALID_TIME);
    }
    // 시각 검사(400)를 마친 뒤에야 알림 지우기·옛 템플릿 옮기기를 한다.
    beginWrite(userId);
    SettingRow current =
        tx.execute(s -> settings.find(userId).orElseGet(() -> SettingRow.defaults(userId)));
    boolean enabled = req.dailyEnabled() != null ? req.dailyEnabled() : current.dailyEnabled();
    LocalTime time =
        req.timeOfDay() != null ? LocalTime.parse(req.timeOfDay(), HH_MM) : current.timeOfDay();
    boolean skipEmpty = req.skipEmpty() != null ? req.skipEmpty() : current.skipEmpty();

    boolean reschedule =
        enabled
            && (!current.dailyEnabled()
                || !time.equals(current.timeOfDay())
                || current.nextRunAt() == null);
    OffsetDateTime next = null;
    if (enabled) {
      // 켜진 상태로 저장할 때마다 템플릿을 보장한다 — 트랜잭션 밖(본문 쓰기가 동기화 서버 위임 경로). 지웠거나 다른 공간으로 옮긴 템플릿은 「템플릿」 아래 다시
      // 만들고 알림을 세운다(WP-1655). 공간 안에 있으면 그대로 둔다.
      template.ensureBoth(userId);
      next = reschedule ? PersonalReportPeriod.nextRun(time, now) : current.nextRunAt();
      // 켜진 채 시각만 바꿨다면, 새 시각 기준으로 이미 지난 오늘 슬롯이 맡을 날(어제)이 아직 열려 있을 때 바로 돌린다 — 09:00→08:00 을 08:30 에
      // 바꾸면 다음 그 시각은 내일 08:00 이라 어제 보고가 영영 빠진다.
      if (current.dailyEnabled()
          && !time.equals(current.timeOfDay())
          && missedSlotOpen(userId, time, now)) {
        next = now;
      }
    }
    OffsetDateTime nextRunAt = next;
    tx.executeWithoutResult(
        s -> {
          settings.save(userId, enabled, time, skipEmpty, nextRunAt);
          // 새 일정이면 지난 일정의 실패 기록을 지운다(프로젝트 리포트 설정과 같은 규칙).
          if (reschedule) settings.resetFailures(userId);
        });
    return get(userId);
  }

  /**
   * 새 보고 시각 기준으로 오늘 슬롯이 이미 지났는데(대상 날짜가 어제) 그 어제가 아직 닫히지 않았는가 — 자동 기록(GENERATED·SKIPPED·FAILED)도,
   * 그날이 끝난 뒤 만든 살아 있는 수동 보고도 없다({@link PersonalReportRepository#autoDayClosed}). 오늘 슬롯이 아직 오지 않았으면
   * 다음 그 시각이 어제를 맡으므로 false.
   */
  private boolean missedSlotOpen(long userId, LocalTime time, OffsetDateTime now) {
    LocalDate today = now.atZoneSameInstant(ReportCadence.KST).toLocalDate();
    LocalDate target = PersonalReportPeriod.dailyTarget(time, now);
    if (!target.equals(today.minusDays(1))) return false;
    Boolean closed =
        tx.execute(s -> reports.autoDayClosed(userId, PersonalReportPeriod.daily(target)));
    return !Boolean.TRUE.equals(closed);
  }

  /**
   * 템플릿을 기본으로 되돌린다(직전 판은 수정 기록에 남는다) — 없으면 새로 복사한다. 켜짐·시각은 건드리지 않는다.
   *
   * @throws IllegalArgumentException 월간(주간 템플릿을 쓴다)일 때(400)
   */
  public PersonalReportSettingsResponse resetTemplate(long userId, PersonalReportKind kind) {
    if (kind == PersonalReportKind.MONTHLY) {
      throw new IllegalArgumentException("월간 보고는 주간 템플릿을 써요. 주간 템플릿을 되돌려 주세요");
    }
    beginWrite(userId);
    template.reset(userId, kind);
    return get(userId);
  }

  /**
   * 저장 위치 바꾸기(WP-1655) — 새 보고를 pageId 아래에 만든다. 이미 만든 보고는 옮기지 않는다.
   *
   * @throws IllegalArgumentException 내 노트 밖·없는 페이지, 「템플릿」 갈래, AI 보고 페이지, 달 폴더 갈래(→ 400)
   */
  public PersonalReportSettingsResponse updateLocation(long userId, long pageId) {
    // 잘못된 요청은 아무것도 바꾸지 않게 검증을 먼저 한다.
    location.validateChoice(userId, pageId);
    beginWrite(userId);
    tx.executeWithoutResult(s -> settings.setLocation(userId, pageId));
    return get(userId);
  }

  /**
   * 설정 쓰기 공통 앞단 — 「템플릿을 다시 만들었어요」 알림을 먼저 지우고(이 쓰기가 다시 만들면 다시 적힌다), 옛 「보고」 아래 템플릿을 한 번 옮긴다(복사는 하지
   * 않음). 알림 지우기만 짧은 트랜잭션이고 옛 템플릿 옮기기는 스스로 트랜잭션을 관리하므로 트랜잭션 밖에서 부른다.
   */
  private void beginWrite(long userId) {
    tx.executeWithoutResult(s -> settings.clearTemplateRecreated(userId));
    template.relocateLegacyIfNeeded(userId);
  }

  /**
   * 응답 — 트랜잭션 안에서 부른다. 저장 위치·공간·템플릿 루트는 {@link PersonalReportLocation#describe} 로 읽고(아무것도 만들지 않는다),
   * 템플릿은 내 노트 공간 안에 실제로 있을 때만 id·경로를 싣는다(지웠거나 다른 공간이면 null).
   */
  private PersonalReportSettingsResponse response(long userId) {
    SettingRow row = settings.find(userId).orElseGet(() -> SettingRow.defaults(userId));
    PersonalReportLocation.Description where = location.describe(userId);
    Long dailyId = templateIfInSpace(row.dailyTemplatePageId(), where.spaceId());
    Long weeklyId = templateIfInSpace(row.weeklyTemplatePageId(), where.spaceId());
    return new PersonalReportSettingsResponse(
        row.dailyEnabled(),
        row.timeOfDay().format(HH_MM),
        row.skipEmpty(),
        dailyId,
        weeklyId,
        pathOrNull(dailyId),
        pathOrNull(weeklyId),
        where.templatesRootId(),
        row.templateRecreatedAt(),
        where.locationPageId(),
        where.locationPath(),
        where.spaceId(),
        row.dailyEnabled() ? row.nextRunAt() : null,
        assistantResolver.resolveOrEmpty(userId).isPresent(),
        row.lastError());
  }

  /** 템플릿이 내 노트 공간 안에 있을 때만 id 를 낸다(WP-1655 — 생성기가 id 로 따라가는 규칙과 같다). 공간이 없으면 null. */
  private Long templateIfInSpace(Long pageId, Long spaceId) {
    return spaceId != null && writer.existsInSpace(pageId, spaceId) ? pageId : null;
  }

  /** 템플릿 페이지의 실제 경로 제목(루트부터 자기까지). 템플릿이 없으면 null. */
  private List<String> pathOrNull(Long pageId) {
    return pageId == null ? null : writer.pathTitles(pageId);
  }
}
