package com.workplace.wiki.report;

import com.workplace.global.util.CapabilityTokens;
import com.workplace.issue.report.PersonalReportKind;
import com.workplace.wiki.dto.WikiPageDetail;
import com.workplace.wiki.report.PersonalReportSettingRepository.SettingRow;
import com.workplace.wiki.service.WikiSystemPageWriter;
import com.workplace.wiki.service.WikiSystemPageWriter.PersonalReportsHome;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 개인 보고 템플릿 두 벌(WP-1486) — 제품 기본 「일일」·「주간」(완성 샘플 + {@code wp-ai-instruction} 지시 상자)을 내 노트 › 「보고」 바로
 * 아래 「템플릿 · 일일 보고」·「템플릿 · 주간 보고」로 복사하고, 기본으로 되돌린다. 월간은 주간 템플릿을 쓴다(기간 낱말만 AI 가 바꾼다).
 *
 * <p>작성자는 언제나 본인이다(개인 공간은 소유자 한 명뿐). 본문 쓰기는 동기화 서버 위임 경로라 이 클래스의 메서드는 트랜잭션 밖에서 불러야 한다 — 설정 행 읽기·쓰기만
 * 짧은 트랜잭션으로 감싼다. 판정·덮기는 {@link ReportTemplateCopier} 가 하고, 복사는 동시 생성이 템플릿을 두 장 만들지 않게 공간 트리 잠금 아래에서
 * 직접 한다({@link #copy}).
 */
@Component
public class PersonalReportTemplate {

  /** 복사한 일일 템플릿 페이지 제목. */
  public static final String DAILY_TITLE = "템플릿 · 일일 보고";

  /** 복사한 주간(·월간) 템플릿 페이지 제목. */
  public static final String WEEKLY_TITLE = "템플릿 · 주간 보고";

  private static final String DAILY_RESOURCE = "report/personal-daily-template.md";
  private static final String WEEKLY_RESOURCE = "report/personal-weekly-template.md";

  private final WikiSystemPageWriter writer;
  private final ReportTemplateCopier copier;
  private final PersonalReportSettingRepository settings;
  private final TransactionTemplate tx;
  private final String publicBaseUrl;
  private final String rawDaily;
  private final String rawWeekly;

  public PersonalReportTemplate(
      WikiSystemPageWriter writer,
      ReportTemplateCopier copier,
      PersonalReportSettingRepository settings,
      PlatformTransactionManager txManager,
      @Value("${workplace.public-base-url:}") String publicBaseUrl) {
    this.writer = writer;
    this.copier = copier;
    this.settings = settings;
    this.tx = new TransactionTemplate(txManager);
    this.publicBaseUrl = publicBaseUrl;
    // 기동 때 한 번 원문을 읽는다 — 없으면 배포가 잘못된 것이라 기동을 실패시킨다.
    this.rawDaily = ReportTemplateCopier.loadResource(DAILY_RESOURCE);
    this.rawWeekly = ReportTemplateCopier.loadResource(WEEKLY_RESOURCE);
  }

  /** 종류별 기본 템플릿 마크다운 — 일일은 일일, 주간·월간은 주간 원문. 자리표시 {@code {{BASE_URL}}} 는 공개 웹 주소(끝 「/」 뗌)로 바꾼다. */
  public String defaultMarkdown(PersonalReportKind kind) {
    String raw = kind == PersonalReportKind.DAILY ? rawDaily : rawWeekly;
    return raw.replace("{{BASE_URL}}", CapabilityTokens.normalizeBaseUrl(publicBaseUrl));
  }

  /**
   * 그 종류의 템플릿을 보장하고 id 를 돌려준다. 설정의 템플릿이 아직 「보고」 바로 아래면 그대로 쓰고, 없거나(지워짐) 밖으로 옮겨졌으면 기본을 새로 복사해 설정에
   * 적는다. 트랜잭션 밖에서 부른다.
   */
  public long ensure(long userId, PersonalReportsHome home, PersonalReportKind kind) {
    Long current = currentTemplate(userId, kind);
    if (copier.isUnder(current, home.reportsPageId())) {
      return current;
    }
    return copy(userId, home, kind);
  }

  /**
   * 템플릿 본문 — 비었으면(없는 페이지 포함) 그 종류의 기본 원문으로 대신한다. 다른 생성이 템플릿을 막 만들고 본문을 아직 못 쓴 틈이거나 그 본문 쓰기가 실패한
   * 경우다({@link #copy}). 트랜잭션 밖에서 부른다.
   */
  public String readBodyOrDefault(long templateId, PersonalReportKind kind) {
    return writer
        .readBody(templateId)
        .filter(body -> !body.isBlank())
        .orElseGet(() -> defaultMarkdown(kind));
  }

  /** 일일 보고를 켤 때 — 「보고」 자리를 보장하고 일일·주간 템플릿을 둘 다 갖춘다. 트랜잭션 밖에서 부른다. */
  public void ensureBoth(long userId) {
    PersonalReportsHome home = writer.ensurePersonalReportsHome(userId);
    ensure(userId, home, PersonalReportKind.DAILY);
    ensure(userId, home, PersonalReportKind.WEEKLY);
  }

  /** 템플릿을 기본으로 되돌린다 — 「보고」 아래 있으면 본문을 기본으로 덮고(직전 판을 수정 기록에 남긴다), 없으면 새로 복사한다. 트랜잭션 밖에서 부른다. */
  public void reset(long userId, PersonalReportKind kind) {
    PersonalReportsHome home = writer.ensurePersonalReportsHome(userId);
    Long current = currentTemplate(userId, kind);
    if (!copier.isUnder(current, home.reportsPageId())) {
      copy(userId, home, kind);
      return;
    }
    copier.overwrite(current, userId, defaultMarkdown(kind));
  }

  /** 설정에 적힌 그 종류의 템플릿 페이지 id(없으면 null). */
  private Long currentTemplate(long userId, PersonalReportKind kind) {
    return tx.execute(s -> settings.find(userId).map(r -> templateOf(r, kind)).orElse(null));
  }

  private static Long templateOf(SettingRow row, PersonalReportKind kind) {
    return kind == PersonalReportKind.DAILY
        ? row.dailyTemplatePageId()
        : row.weeklyTemplatePageId();
  }

  /**
   * 기본 템플릿을 「보고」 아래 새 페이지로 복사해 제 자리(일일 0번·주간 1번)에 두고 설정에 적는다.
   *
   * <p>같은 사람의 생성 둘(자동 일일과 수동 만들기 등)이 동시에 부르면 둘 다 「없음」을 보고 템플릿을 두 장 만들 수 있다. 그래서 짧은 트랜잭션에서 그 공간의 트리
   * 잠금(「보고」·월 폴더를 만들 때와 같은 잠금)을 잡고 설정을 다시 읽어, 그새 다른 쪽이 만들어 두었으면 그것을 쓴다. 없으면 같은 트랜잭션에서 빈 페이지를 만들어
   * 자리에 두고 설정에 적은 뒤 커밋한다 — 잠금은 커밋까지라 뒤따르는 쪽은 적힌 템플릿을 본다. 본문 쓰기는 동기화 서버 위임 경로라 잠금을 쥘 수 없어 커밋 뒤 트랜잭션
   * 밖에서 한다(그 짧은 틈에 빈 본문을 읽은 생성기는 기본 원문으로 대신한다 — {@link #readBodyOrDefault}).
   */
  private long copy(long userId, PersonalReportsHome home, PersonalReportKind kind) {
    boolean daily = kind == PersonalReportKind.DAILY;
    Created created =
        tx.execute(
            s -> {
              writer.lockSpaceTree(home.spaceId());
              Long current = settings.find(userId).map(r -> templateOf(r, kind)).orElse(null);
              if (copier.isUnder(current, home.reportsPageId())) {
                return new Created(current, null);
              }
              WikiPageDetail page =
                  writer.createPage(
                      userId,
                      home.spaceId(),
                      home.reportsPageId(),
                      daily ? DAILY_TITLE : WEEKLY_TITLE);
              writer.moveTo(page.id(), home.reportsPageId(), daily ? 0 : 1);
              settings.setTemplate(userId, kind, page.id());
              return new Created(page.id(), page.version());
            });
    if (created.version() != null) {
      // 이 호출이 만든 페이지만 본문을 쓴다(사람 글, 수정 기록 없음) — 다른 쪽이 만든 것은 그쪽이 쓴다.
      writer.writeBody(
          userId, created.pageId(), created.version(), defaultMarkdown(kind), false, false);
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
