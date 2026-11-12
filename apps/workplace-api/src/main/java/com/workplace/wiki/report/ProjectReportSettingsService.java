package com.workplace.wiki.report;

import com.workplace.issue.report.ReportCadence;
import com.workplace.project.dto.ProjectRow;
import com.workplace.project.service.ProjectAccessGuard;
import com.workplace.wiki.report.ProjectReportSettingRepository.SettingRow;
import com.workplace.wiki.report.dto.ProjectReportSettingsResponse;
import com.workplace.wiki.report.dto.UpdateProjectReportSettingsRequest;
import com.workplace.wiki.repository.ProjectNoteSpaceRepository;
import com.workplace.wiki.service.WikiSystemPageWriter;
import com.workplace.wiki.service.WikiSystemPageWriter.ReportsHome;
import java.time.DayOfWeek;
import java.time.LocalTime;
import java.time.OffsetDateTime;
import java.time.format.DateTimeFormatter;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 프로젝트 리포트 설정(WP-1483) — 프로젝트 설정 「리포트」 영역의 읽기·저장·템플릿 되돌리기.
 *
 * <ul>
 *   <li>읽기: 프로젝트를 읽을 수 있는 사람. 행이 없으면 기본값(꺼짐·매주·월요일·09:00)
 *   <li>저장·되돌리기: 프로젝트 OWNER·ADMIN(상태 요약 간격과 같은 판정 — {@code assertWithRole(OWNER)} 이 ADMIN 을 통과시킨다).
 *       개인 프로젝트는 400
 *   <li>켤 때 템플릿이 없거나 지워졌으면 기본 템플릿을 복사하고, 다음 실행 시각을 다시 정한다(끄면 비운다)
 * </ul>
 *
 * <p>쓰기 주체는 설정한 사람이 아니라 리포트 작성자(소유자가 멤버면 소유자, 아니면 가장 작은 OWNER id)다 — 설정한 ADMIN 이 노트 공간 멤버가 아닐 수
 * 있다(설계 「내가 정한 것」).
 *
 * <p>이 서비스는 일부러 {@code @Transactional} 이 아니다 — 템플릿 본문 쓰기가 동기화 서버 위임 경로라 트랜잭션 밖이어야 한다. 권한 확인·설정 행
 * 읽기·쓰기만 짧은 트랜잭션(RLS GUC 주입)으로 감싼다.
 */
@Service
public class ProjectReportSettingsService {

  /** 개인 프로젝트 설정 요청의 400 문구. */
  static final String PERSONAL_MESSAGE = "개인 프로젝트는 리포트를 만들지 않아요.";

  private static final DateTimeFormatter HH_MM = DateTimeFormatter.ofPattern("HH:mm");

  private final ProjectAccessGuard guard;
  private final ProjectReportSettingRepository settings;
  private final ProjectNoteSpaceRepository projects;
  private final WikiSystemPageWriter writer;
  private final ProjectReportTemplate template;
  private final TransactionTemplate tx;

  public ProjectReportSettingsService(
      ProjectAccessGuard guard,
      ProjectReportSettingRepository settings,
      ProjectNoteSpaceRepository projects,
      WikiSystemPageWriter writer,
      ProjectReportTemplate template,
      PlatformTransactionManager txManager) {
    this.guard = guard;
    this.settings = settings;
    this.projects = projects;
    this.writer = writer;
    this.template = template;
    this.tx = new TransactionTemplate(txManager);
  }

  /** 설정 읽기 — 프로젝트를 못 읽으면 404(존재 은닉). */
  public ProjectReportSettingsResponse get(long callerId, String key) {
    return tx.execute(
        s -> {
          ProjectRow project = guard.assertReadable(key, callerId);
          return response(project, callerId);
        });
  }

