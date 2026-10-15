package com.workplace.home.service;

import com.workplace.home.dto.AiMemoryChangeItem;
import com.workplace.home.dto.AiMemoryChangePage;
import com.workplace.home.dto.UndoAiMemoryChangeResponse;
import com.workplace.home.exception.AiMemoryException;
import com.workplace.home.repository.AiMemoryChangeRepository;
import com.workplace.home.repository.AiMemoryChangeRepository.ChangeRow;
import com.workplace.home.repository.AiMemoryRepository;
import com.workplace.home.repository.AiMemoryRepository.Row;
import com.workplace.home.repository.CursorCodec;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 「AI가 정리한 기록」 목록·되돌리기(WP-385 스펙 8.1) — 본인 것만. 되돌리기는 결과가 "그대로"(MemorySnapshot.sameAs)이고 고정되지 않았을 때만
 * 하고, 다르면 409 AI_MEMORY_CHANGED 로 그 뒤의 변경(고정 포함)을 덮지 않는다. 고침·합침을 되돌리면 거절한 결과 문장을 지운 기록에 남긴다. 되살리기는
 * 원래 id 로만(채팅 결과 줄 되돌리기와 달리 새 id 로 만들지 않는다 — 같은 메모리를 가리키는 다른 기록의 되돌리기가 엉키지 않게) 하고, id 가 이미 쓰였거나 범위가
 * 가득이면 409 AI_MEMORY_CHANGED. 잠금 순서는 사용자 잠금 → 기록 행 → 메모리 행(생성·고치기·배경 정리와 같은 순서라 교착이 없다).
 */
@Service
@RequiredArgsConstructor
public class AiMemoryChangeService {

  static final int DEFAULT_SIZE = 30;
  static final int MAX_SIZE = 50;
  static final int COUNT_DAYS = 30;

  private final AiMemoryChangeRepository changeRepo;
  private final AiMemoryChangeLog changeLog;
  private final AiMemoryRepository memoryRepo;
  private final AiMemoryForgottenService forgotten;
  private final AiMemoryClock clock;
  private final ApplicationEventPublisher events;

  /** 기록 한 묶음(최신순, 기본 30·최대 50) + 다음 커서 + 지난 30일 횟수. */
  @Transactional(readOnly = true)
  public AiMemoryChangePage list(long userId, String cursor, Integer size) {
    int n = size == null ? DEFAULT_SIZE : Math.max(1, Math.min(size, MAX_SIZE));
    CursorCodec.Slice<ChangeRow> slice =
        CursorCodec.slice(
            changeRepo.page(userId, CursorCodec.decode(cursor), n + 1),
            n,
            ChangeRow::createdAt,
            ChangeRow::id);
    int count =
        changeRepo.countSince(userId, OffsetDateTime.now(ZoneOffset.UTC).minusDays(COUNT_DAYS));
    return new AiMemoryChangePage(
        slice.items().stream().map(this::toItem).toList(), slice.next(), count);
  }

  /**
   * 되돌리기 — 사용자 전용(대행이면 403, 고정과 같은 규칙).
   *
   * @param internal ai-agent 대행(Internal) 호출인가
   * @throws AiMemoryException 403 CHANGE_USER_ONLY(대행), 404 NOT_FOUND(남의·없는 기록), 409
   *     CHANGE_UNDONE(이미 되돌림), 409 CHANGED(그 뒤 바뀜·id 가 쓰임·범위 가득)
   */
  @Transactional
  public UndoAiMemoryChangeResponse undo(long userId, long changeId, boolean internal) {
    if (internal) throw AiMemoryException.changeUserOnly();
    memoryRepo.lockUser(userId);
    ChangeRow ch = changeRepo.lock(userId, changeId).orElseThrow(AiMemoryException::notFound);
    if (ch.undoneAt() != null) throw AiMemoryException.changeUndone();
    List<MemorySnapshot> before = changeLog.readBefore(ch.beforeJson());
    MemorySnapshot after = changeLog.readAfter(ch.afterJson());
    LocalDate today = clock.today();
    switch (AiMemoryChangeAction.valueOf(ch.action())) {
      case ADDED -> {
        Row cur = lockSame(userId, after);
        memoryRepo.delete(userId, cur.id());
        // 사용자가 "기억하지 마"라고 한 셈 — 배경 정리가 같은 말을 다시 저장하지 않게.
        forgotten.remember(userId, List.of(cur.content()));
      }
      case UPDATED -> {
        restoreInPlace(userId, lockSame(userId, after), before.get(0), today);
        rememberRejected(userId, after, before);
      }
      case MERGED -> {
        restoreInPlace(userId, lockSame(userId, after), before.get(0), today);
        for (MemorySnapshot s : before.subList(1, before.size())) reinsert(userId, s, today);
        rememberRejected(userId, after, before);
      }
      case FORGOTTEN, DECAYED -> reinsert(userId, before.get(0), today);
    }
    changeRepo.markUndone(userId, changeId, OffsetDateTime.now(ZoneOffset.UTC));
    return new UndoAiMemoryChangeResponse(
        toItem(changeRepo.find(userId, changeId).orElseThrow(AiMemoryException::notFound)));
  }

