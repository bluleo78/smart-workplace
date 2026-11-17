package com.workplace.wiki.report;

import com.workplace.issue.report.ReportCadence;
import com.workplace.project.dto.ProjectRow;
import com.workplace.project.service.ProjectAccessGuard;
import com.workplace.wiki.report.ProjectReportSettingRepository.SettingRow;
import com.workplace.wiki.report.dto.ProjectReportGenerateResponse;
import com.workplace.wiki.report.dto.ProjectReportSettingsResponse;
import com.workplace.wiki.report.dto.UpdateProjectReportSettingsRequest;
import com.workplace.wiki.repository.ProjectNoteSpaceRepository;
import com.workplace.wiki.service.WikiSystemPageWriter;
import java.time.DayOfWeek;
import java.time.LocalTime;
import java.time.OffsetDateTime;
import java.time.format.DateTimeFormatter;
import java.util.List;
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
 *   <li>「지금 생성」(WP-1630): 저장과 같은 권한으로 직전 회차 리포트를 바로 만든다
 *   <li>켤 때 템플릿이 없거나 지워졌으면 「템플릿」 아래 기본 템플릿을 복사하고, 다음 실행 시각을 다시 정한다(끄면 비운다)
 *   <li>저장 위치 바꾸기(WP-1654): 같은 권한으로 새 리포트를 둘 프로젝트 노트 공간 페이지를 고른다(검증은 {@link ProjectReportLocation})
 *   <li>모든 설정 쓰기(저장·되돌리기·위치 바꾸기)는 먼저 「템플릿을 다시 만들었어요」 알림을 지우고 옛 위치 템플릿을 한 번 옮긴다(WP-1654 — 스펙 「다음 설정
 *       저장이나 생성 때」)
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
  private final ProjectReportGenerator generator;
  private final ProjectReportLocation location;
  private final TransactionTemplate tx;

  public ProjectReportSettingsService(
      ProjectAccessGuard guard,
      ProjectReportSettingRepository settings,
      ProjectNoteSpaceRepository projects,
      WikiSystemPageWriter writer,
      ProjectReportTemplate template,
      ProjectReportGenerator generator,
      ProjectReportLocation location,
      PlatformTransactionManager txManager) {
    this.guard = guard;
    this.settings = settings;
    this.projects = projects;
    this.writer = writer;
    this.template = template;
    this.generator = generator;
    this.location = location;
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
    long author = reportAuthor(project);
    beginWrite(project, author);
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
      template.ensureTemplate(project, projectSpace(project), author);
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
    long author = reportAuthor(project);
    beginWrite(project, author);
    template.reset(project, author);
    return tx.execute(s -> response(project, callerId));
  }

  /**
   * 저장 위치 바꾸기(WP-1654) — 새 리포트를 pageId 아래에 만든다. 이미 만든 리포트는 옮기지 않는다. 권한은 저장과 같다(OWNER·ADMIN, 개인
   * 400).
   *
   * @throws IllegalArgumentException 공간 밖·없는 페이지, 「템플릿」·템플릿 갈래, AI 리포트 페이지(→ 400)
   */
  public ProjectReportSettingsResponse updateLocation(long callerId, String key, long pageId) {
    ProjectRow project = tx.execute(s -> requireManageable(key, callerId));
    // 잘못된 요청은 아무것도 바꾸지 않게 검증을 먼저 한다.
    location.validateChoice(project.id(), pageId);
    beginWrite(project, reportAuthor(project));
    tx.executeWithoutResult(s -> settings.setLocation(project.id(), pageId));
    return tx.execute(s -> response(project, callerId));
  }

  /**
   * 설정 쓰기 공통 앞단(WP-1654) — 「템플릿을 다시 만들었어요」 알림을 먼저 지우고(이 쓰기가 다시 만들면 다시 적힌다), 옛 위치 템플릿을 한 번 옮긴다(복사는
   * 하지 않음). 트랜잭션 밖에서 부른다.
   */
  private void beginWrite(ProjectRow project, long author) {
    tx.executeWithoutResult(s -> settings.clearTemplateRecreated(project.id()));
    template.relocateLegacyIfNeeded(project, author);
  }

  /** 「지금 생성」(WP-1630) — 지금 시각 기준. */
  public ProjectReportGenerateResponse generateNow(long callerId, String key) {
    return generateNow(callerId, key, OffsetDateTime.now());
  }

  /**
   * 「지금 생성」 — 설정 저장과 같은 권한(OWNER·ADMIN, 개인 400)으로, 설정의 주기(행이 없으면 기본 매주)에서 직전에 끝난 회차 리포트를 지금 만든다. 꺼져
   * 있어도 만들고 정기 일정은 건드리지 않는다. 생성은 정기 실행과 같은 생성기가 한다({@link ProjectReportGenerator#runNow}).
   *
   * @throws ProjectReportGenerateException 비서 없음·만드는 중(409), 생성 실패(502)
   */
  public ProjectReportGenerateResponse generateNow(long callerId, String key, OffsetDateTime now) {
    // 권한 확인과 설정 읽기는 한 트랜잭션으로 — 생성(AI·본문 쓰기)은 트랜잭션 밖에서 한다.
    Target target =
        tx.execute(
            s -> {
              ProjectRow p = requireManageable(key, callerId);
              return new Target(
                  p, settings.find(p.id()).orElseGet(() -> SettingRow.defaults(p.id())));
            });
    return generator.runNow(target.project(), target.setting(), now);
  }

  /** 「지금 생성」 대상 — 권한을 확인한 프로젝트와 그 설정(행이 없으면 기본값). */
  private record Target(ProjectRow project, SettingRow setting) {}

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

  /**
   * 프로젝트 노트 공간 보장 — TEAM·OPEN 이면 늘 있다(개인은 앞에서 걸렀다). 「리포트」는 만들지 않는다 — 리포트 자리는 생성 때 저장 위치 해석기가
   * 정한다(WP-1654).
   */
  private long projectSpace(ProjectRow project) {
    return writer
        .ensureProjectSpace(project.id())
        .orElseThrow(() -> new IllegalArgumentException(PERSONAL_MESSAGE));
  }

  /**
   * 응답 — 행이 없으면 기본값. canManage 는 OWNER·ADMIN 이고 개인 프로젝트가 아닐 때. 템플릿은 공간 안에 실제로 있을 때만 id·경로를 싣는다(지웠거나
   * 다른 공간이면 비움). 저장 위치는 {@link ProjectReportLocation#describe} 로 읽는다. 아무 페이지도 만들지 않는다. 트랜잭션 안에서
   * 부른다.
   */
  private ProjectReportSettingsResponse response(ProjectRow project, long callerId) {
    SettingRow row = settings.find(project.id()).orElseGet(() -> SettingRow.defaults(project.id()));
    String role = guard.viewerRole(project, callerId);
    boolean canManage = !project.isPersonal() && ("OWNER".equals(role) || "ADMIN".equals(role));
    ProjectReportLocation.Description where = location.describe(project.id());
    Long templateId =
        where.spaceId() != null && writer.existsInSpace(row.templatePageId(), where.spaceId())
            ? row.templatePageId()
            : null;
    List<String> templatePath = templateId == null ? List.of() : writer.pathTitles(templateId);
    return new ProjectReportSettingsResponse(
        row.enabled(),
        row.cadence().name(),
        row.weekday().name(),
        row.timeOfDay().format(HH_MM),
        templateId,
        row.nextRunAt(),
        canManage,
        where.spaceId(),
        where.templatesRootId(),
        templatePath,
        row.templateRecreatedAt(),
        where.locationPageId(),
        where.locationPath());
  }
}
