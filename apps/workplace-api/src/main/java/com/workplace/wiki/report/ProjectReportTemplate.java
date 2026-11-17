package com.workplace.wiki.report;

import com.workplace.global.util.CapabilityTokens;
import com.workplace.project.dto.ProjectRow;
import com.workplace.wiki.dto.WikiPageDetail;
import com.workplace.wiki.report.ProjectReportSettingRepository.SettingRow;
import com.workplace.wiki.service.WikiSystemPageWriter;
import java.util.Optional;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 프로젝트 정기 리포트 템플릿(WP-1483, WP-1654 에서 리포트와 분리) — 제품 기본 템플릿 「프로젝트 주간」(완성 샘플 + {@code
 * wp-ai-instruction} 지시 상자)을 프로젝트 노트 공간 맨 위 「템플릿」 › 「정기 리포트」로 복사하고, 기본으로 되돌린다.
 *
 * <ul>
 *   <li>템플릿은 설정의 id(template_page_id)로 따라간다 — 같은 프로젝트 노트 공간 안이면 사람이 어디로 옮겨도 그대로 쓴다.
 *   <li>지워졌거나 다른 공간으로 옮겨졌으면 「템플릿」 아래 새로 복사하고, 한 번 갖춘 뒤의 재생성이면 설정에 「다시 만들었어요」 시각을 남긴다.
 *   <li>옛 구조(「리포트」 바로 아래 「템플릿 · 주간 리포트」)는 다음 설정 쓰기·생성 때 한 번만 같은 id 로 「템플릿」 아래 맨 위로 옮기고 제목을 「정기
 *       리포트」로 바꾼다(본문 유지). 이미 사람이 다른 곳으로 옮겨 둔 템플릿은 옮기지 않는다.
 * </ul>
 *
 * <p>쓰기는 {@link WikiSystemPageWriter}(역할 검사 없음)로 한다 — 작성자는 부르는 쪽이 정한 리포트 작성자. 본문 쓰기는 동기화 서버 위임 경로라
 * 이 클래스의 공개 메서드는 트랜잭션 밖에서 불러야 한다. 복사·이전은 동시 호출(설정 저장·정기 실행·「지금 생성」)이 템플릿을 두 장 만들거나 두 번 옮기지 않게 공간 트리
 * 잠금 아래에서 설정 행을 다시 읽고 한다(개인 보고 {@link PersonalReportTemplate} 와 같은 방식).
 */
@Component
public class ProjectReportTemplate {

  /** 복사한 템플릿 페이지 제목(WP-1654 — 주기와 무관한 이름). */
  public static final String TEMPLATE_TITLE = "정기 리포트";

  /** 기본 템플릿 원문 위치 — 자리표시 {@code {{BASE_URL}}}·{@code {{PROJECT_KEY}}} 를 담는다. */
  private static final String RESOURCE = "report/project-weekly-template.md";

  private final WikiSystemPageWriter writer;
  private final ReportTemplateCopier copier;
  private final ProjectReportSettingRepository settings;
  private final TransactionTemplate tx;
  private final String publicBaseUrl;
  private final String rawTemplate;

  public ProjectReportTemplate(
      WikiSystemPageWriter writer,
      ReportTemplateCopier copier,
      ProjectReportSettingRepository settings,
      PlatformTransactionManager txManager,
      @Value("${workplace.public-base-url:}") String publicBaseUrl) {
    this.writer = writer;
    this.copier = copier;
    this.settings = settings;
    // 순수 단위 테스트(defaultMarkdown 만 봄)는 트랜잭션 관리자 없이 만든다.
    this.tx = txManager == null ? null : new TransactionTemplate(txManager);
    this.publicBaseUrl = publicBaseUrl;
    // 기동 때 한 번 원문을 읽는다 — 없으면 배포가 잘못된 것이라 기동을 실패시킨다.
    this.rawTemplate = ReportTemplateCopier.loadResource(RESOURCE);
  }

  /**
   * 기본 템플릿 마크다운 — 샘플 이슈 링크가 그 프로젝트 주소 모양이 되게 자리표시를 바꾼다(끝 「/」는 뗀다).
   *
   * @param baseUrl 공개 웹 주소(예: https://works.example.com)
   */
  public String defaultMarkdown(String baseUrl, String projectKey) {
    String base = CapabilityTokens.normalizeBaseUrl(baseUrl);
    return rawTemplate.replace("{{BASE_URL}}", base).replace("{{PROJECT_KEY}}", projectKey);
  }

