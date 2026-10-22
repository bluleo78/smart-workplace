package com.workplace.calendar.service;

import com.workplace.calendar.CalendarPalette;
import com.workplace.calendar.GraphEventTypes;
import com.workplace.calendar.dto.CalendarEventResponse;
import com.workplace.calendar.dto.CalendarTagRef;
import com.workplace.calendar.dto.CalendarTagRequest;
import com.workplace.calendar.dto.CalendarTagResponse;
import com.workplace.calendar.exception.CalendarEventNotFoundException;
import com.workplace.calendar.exception.CalendarTagDuplicateNameException;
import com.workplace.calendar.exception.CalendarTagNotFoundException;
import com.workplace.calendar.exception.ExternalCalendarWriteInTransactionException;
import com.workplace.calendar.exception.ExternalEventTagNotSupportedException;
import com.workplace.calendar.exception.OutlookTagRenameNotAllowedException;
import com.workplace.calendar.repository.CalendarEventExceptionRepository;
import com.workplace.calendar.repository.CalendarEventExceptionRepository.MasterOccurrence;
import com.workplace.calendar.repository.CalendarEventRepository;
import com.workplace.calendar.repository.CalendarEventRepository.TagWriteTarget;
import com.workplace.calendar.repository.CalendarTagRepository;
import com.workplace.calendar.repository.CalendarTagRepository.EventTagLink;
import com.workplace.calendar.repository.CalendarTagRepository.TagRow;
import com.workplace.calendar.service.CalendarTransport.LiveCategories;
import com.workplace.global.util.SingleLineTitles;
import com.workplace.global.util.Texts;
import com.workplace.mail.dto.EmailAccountResponse;
import com.workplace.mail.repository.EmailAccountRepository;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 캘린더 태그 유스케이스(WP-714) — 사용자별 태그 CRUD, 일정에 태그 붙이기, 일정 응답에 호출자 태그 채우기.
 *
 * <p>태그는 사람마다 따로다: 같은 일정이라도 각자 자기 태그만 붙이고 본다. 반복 일정은 마스터에 붙이고, 가상 회차·고친 회차(오버라이드)는 마스터의 태그를 따른다.
 * 외부(M365) 일정의 태그는 그 사서함의 Outlook 범주가 원본이다 — 앱에서 바꾸면 Graph 로 범주를 먼저 써 넣고 성공해야 OUTLOOK 연결을
 * 바꾼다(WP-716).
 */
@Service
public class CalendarTagService {
  /** 태그 이름 최대 길이(앞뒤 공백 제외). 사이드바·칩에서 읽히는 길이로 정했다 — Outlook 범주는 이 제한 없이 동기화된다. */
  static final int NAME_MAX = 50;

  private final CalendarTagRepository tagRepo;
  private final CalendarEventRepository eventRepo;
  private final CalendarEventExceptionRepository exceptionRepo;
  // Outlook 범주 써 넣기(WP-716) — 일정 사본 주인의 메일 계정과 공급자별 전송기(일정 쓰기와 같은 해소 규칙).
  private final EmailAccountRepository emailAccountRepo;
  private final CalendarTransports transports;
  // 범주 써 넣기는 Graph HTTP 를 트랜잭션 밖에서 하므로 DB 접근을 짧은 트랜잭션으로 감싼다(CalendarEventService 와 같은 패턴).
  private final TransactionTemplate txTemplate;

  /**
   * 명시적 생성자 — TransactionTemplate 을 PlatformTransactionManager 로 구성해야 해서 @RequiredArgsConstructor 를
   * 쓰지 않는다.
   */
  public CalendarTagService(
      CalendarTagRepository tagRepo,
      CalendarEventRepository eventRepo,
      CalendarEventExceptionRepository exceptionRepo,
      EmailAccountRepository emailAccountRepo,
      CalendarTransports transports,
      PlatformTransactionManager txManager) {
    this.tagRepo = tagRepo;
    this.eventRepo = eventRepo;
    this.exceptionRepo = exceptionRepo;
    this.emailAccountRepo = emailAccountRepo;
    this.transports = transports;
    this.txTemplate = new TransactionTemplate(txManager);
  }

