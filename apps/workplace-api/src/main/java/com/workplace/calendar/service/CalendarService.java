package com.workplace.calendar.service;

import com.workplace.calendar.CalendarPalette;
import com.workplace.calendar.dto.CalendarRequest;
import com.workplace.calendar.dto.CalendarResponse;
import com.workplace.calendar.exception.CalendarNotFoundException;
import com.workplace.calendar.exception.DefaultCalendarDeletionException;
import com.workplace.calendar.exception.ExternalCalendarDeletionNotAllowedException;
import com.workplace.calendar.exception.ExternalCalendarResetNotAllowedException;
import com.workplace.calendar.exception.ReadOnlyCalendarException;
import com.workplace.calendar.outbound.CalendarChangeNotifier;
import com.workplace.calendar.repository.CalendarRepository;
import com.workplace.calendar.repository.CalendarUserSettingRepository;
import com.workplace.calendar.repository.EventAttendeeRepository;
import com.workplace.global.realtime.ResourceChangedEvent;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** 개인 캘린더(컨테이너) 유스케이스. 소유자 전용 CRUD + 기본 캘린더 보장(ensureDefault) + 삭제 시맨틱. */
@Service
@RequiredArgsConstructor
public class CalendarService {
  private final CalendarRepository repo;
  // 캘린더 변경 → resource.changed 발행(WP-61). 각 @Transactional 메서드 안에서 호출.
  private final CalendarChangeNotifier changeNotifier;
  // 초기화 전 내부 참석자 수집용(하드 삭제 cascade 로 참석자 행이 사라지므로).
  private final EventAttendeeRepository attendeeRepo;
  // 사용자별 「새 일정 기본 캘린더」 설정(WP-2169).
  private final CalendarUserSettingRepository settingRepo;

  /** 기본 캘린더 이름(WP-2169) — Outlook 등 외부 캘린더와 구분되는 Works 자체 캘린더. V347 이 옛 이름 「기본」 도 이것으로 바꾼다. */
  public static final String DEFAULT_CALENDAR_NAME = "Works 캘린더";

  /** 소유자의 캘린더 목록. 비어 있으면 기본 캘린더를 lazy 생성 후 반환(신규/제로-일정 유저). */
  @Transactional
  public List<CalendarResponse> list(long callerId) {
    ensureDefault(callerId);
    return repo.listByOwner(callerId);
  }

  /**
   * 기본 캘린더 보장 — 없으면 생성하고, 기본 캘린더 id 를 반환한다. 일정 생성 chokepoint 가 호출. 첫 요청들이 동시에 만들면 늦은 쪽은 넣지 않고 먼저 만든
   * 것을 다시 읽어 쓴다(WP-757 — 예전엔 유일 인덱스에 걸려 409).
   */
  @Transactional
  public long ensureDefault(long callerId) {
    return repo.findDefaultId(callerId)
        .or(
            () ->
                repo.insertDefaultIfAbsent(
                    callerId, DEFAULT_CALENDAR_NAME, CalendarPalette.DEFAULT))
        .or(() -> repo.findDefaultId(callerId))
        .orElseThrow(() -> new IllegalStateException("기본 캘린더를 만들지도 찾지도 못함: " + callerId));
  }

  /**
   * 새 일정을 만들 수 있는 캘린더인가(WP-2169) — 캘린더를 생략한 생성이 사용자의 기본 캘린더 설정을 따라도 되는지 판정한다.
   *
   * <p>본인 소유 + 읽기 전용 아님 + 보이는 캘린더(연결 해제(disabled_at) 계정의 외부 캘린더는 목록에서처럼 숨겨 제외 — {@code
   * findByIdForOwner} 가 같은 가시성 조건을 쓴다)여야 하고, 외부(Outlook) 캘린더는 allowExternal 일 때만 쓴다. 호출자 트랜잭션 안의
   * 생성(앱 안 AI 확인 카드)은 Graph 쓰기가 막혀 있어(#548) allowExternal=false 로 부른다.
   */
  public boolean isUsableCreateTarget(long callerId, long calendarId, boolean allowExternal) {
    return repo.findByIdForOwner(callerId, calendarId)
        .filter(c -> !c.isReadOnly())
        // 외부 캘린더는 연동 계정(provider)이 있다 — 응답에 이미 있어 isExternal 재조회가 필요 없다.
        .filter(c -> allowExternal || c.provider() == null)
        .isPresent();
  }

