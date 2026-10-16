package com.workplace.home.service;

import com.workplace.home.dto.SharedAiMemoryChangeItem;
import com.workplace.home.dto.SharedAiMemoryChangePage;
import com.workplace.home.dto.UndoSharedAiMemoryChangeResponse;
import com.workplace.home.exception.SharedAiMemoryException;
import com.workplace.home.repository.CursorCodec;
import com.workplace.home.repository.SharedAiMemoryChangeRepository;
import com.workplace.home.repository.SharedAiMemoryChangeRepository.ChangeRow;
import com.workplace.home.repository.SharedAiMemoryRepository;
import com.workplace.home.repository.SharedAiMemoryRepository.Row;
import com.workplace.home.service.SharedMemorySpaces.Access;
import com.workplace.home.service.SharedSpace.SpaceKey;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.stream.Collectors;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 공간 기록·되돌리기(WP-386 스펙 7절, 규칙은 WP-385 8.1 과 같은 모양). 잠금 순서: 공간 잠금 → 기록 행 → 메모리 행. 되돌리기는 지금 행이 기록의
 * 결과와 "그대로"일 때만 하고(아니면 409 CHANGED), 되돌림마다 RESTORED 기록을 남긴다. 호출자 트랜잭션이 있으면 합류한다(채팅 결과 줄 되돌리기).
 */
@Service
public class SharedAiMemoryChangeService {

  /** 기록 보관 일수(만료 정리 배치). */
  public static final int KEEP_DAYS = 90;

  static final int DEFAULT_SIZE = 30;
  static final int MAX_SIZE = 50;

  private static final String UNKNOWN_USER = "알 수 없는 사용자";

  private final SharedMemorySpaces spaces;
  private final SharedAiMemoryRepository repo;
  private final SharedAiMemoryChangeRepository changes;
  private final SharedAiMemoryChangeLog changeLog;
  private final SharedAiMemoryForgottenService forgotten;
  private final ApplicationEventPublisher events;
  private final TransactionTemplate tx;
  private final TransactionTemplate readTx;

  public SharedAiMemoryChangeService(
      SharedMemorySpaces spaces,
      SharedAiMemoryRepository repo,
      SharedAiMemoryChangeRepository changes,
      SharedAiMemoryChangeLog changeLog,
      SharedAiMemoryForgottenService forgotten,
      ApplicationEventPublisher events,
      PlatformTransactionManager txManager) {
    this.spaces = spaces;
    this.repo = repo;
    this.changes = changes;
    this.changeLog = changeLog;
    this.forgotten = forgotten;
    this.events = events;
    this.tx = new TransactionTemplate(txManager);
    this.readTx = new TransactionTemplate(txManager);
    this.readTx.setReadOnly(true);
  }

  /** 기록 한 묶음(최신순, 기본 30·최대 50). 못 읽는 공간은 404. 숫자 아닌 커서는 첫 페이지. */
  public SharedAiMemoryChangePage list(
      long userId, String spaceType, Long spaceId, String cursor, Integer size) {
    SpaceKey k = SpaceKey.of(spaceType, spaceId);
    if (k == null) throw SharedAiMemoryException.invalid("공간을 알 수 없어요.");
    return readTx.execute(
        s -> {
          Access a = spaces.requireReadable(userId, k);
          int n = size == null ? DEFAULT_SIZE : Math.max(1, Math.min(size, MAX_SIZE));
          CursorCodec.Slice<ChangeRow> page =
              CursorCodec.slice(
                  changes.page(k, CursorCodec.decode(cursor), n + 1),
                  n,
                  ChangeRow::createdAt,
                  ChangeRow::id);
          return new SharedAiMemoryChangePage(items(a, userId, page.items()), page.next());
        });
  }

  /**
   * 되돌리기.
   *
   * @throws SharedAiMemoryException 404(없음·못 읽는 공간), 400(RESTORED), 409 CHANGE_UNDONE(권한보다 먼저),
   *     403(권한), 409 CHANGED
   */
  public UndoSharedAiMemoryChangeResponse undo(long userId, long changeId) {
    UndoResult r = tx.execute(s -> undoLocked(userId, changeId));
    // 이미 되돌린 기록은 409 — 잠금 안에서 판정한 결과를 트랜잭션 밖에서 오류로 바꾼다.
    if (r.outcome() == UndoOutcome.ALREADY_UNDONE) throw SharedAiMemoryException.changeUndone();
    return r.response();
  }