  /** 내 태그 목록 — 이름순, 일정 수·구독 주소 여부 포함. */
  @Transactional(readOnly = true)
  public List<CalendarTagResponse> list(long callerId) {
    return tagRepo.listByUser(callerId);
  }

  /** 태그 만들기 — 이름 1~50자(공백 제외), 색은 팔레트 키(없으면 이름 해시). 같은 이름(대소문자 무시)이면 409. */
  @Transactional
  public CalendarTagResponse create(long callerId, CalendarTagRequest req) {
    String name = requireName(req.name());
    String color = req.color() == null ? CalendarPalette.forName(name) : requireColor(req.color());
    // 먼저 확인해 409 를 낸다 — 유니크 위반을 기다리면 트랜잭션이 깨져 같은 트랜잭션의 뒤 작업까지 실패한다. 경합은 아래 catch 가 받는다.
    if (tagRepo.existsName(callerId, name, null)) throw new CalendarTagDuplicateNameException();
    long id;
    try {
      id = tagRepo.insert(callerId, name, color);
    } catch (DuplicateKeyException e) {
      throw new CalendarTagDuplicateNameException();
    }
    return tagRepo.findResponse(callerId, id).orElseThrow(CalendarTagNotFoundException::new);
  }

  /**
   * 이름·색 바꾸기 — 보낸 필드만 바꾼다. 남의 태그·없는 태그는 404, 이름 충돌은 409. Outlook 범주에서 온 태그(OUTLOOK 연결이 있는 태그)의 이름을
   * 바꾸려 하면 409 — 동기화가 범주 이름으로 태그를 찾아, 앱에서 바꾼 이름은 다음 동기화에서 옛 이름 태그로 갈라지기 때문이다. 색은 바꿀 수 있다.
   */
  @Transactional
  public CalendarTagResponse update(long callerId, long tagId, CalendarTagRequest req) {
    TagRow current = requireOwned(callerId, tagId);
    // 이름이 그대로면 이름 검사를 건너뛴다 — Outlook 범주에서 온 50자 넘는 태그도 색만 바꿀 수 있어야 한다(화면은 늘 이름·색을 함께 보낸다).
    boolean sameName =
        req.name() == null
            || req.name().strip().equals(current.name())
            || SingleLineTitles.normalize(req.name()).equals(current.name());
    if (!sameName && tagRepo.hasOutlookLinks(tagId)) {
      throw new OutlookTagRenameNotAllowedException();
    }
    String name = sameName ? null : requireName(req.name());
    String color = req.color() == null ? null : requireColor(req.color());
    if (name != null && tagRepo.existsName(callerId, name, tagId)) {
      throw new CalendarTagDuplicateNameException();
    }
    try {
      tagRepo.update(tagId, name, color);
    } catch (DuplicateKeyException e) {
      throw new CalendarTagDuplicateNameException();
    }
    return tagRepo.findResponse(callerId, tagId).orElseThrow(CalendarTagNotFoundException::new);
  }

  /** 태그 지우기 — 일정 연결과 구독 주소도 함께 사라진다. 일정은 그대로. */
  @Transactional
  public void delete(long callerId, long tagId) {
    requireOwned(callerId, tagId);
    tagRepo.delete(tagId);
  }