  /**
   * 새 일정 기본 캘린더로 지정할 수 있는지 검증한다(WP-2169). 남의/없는 캘린더와 연결 해제 계정의 캘린더(목록에서 숨겨짐)는 404(존재 은닉), 읽기 전용은
   * 409 — 보이는지를 먼저 보므로 숨겨진 읽기 전용 캘린더도 404 다.
   */
  public void requireUsableCreateTarget(long callerId, long calendarId) {
    CalendarResponse calendar =
        repo.findByIdForOwner(callerId, calendarId)
            .orElseThrow(() -> new CalendarNotFoundException(calendarId));
    if (calendar.isReadOnly()) throw new ReadOnlyCalendarException(calendarId);
  }

  /**
   * 캘린더를 생략한 새 일정의 대상 캘린더(WP-2169) — 일정 생성·확인 카드 사전검증·설정 GET 이 함께 쓰는 하나의 해석.
   *
   * <p>설정의 기본 캘린더가 {@link #isUsableCreateTarget} 이면 그것, 아니면 Works 캘린더다. Works 캘린더는 allowInsert 면 없을
   * 때 만들고({@link #ensureDefault}), 아니면(쓰기 금지 사전검증) 있는 것만 찾아 없으면 null 을 돌려준다 — 사전검증은 null 이면 캘린더 검증을
   * 건너뛴다.
   */
  public Long resolveCreateCalendarId(long callerId, boolean allowExternal, boolean allowInsert) {
    Long preferred = settingRepo.findPreferredCalendarId(callerId).orElse(null);
    if (preferred != null && isUsableCreateTarget(callerId, preferred, allowExternal)) {
      return preferred;
    }
    // 삼항식으로 쓰면 long 으로 언박싱돼 null 에서 NPE 가 나므로 나눠 쓴다.
    if (allowInsert) return ensureDefault(callerId);
    return repo.findDefaultId(callerId).orElse(null);
  }

  /** 캘린더 생성 — 색 팔레트 검증, position 미지정 시 말미 배치. is_default=false. */
  @Transactional
  public CalendarResponse create(long callerId, CalendarRequest req) {
    validateColor(req.color());
    // 말미 배치는 int 끝에서 멈춘다 — 상한 전에 저장된 최댓값 뒤에서 +1 이 음수로 넘어가 맨 앞에 정렬됐다(WP-747). 같은 값이면 id 순이라 뒤에 온다.
    int pos =
        req.position() != null
            ? req.position()
            : (int) Math.min((long) repo.maxPosition(callerId) + 1, Integer.MAX_VALUE);
    long id = repo.insert(callerId, req.name(), req.color(), false, pos);
    changeNotifier.calendarChanged(ResourceChangedEvent.OP_CREATED, id, callerId, callerId);
    return repo.findByIdForOwner(callerId, id).orElseThrow(() -> new CalendarNotFoundException(id));
  }

  /** 캘린더 수정 — 소유 검증 + 읽기전용 거부 + 색 팔레트 검증. */
  @Transactional
  public CalendarResponse update(long callerId, long id, CalendarRequest req) {
    requireOwnedCalendar(callerId, id);
    if (repo.isReadOnly(id)) throw new ReadOnlyCalendarException(id);
    validateColor(req.color());
    repo.update(id, req.name(), req.color(), req.position());
    changeNotifier.calendarChanged(ResourceChangedEvent.OP_UPDATED, id, callerId, callerId);
    return repo.findByIdForOwner(callerId, id).orElseThrow(() -> new CalendarNotFoundException(id));
  }