  /** {@link #undoLocked} 판정 — 되돌렸는가, 이미 되돌려져 있었는가. */
  public enum UndoOutcome {
    UNDONE,
    ALREADY_UNDONE
  }

  /** {@link #undoLocked} 결과 — ALREADY_UNDONE 이면 response 는 null. */
  public record UndoResult(UndoOutcome outcome, UndoSharedAiMemoryChangeResponse response) {}

  /**
   * 되돌리기 본체 — 호출자 트랜잭션 안에서 부른다({@link SharedAiMemoryService#insertLocked} 와 같은 모양,
   * TransactionTemplate 을 거치지 않아 예외가 바깥 트랜잭션을 rollback-only 로 만들지 않는다). "이미 되돌림" 은 기록 행 잠금 아래에서 판정해
   * 동시 되돌리기와 겹치지 않고, 예외 대신 ALREADY_UNDONE 로 알린다(채팅 결과 줄은 이를 성공으로 본다). 그 밖의 오류(404·400·403·409
   * CHANGED)는 그대로 던진다. 잠금 순서: 공간 → 기록 → 메모리.
   */
  public UndoResult undoLocked(long userId, long changeId) {
    // 기록의 공간을 알아야 공간 잠금을 먼저 잡을 수 있다(잠금 순서: 공간 → 기록 → 메모리).
    ChangeRow seen = changes.find(changeId).orElseThrow(SharedAiMemoryException::notFound);
    SpaceKey k = seen.spaceKey();
    repo.lockSpace(k);
    Access a = spaces.requireReadable(userId, k);
    ChangeRow ch = changes.lock(changeId).orElseThrow(SharedAiMemoryException::notFound);
    if (SharedAiMemoryChangeLog.RESTORED.equals(ch.action())) {
      throw SharedAiMemoryException.invalid("되돌림 기록은 되돌릴 수 없어요.");
    }
    // 이미 되돌린 기록은 권한과 무관하게 ALREADY_UNDONE — 못 되돌리는 사람에게도 "이미 되돌림" 이 맞는 안내다(권한 403 보다 먼저).
    if (ch.undoneAt() != null) return new UndoResult(UndoOutcome.ALREADY_UNDONE, null);
    if (!canUndo(
        a,
        userId,
        ch,
        changeLog.readBefore(ch.beforeJson()),
        changeLog.readAfter(ch.afterJson()))) {
      throw SharedAiMemoryException.forbidden("이 기록을 되돌릴 권한이 없어요.");
    }
    OffsetDateTime now = OffsetDateTime.now(ZoneOffset.UTC);
    reverse(k, userId, ch, now);
    changes.markUndone(changeId, userId, now);
    return new UndoResult(
        UndoOutcome.UNDONE,
        new UndoSharedAiMemoryChangeResponse(
            items(a, userId, List.of(changes.find(changeId).orElseThrow())).get(0)));
  }