  /**
   * 일정의 내 태그를 tagIds 로 바꾼다. 일정은 볼 수 있어야 하고(주인 또는 참석자 — 아니면 404), 태그는 모두 내 것이어야 한다(아니면 404). 다른 사람의
   * 태그는 건드리지 않는다.
   *
   * <ul>
   *   <li>앱 일정: APP 연결을 바꾼다. 고친 회차 id 면 마스터에 붙인다(가상 회차 id 는 이미 마스터 id).
   *   <li>M365 일정(WP-716): 앱이 아는 연결과 요청의 차이(더할 태그·뺄 태그)만 그 일정의 지금 Outlook 범주에 더하고 빼서 Graph 에 써 넣는다
   *       — 마지막 동기화 뒤 Outlook 에서 붙인 범주는 그대로 두고, 손대지 않은 범주는 Outlook 표기 그대로 보낸다. 성공하면 Outlook 이 바꿔 보일
   *       로컬 행의 OUTLOOK 연결에 같은 차이를 반영한다. 바꿀 수 없는 M365 일정(tagsEditable=false)은 409.
   * </ul>
   *
   * <p>비-@Transactional 오케스트레이터(CalendarEventService 외부 쓰기와 같은 3단계): 확인(tx) → Graph 읽기·쓰기(tx 밖) →
   * 저장(tx). Graph 가 실패하면(502) 로컬은 그대로다. 앱 일정은 첫 트랜잭션에서 저장까지 끝난다.
   */
  public void setEventTags(long callerId, long eventId, List<Long> tagIds) {
    Set<Long> wanted = normalize(tagIds);

    // 호출자(AI·채팅 등)의 바깥 tx 가 열려 있는지는 txTemplate 에 들어가기 전에 본다 — 안에서는 늘 열려 있다. M365 일정이면 확인 단계에서
    // 다른 판정보다 먼저 막는다(Graph 를 읽기 전에, #232·#548).
    boolean ambientTx = TransactionSynchronizationManager.isActualTransactionActive();

    // ① 확인(tx) — 앱 일정이면 여기서 저장까지 하고 null, M365 일정이면 써 넣을 차이를 돌려준다.
    OutlookWrite write =
        txTemplate.execute(s -> applyOrPrepare(callerId, eventId, wanted, ambientTx));
    if (write == null || write.isEmpty()) return;

    // ② Graph(tx 밖) — 누른 일정의 지금 종류·시리즈·범주를 읽고, 대상마다 자기 범주에 같은 차이를 반영해 써 넣는다.
    CalendarTransport transport = transports.forProvider(write.account().provider());
    LiveCategories live = transport.readCategories(callerId, write.account(), write.externalId());
    List<String> addedNames = write.addedNames();
    List<String> removedNames = write.removedNames();
    for (String target : live.targets(write.externalId())) {
      // 보통 회차의 범주는 시리즈 마스터의 것이라 읽어 둔 값을 그대로 쓴다. 자기 자신이거나, 고친 회차의 마스터처럼 다른 일정만 다시 읽는다.
      boolean sameCategories =
          target.equals(write.externalId()) || GraphEventTypes.OCCURRENCE.equals(live.type());
      List<String> current =
          sameCategories
              ? live.categories()
              : transport.readCategories(callerId, write.account(), target).categories();
      List<String> merged = mergeCategories(current, addedNames, removedNames);
      if (!merged.equals(current)) {
        transport.updateCategories(callerId, write.account(), target, merged);
      }
    }

    // ③ 저장(tx) — Outlook 이 바꿔 보일 로컬 행에만 같은 차이를 반영하고 써 넣은 시각을 남긴다(동기화 경합 표시).
    OffsetDateTime writtenAt = OffsetDateTime.now(ZoneOffset.UTC);
    txTemplate.execute(
        s -> {
          persistOutlookWrite(callerId, eventId, write, live, writtenAt);
          return null;
        });
  }

  /**
   * setEventTags 의 확인 단계(tx 안) — 볼 수 있는지·써 넣기 허용·태그 주인을 확인한다. 앱 일정은 APP 연결 저장까지 하고 null 을, M365 일정은
   * 앱이 아는 OUTLOOK 연결과 요청의 차이를 돌려준다. 409(쓸 수 없는 M365 일정)는 태그 주인 확인보다 먼저 낸다 — 무엇을 보내든 바꿀 수 없는 일정이기
   * 때문이다. 바깥 tx 가드는 그 다음, 계정·태그를 읽기 전에 둔다.
   */
  private OutlookWrite applyOrPrepare(
      long callerId, long eventId, Set<Long> wanted, boolean ambientTx) {
    TagWriteTarget target =
        eventRepo
            .findTagWriteTarget(callerId, eventId)
            .orElseThrow(() -> new CalendarEventNotFoundException(eventId));
    if (target.externalId() == null) {
      replaceAppTags(callerId, eventId, wanted);
      return null;
    }
    EmailAccountResponse account = requireOutlookWritable(callerId, target);
    if (ambientTx) throw new ExternalCalendarWriteInTransactionException();
    requireOwnedTags(callerId, wanted);
    Set<Long> linked =
        tagRepo.outlookLinks(callerId, List.of(eventId)).getOrDefault(eventId, Set.of());
    Set<Long> added = new LinkedHashSet<>(wanted);
    added.removeAll(linked);
    Set<Long> removed = new LinkedHashSet<>(linked);
    removed.removeAll(wanted);
    // 더할·뺄 이름을 한 번에 읽는다(이름순 맵) — 뒤에서 이 맵을 나눠 쓴다.
    Set<Long> changed = new LinkedHashSet<>(added);
    changed.addAll(removed);
    return new OutlookWrite(
        account,
        target.calendarId(),
        target.externalId(),
        added,
        removed,
        tagRepo.namesOf(callerId, changed));
  }