  /**
   * 설정 저장. 비운 필드는 지금 값(없으면 기본값)을 그대로 둔다. 켜면 템플릿을 보장한다. 켬·일정이 바뀌면 다음 실행 시각을 지금 이후로 다시 정하고(끄면 비움) 실패
   * 수·오류를 지운다 — 일정이 그대로면 실행기의 다음 예정·재시도 시각을 그대로 둔다. 템플릿은 꺼도 그대로 둔다.
   */
  public ProjectReportSettingsResponse update(
      long callerId, String key, UpdateProjectReportSettingsRequest req) {
    ProjectRow project = tx.execute(s -> requireManageable(key, callerId));
    SettingRow current =
        tx.execute(
            s -> settings.find(project.id()).orElseGet(() -> SettingRow.defaults(project.id())));
    ReportCadence cadence =
        req.cadence() != null ? ReportCadence.parse(req.cadence()) : current.cadence();
    DayOfWeek weekday =
        req.weekday() != null ? DayOfWeek.valueOf(req.weekday()) : current.weekday();
    LocalTime time =
        req.timeOfDay() != null ? LocalTime.parse(req.timeOfDay(), HH_MM) : current.timeOfDay();
    boolean enabled = Boolean.TRUE.equals(req.enabled());

    // 켬·일정이 바뀌었을 때만 다음 실행 시각을 다시 정한다(실패 수·오류도 지움). 그대로면 실행기가 정한 다음 예정·재시도 시각을 덮지 않는다.
    boolean scheduleChanged =
        enabled != current.enabled()
            || cadence != current.cadence()
            || weekday != current.weekday()
            || !time.equals(current.timeOfDay())
            || (enabled && current.nextRunAt() == null);
    OffsetDateTime nextRunAt = null;
    if (enabled) {
      // 템플릿 복사는 트랜잭션 밖 — 본문 쓰기가 동기화 서버 위임 경로다. 복사하면 ensureTemplate 이 설정 행에 적는다.
      long author = reportAuthor(project);
      ReportsHome home = reportsHome(project, author);
      template.ensureTemplate(project, home, author);
      // 설정을 바꾸면 새 일정으로 본다 — 격주의 지난 예정 기준도 새로 잡는다.
      nextRunAt = cadence.nextRun(weekday, time, OffsetDateTime.now(), null);
    }
    OffsetDateTime next = nextRunAt;
    tx.executeWithoutResult(
        s ->
            settings.saveSettings(
                project.id(), enabled, cadence, weekday, time, scheduleChanged, next));
    return tx.execute(s -> response(project, callerId));
  }

  /** 템플릿을 기본으로 되돌린다(직전 판은 수정 기록에 남는다). 템플릿이 없으면 새로 복사한다. 켜짐·일정은 건드리지 않는다. */
  public ProjectReportSettingsResponse resetTemplate(long callerId, String key) {
    ProjectRow project = tx.execute(s -> requireManageable(key, callerId));
    template.reset(project, reportAuthor(project));
    return tx.execute(s -> response(project, callerId));
  }

  /** 저장·되돌리기 권한 — OWNER·ADMIN(아니면 403/404), 개인 프로젝트면 400. 트랜잭션 안에서 부른다. */
  private ProjectRow requireManageable(String key, long callerId) {
    ProjectRow project = guard.assertWithRole(key, callerId, "OWNER");
    if (project.isPersonal()) {
      throw new IllegalArgumentException(PERSONAL_MESSAGE);
    }
    return project;
  }

  /** 템플릿·「리포트」 작성자 — 노트 공간 「리포트」와 같은 규칙({@link ProjectNoteSpaceRepository#findReportAuthor}). */
  private long reportAuthor(ProjectRow project) {
    return tx.execute(s -> projects.findReportAuthor(project.id(), project.ownerId()));
  }

  /** 「리포트」 자리 보장 — TEAM·OPEN 이면 늘 있다(개인은 앞에서 걸렀다). */
  private ReportsHome reportsHome(ProjectRow project, long author) {
    return writer
        .ensureReportsHome(project.id(), author)
        .orElseThrow(() -> new IllegalArgumentException(PERSONAL_MESSAGE));
  }

  /** 응답 — 행이 없으면 기본값. canManage 는 OWNER·ADMIN 이고 개인 프로젝트가 아닐 때. 트랜잭션 안에서 부른다. */
  private ProjectReportSettingsResponse response(ProjectRow project, long callerId) {
    SettingRow row = settings.find(project.id()).orElseGet(() -> SettingRow.defaults(project.id()));
    String role = guard.viewerRole(project, callerId);
    boolean canManage = !project.isPersonal() && ("OWNER".equals(role) || "ADMIN".equals(role));
    return new ProjectReportSettingsResponse(
        row.enabled(),
        row.cadence().name(),
        row.weekday().name(),
        row.timeOfDay().format(HH_MM),
        row.templatePageId(),
        row.nextRunAt(),
        canManage);
  }
}