  /**
   * 템플릿을 보장하고 그 페이지 id 를 돌려준다(생성·설정을 켤 때). 트랜잭션 밖에서 부른다.
   *
   * <ol>
   *   <li>설정의 템플릿이 그 공간 안에 있으면 그대로 쓴다(어디로 옮겼든). 아직 「템플릿」 체계로 갖추지 않았으면 옛 위치 이전을 먼저 한다.
   *   <li>없거나(지워짐) 다른 공간이면 「템플릿」 아래 새로 복사한다 — 한 번 갖춘 뒤였거나 다른 공간으로 옮겨진 것이면 「다시 만들었어요」로 알린다.
   * </ol>
   *
   * @param spaceId 프로젝트 노트 공간(부른 쪽이 보장했다)
   */
  public long ensureTemplate(ProjectRow project, long spaceId, long authorId) {
    SettingRow row = readRow(project.id());
    Long current = row.templatePageId();
    if (writer.existsInSpace(current, spaceId)) {
      if (!row.templateInitialized()) {
        relocateLegacy(project.id(), spaceId, authorId);
      }
      return current;
    }
    // 처음 복사(행 없음·한 번도 갖추지 않음)는 알리지 않는다. 지운 템플릿은 FK 로 id 가 NULL 이 되므로 initialized 로 가린다.
    return copy(project, spaceId, authorId, row.templateInitialized() || current != null);
  }

  /**
   * 옛 위치(「리포트」 바로 아래) 템플릿을 한 번 「템플릿」 아래로 옮긴다 — 복사는 하지 않는다. 설정 서비스가 모든 설정 쓰기(켜든 끄든 저장·위치 바꾸기·되돌리기)
   * 앞에서 부른다(스펙 「다음 설정 저장이나 생성 때」). 공간은 찾기만 하고 만들지 않는다 — 없으면 아무것도 하지 않는다. 트랜잭션 밖에서 부른다.
   */
  public void relocateLegacyIfNeeded(ProjectRow project, long authorId) {
    Optional<Long> space = writer.findLinkedSpace(project.id());
    if (space.isEmpty()) {
      return;
    }
    SettingRow row = readRow(project.id());
    if (!row.templateInitialized() && writer.existsInSpace(row.templatePageId(), space.get())) {
      relocateLegacy(project.id(), space.get(), authorId);
    }
  }

  /**
   * 템플릿 본문 — 비었으면(없는 페이지 포함) 기본 원문으로 대신한다. 다른 호출이 템플릿을 막 만들고 본문을 아직 못 쓴 틈이거나 그 본문 쓰기가 실패한
   * 경우다({@link #copy}). 트랜잭션 밖에서 부른다.
   */
  public String readBodyOrDefault(long templateId, ProjectRow project) {
    return writer
        .readBody(templateId)
        .filter(body -> !body.isBlank())
        .orElseGet(() -> defaultMarkdown(publicBaseUrl, project.key()));
  }

  /**
   * 템플릿을 기본으로 되돌린다 — 공간 안에 템플릿이 있으면(옛 위치면 먼저 옮기고) 본문을 기본으로 덮고(직전 판을 수정 기록에 남긴다), 없으면 「템플릿」 아래 새로
   * 복사한다. 사람이 누른 되돌리기라 「다시 만들었어요」로 알리지 않는다. 트랜잭션 밖에서 부른다.
   */
  public void reset(ProjectRow project, long authorId) {
    long spaceId =
        writer
            .ensureProjectSpace(project.id())
            .orElseThrow(() -> new IllegalArgumentException("개인 프로젝트는 리포트를 만들지 않아요."));
    relocateLegacyIfNeeded(project, authorId);
    Long current = readRow(project.id()).templatePageId();
    if (!writer.existsInSpace(current, spaceId)) {
      copy(project, spaceId, authorId, false);
      return;
    }
    copier.overwrite(current, authorId, defaultMarkdown(publicBaseUrl, project.key()));
  }