  /**
   * M365 일정에 범주를 써 넣을 수 있는지 — 허용 판정은 두 단계다: 일정 사본의 규칙(내 사본·쓸 수 있는 내 사서함 달력)과 이어진 내 활성 계정. 응답
   * tagsEditable 도 같은 두 조건이다. 안 되면 409, 되면 써 넣을 계정.
   */
  private EmailAccountResponse requireOutlookWritable(long callerId, TagWriteTarget target) {
    if (!target.ownWritableCopy() || target.externalAccountId() == null) {
      throw new ExternalEventTagNotSupportedException();
    }
    return emailAccountRepo
        .findByIdAndUser(callerId, target.externalAccountId())
        .orElseThrow(ExternalEventTagNotSupportedException::new);
  }

  /**
   * 앱 일정의 내 태그를 tagIds 로 바꾼다(APP 연결) — 호출자의 쓰기 트랜잭션 안에서 부른다. 태그는 시리즈 단위라 고친 회차(오버라이드) id 면 그 마스터에
   * 붙인다(가상 회차 id 는 이미 마스터 id). 태그가 모두 내 것이 아니면 404. 일정 저장 요청에 실린 태그(WP-801)와 {@code PUT
   * /events/{id}/tags} 의 앱 일정 경로가 같이 쓴다 — M365 일정은 여기로 오면 안 된다(Graph 를 거치는 setEventTags).
   */
  public void replaceAppTags(long callerId, long eventId, Collection<Long> tagIds) {
    Set<Long> wanted = normalize(tagIds);
    requireOwnedTags(callerId, wanted);
    long masterId =
        exceptionRepo
            .findMasterOccurrenceByOverride(eventId)
            .map(MasterOccurrence::eventId)
            .orElse(eventId);
    tagRepo.replaceAppLinks(callerId, masterId, wanted);
  }

  /**
   * 일정 저장(수정) 요청에 실린 태그 사전 확인(WP-801) — 일정을 쓰기 전에, 읽기 트랜잭션 안에서 setEventTags 와 같은 판정을 한다: 볼 수 없는 일정
   * 404, 범주를 써 넣을 수 없는 M365 일정 409(태그 주인 확인보다 먼저 — 무엇을 보내든 바꿀 수 없다), 남의 태그·없는 태그 404. 일정 본문(또는
   * Graph PATCH)이 저장된 뒤에야 태그가 거절돼 「일정은 바뀌었는데 오류」가 되지 않게 한다.
   */
  public void validateEventTags(long callerId, long eventId, Collection<Long> tagIds) {
    TagWriteTarget target =
        eventRepo
            .findTagWriteTarget(callerId, eventId)
            .orElseThrow(() -> new CalendarEventNotFoundException(eventId));
    if (target.externalId() != null) requireOutlookWritable(callerId, target);
    requireOwnedTags(callerId, normalize(tagIds));
  }

  /** 새 일정 요청에 실린 태그 사전 확인(WP-801) — 아직 일정이 없어 태그 주인만 본다(남의 태그·없는 태그 404). */
  public void validateNewEventTags(long callerId, Collection<Long> tagIds) {
    requireOwnedTags(callerId, normalize(tagIds));
  }

  /** 요청 태그 id 정리 — null 은 버리고 순서를 지킨 채 중복을 없앤다. */
  private static Set<Long> normalize(Collection<Long> tagIds) {
    Set<Long> wanted = new LinkedHashSet<>();
    for (Long id : tagIds) if (id != null) wanted.add(id);
    return wanted;
  }