  /**
   * 결과 메모리를 잠그고 "그대로"인지 — 아니면(없음 포함) 409 CHANGED. 정리 뒤 사용자가 고정했어도 409 다: 고정도 사용자가 바꾼 것이라 되돌리기가 고정한
   * 메모리를 지우거나 고쳐 쓰지 않는다. sameAs 는 「AI가 정리」 표시와 함께 쓰는 술어라 고정을 보지 않고, 되돌리기 잠금만 고정을 더 본다.
   */
  private Row lockSame(long userId, MemorySnapshot after) {
    Row cur = after == null ? null : memoryRepo.lock(userId, after.id()).orElse(null);
    if (after == null || !after.sameAs(cur) || cur.pinned()) throw AiMemoryException.changed();
    return cur;
  }

  /** 고침·합침을 되돌리면 사용자가 거절한 결과 문장을 지운 기록에 남긴다(AiMemoryForgottenService#rejectReplaced 규칙). */
  private void rememberRejected(long userId, MemorySnapshot after, List<MemorySnapshot> before) {
    forgotten.rejectReplaced(
        userId, before.stream().map(MemorySnapshot::content).toList(), after.content());
  }

  /** 제자리에서 이전 값으로 — 다른 범위로 옮겨 새로 유효해지는데 가득이면 409 CHANGED(AiMemoryService 와 같은 판정). */
  private void restoreInPlace(long userId, Row cur, MemorySnapshot prev, LocalDate today) {
    LocalDate exp = prev.expiresOnDate();
    if (AiMemoryService.activatesInto(cur, prev.scope(), exp, today)
        && AiMemoryService.overLimit(memoryRepo, userId, prev.scope(), exp, today)) {
      throw AiMemoryException.changed();
    }
    Row saved =
        memoryRepo
            .update(userId, cur.id(), prev.kind(), prev.content(), prev.scope(), exp)
            .orElseThrow(AiMemoryException::changed);
    if (!cur.content().equals(saved.content())) requestEmbedding(saved.id());
  }

  /** 원래 id 로 되살린다(사용 시각 = 지금) — 유효로 돌아오는데 가득이거나 id 가 이미 쓰였으면 409 CHANGED. */
  private void reinsert(long userId, MemorySnapshot s, LocalDate today) {
    if (AiMemoryService.overLimit(memoryRepo, userId, s.scope(), s.expiresOnDate(), today)) {
      throw AiMemoryException.changed();
    }
    Row saved =
        memoryRepo
            .insertWithId(s.id(), userId, s.toNewMemory())
            .orElseThrow(AiMemoryException::changed);
    requestEmbedding(saved.id());
  }

  /** 내용이 새로 생기거나 바뀐 메모리의 임베딩을 커밋 뒤에 채우게 한다 — 롤백되면 이벤트도 사라진다. */
  private void requestEmbedding(long memoryId) {
    events.publishEvent(TextEmbeddingService.Requested.memory(memoryId));
  }

  /** 기록 행 → 응답 항목 — before/after JSON 을 스냅숏으로 읽고, 출처 대화는 남아 있을 때만(지워졌으면 null) id·제목으로 싣는다. */
  private AiMemoryChangeItem toItem(ChangeRow r) {
    return new AiMemoryChangeItem(
        r.id(),
        r.action(),
        r.createdAt(),
        changeLog.readAfter(r.afterJson()),
        changeLog.readBefore(r.beforeJson()),
        r.sourceSessionId() == null
            ? null
            : new AiMemoryChangeItem.SourceSession(r.sourceSessionId(), r.sessionTitle()),
        r.reason(),
        r.undoneAt());
  }
}
