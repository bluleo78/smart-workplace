package com.workplace.global.exception;

import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.auth.exception.KeyNotFoundException;
import com.workplace.auth.exception.UserTokenNotFoundException;
import com.workplace.calendar.exception.CalendarEventNotFoundException;
import com.workplace.calendar.exception.CalendarNotFoundException;
import com.workplace.calendar.exception.ExternalCalendarDeletionNotAllowedException;
import com.workplace.calendar.exception.ExternalCalendarResetNotAllowedException;
import com.workplace.calendar.exception.ReadOnlyCalendarException;
import com.workplace.contacts.exception.ContactForbiddenException;
import com.workplace.contacts.exception.ContactNotFoundException;
import com.workplace.cycle.exception.CycleNotFoundException;
import com.workplace.drive.exception.DriveFileNotFoundException;
import com.workplace.drive.exception.DriveFolderNotFoundException;
import com.workplace.drive.exception.DriveLastOwnerException;
import com.workplace.drive.exception.DriveNotInTrashException;
import com.workplace.drive.exception.DriveSpaceNotFoundException;
import com.workplace.drive.exception.DriveSpaceTypeNotEditableException;
import com.workplace.file.exception.FileNotFoundException;
import com.workplace.home.exception.HomeAttachmentNotFoundException;
import com.workplace.home.exception.HomeProposalAlreadyResolvedException;
import com.workplace.home.exception.HomeProposalNotFoundException;
import com.workplace.issue.exception.AttachmentNotFoundException;
import com.workplace.issue.exception.FieldNotFoundException;
import com.workplace.issue.exception.IssueCommentNotFoundException;
import com.workplace.issue.exception.TypeNotFoundException;
import com.workplace.label.exception.LabelNotFoundException;
import com.workplace.mail.exception.EmailAccountNotFoundException;
import com.workplace.mail.exception.EmailAttachmentNotFoundException;
import com.workplace.mail.exception.EmailMessageNotFoundException;
import com.workplace.milestone.exception.MilestoneNotFoundException;
import com.workplace.user.exception.UserGroupForbiddenException;
import com.workplace.user.exception.UserGroupNotFoundException;
import com.workplace.view.exception.SavedViewNotFoundException;
import com.workplace.wiki.exception.WikiAttachmentNotFoundException;
import com.workplace.wiki.exception.WikiLastOwnerException;
import com.workplace.wiki.exception.WikiPageNotFoundException;
import com.workplace.wiki.exception.WikiSpaceNotFoundException;
import com.workplace.wiki.exception.WikiSpaceTypeNotEditableException;
import java.util.List;
import java.util.function.Supplier;
import org.junit.jupiter.api.Test;

/**
 * 못 찾음(404)·권한 없음(403) 예외 문구에 내부 id 가 들어가지 않는지 확인한다(WP-619).
 *
 * <p>이 문구는 GlobalExceptionHandler 가 그대로 응답 message 로 내보내 화면 토스트·AI 도구 결과에 보인다. 「코멘트를 찾을 수 없습니다:
 * id=999」처럼 요청 id·호출자 userId 가 섞이면 사람에게는 뜻 없는 숫자이고, 권한 거절에선 내부 사용자 번호까지 드러난다.
 */
class ErrorMessageNoInternalIdTest {

  private static final long ID = 987_654L;
  private static final long USER_ID = 135_791L;

  @Test
  void 못_찾음_권한없음_예외_문구에_id_가_없다() {
    List<Supplier<RuntimeException>> cases =
        List.of(
            () -> new IssueCommentNotFoundException(ID),
            () -> new LabelNotFoundException(ID),
            () -> new MilestoneNotFoundException(ID),
            () -> new FieldNotFoundException(ID),
            () -> new TypeNotFoundException(ID),
            () -> new CycleNotFoundException(ID),
            () -> new SavedViewNotFoundException(ID),
            () -> new CalendarEventNotFoundException(ID),
            () -> new CalendarNotFoundException(ID),
            () -> new UserGroupNotFoundException(ID),
            () -> new UserGroupForbiddenException(ID, USER_ID),
            () -> new ContactNotFoundException("EXTERNAL", ID),
            () -> new ContactForbiddenException(ID, USER_ID),
            () -> new KeyNotFoundException(ID),
            () -> new UserTokenNotFoundException(ID),
            () -> new FileNotFoundException(ID),
            () -> new DriveSpaceNotFoundException(ID),
            () -> new DriveFolderNotFoundException(ID),
            () -> new DriveFileNotFoundException(ID),
            () -> new WikiPageNotFoundException(ID),
            () -> new WikiSpaceNotFoundException(ID),
            () -> new EmailMessageNotFoundException(ID),
            () -> new EmailAccountNotFoundException(ID),
            () -> new EmailAttachmentNotFoundException(ID),
            () -> new HomeProposalNotFoundException(ID),
            () -> new HomeAttachmentNotFoundException(ID));

    for (Supplier<RuntimeException> c : cases) {
      RuntimeException ex = c.get();
      String msg = ex.getMessage();
      assertThat(msg)
          .as(ex.getClass().getSimpleName())
          .doesNotContain(String.valueOf(ID))
          .doesNotContain(String.valueOf(USER_ID))
          .doesNotContainIgnoringCase("id")
          .doesNotContain("EXTERNAL")
          .endsWith("니다");
    }
  }

  /**
   * WP-672: 첨부 없음·마지막 소유자·개인 공간 편집·휴지통 복원·읽기 전용 캘린더·처리된 확인 카드 문구에도 내부 id 와 영문
   * 값(PERSONAL·file·OWNER)이 남지 않는다.
   */
  @Test
  void 상태_충돌_예외_문구에도_id_와_영문_값이_없다() {
    List<Supplier<RuntimeException>> cases =
        List.of(
            () -> new AttachmentNotFoundException(ID),
            () -> new WikiAttachmentNotFoundException(ID),
            () -> new DriveLastOwnerException(ID),
            () -> WikiLastOwnerException.ofSpace("팀 공간"),
            () -> WikiLastOwnerException.ofAgent(List.of("팀 공간", "설계 공간")),
            () -> new DriveSpaceTypeNotEditableException(ID, "PERSONAL"),
            () -> new WikiSpaceTypeNotEditableException(ID, "PERSONAL"),
            () -> new DriveNotInTrashException("file", ID),
            () -> new ReadOnlyCalendarException(ID),
            () -> new ExternalCalendarResetNotAllowedException(ID),
            () -> new ExternalCalendarDeletionNotAllowedException(ID),
            () -> new HomeProposalAlreadyResolvedException(ID));

    for (Supplier<RuntimeException> c : cases) {
      RuntimeException ex = c.get();
      assertThat(ex.getMessage())
          .as(ex.getClass().getSimpleName())
          .doesNotContain(String.valueOf(ID))
          .doesNotContainIgnoringCase("id")
          .doesNotContain("PERSONAL")
          .doesNotContain("OWNER")
          .doesNotContain("file")
          .doesNotContain("type")
          .satisfies(m -> assertThat(m.endsWith("세요") || m.endsWith("니다")).isTrue());
    }
  }
}
