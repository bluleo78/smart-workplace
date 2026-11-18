package com.workplace.calendar.service;

import com.workplace.mail.dto.EmailAccountResponse;
import com.workplace.mail.dto.MailProvider;
import java.util.Set;

/** 공급자별 캘린더 동기화 seam. provider() 를 키로 CalendarSyncService 가 디스패치한다. */
public interface CalendarFetcher {

  /** 이 구현이 담당하는 공급자. */
  MailProvider provider();

  /**
   * 외부 캘린더를 동기화해 external_calendar / calendar_event 에 upsert/prune 한다.
   *
   * @param userId 계정 소유자
   * @param accountId email_account.id
   * @param account 계정 응답 DTO
   * @return 동기화 결과(수신 일정 수 + 알릴 내부 참석자)
   */
  SyncResult sync(long userId, long accountId, EmailAccountResponse account);

  /**
   * 동기화 결과(WP-1733).
   *
   * @param upserted upsert 한 일정 수(바뀌지 않은 일정 포함)
   * @param affectedAttendeeUserIds 이번 동기화로 실제 생성·변경·삭제된 일정의 내부 참석자 userId(소유자 제외). 같은 회의를 자기 화면에서
   *     보는 다른 사용자에게도 갱신 알림을 보내려고 모은다.
   */
  record SyncResult(int upserted, Set<Long> affectedAttendeeUserIds) {
    public SyncResult {
      affectedAttendeeUserIds =
          affectedAttendeeUserIds == null ? Set.of() : Set.copyOf(affectedAttendeeUserIds);
    }

    /** 아무 변화도 알릴 참석자도 없는 결과. */
    public static SyncResult empty() {
      return new SyncResult(0, Set.of());
    }
  }
}
