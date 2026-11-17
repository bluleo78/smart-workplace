package com.workplace.wiki.report;

import com.workplace.global.util.CapabilityTokens;
import com.workplace.issue.report.PersonalReportKind;
import com.workplace.wiki.dto.WikiPageDetail;
import com.workplace.wiki.report.PersonalReportSettingRepository.SettingRow;
import com.workplace.wiki.service.WikiSystemPageWriter;
import java.util.List;
import java.util.Optional;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 개인 보고 템플릿 두 벌(WP-1486, WP-1655 에서 보고와 분리) — 제품 기본 「일일」·「주간」(완성 샘플 + {@code wp-ai-instruction} 지시
 * 상자)을 내 노트 맨 위 「템플릿」 아래 「일일 보고」·「주간·월간 보고」로 복사하고, 기본으로 되돌린다. 월간은 주간 템플릿을 쓴다(기간 낱말만 AI 가 바꾼다).
 *
 * <ul>
 *   <li>템플릿은 설정의 id(daily/weekly_template_page_id)로 따라간다 — 내 노트 공간 안이면 사람이 어디로 옮겨도 그대로 쓴다. 「보고」는
 *       만들지 않는다(보고 저장 위치는 {@link PersonalReportLocation} 이 정한다).
 *   <li>지워졌거나 다른 공간으로 옮겨졌으면 「템플릿」 아래(일일 0번, 주간·월간은 일일 다음) 새로 복사한다. 그 종류를 전에 만든 적이 있으면(id 가 남아 있거나
 *       *_template_made) 설정에 「다시 만들었어요」 시각을 남긴다 — 종류별로 가려서 처음 켤 때 일일 직후의 주간 복사를 「다시 만듦」으로 보지 않는다.
 *   <li>옛 구조(「보고」 바로 아래 「템플릿 · 일일 보고」·「템플릿 · 주간 보고」)는 다음 설정 쓰기·생성 때 한 번만 같은 id 로 「템플릿」 아래로 옮기고 제목만
 *       바꾼다(본문 그대로). 이미 사람이 다른 곳으로 옮겨 둔 템플릿은 그 자리에 둔다.
 * </ul>
 *
 * <p>작성자는 언제나 본인이다(개인 공간은 소유자 한 명뿐). 본문 쓰기는 동기화 서버 위임 경로라 이 클래스의 공개 메서드는 트랜잭션 밖에서 불러야 한다 — 설정 행
 * 읽기·쓰기만 짧은 트랜잭션으로 감싼다. 복사·이전은 동시 호출(자동 일일과 수동 만들기, 설정 저장)이 템플릿을 두 장 만들거나 두 번 옮기지 않게 공간 트리 잠금 아래에서
 * 설정 행을 다시 읽고 한다(프로젝트 {@link ProjectReportTemplate} 와 같은 방식).
 */
@Component
public class PersonalReportTemplate {

  /** 복사한 일일 템플릿 페이지 제목(WP-1655 — 「템플릿」 아래라 접두어 없음). */
  public static final String DAILY_TITLE = "일일 보고";

  /** 복사한 주간·월간 템플릿 페이지 제목(WP-1655 — 월간도 이 템플릿을 쓴다). */
  public static final String WEEKLY_TITLE = "주간·월간 보고";

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
   * 그 종류의 템플릿을 보장하고 id 를 돌려준다(생성·설정을 켤 때). 트랜잭션 밖에서 부른다.
   *
   * <ol>
   *   <li>아직 옛 이전 판정을 하지 않았으면({@code !templateInitialized}) 옛 「보고」 아래 템플릿 옮기기를 먼저 한다.
   *   <li>설정의 템플릿이 그 공간 안에 있으면 그대로 쓴다(어디로 옮겼든).
   *   <li>없거나(지워짐) 다른 공간이면 「템플릿」 아래 새로 복사한다 — 그 종류를 전에 만든 적이 있으면 「다시 만들었어요」로 알린다.
   * </ol>
   *
   * @param spaceId 내 노트 공간(부른 쪽이 보장했다)
   */
  public long ensure(long userId, long spaceId, PersonalReportKind kind) {
    // 「다시 만듦」 판정은 이전·복사 전의 행으로 한다 — 이전은 id·만든 적 표시를 바꾸지 않는다.
    SettingRow row = readRow(userId);
    if (!row.templateInitialized()) {
      relocateLegacy(userId, spaceId);
    }
    Long current = templateOf(row, kind);
    if (writer.existsInSpace(current, spaceId)) {
      return current;
    }
    // id 가 남아 있으면 다른 공간으로 옮겨진 것, 비었는데 만든 적이 있으면 지워진 것(FK 가 NULL 로 만든다) — 둘 다 다시 만듦.
    return copy(userId, spaceId, kind, current != null || madeOf(row, kind));
  }