  /**
   * 지금 범주에 차이만 반영한 범주 목록(WP-716 리뷰) — 뺄 이름과 같은 범주를 지우고, 더할 이름 중 아직 없는 것만 뒤에 붙인다. 손대지 않은 범주는 Outlook
   * 표기(앞뒤 공백·대소문자) 그대로 남기고, 이미 있는 범주를 더하면 Outlook 표기를 그대로 둔다. 이름 비교는 앞뒤 공백을 떼고 대소문자를 무시한다.
   */
  static List<String> mergeCategories(
      List<String> current, Collection<String> added, Collection<String> removed) {
    List<String> out = new ArrayList<>();
    for (String c : current) {
      if (!containsName(removed, c)) out.add(c);
    }
    for (String a : added) {
      if (!containsName(out, a)) out.add(a);
    }
    return out;
  }

  /** names 에 name 과 같은 범주 이름이 있는가 — 앞뒤 공백을 떼고 대소문자 무시(Outlook 범주 이름 규칙). */
  private static boolean containsName(Collection<String> names, String name) {
    for (String x : names) {
      if (Texts.equalsStrippedIgnoreCase(x, name)) return true;
    }
    return false;
  }

  /**
   * setEventTags 의 저장 단계(tx 안) — Outlook 이 실제로 바꿔 보일 로컬 행(누른 행 + 시리즈 마스터에 썼다면 같은 시리즈의 보통 회차 행)에 써
   * 넣은 시각을 남기고(행 잠금 겸) OUTLOOK 연결에 같은 차이를 반영한다. 따로 고친 다른 회차는 자기 범주가 있어 건드리지 않는다(다음 동기화가 원본). 그 사이
   * 지워진 태그는 더하지 않는다 — 없는 태그로 넣다 FK 로 500 이 나지 않게, 다음 동기화가 Outlook 범주로 다시 맞춘다.
   */
  private void persistOutlookWrite(
      long callerId,
      long eventId,
      OutlookWrite write,
      LiveCategories live,
      OffsetDateTime writtenAt) {
    Set<Long> rows = new LinkedHashSet<>();
    rows.add(eventId);
    if (live.writesSeries()) {
      rows.addAll(eventRepo.findSeriesOccurrenceIds(write.calendarId(), live.seriesMasterId()));
    }
    // 먼저 표시해 행 잠금을 잡는다 — 동시에 도는 동기화의 같은 행 upsert 는 이 tx 가 끝난 뒤에 이어지고, 그때 이 표시를 보고 범주 연결을 건너뛴다.
    eventRepo.markCategoriesWritten(rows, writtenAt);
    eventRepo.updateExternalSeries(eventId, live.seriesMasterId(), live.type());
    Set<Long> addable = tagRepo.ownedIds(callerId, write.addedIds());
    List<EventTagLink> adds = new ArrayList<>();
    List<EventTagLink> removes = new ArrayList<>();
    for (long row : rows) {
      for (long tagId : addable) adds.add(new EventTagLink(row, tagId));
      for (long tagId : write.removedIds()) removes.add(new EventTagLink(row, tagId));
    }
    tagRepo.deleteOutlookLinks(removes);
    tagRepo.insertOutlookLinks(adds);
  }

  /** 태그가 모두 호출자 것인지 — 남의 태그·없는 태그가 섞이면 404(존재 은닉). */
  private void requireOwnedTags(long callerId, Set<Long> wanted) {
    if (!tagRepo.ownedIds(callerId, wanted).containsAll(wanted)) {
      throw new CalendarTagNotFoundException();
    }
  }

  /**
   * Outlook 범주 써 넣기 내용(WP-716) — 확인 단계(tx)에서 앱이 아는 OUTLOOK 연결과 요청의 차이를 정해 Graph 호출·저장 단계로 넘긴다.
   *
   * @param calendarId 누른 일정의 달력 — 같은 시리즈의 로컬 회차 행을 찾는다
   * @param externalId 누른 일정의 Graph id
   * @param addedIds 더할 태그 id(요청에 있고 아직 연결 안 됨)
   * @param removedIds 뺄 태그 id(연결돼 있고 요청에 없음)
   * @param names 더할·뺄 태그의 id → 범주 이름(이름순) — 더할 이름·뺄 이름은 여기서 나눠 쓴다
   */
  private record OutlookWrite(
      EmailAccountResponse account,
      long calendarId,
      String externalId,
      Set<Long> addedIds,
      Set<Long> removedIds,
      Map<Long, String> names) {
    /** 바꿀 것이 없으면 Graph 를 부르지 않는다. */
    boolean isEmpty() {
      return addedIds.isEmpty() && removedIds.isEmpty();
    }

    /** 더할 범주 이름(이름순). */
    List<String> addedNames() {
      return namesIn(addedIds);
    }

    /** 뺄 범주 이름(이름순). */
    List<String> removedNames() {
      return namesIn(removedIds);
    }

    private List<String> namesIn(Set<Long> ids) {
      return names.entrySet().stream()
          .filter(e -> ids.contains(e.getKey()))
          .map(Map.Entry::getValue)
          .toList();
    }
  }