  /**
   * 캘린더 삭제 — 소유 검증 + 읽기전용 거부 + 외부 동기화 컨테이너 거부, 기본은 거부, 비기본은 소속 일정을 기본으로 이동 후 삭제(데이터 보존).
   *
   * <p>외부 동기화 컨테이너(accountEmail 존재)는 Graph 상 canEdit=true(is_read_only=false)여도 로컬 삭제를 허용하지 않는다 —
   * 삭제해도 다음 동기화 사이클에서 신규 calendar_id 로 재생성되어 중복/고아 데이터가 발생한다(#608).
   */
  @Transactional
  public void delete(long callerId, long id) {
    requireOwnedCalendar(callerId, id);
    if (repo.isReadOnly(id)) throw new ReadOnlyCalendarException(id);
    if (repo.isExternal(id)) {
      throw new ExternalCalendarDeletionNotAllowedException(id);
    }
    if (repo.isDefault(id)) {
      throw new DefaultCalendarDeletionException();
    }
    long defaultId = ensureDefault(callerId);
    repo.moveEventsToCalendar(id, defaultId);
    repo.delete(id);
    // 소속 일정이 기본 캘린더로 이동하지만 프론트는 ['calendar'] 한 prefix 로 일정까지 함께 무효화한다.
    changeNotifier.calendarChanged(ResourceChangedEvent.OP_DELETED, id, callerId, callerId);
  }

  /** 한 캘린더의 모든 일정을 하드 삭제(강제 리셋). 로컬 캘린더만 허용, 연동 캘린더는 409. */
  @Transactional
  public void resetEvents(long callerId, long calendarId) {
    requireOwnedCalendar(callerId, calendarId);
    if (repo.isExternal(calendarId)) {
      throw new ExternalCalendarResetNotAllowedException(calendarId);
    }
    // 청중 축소(하드 삭제 cascade): 삭제 전에 내부 참석자를 수집해 extra 수신자로 넘긴다.
    List<Long> attendeeIds = attendeeRepo.findInternalUserIdsByCalendar(calendarId);
    repo.deleteAllEventsByCalendar(calendarId);
    // 일정만 지워지고 캘린더는 남으므로 updated (['calendar'] prefix 무효화로 일정 목록도 갱신).
    changeNotifier.calendarChanged(
        ResourceChangedEvent.OP_UPDATED, calendarId, callerId, attendeeIds, callerId);
  }

  /** 소유 캘린더 검증 — 미존재/비소유 모두 404(존재 은닉). 일정 chokepoint 도 사용. */
  public void requireOwnedCalendar(long callerId, long calendarId) {
    long ownerId =
        repo.findOwnerId(calendarId).orElseThrow(() -> new CalendarNotFoundException(calendarId));
    if (ownerId != callerId) {
      throw new CalendarNotFoundException(calendarId);
    }
  }

  /**
   * 소유 + 쓰기가능(읽기전용 외부 컨테이너 아님) 검증. 일정 생성/이동 chokepoint 용.
   *
   * <p>외부 동기화 컨테이너는 owner_id = 동기화 유저이므로 소유 검증만으론 막히지 않는다. 읽기전용이면 추가로
   * ReadOnlyCalendarException(409) 을 던진다.
   */
  public void requireWritableCalendar(long callerId, long calendarId) {
    requireOwnedCalendar(callerId, calendarId);
    if (repo.isReadOnly(calendarId)) throw new ReadOnlyCalendarException(calendarId);
  }

  /** 색 팔레트 키 검증 — 미허용 색은 400. */
  private void validateColor(String color) {
    if (!CalendarPalette.isValid(color)) {
      throw new IllegalArgumentException("허용되지 않은 색입니다: " + color);
    }
  }
}