  /** 반대 동작 + RESTORED 기록. */
  private void reverse(SpaceKey k, long userId, ChangeRow ch, OffsetDateTime now) {
    List<SharedMemorySnapshot> before = changeLog.readBefore(ch.beforeJson());
    SharedMemorySnapshot after = changeLog.readAfter(ch.afterJson());
    switch (ch.action()) {
      case SharedAiMemoryChangeLog.ADDED -> {
        Row cur = lockSame(k, after);
        // 넣은 것을 사람이 거둔 셈 — AI 가 넣었든 사람이 대화로 요청했든 지운 기록에 남겨, 배경 추출이 같은 발화에서 같은 말을 AI_EXTRACTED 로
        // 다시 넣지 않게 한다(직접 추가 USER_ADDED 는 발화가 없어 남기지 않는다 — removeLocked 가 판정).
        SharedAiMemoryService.removeLocked(repo, forgotten, k, cur);
        changeLog.record(
            k,
            null,
            SharedAiMemoryChangeLog.RESTORED,
            userId,
            cur.id(),
            List.of(SharedMemorySnapshot.of(cur)),
            null,
            now);
      }
      case SharedAiMemoryChangeLog.UPDATED -> {
        Row cur = lockSame(k, after);
        Row saved = restoreInPlace(cur, before.get(0), userId, now);
        rememberRejected(k, ch, before, after);
        changeLog.record(
            k,
            null,
            SharedAiMemoryChangeLog.RESTORED,
            userId,
            saved.id(),
            List.of(SharedMemorySnapshot.of(cur)),
            SharedMemorySnapshot.of(saved),
            now);
      }
      case SharedAiMemoryChangeLog.MERGED -> {
        Row cur = lockSame(k, after);
        List<SharedMemorySnapshot> rest = before.subList(1, before.size());
        requireRoom(k, rest.size());
        Row saved = restoreInPlace(cur, before.get(0), userId, now);
        for (SharedMemorySnapshot s : rest) reinsert(k, s, userId, now);
        rememberRejected(k, ch, before, after);
        changeLog.record(
            k,
            null,
            SharedAiMemoryChangeLog.RESTORED,
            userId,
            saved.id(),
            List.of(SharedMemorySnapshot.of(cur)),
            SharedMemorySnapshot.of(saved),
            now);
      }
      case SharedAiMemoryChangeLog.DELETED -> {
        requireRoom(k, 1);
        Row saved = reinsert(k, before.get(0), userId, now);
        // 사람이 지움을 거둔 것 — 지운 기록에 남아 있던 같은 말을 풀어, 되살린 항목을 AI 정리가 영영 못 고치는 일이 없게 한다.
        forgotten.release(k, saved.content());
        changeLog.record(
            k,
            null,
            SharedAiMemoryChangeLog.RESTORED,
            userId,
            saved.id(),
            List.of(),
            SharedMemorySnapshot.of(saved),
            now);
      }
      default -> throw SharedAiMemoryException.invalid("되돌릴 수 없는 기록이에요.");
    }
  }

  /**
   * AI 가 한 고침·합침을 사람이 되돌리면 AI 가 낸 결과 문장을 지운 기록에 남긴다(WP-385 AiMemoryChangeService#rememberRejected 와
   * 같은 뜻 — 안 남기면 배경 추출이 같은 대화에서 같은 고침을 다시 한다). 사람이 한 고침(행위자 USER)을 되돌린 것은 AI 결과에 대한 거절이 아니라 남기지
   * 않는다. 되돌린 뒤에도 남는 문장과 정규화로 같으면 넣지 않는다({@link SharedAiMemoryForgottenService#rejectReplaced}).
   */
  private void rememberRejected(
      SpaceKey k, ChangeRow ch, List<SharedMemorySnapshot> before, SharedMemorySnapshot after) {
    if (!SharedAiMemoryChangeLog.ACTOR_AI.equals(ch.actorKind())) return;
    forgotten.rejectReplaced(
        k, before.stream().map(SharedMemorySnapshot::content).toList(), after.content());
  }

  /** 결과 메모리를 잠그고 "그대로"인지 — 아니면(없음 포함) 409 CHANGED. */
  private Row lockSame(SpaceKey k, SharedMemorySnapshot after) {
    Row cur = after == null ? null : repo.lock(k, after.id()).orElse(null);
    if (after == null || !after.sameAs(cur)) throw SharedAiMemoryException.changed();
    return cur;
  }

  /**
   * 복원한 행의 수정자 — AI 출처 스냅숏을 되살리면 그 문장은 AI 의 것이라 비운다(null). 되돌린 사람을 남기면 사람이 고친 항목으로 보여 이후 AI 정리가 다시
   * 손댈 수 없다({@link SharedMemorySpaces#aiOwned}). 되돌린 AI 문장이 다시 돌아오는 것은 지운 기록(rejectReplaced)이 따로
   * 막는다. 사람 출처 스냅숏은 되돌린 사람.
   */
  private static Long restoredUpdatedBy(SharedMemorySnapshot s, long userId) {
    return SharedMemorySpaces.AI_ORIGINS.contains(s.origin()) ? null : userId;
  }

