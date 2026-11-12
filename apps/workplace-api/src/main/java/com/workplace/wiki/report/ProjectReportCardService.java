package com.workplace.wiki.report;

import com.workplace.issue.report.ReportCadence;
import com.workplace.project.dto.ProjectRow;
import com.workplace.project.service.ProjectAccessGuard;
import com.workplace.wiki.report.ProjectReportRepository.ReportRow;
import com.workplace.wiki.report.dto.ProjectReportCardResponse;
import com.workplace.wiki.report.dto.ReportCard;
import com.workplace.wiki.report.dto.ReportListItem;
import com.workplace.wiki.repository.WikiPageRepository;
import com.workplace.wiki.repository.WikiPageRepository.EditMark;
import com.workplace.wiki.repository.WikiSpaceMemberRepository;
import com.workplace.wiki.repository.WikiSpaceRepository;
import com.workplace.wiki.service.WikiSystemPageWriter;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 개요 카드 리포트 줄(WP-1483) — 최신 리포트의 배지·한 줄과 「지난 리포트」 목록.
 *
 * <ul>
 *   <li>프로젝트를 못 읽으면 404(존재 은닉). 프로젝트는 읽어도 노트 공간 VIEWER 가 아니면(공간 비멤버 ADMIN 등) 빈 응답 — 눌러도 열 수 없는 리포트를
 *       보이지 않는다.
 *   <li>최신 카드의 배지·한 줄은 페이지 마크다운을 그때 읽는다(사람이 고치면 카드도 바뀐다). 배지를 못 읽으면 생성 때 저장한 배지.
 *   <li>목록은 최신 회차부터 최대 {@value #PAST_LIMIT}개, 저장 배지를 쓴다(본문을 열 번 읽지 않게). 지워졌거나 공간 밖으로 옮겨진 페이지는 뺀다.
 *   <li>「수정됨」 = 페이지 수정 시각이 AI 작성 시각보다 늦음 — 열기만 하고 고치지 않았으면 같다.
 * </ul>
 */
@Service
@RequiredArgsConstructor
public class ProjectReportCardService {

  /** 「지난 리포트」 목록 상한(최신 포함). */
  static final int PAST_LIMIT = 10;

  private final ProjectAccessGuard guard;
  private final ProjectReportRepository reports;
  private final WikiSpaceRepository spaces;
  private final WikiSpaceMemberRepository spaceMembers;
  private final WikiPageRepository pages;
  private final WikiSystemPageWriter writer;

  /** 개요 카드 리포트 줄 — 위 규칙. RLS 를 위해 한 읽기 트랜잭션 안에서 읽는다. */
  @Transactional(readOnly = true)
  public ProjectReportCardResponse card(long callerId, String projectKey) {
    ProjectRow project = guard.assertReadable(projectKey, callerId);
    Optional<Long> space = spaces.findIdByLinkedProject(project.id());
    // 노트 공간 VIEWER 이상(직접·부서 멤버)만 — 아니면 리포트가 있어도 숨긴다.
    if (space.isEmpty() || spaceMembers.findRole(space.get(), callerId).isEmpty()) {
      return ProjectReportCardResponse.empty();
    }
    long spaceId = space.get();
    List<ReportRow> rows = reports.recentGenerated(project.id(), PAST_LIMIT);
    Map<Long, EditMark> marks = pages.findEditMarks(rows.stream().map(ReportRow::pageId).toList());
    // 페이지가 공간 밖으로 옮겨졌으면 뺀다 — 그 공간을 볼 수 있는지 여기서 알 수 없다.
    List<ReportRow> visible =
        rows.stream()
            .filter(r -> marks.containsKey(r.pageId()))
            .filter(r -> marks.get(r.pageId()).spaceId() == spaceId)
            .toList();
    Long reportsPageId = writer.findReportsPage(spaceId).orElse(null);
    if (visible.isEmpty()) {
      return new ProjectReportCardResponse(null, List.of(), reportsPageId, null);
    }
    List<ReportListItem> past =
        visible.stream()
            .map(
                r -> {
                  EditMark m = marks.get(r.pageId());
                  return new ReportListItem(
                      r.pageId(), m.title(), r.periodStart(), r.badge(), m.editedAfterAi());
                })
            .toList();
    ReportRow top = visible.get(0);
    return new ProjectReportCardResponse(
        latest(top, marks.get(top.pageId())), past, reportsPageId, cadenceLabel(top));
  }

  /** 최신 카드 — 본문을 그때 읽어 배지·한 줄을 뽑는다(못 읽은 배지는 저장값). */
  private ReportCard latest(ReportRow row, EditMark mark) {
    ReportMarkdown.CardSummary summary =
        writer
            .readBody(row.pageId())
            .map(ReportMarkdown::cardSummary)
            .orElse(new ReportMarkdown.CardSummary(null, null));
    String badge = summary.badge() != null ? summary.badge() : row.badge();
    return new ReportCard(
        row.pageId(),
        mark.title(),
        row.periodStart(),
        row.periodEnd(),
        row.createdAt(),
        badge,
        summary.line(),
        mark.editedAfterAi());
  }

  /**
   * 최신 리포트의 주기 이름(줄 머리 「주간 리포트」) — 회차 길이로 정한다(7일 주간, 14일 격주, 그 밖 월간). 설정이 아니라 회차에서 읽어, 주기를 바꾼 뒤에도
   * 지난 리포트를 바른 이름으로 부른다.
   */
  private static String cadenceLabel(ReportRow row) {
    long days = ChronoUnit.DAYS.between(row.periodStart(), row.periodEnd()) + 1;
    ReportCadence cadence =
        days == 7
            ? ReportCadence.WEEKLY
            : days == 14 ? ReportCadence.BIWEEKLY : ReportCadence.MONTHLY;
    return cadence.label();
  }
}