  /** 설정 행(없으면 기본값) — 짧은 트랜잭션. */
  private SettingRow readRow(long projectId) {
    return tx.execute(
        s -> settings.find(projectId).orElseGet(() -> SettingRow.defaults(projectId)));
  }

  /**
   * 옛 위치 이전(한 번만) — 공간 트리 잠금 아래에서 행을 다시 읽어, 아직 갖추지 않았고 템플릿 부모가 공간의 「리포트」 루트면 「템플릿」 맨 위로 옮기고 제목을 「정기
   * 리포트」로 바꾼다. 부모가 다른 곳이면(사람이 이미 옮겨 둠) 옮기지 않는다. 어느 쪽이든 갖춤 표시를 남긴다. 본문은 건드리지 않는다 — 제목만 바꾸기는 위임 없는
   * 트랜잭션 안 경로라 잠금을 쥔 채 할 수 있다.
   */
  private void relocateLegacy(long projectId, long spaceId, long authorId) {
    tx.executeWithoutResult(
        s -> {
          writer.lockSpaceTree(spaceId);
          SettingRow row = settings.find(projectId).orElseGet(() -> SettingRow.defaults(projectId));
          if (row.templateInitialized()) {
            // 그새 다른 호출이 이전(또는 복사)을 마쳤다.
            return;
          }
          Long current = row.templatePageId();
          Optional<Long> reports = writer.findReportsPage(spaceId);
          if (current != null
              && reports.isPresent()
              && writer.existsUnder(current, reports.get())) {
            long templatesRoot = writer.ensureTemplatesPage(spaceId, authorId);
            writer.moveTo(current, templatesRoot, 0);
            writer.renameTo(current, TEMPLATE_TITLE, authorId);
          }
          settings.markTemplateInitialized(projectId);
        });
  }

  /**
   * 기본 템플릿을 「템플릿」 아래 새 페이지로 복사해 맨 위에 두고 설정에 적는다.
   *
   * <p>동시 호출이 둘 다 「없음」을 보고 템플릿을 두 장 만들지 않게, 짧은 트랜잭션에서 공간 트리 잠금을 잡고 설정을 다시 읽어 그새 공간 안에 템플릿이 생겼으면 그것을
   * 쓴다. 없으면 같은 트랜잭션에서 「템플릿」 보장 → 빈 페이지 만들기 → 맨 위로 옮기기 → 설정에 적기를 하고 커밋한다. 본문 쓰기는 동기화 서버 위임 경로라 잠금을 쥘
   * 수 없어 커밋 뒤 트랜잭션 밖에서 이 호출이 만든 페이지에만 한다(그 틈에 빈 본문을 읽은 생성기는 {@link #readBodyOrDefault} 로 기본 원문을
   * 쓴다).
   *
   * @param recreated 없어진 템플릿을 다시 만드는 것이면 true — 설정에 「다시 만들었어요」 시각을 남긴다
   */
  private long copy(ProjectRow project, long spaceId, long authorId, boolean recreated) {
    long projectId = project.id();
    Created created =
        tx.execute(
            s -> {
              writer.lockSpaceTree(spaceId);
              Long current = settings.find(projectId).map(SettingRow::templatePageId).orElse(null);
              if (writer.existsInSpace(current, spaceId)) {
                return new Created(current, null);
              }
              long templatesRoot = writer.ensureTemplatesPage(spaceId, authorId);
              WikiPageDetail page =
                  writer.createPage(authorId, spaceId, templatesRoot, TEMPLATE_TITLE);
              writer.moveTo(page.id(), templatesRoot, 0);
              settings.setTemplate(projectId, page.id(), recreated);
              return new Created(page.id(), page.version());
            });
    if (created.version() != null) {
      // 이 호출이 만든 페이지만 본문을 쓴다(사람 글, 수정 기록 없음) — 다른 쪽이 만든 것은 그쪽이 쓴다.
      writer.writeBody(
          authorId,
          created.pageId(),
          created.version(),
          defaultMarkdown(publicBaseUrl, project.key()),
          false,
          false);
    }
    return created.pageId();
  }

  /**
   * 잠금 아래에서 정한 템플릿.
   *
   * @param version 이 호출이 새로 만들었으면 만들기 응답의 판(본문을 쓸 때 쓴다), 이미 있던 것을 쓰면 null
   */
  private record Created(long pageId, Integer version) {}
}
