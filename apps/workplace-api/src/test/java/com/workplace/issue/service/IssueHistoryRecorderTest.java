package com.workplace.issue.service;

import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.verifyNoMoreInteractions;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.issue.dto.IssueRow;
import com.workplace.issue.repository.IssueHistoryRepository;
import java.time.Instant;
import java.time.LocalDate;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

/** IssueHistoryRecorder 단위 테스트. Phase 3c 이후 담당자는 별도 흐름에서 기록되므로 recordChanges 는 다루지 않는다. */
@ExtendWith(MockitoExtension.class)
class IssueHistoryRecorderTest {

  @Mock private IssueHistoryRepository repo;

  private IssueHistoryRecorder recorder() {
    return new IssueHistoryRecorder(repo, new ObjectMapper());
  }

  /** 비교용 IssueRow 헬퍼. id/projectId/number/reporter 등은 고정. */
  private IssueRow row(String title, String status, String priority, LocalDate due) {
    return new IssueRow(
        99L, 1L, 1, title, "body", status, priority, due, 10L, Instant.now(), Instant.now(), null);
  }

  @Test
  void recordChanges_titleChange_writesOneTitleEvent() {
    var before = row("A", "TODO", "MID", null);
    var after = row("B", "TODO", "MID", null);

    recorder().recordChanges(1L, before, after);

    verify(repo).insert(99L, 1L, "TITLE_CHANGED", "A", "B");
    verifyNoMoreInteractions(repo);
  }

  @Test
  void recordChanges_bodyOnlyChange_noEvents() {
    var before =
        new IssueRow(
            99L,
            1L,
            1,
            "T",
            "body-1",
            "TODO",
            "MID",
            null,
            10L,
            Instant.now(),
            Instant.now(),
            null);
    var after =
        new IssueRow(
            99L,
            1L,
            1,
            "T",
            "body-2",
            "TODO",
            "MID",
            null,
            10L,
            Instant.now(),
            Instant.now(),
            null);

    recorder().recordChanges(1L, before, after);

    verifyNoInteractions(repo);
  }

  @Test
  void recordChanges_statusChange_writesStatusEvent() {
    var before = row("T", "TODO", "MID", null);
    var after = row("T", "IN_PROGRESS", "MID", null);

    recorder().recordChanges(7L, before, after);

    verify(repo).insert(99L, 7L, "STATUS_CHANGED", "TODO", "IN_PROGRESS");
    verifyNoMoreInteractions(repo);
  }

  @Test
  void recordChanges_dueDate_writesEvent() {
    LocalDate newDue = LocalDate.of(2026, 6, 1);
    var before = row("T", "TODO", "MID", null);
    var after = row("T", "TODO", "MID", newDue);

    recorder().recordChanges(1L, before, after);

    verify(repo).insert(99L, 1L, "DUE_DATE_CHANGED", null, newDue.toString());
    verifyNoMoreInteractions(repo);
  }
}