  /** 일일 보고를 켤 때 — 내 노트 공간을 보장하고 일일·주간 템플릿을 둘 다 갖춘다(「보고」는 만들지 않는다). 트랜잭션 밖에서 부른다. */
  public void ensureBoth(long userId) {
    long spaceId = writer.ensurePersonalSpace(userId);
    ensure(userId, spaceId, PersonalReportKind.DAILY);
    ensure(userId, spaceId, PersonalReportKind.WEEKLY);
  }

  /**
   * 옛 위치(「보고」 바로 아래) 템플릿을 한 번 「템플릿」 아래로 옮긴다 — 복사는 하지 않는다. 설정 쓰기 앞에서 부른다(스펙 「다음 설정 저장·보고 만들기 때」).
   * 공간·「보고」는 찾기만 하고 만들지 않는다 — 공간이 없으면 아무것도 하지 않는다. 트랜잭션 밖에서 부른다.
   */
  public void relocateLegacyIfNeeded(long userId) {
    Optional<Long> space = writer.findPersonalSpace(userId);
    if (space.isEmpty()) {
      return;
    }
    if (!readRow(userId).templateInitialized()) {
      relocateLegacy(userId, space.get());
    }
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

  /**
   * 템플릿을 기본으로 되돌린다 — 공간 안에 템플릿이 있으면 본문을 기본으로 덮고(직전 판을 수정 기록에 남긴다), 없으면 「템플릿」 아래 새로 복사한다. 옛 위치
   * 이전({@link #relocateLegacyIfNeeded})은 부른 쪽이 먼저 한다(설정 쓰기 앞에서 하는 {@code beginWrite} 가 이미 한다). 사람이
   * 누른 되돌리기라 「다시 만들었어요」로 알리지 않는다. 트랜잭션 밖에서 부른다.
   */
  public void reset(long userId, PersonalReportKind kind) {
    long spaceId = writer.ensurePersonalSpace(userId);
    Long current = templateOf(readRow(userId), kind);
    if (!writer.existsInSpace(current, spaceId)) {
      copy(userId, spaceId, kind, false);
      return;
    }
    copier.overwrite(current, userId, defaultMarkdown(kind));
  }

  /** 설정 행(없으면 기본값) — 짧은 트랜잭션. */
  private SettingRow readRow(long userId) {
    return tx.execute(s -> settings.find(userId).orElseGet(() -> SettingRow.defaults(userId)));
  }

  /** 행에 적힌 그 종류의 템플릿 페이지 id — 일일은 일일 칸, 주간·월간은 주간 칸(없으면 null). */
  private static Long templateOf(SettingRow row, PersonalReportKind kind) {
    return kind == PersonalReportKind.DAILY
        ? row.dailyTemplatePageId()
        : row.weeklyTemplatePageId();
  }

  /** 그 종류의 템플릿을 한 번이라도 만들었는가 — 지워져 id 가 비었을 때 「다시 만듦」 판정. */
  private static boolean madeOf(SettingRow row, PersonalReportKind kind) {
    return kind == PersonalReportKind.DAILY ? row.dailyTemplateMade() : row.weeklyTemplateMade();
  }

  private static String titleOf(PersonalReportKind kind) {
    return kind == PersonalReportKind.DAILY ? DAILY_TITLE : WEEKLY_TITLE;
  }

  /**
   * 옛 위치 이전(한 번만) — 공간 트리 잠금 아래에서 행을 다시 읽어, 아직 판정하지 않았으면 부모가 「보고」 루트인 일일·주간 템플릿을 각각 「템플릿」 아래로
   * 옮기고(일일 0번, 주간은 일일 다음) 제목을 새 이름으로 바꾼다. 부모가 다른 곳이면(사람이 이미 옮겨 둠) 옮기지 않는다. 「보고」가 없거나 옮길 것이 없어도 판정
   * 마침을 남긴다. 「보고」는 찾기만 하고 만들지 않는다. 본문은 건드리지 않는다 — 제목만 바꾸기는 위임 없는 트랜잭션 안 경로라 잠금을 쥔 채 할 수 있다.
   */
  private void relocateLegacy(long userId, long spaceId) {
    tx.executeWithoutResult(
        s -> {
          writer.lockSpaceTree(spaceId);
          SettingRow row = settings.find(userId).orElseGet(() -> SettingRow.defaults(userId));
          if (row.templateInitialized()) {
            // 그새 다른 호출이 이전을 마쳤다.
            return;
          }
          Optional<Long> reports = writer.findPersonalReportsPage(spaceId);
          if (reports.isPresent()) {
            Long daily = row.dailyTemplatePageId();
            Long weekly = row.weeklyTemplatePageId();
            boolean moveDaily = daily != null && writer.existsUnder(daily, reports.get());
            boolean moveWeekly = weekly != null && writer.existsUnder(weekly, reports.get());
            if (moveDaily || moveWeekly) {
              long templatesRoot = writer.ensureTemplatesPage(spaceId, userId);
              if (moveDaily) {
                writer.moveTo(daily, templatesRoot, 0);
                writer.renameTo(daily, DAILY_TITLE, userId);
              }
              if (moveWeekly) {
                writer.moveTo(weekly, templatesRoot, weeklyPosition(templatesRoot, daily));
                writer.renameTo(weekly, WEEKLY_TITLE, userId);
              }
            }
          }
          settings.markTemplateInitialized(userId);
        });
  }

  /** 주간·월간 템플릿을 둘 자리 — 일일 템플릿이 「템플릿」 바로 아래 있으면 그 바로 다음, 아니면 맨 위(0번). 잠금 아래에서 부른다. */
  private int weeklyPosition(long templatesRoot, Long dailyId) {
    if (dailyId == null) {
      return 0;
    }
    List<Long> children = writer.childIdsOrdered(templatesRoot);
    int index = children.indexOf(dailyId);
    return index >= 0 ? index + 1 : 0;
  }

  /**
   * 기본 템플릿을 「템플릿」 아래 새 페이지로 복사해 제 자리(일일 0번, 주간·월간은 일일 다음)에 두고 설정에 적는다.
   *
   * <p>같은 사람의 호출 둘(자동 일일과 수동 만들기 등)이 둘 다 「없음」을 보고 템플릿을 두 장 만들지 않게, 짧은 트랜잭션에서 공간 트리 잠금을 잡고 설정을 다시 읽어
   * 그새 공간 안에 템플릿이 생겼으면 그것을 쓴다. 없으면 같은 트랜잭션에서 「템플릿」 보장 → 빈 페이지 만들기 → 자리 옮기기 → 설정에 적기를 하고 커밋한다 — 잠금은
   * 커밋까지라 뒤따르는 쪽은 적힌 템플릿을 본다. 본문 쓰기는 동기화 서버 위임 경로라 잠금을 쥘 수 없어 커밋 뒤 트랜잭션 밖에서 이 호출이 만든 페이지에만 한다(그 짧은
   * 틈에 빈 본문을 읽은 생성기는 기본 원문으로 대신한다 — {@link #readBodyOrDefault}).
   *
   * @param recreated 없어진 템플릿을 다시 만드는 것이면 true — 설정에 「다시 만들었어요」 시각을 남긴다
   */
  private long copy(long userId, long spaceId, PersonalReportKind kind, boolean recreated) {
    Created created =
        tx.execute(
            s -> {
              writer.lockSpaceTree(spaceId);
              SettingRow row = settings.find(userId).orElseGet(() -> SettingRow.defaults(userId));
              Long current = templateOf(row, kind);
              if (writer.existsInSpace(current, spaceId)) {
                return new Created(current, null);
              }
              long templatesRoot = writer.ensureTemplatesPage(spaceId, userId);
              WikiPageDetail page =
                  writer.createPage(userId, spaceId, templatesRoot, titleOf(kind));
              int position =
                  kind == PersonalReportKind.DAILY
                      ? 0
                      : weeklyPosition(templatesRoot, row.dailyTemplatePageId());
              writer.moveTo(page.id(), templatesRoot, position);
              settings.setTemplate(userId, kind, page.id(), recreated);
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
