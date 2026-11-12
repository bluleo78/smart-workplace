package com.workplace.wiki.report;

import com.workplace.global.util.CapabilityTokens;
import com.workplace.project.dto.ProjectRow;
import com.workplace.wiki.report.ProjectReportSettingRepository.SettingRow;
import com.workplace.wiki.service.WikiSystemPageWriter;
import com.workplace.wiki.service.WikiSystemPageWriter.ReportsHome;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 프로젝트 리포트 템플릿(WP-1483) — 제품 기본 템플릿 「프로젝트 주간」(완성 샘플 + {@code wp-ai-instruction} 지시 상자)을 프로젝트 노트 공간
 * › 리포트 › 「템플릿 · 주간 리포트」로 복사하고, 기본으로 되돌린다.
 *
 * <p>쓰기는 {@link WikiSystemPageWriter}(역할 검사 없음)로 한다 — 작성자는 부르는 쪽이 정한 리포트 작성자. 본문 쓰기는 동기화 서버 위임 경로라
 * 이 클래스의 메서드는 트랜잭션 밖에서 불러야 한다. 설정 행 읽기·쓰기만 짧은 트랜잭션으로 감싼다. 복사·판정·덮기는 개인 보고와 나눠 쓰는 {@link
 * ReportTemplateCopier}(WP-1486) 가 한다.
 */
@Component
public class ProjectReportTemplate {

  /** 복사한 템플릿 페이지 제목. */
  public static final String TEMPLATE_TITLE = "템플릿 · 주간 리포트";

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
    this.tx = new TransactionTemplate(txManager);
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
   * 템플릿을 보장하고 그 페이지 id 를 돌려준다. 설정의 템플릿이 아직 「리포트」 바로 아래에 있으면 그대로 쓰고, 없거나(지워짐) 「리포트」 밖으로 옮겨졌으면 기본
   * 템플릿을 새로 복사해 「리포트」 아래 맨 위에 두고 설정에 적는다. 트랜잭션 밖에서 부른다.
   */
  public long ensureTemplate(ProjectRow project, ReportsHome home, long authorId) {
    Long current =
        tx.execute(s -> settings.find(project.id()).map(SettingRow::templatePageId).orElse(null));
    if (copier.isUnder(current, home.reportsPageId())) {
      return current;
    }
    return copy(project, home, authorId);
  }

  /**
   * 템플릿을 기본으로 되돌린다 — 템플릿이 「리포트」 아래 있으면 본문을 기본으로 덮고(직전 판을 수정 기록에 남긴다), 없으면 새로 복사한다. 트랜잭션 밖에서 부른다.
   */
  public void reset(ProjectRow project, long authorId) {
    ReportsHome home =
        writer
            .ensureReportsHome(project.id(), authorId)
            .orElseThrow(() -> new IllegalArgumentException("개인 프로젝트는 리포트를 만들지 않아요."));
    Long current =
        tx.execute(s -> settings.find(project.id()).map(SettingRow::templatePageId).orElse(null));
    if (!copier.isUnder(current, home.reportsPageId())) {
      copy(project, home, authorId);
      return;
    }
    copier.overwrite(current, authorId, defaultMarkdown(publicBaseUrl, project.key()));
  }

  /** 기본 템플릿을 「리포트」 아래 새 페이지로 복사해 맨 위로 올리고 설정에 적는다. */
  private long copy(ProjectRow project, ReportsHome home, long authorId) {
    long pageId =
        copier.copy(
            defaultMarkdown(publicBaseUrl, project.key()),
            TEMPLATE_TITLE,
            home.spaceId(),
            home.reportsPageId(),
            authorId,
            0);
    tx.executeWithoutResult(s -> settings.setTemplate(project.id(), pageId));
    return pageId;
  }
}