  /** 같은 행을 이전 내용·출처로 되돌린다 — 내용이 달라졌으면 임베딩을 다시 만든다. */
  private Row restoreInPlace(Row cur, SharedMemorySnapshot prev, long userId, OffsetDateTime now) {
    Row saved =
        repo.update(cur.id(), prev.content(), prev.origin(), restoredUpdatedBy(prev, userId), now);
    if (!cur.content().equals(saved.content())) {
      events.publishEvent(TextEmbeddingService.Requested.sharedMemory(saved.id()));
    }
    return saved;
  }

  /**
   * 지워진 행을 원래 id 로 되살린다 — id 가 이미 쓰였으면 409 CHANGED. 스냅숏의 작성자가 그 뒤 사라졌으면(탈퇴 삭제) 작성자 없이 되살린다: 그대로 넣으면
   * 외래키 위반으로 500 이 된다.
   */
  private Row reinsert(SpaceKey k, SharedMemorySnapshot s, long userId, OffsetDateTime now) {
    SharedMemorySnapshot toInsert = s;
    if (s.authorUserId() != null && repo.userNames(Set.of(s.authorUserId())).isEmpty()) {
      toInsert = new SharedMemorySnapshot(s.id(), s.content(), s.origin(), null);
    }
    Row saved =
        repo.insertWithId(toInsert.id(), k, toInsert, restoredUpdatedBy(toInsert, userId), now)
            .orElseThrow(SharedAiMemoryException::changed);
    events.publishEvent(TextEmbeddingService.Requested.sharedMemory(saved.id()));
    return saved;
  }

  /** 되살릴 자리가 있는가 — 가득이면 409 CHANGED(그 뒤 공간이 바뀐 것). */
  private void requireRoom(SpaceKey k, int adding) {
    if (repo.count(k) + adding > SharedAiMemoryRepository.limitOf(k)) {
      throw SharedAiMemoryException.changed();
    }
  }

  /**
   * 되돌릴 수 있는가 — 되돌림 기록은 늘 false, 관리 권한자는 모두, 그 밖은 본인이 행위자인 기록이면서 대상 항목을 본인이 고칠 수 있을 때({@link
   * SharedMemorySpaces#canEdit} — 본인 직접 추가·요청 항목). before/after 는 호출자가 이미 읽은 값을 넘긴다.
   */
  private boolean canUndo(
      Access a,
      long userId,
      ChangeRow ch,
      List<SharedMemorySnapshot> before,
      SharedMemorySnapshot after) {
    if (SharedAiMemoryChangeLog.RESTORED.equals(ch.action())) return false;
    if (a.canManage()) return true;
    if (!SharedAiMemoryChangeLog.ACTOR_USER.equals(ch.actorKind())
        || !Objects.equals(ch.actorUserId(), userId)) {
      return false;
    }
    SharedMemorySnapshot target = after != null ? after : before.isEmpty() ? null : before.get(0);
    return target != null && spaces.canEdit(a, userId, target.origin(), target.authorUserId());
  }

  /** 기록 행 → 응답 — 행위자 이름은 한 번에 읽고, AI 행위자에는 이름을 싣지 않는다. */
  private List<SharedAiMemoryChangeItem> items(Access a, long userId, List<ChangeRow> rows) {
    Map<Long, String> names =
        repo.userNames(
            rows.stream()
                .map(ChangeRow::actorUserId)
                .filter(Objects::nonNull)
                .collect(Collectors.toSet()));
    List<SharedAiMemoryChangeItem> out = new ArrayList<>();
    for (ChangeRow r : rows) {
      boolean ai = SharedAiMemoryChangeLog.ACTOR_AI.equals(r.actorKind());
      // 탈퇴로 행위자 id 가 비어도 사람 기록이면 이름 자리를 채운다.
      String name =
          ai
              ? null
              : r.actorUserId() == null
                  ? UNKNOWN_USER
                  : names.getOrDefault(r.actorUserId(), UNKNOWN_USER);
      List<SharedMemorySnapshot> before = changeLog.readBefore(r.beforeJson());
      SharedMemorySnapshot after = changeLog.readAfter(r.afterJson());
      out.add(
          new SharedAiMemoryChangeItem(
              r.id(),
              r.action(),
              new SharedAiMemoryChangeItem.Actor(r.actorKind(), name),
              r.createdAt(),
              after,
              before,
              r.undoneAt(),
              r.undoneAt() == null && canUndo(a, userId, r, before, after)));
    }
    return out;
  }
}
