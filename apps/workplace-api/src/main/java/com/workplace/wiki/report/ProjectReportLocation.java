package com.workplace.wiki.report;

import com.workplace.project.dto.ProjectRow;
import com.workplace.wiki.dto.WikiPageDetail;
import com.workplace.wiki.report.ProjectReportSettingRepository.SettingRow;
import com.workplace.wiki.report.ReportErrors.ReportFailure;
import com.workplace.wiki.service.WikiSystemPageWriter;
import java.util.List;
import java.util.Optional;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 프로젝트 정기 리포트 저장 위치 해석기(WP-1654) — 새 리포트를 어느 페이지 아래에 둘지 정한다.
 *
 * <ul>
 *   <li>설정에 고른 위치(report_location_page_id)가 있고 프로젝트 노트 공간 안에 있으면 그 아래. 없거나 지워졌으면(FK 가 NULL 로) 기본
 *       「리포트」
 *   <li>고른 위치가 다른 공간으로 옮겨졌으면 생성 때 「리포트」로 되돌리고 설정값을 조건부로 지운다(그사이 새로 고른 값은 지우지 않게)
 *   <li>고른 위치가 유효하면 「리포트」를 만들지 않는다 — 사람이 비게 된 「리포트」를 지웠어도 되살리지 않는다
 * </ul>
 *
 * <p>설정 화면·개요 카드용 {@link #describe} 는 아무것도 만들지 않는다. 쓰기({@link #resolveForWrite})는 트랜잭션 밖에서도 부를 수 있게
 * 설정 행 읽기·쓰기만 짧은 트랜잭션으로 감싼다(부른 쪽 트랜잭션이 있으면 합류한다).
 */
@Component
public class ProjectReportLocation {

  /** 기본 저장 위치 이름 — 「리포트」가 아직 없어도 설정 화면에는 이 경로로 보인다(다음 생성 때 만든다). */
  static final String DEFAULT_TITLE = "리포트";

  /** 다른 공간·없는 페이지를 고른 요청의 400 문구. */
  static final String NOT_IN_SPACE = "프로젝트 노트 공간의 페이지만 고를 수 있어요.";

  /** 「템플릿」 갈래·템플릿 페이지 갈래를 고른 요청의 400 문구. */
  static final String UNDER_TEMPLATE = "템플릿 아래에는 리포트를 둘 수 없어요.";

  /** AI 가 쓴 리포트 페이지를 고른 요청의 400 문구. */
  static final String UNDER_AI_REPORT = "AI 가 쓴 리포트 페이지 아래에는 둘 수 없어요.";

  private final WikiSystemPageWriter writer;
  private final ProjectReportSettingRepository settings;
  private final TransactionTemplate tx;

  public ProjectReportLocation(
      WikiSystemPageWriter writer,
      ProjectReportSettingRepository settings,
      PlatformTransactionManager txManager) {
    this.writer = writer;
    this.settings = settings;
    this.tx = new TransactionTemplate(txManager);
  }

  /**
   * 생성용으로 해석한 자리.
   *
   * @param spaceId 프로젝트 노트 공간
   * @param parentPageId 새 리포트를 만들 부모 페이지(고른 위치 또는 「리포트」)
   */
  public record Resolved(long spaceId, long parentPageId) {}

  /**
   * 읽기 전용 설명 — 설정 화면·개요 카드용.
   *
   * @param spaceId 프로젝트 노트 공간(없으면 null)
   * @param locationPageId 유효한 저장 위치(고른 위치가 공간 안이면 그것, 아니면 「리포트」, 그것도 없으면 null)
   * @param locationPath 저장 위치 경로 제목(기본 {@code ["리포트"]})
   * @param templatesRootId 맨 위 「템플릿」 페이지(없으면 null) — 고르기 창에서 뺀다
   */
  public record Description(
      Long spaceId, Long locationPageId, List<String> locationPath, Long templatesRootId) {}

  /**
   * 생성용 자리를 정한다 — 공간을 보장하고, 고른 위치가 유효하면 그것, 아니면 「리포트」(없으면 맨 위 0번에 만든다). 고른 위치가 다른 공간으로 옮겨졌으면 설정값을
   * 조건부로 지운다.
   *
   * @param authorId 「리포트」를 새로 만들 때의 작성자(리포트 작성자 규칙)
   * @throws ReportFailure 공간을 둘 수 없는 프로젝트
   */
  public Resolved resolveForWrite(ProjectRow project, long authorId) {
    long projectId = project.id();
    long spaceId =
        writer
            .ensureProjectSpace(projectId)
            .orElseThrow(() -> new ReportFailure("리포트를 둘 노트 공간을 만들 수 없어요."));
    Long chosen = tx.execute(s -> storedLocation(projectId));
    if (chosen != null) {
      if (writer.existsInSpace(chosen, spaceId)) {
        return new Resolved(spaceId, chosen);
      }
      // 다른 공간으로 옮겨진 위치 — 기본으로 되돌린다(지워진 위치는 FK 가 이미 NULL 로 했다).
      tx.executeWithoutResult(s -> settings.clearLocationIf(projectId, chosen));
    }
    return new Resolved(spaceId, writer.ensureReportsPage(spaceId, authorId));
  }

  /** 읽기 전용 설명 — 아무 페이지도 만들지 않는다. 공간이 없으면 id 는 모두 null, 경로는 기본. */
  public Description describe(long projectId) {
    return tx.execute(
        s -> {
          Optional<Long> space = writer.findLinkedSpace(projectId);
          if (space.isEmpty()) {
            return new Description(null, null, List.of(DEFAULT_TITLE), null);
          }
          long spaceId = space.get();
          Long templatesRoot = writer.findTemplatesPage(spaceId).orElse(null);
          Long chosen = storedLocation(projectId);
          if (writer.existsInSpace(chosen, spaceId)) {
            return new Description(spaceId, chosen, writer.pathTitles(chosen), templatesRoot);
          }
          Long reports = writer.findReportsPage(spaceId).orElse(null);
          return new Description(spaceId, reports, List.of(DEFAULT_TITLE), templatesRoot);
        });
  }

  /**
   * 설정에서 고른 위치를 검증한다 — 역할 없이 시스템 조회로 본다(관리 권한은 부른 쪽이 확인했다).
   *
   * @throws IllegalArgumentException 공간 밖·없는 페이지, 「템플릿」 갈래 또는 지금 템플릿 페이지 갈래(자기 포함), AI 가 쓴 리포트
   *     페이지(→ 400)
   */
  public void validateChoice(long projectId, long pageId) {
    tx.executeWithoutResult(
        s -> {
          Optional<Long> space = writer.findLinkedSpace(projectId);
          if (space.isEmpty() || !writer.existsInSpace(pageId, space.get())) {
            throw new IllegalArgumentException(NOT_IN_SPACE);
          }
          long spaceId = space.get();
          Optional<Long> templatesRoot = writer.findTemplatesPage(spaceId);
          if (templatesRoot.isPresent() && writer.isUnderOrSelf(pageId, templatesRoot.get())) {
            throw new IllegalArgumentException(UNDER_TEMPLATE);
          }
          // 사람이 「템플릿」 밖으로 옮긴 템플릿도 그 갈래에 리포트를 두지 않는다(템플릿 본문과 리포트가 섞이지 않게).
          Long template = settings.find(projectId).map(SettingRow::templatePageId).orElse(null);
          if (writer.existsInSpace(template, spaceId) && writer.isUnderOrSelf(pageId, template)) {
            throw new IllegalArgumentException(UNDER_TEMPLATE);
          }
          String aiAction = writer.findPage(pageId).map(WikiPageDetail::aiLastAction).orElse(null);
          if (WikiSystemPageWriter.AI_ACTION_REPORT.equals(aiAction)) {
            throw new IllegalArgumentException(UNDER_AI_REPORT);
          }
        });
  }

  /** 설정에 적힌 저장 위치(없으면 null). 트랜잭션 안에서 부른다. */
  private Long storedLocation(long projectId) {
    return settings.find(projectId).map(SettingRow::reportLocationPageId).orElse(null);
  }
}