  /**
   * 일정 응답들에 호출자의 태그를 채운다 — 목록·상세가 같이 쓴다. 가상 회차는 masterEventId, 고친 회차는 예외 표의 마스터로 키를 바꿔 마스터의 태그를 따르게
   * 하고, 두 번의 배치 조회(오버라이드 역조회·태그)로 끝내 N+1 을 피한다. 호출자의 읽기 트랜잭션 안에서 부른다.
   */
  public List<CalendarEventResponse> withCallerTags(
      long callerId, List<CalendarEventResponse> events) {
    if (events.isEmpty()) return events;
    Set<Long> concreteIds = new HashSet<>();
    for (CalendarEventResponse e : events) {
      if (e.masterEventId() == null) concreteIds.add(e.id());
    }
    Map<Long, MasterOccurrence> overrides = exceptionRepo.mastersByOverrides(concreteIds);
    Set<Long> keys = new HashSet<>();
    for (CalendarEventResponse e : events) keys.add(tagKey(e, overrides));
    Map<Long, List<CalendarTagRef>> byEvent = tagRepo.tagsByEvents(callerId, keys);
    return events.stream()
        .map(e -> e.withTags(byEvent.getOrDefault(tagKey(e, overrides), List.of())))
        .toList();
  }

  /** 반복을 「이후 모든 일정」으로 나눠 새 마스터가 생길 때 옛 마스터의 태그(모든 사람 것)를 잇는다. 쓰기 트랜잭션 안에서 부른다. */
  public void copyTags(long fromEventId, long toEventId) {
    tagRepo.copyLinks(fromEventId, toEventId);
  }

  /** 태그를 찾을 일정 키 — 가상 회차는 마스터, 고친 회차는 예외 표의 마스터, 그 외는 자기 id. 구독 주소도 같은 규칙으로 거른다. */
  static long tagKey(CalendarEventResponse e, Map<Long, MasterOccurrence> overrides) {
    if (e.masterEventId() != null) return e.masterEventId();
    MasterOccurrence m = overrides.get(e.id());
    return m != null ? m.eventId() : e.id();
  }

  /** 주인 확인 — 남의 태그·없는 태그는 404(존재 은닉). 구독 주소 서비스(CalendarTagFeedService)도 같은 확인을 쓴다. */
  TagRow requireOwned(long callerId, long tagId) {
    return tagRepo.findOwned(callerId, tagId).orElseThrow(CalendarTagNotFoundException::new);
  }

  /**
   * 이름 정리·검증 — 다른 이름 칸처럼 한 줄로 다듬고(줄바꿈→공백, 앞뒤 보이지 않는 글자 제거, 그려지는 글자가 없으면 빈 이름) 1~50자. 제로폭·점자 빈칸만 있는
   * 이름이 빈 칩으로, 줄바꿈 든 이름이 두 줄로 저장됐다(WP-768, WP-724 빈틈).
   */
  private static String requireName(String raw) {
    String name = SingleLineTitles.normalize(Objects.requireNonNullElse(raw, ""));
    if (name.isEmpty() || name.length() > NAME_MAX) {
      throw new IllegalArgumentException("태그 이름은 1~" + NAME_MAX + "자로 입력하세요");
    }
    return name;
  }

  /** 색 검증 — 팔레트 키만. */
  private static String requireColor(String color) {
    if (!CalendarPalette.isValid(color)) {
      throw new IllegalArgumentException("허용되지 않은 색입니다");
    }
    return color;
  }
}
