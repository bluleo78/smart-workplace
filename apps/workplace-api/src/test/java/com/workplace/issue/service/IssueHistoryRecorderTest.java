package com.workplace.issue.service;

import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.verifyNoMoreInteractions;

import com.workplace.issue.dto.IssueRow;
import com.workplace.issue.repository.IssueHistoryRepository;
import java.time.Instant;
import java.time.LocalDate;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

/**
 * IssueHistoryRecorder 단위 테스트. 변경 항목별 history insert 호출 여부와 body 변경 무시 여부를 검증한다. (DB 미사용 — Mockito
 * 만 사용.)
 */
@ExtendWith(MockitoExtension.class)
class IssueHistoryRecorderTest {

  @Mock private IssueHistoryRepository repo;

  @InjectMocks private IssueHistoryRecorder recorder;

  /** 비교용 IssueRow 헬퍼. id/projectId/number/reporter 등은 고정. */
  private IssueRow row(String title, String status, String priority, Long assignee, LocalDate due) {
    return new IssueRow(
        99L,
        1L,
        1,
        title,
        "body",
        status,
        priority,
        due,
        10L,
        assignee,
        Instant.now(),
        Instant.now(),
        null);
  }

  @Test
  void recordChanges_titleChange_writesOneTitleEvent() {
    var before = row("A", "TODO", "MID", null, null);
    var after = row("B", "TODO", "MID", null, null);

    recorder.recordChanges(1L, before, after);

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
            null,
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
            null,
            Instant.now(),
            Instant.now(),
            null);

    recorder.recordChanges(1L, before, after);

    verifyNoInteractions(repo);
  }

  @Test
  void recordChanges_statusAndAssignee_writesBoth() {
    var before = row("T", "TODO", "MID", 10L, null);
    var after = row("T", "IN_PROGRESS", "MID", 20L, null);

    recorder.recordChanges(7L, before, after);

    verify(repo).insert(99L, 7L, "STATUS_CHANGED", "TODO", "IN_PROGRESS");
    verify(repo).insert(99L, 7L, "ASSIGNEE_CHANGED", "10", "20");
    verifyNoMoreInteractions(repo);
  }

  @Test
  void recordChanges_dueDate_writesEvent() {
    LocalDate newDue = LocalDate.of(2026, 6, 1);
    var before = row("T", "TODO", "MID", null, null);
    var after = row("T", "TODO", "MID", null, newDue);

    recorder.recordChanges(1L, before, after);

    // before.dueDate null → from=null, after.dueDate="2026-06-01"
    verify(repo).insert(99L, 1L, "DUE_DATE_CHANGED", null, newDue.toString());
    verifyNoMoreInteractions(repo);
  }

  @Test
  void recordChanges_assigneeCleared_writesNullTo() {
    var before = row("T", "TODO", "MID", 10L, null);
    var after = row("T", "TODO", "MID", null, null);

    recorder.recordChanges(1L, before, after);

    verify(repo).insert(99L, 1L, "ASSIGNEE_CHANGED", "10", null);
    verifyNoMoreInteractions(repo);
  }
}
