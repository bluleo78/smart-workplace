package com.workplace.wiki.report;

import com.workplace.wiki.dto.WikiPageDetail;
import com.workplace.wiki.report.PersonalReportSettingRepository.SettingRow;
import com.workplace.wiki.service.WikiSystemPageWriter;
import java.util.List;
import java.util.Optional;
import java.util.stream.Stream;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 개인 보고 저장 위치 해석기(WP-1655) — 새 보고를 내 노트의 어느 페이지 아래에 둘지 정한다. 프로젝트 판 {@link ProjectReportLocation}
 * (WP-1654)과 같은 모양이고, 공간 찾기(본인 PERSONAL 공간)·설정 행·막는 규칙(달 폴더 갈래도 막음)만 다르다.
 *
 * <ul>
 *   <li>설정에 고른 위치(report_location_page_id)가 있고 내 노트 공간 안이며 막히지 않았으면 그 아래. 없거나 지워졌으면(FK 가 NULL 로) 기본
 *       「보고」
 *   <li>고른 위치가 다른 공간으로 옮겨졌으면 생성 때 「보고」로 되돌리고 설정값을 조건부로 지운다(그사이 새로 고른 값은 지우지 않게)
 *   <li>고른 위치가 나중에 「템플릿」·템플릿 페이지·달 폴더 갈래로 옮겨졌으면 설명·생성 모두 「보고」로 본다(설정값은 남긴다)
 *   <li>고른 위치가 유효하면 「보고」를 만들지 않는다 — 사람이 비게 된 「보고」를 지웠어도 되살리지 않는다
 * </ul>
 *
 * <p>설정 화면용 {@link #describe} 는 아무것도 만들지 않는다. 쓰기({@link #resolveForWrite})는 트랜잭션 밖에서도 부를 수 있게 설정 행
 * 읽기·쓰기만 짧은 트랜잭션으로 감싼다(부른 쪽 트랜잭션이 있으면 합류한다).
 */
@Component
public class PersonalReportLocation {

  /** 기본 저장 위치 이름 — 「보고」가 아직 없어도 설정 화면에는 이 경로로 보인다(다음 생성 때 만든다). */
  static final String DEFAULT_TITLE = WikiSystemPageWriter.PERSONAL_REPORTS_TITLE;

  /** 내 노트 밖·없는 페이지를 고른 요청의 400 문구. */
  static final String NOT_IN_SPACE = "내 노트의 페이지만 고를 수 있어요.";

  /** 「템플릿」 갈래·템플릿 페이지 갈래를 고른 요청의 400 문구. */
  static final String UNDER_TEMPLATE = "템플릿 아래에는 보고를 둘 수 없어요.";

  /** AI 가 쓴 보고 페이지를 고른 요청의 400 문구. */
  static final String UNDER_AI_REPORT = "AI 가 쓴 보고 페이지 아래에는 둘 수 없어요.";

  /** 달 폴더(「2026년 11월」) 자신이나 그 아래를 고른 요청의 400 문구. */
  static final String UNDER_MONTH_FOLDER = "달 폴더 아래에는 보고를 둘 수 없어요.";

  private final WikiSystemPageWriter writer;
  private final PersonalReportSettingRepository settings;
  private final TransactionTemplate tx;

  public PersonalReportLocation(
      WikiSystemPageWriter writer,
      PersonalReportSettingRepository settings,
      PlatformTransactionManager txManager) {
    this.writer = writer;
    this.settings = settings;
    this.tx = new TransactionTemplate(txManager);
  }

  /**
   * 생성용으로 해석한 자리.
   *
   * @param spaceId 본인의 내 노트(PERSONAL) 공간
   * @param parentPageId 새 보고의 달 폴더를 만들 부모 페이지(고른 위치 또는 「보고」)
   */
  public record Resolved(long spaceId, long parentPageId) {}

  /**
   * 읽기 전용 설명 — 설정 화면용.
   *
   * @param spaceId 내 노트 공간(없으면 null)
   * @param locationPageId 유효한 저장 위치(고른 위치가 유효하면 그것, 아니면 「보고」, 그것도 없으면 null)
   * @param locationPath 저장 위치 경로 제목(기본 {@code ["보고"]})
   * @param templatesRootId 맨 위 「템플릿」 페이지(없으면 null) — 고르기 창에서 뺀다
   */
  public record Description(
      Long spaceId, Long locationPageId, List<String> locationPath, Long templatesRootId) {}

  /**
   * 생성용 자리를 정한다 — 공간을 보장하고, 고른 위치가 유효하면 그것, 아니면 「보고」(없으면 맨 위에 만든다). 고른 위치가 다른 공간으로 옮겨졌으면(또는 없는
   * 페이지면) 설정값을 조건부로 지운다.
   */
  public Resolved resolveForWrite(long userId) {
    long spaceId = writer.ensurePersonalSpace(userId);
    Long chosen = tx.execute(s -> storedLocation(settings.find(userId)));
    if (chosen != null) {
      // null = 공간 밖(다른 공간으로 옮겨졌거나 없는 페이지), true = 공간 안이지만 막힌 갈래, false = 그대로 쓴다.
      Boolean blocked =
          tx.execute(
              s ->
                  writer.existsInSpace(chosen, spaceId)
                      ? blocked(settings.find(userId), spaceId, chosen, writer.pathTitles(chosen))
                      : null);
      if (Boolean.FALSE.equals(blocked)) {
        return new Resolved(spaceId, chosen);
      }
      if (blocked == null) {
        // 다른 공간으로 옮겨진 위치 — 기본으로 되돌린다(지워진 위치는 FK 가 이미 NULL 로 했다).
        tx.executeWithoutResult(s -> settings.clearLocationIf(userId, chosen));
      }
      // 「템플릿」·템플릿·달 폴더 갈래로 옮겨진 위치는 이번에만 「보고」에 둔다 — 설정값은 남겨 사람이 다시 밖으로 옮기면 그대로 쓴다.
    }
    return new Resolved(spaceId, writer.ensurePersonalReportsPage(spaceId, userId));
  }

  /** 읽기 전용 설명 — 공간·「보고」를 포함해 아무 페이지도 만들지 않는다. 공간이 없으면 id 는 모두 null, 경로는 기본. */
  public Description describe(long userId) {
    return tx.execute(
        s -> {
          Optional<Long> space = writer.findPersonalSpace(userId);
          if (space.isEmpty()) {
            return new Description(null, null, List.of(DEFAULT_TITLE), null);
          }
          long spaceId = space.get();
          Long templatesRoot = writer.findTemplatesPage(spaceId).orElse(null);
          // 설정 행은 한 번만 읽고, 고른 위치의 경로 제목도 한 번만 구해 막힘 판정과 표시에 같이 쓴다.
          Optional<SettingRow> row = settings.find(userId);
          Long chosen = storedLocation(row);
          // 고른 위치가 공간 안이어도 막힌 갈래로 옮겨졌으면 생성과 같이 「보고」로 보인다.
          if (writer.existsInSpace(chosen, spaceId)) {
            List<String> path = writer.pathTitles(chosen);
            if (!blocked(row, spaceId, chosen, path)) {
              return new Description(spaceId, chosen, path, templatesRoot);
            }
          }
          Long reports = writer.findPersonalReportsPage(spaceId).orElse(null);
          return new Description(spaceId, reports, List.of(DEFAULT_TITLE), templatesRoot);
        });
  }

  /**
   * 설정에서 고른 위치를 검증한다 — 아무것도 만들지 않는다(400 은 부수효과가 없어야 한다). 검사 순서는 공간 → 템플릿 갈래 → 달 폴더 갈래 → AI 보고.
   *
   * @throws IllegalArgumentException 내 노트 공간이 없거나 공간 밖·없는 페이지, 「템플릿」 갈래 또는 지금 템플릿 페이지 갈래(자기 포함), 달
   *     폴더 갈래(자기 포함), AI 가 쓴 보고 페이지 자신(→ 400)
   */
  public void validateChoice(long userId, long pageId) {
    tx.executeWithoutResult(
        s -> {
          Optional<Long> space = writer.findPersonalSpace(userId);
          if (space.isEmpty() || !writer.existsInSpace(pageId, space.get())) {
            throw new IllegalArgumentException(NOT_IN_SPACE);
          }
          if (underTemplate(settings.find(userId), space.get(), pageId)) {
            throw new IllegalArgumentException(UNDER_TEMPLATE);
          }
          if (underMonthFolder(writer.pathTitles(pageId))) {
            throw new IllegalArgumentException(UNDER_MONTH_FOLDER);
          }
          String aiAction = writer.findPage(pageId).map(WikiPageDetail::aiLastAction).orElse(null);
          if (WikiSystemPageWriter.AI_ACTION_REPORT.equals(aiAction)) {
            throw new IllegalArgumentException(UNDER_AI_REPORT);
          }
        });
  }

  /**
   * pageId(공간 안 페이지)에 보고를 둘 수 없는가 — 템플릿 갈래이거나 달 폴더 갈래. 저장 검증과 생성·설명이 같은 기준을 쓴다(검증을 통과한 위치가 나중에 그
   * 갈래로 옮겨진 경우를 생성·설명이 걸러낸다). 트랜잭션 안에서 부른다.
   *
   * @param row 부른 쪽이 읽은 설정 행(없으면 empty)
   * @param path 부른 쪽이 구한 pageId 의 경로 제목({@link WikiSystemPageWriter#pathTitles})
   */
  private boolean blocked(Optional<SettingRow> row, long spaceId, long pageId, List<String> path) {
    return underTemplate(row, spaceId, pageId) || underMonthFolder(path);
  }

  /**
   * pageId 가 맨 위 「템플릿」 갈래(자기 포함)이거나 설정의 일일·주간 템플릿 갈래(자기 포함, 그 템플릿이 공간 안일 때)인가. 사람이 「템플릿」 밖으로 옮긴
   * 템플릿도 그 갈래에 보고를 두지 않는다(템플릿 본문과 보고가 섞이지 않게). 트랜잭션 안에서 부른다.
   */
  private boolean underTemplate(Optional<SettingRow> row, long spaceId, long pageId) {
    Optional<Long> templatesRoot = writer.findTemplatesPage(spaceId);
    if (templatesRoot.isPresent() && writer.isUnderOrSelf(pageId, templatesRoot.get())) {
      return true;
    }
    if (row.isEmpty()) {
      return false;
    }
    return Stream.of(row.get().dailyTemplatePageId(), row.get().weeklyTemplatePageId())
        .anyMatch(t -> writer.existsInSpace(t, spaceId) && writer.isUnderOrSelf(pageId, t));
  }

  /**
   * 경로(루트 → pageId 자신) 제목 중 달 폴더(「2026년 11월」)가 있는가 — 생성기가 달 폴더 아래에 또 달 폴더를 만들지 않게(보고와 달 폴더가 섞이지
   * 않게).
   *
   * @param path pageId 의 경로 제목(자기 포함)
   */
  private static boolean underMonthFolder(List<String> path) {
    return path.stream().anyMatch(PersonalReportMonthFolder::isMonthFolder);
  }

  /** 설정 행에 적힌 저장 위치(행이 없거나 고르지 않았으면 null). */
  private static Long storedLocation(Optional<SettingRow> row) {
    return row.map(SettingRow::reportLocationPageId).orElse(null);
  }
}
