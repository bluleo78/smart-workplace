package com.workplace.home.service;

import com.workplace.global.ai.MemoryTextNormalizer;
import com.workplace.global.ai.TextEmbedder;
import com.workplace.global.util.PersonNames;
import com.workplace.home.dto.SharedAiMemoryItem;
import com.workplace.home.dto.SharedAiMemoryPage;
import com.workplace.home.dto.SharedMemorySpaceItem;
import com.workplace.home.dto.SharedMemorySpaceList;
import com.workplace.home.exception.SharedAiMemoryException;
import com.workplace.home.repository.CursorCodec;
import com.workplace.home.repository.SharedAiMemoryRepository;
import com.workplace.home.repository.SharedAiMemoryRepository.Row;
import com.workplace.home.repository.SharedAiMemoryRepository.Scored;
import com.workplace.home.service.RrfRanking.Ranked;
import com.workplace.home.service.SharedMemorySpaces.Access;
import com.workplace.home.service.SharedSpace.SpaceKey;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.stream.Collectors;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 공용 메모리 관리(WP-386 스펙 6.5·7절) — 공간 목록, 목록·검색, 직접 추가(USER_ADDED, 공용성 검사 없음), 고치기, 지우기. 모든 쓰기는 공간 잠금
 * → 권한 재확인 → 변경 → 공간 기록(행위자 = 사람) 순서다. 검색은 질의 임베딩을 트랜잭션 밖에서 기다린 뒤 짧은 읽기 트랜잭션에서 순위를 매긴다.
 */
@Service
public class SharedAiMemoryService {

  static final int DEFAULT_SIZE = 30;
  static final int MAX_SIZE = 50;

  /** 같은 최신순 — 저장소 정렬(updated_at DESC, id DESC)과 같다. 검색 순위의 동률 가르기에 쓴다. */
  private static final Comparator<Row> NEWEST =
      Comparator.comparing(Row::updatedAt, Comparator.<Instant>reverseOrder())
          .thenComparing(Row::id, Comparator.<Long>reverseOrder());

  private final SharedMemorySpaces spaces;
  private final SharedAiMemoryRepository repo;
  private final SharedAiMemoryChangeLog changeLog;
  private final SharedAiMemoryForgottenService forgotten;
  private final TextEmbedder embedder;
  private final ApplicationEventPublisher events;
  private final TransactionTemplate tx;
  private final TransactionTemplate readTx;

  public SharedAiMemoryService(
      SharedMemorySpaces spaces,
      SharedAiMemoryRepository repo,
      SharedAiMemoryChangeLog changeLog,
      SharedAiMemoryForgottenService forgotten,
      TextEmbedder embedder,
      ApplicationEventPublisher events,
      PlatformTransactionManager txManager) {
    this.spaces = spaces;
    this.repo = repo;
    this.changeLog = changeLog;
    this.forgotten = forgotten;
    this.embedder = embedder;
    this.events = events;
    this.tx = new TransactionTemplate(txManager);
    this.readTx = new TransactionTemplate(txManager);
    this.readTx.setReadOnly(true);
  }

  /**
   * 제어문자(NUL 등 — Postgres 가 거절한다)를 걷어 내고 앞뒤 공백을 지운 내용 — 1~300 코드포인트가 아니면 400. 제어문자만 있으면 빈 문자열이 되어
   * 400 이다(개인 메모리 normalizeContent 와 같은 규칙).
   */
  public static String normalizeContent(String content) {
    String c = content == null ? "" : MemoryTextNormalizer.stripControl(content).strip();
    // 점자 빈칸·결합 문자처럼 공백이 아니어도 그려지지 않는 글자만 있으면 빈 내용으로 본다(WP-724) — 목록에 빈 줄 지침이 생기지 않게.
    if (!PersonNames.hasVisibleChar(c)) c = "";
    int n = c.codePointCount(0, c.length());
    if (n < 1 || n > SharedAiMemoryRepository.MAX_CHARS) {
      throw SharedAiMemoryException.invalid("내용은 1~300자로 적어 주세요.");
    }
    return c;
  }

  /** 읽을 수 있는 공간 목록(개수·상한·권한). */
  public SharedMemorySpaceList spaces(long userId) {
    return readTx.execute(
        s -> {
          Map<String, Integer> counts = repo.countsByParam();
          return new SharedMemorySpaceList(
              spaces.readable(userId).stream()
                  .map(
                      a ->
                          new SharedMemorySpaceItem(
                              a.space().type().name(),
                              a.space().id(),
                              a.space().key(),
                              a.space().name(),
                              a.space().label(),
                              counts.getOrDefault(a.space().param(), 0),
                              SharedAiMemoryRepository.limitOf(a.space().spaceKey()),
                              a.canAdd(),
                              a.canManage()))
                  .toList());
        });
  }

  /** 목록 — q 가 있으면 맞는 것 전부(순위순, 한 묶음), 없으면 최신순 키셋. 못 읽는 공간은 404. */
  public SharedAiMemoryPage list(
      long userId, String spaceType, Long spaceId, String q, String cursor, Integer size) {
    SpaceKey k = keyOrInvalid(spaceType, spaceId);
    String query = q == null ? "" : q.strip();
    float[] vec = null;
    if (!query.isEmpty()) {
      // 못 읽는 공간이면 임베딩을 돌리기 전에 404 — 존재도 숨기고 헛된 임베딩 호출도 없다.
      readTx.executeWithoutResult(s -> spaces.requireReadable(userId, k));
      // 질의 임베딩은 트랜잭션 밖에서 기다린다(연결을 붙들지 않게). 못 받으면 키워드만으로 찾는다.
      vec = embedder.embedQuery(query, AiMemoryService.SEARCH_EMBED_WAIT).orElse(null);
    }
    final float[] queryVec = vec;
    return readTx.execute(
        s -> {
          Access a = spaces.requireReadable(userId, k);
          int count = repo.count(k);
          int limit = SharedAiMemoryRepository.limitOf(k);
          if (!query.isEmpty()) {
            List<Row> rows = rank(repo.score(k, query, SearchTerms.of(query), queryVec));
            return new SharedAiMemoryPage(items(a, userId, rows), null, count, limit);
          }
          int n = size == null ? DEFAULT_SIZE : Math.max(1, Math.min(size, MAX_SIZE));
          CursorCodec.Slice<Row> page =
              CursorCodec.slice(
                  repo.page(k, CursorCodec.decode(cursor), n + 1), n, Row::updatedAt, Row::id);
          return new SharedAiMemoryPage(items(a, userId, page.items()), page.next(), count, limit);
        });
  }

  /** 직접 추가(스펙 6.5) — 공용성 검사 없음, 겹치는 지운 기록을 푼다. */
  public SharedAiMemoryItem add(long userId, String spaceType, Long spaceId, String content) {
    SpaceKey k = keyOrInvalid(spaceType, spaceId);
    String text = normalizeContent(content);
    return tx.execute(
        s -> {
          Added added = insertLocked(userId, k, text, "USER_ADDED");
          return items(added.access(), userId, List.of(added.row())).get(0);
        });
  }

  /** {@link #insertLocked} 결과 — 저장 시점의 공간 권한, 저장된 행, 방금 남긴 기록 id(결과 줄 「되돌리기」가 되돌릴 기록). */
  public record Added(Access access, Row row, long changeId) {}

  /**
   * 사람이 넣는 항목 한 건의 저장(직접 추가 USER_ADDED·직접 요청 USER_REQUESTED 공용) — 공간 잠금 → 권한·한도 재확인 → 저장 → 지운 기록 해제
   * → 기록 → 임베딩 요청. 호출자 트랜잭션 안에서 부른다(검사처럼 오래 걸리는 일은 호출자가 트랜잭션 밖에서 끝낸 뒤).
   */
  public Added insertLocked(long userId, SpaceKey k, String text, String origin) {
    repo.lockSpace(k);
    Access a = spaces.requireReadable(userId, k);
    if (!a.canAdd()) {
      throw SharedAiMemoryException.forbidden(
          "ORG".equals(k.type()) ? "조직 지침은 관리자만 추가할 수 있어요." : "이 공간에 추가할 권한이 없어요.");
    }
    int limit = SharedAiMemoryRepository.limitOf(k);
    if (repo.count(k) >= limit) throw SharedAiMemoryException.full(limit);
    OffsetDateTime now = OffsetDateTime.now(ZoneOffset.UTC);
    Row r = repo.insert(k, text, origin, userId, userId, now);
    forgotten.release(k, text);
    long changeId =
        changeLog.record(
            k,
            null,
            SharedAiMemoryChangeLog.ADDED,
            userId,
            r.id(),
            List.of(),
            SharedMemorySnapshot.of(r),
            now);
    events.publishEvent(TextEmbeddingService.Requested.sharedMemory(r.id()));
    return new Added(a, r, changeId);
  }

  /** 고치기 — 관리 권한자 또는 본인 항목. 출처는 그대로 두고 수정자만 남긴다. */
  public SharedAiMemoryItem update(long userId, long id, String content) {
    String text = normalizeContent(content);
    return tx.execute(
        s -> {
          // 행의 공간을 알아야 공간 잠금을 먼저 잡을 수 있다(잠금 순서: 공간 → 행).
          SpaceKey k = repo.findById(id).orElseThrow(SharedAiMemoryException::notFound).spaceKey();
          repo.lockSpace(k);
          Access a = spaces.requireReadable(userId, k);
          Row cur = repo.lock(k, id).orElseThrow(SharedAiMemoryException::notFound);
          requireEditable(a, userId, cur);
          if (cur.content().equals(text)) return items(a, userId, List.of(cur)).get(0);
          OffsetDateTime now = OffsetDateTime.now(ZoneOffset.UTC);
          Row saved = repo.update(id, text, cur.origin(), userId, now);
          changeLog.record(
              k,
              null,
              SharedAiMemoryChangeLog.UPDATED,
              userId,
              id,
              List.of(SharedMemorySnapshot.of(cur)),
              SharedMemorySnapshot.of(saved),
              now);
          events.publishEvent(TextEmbeddingService.Requested.sharedMemory(id));
          return items(a, userId, List.of(saved)).get(0);
        });
  }

  /** 지우기 — 관리 권한자 또는 본인 항목. AI 항목·대화로 요청한 항목을 지우면 지운 기록에 남긴다(직접 추가한 항목은 남기지 않는다). */
  public void delete(long userId, long id) {
    tx.executeWithoutResult(
        s -> {
          SpaceKey k = repo.findById(id).orElseThrow(SharedAiMemoryException::notFound).spaceKey();
          repo.lockSpace(k);
          Access a = spaces.requireReadable(userId, k);
          Row cur = repo.lock(k, id).orElseThrow(SharedAiMemoryException::notFound);
          requireEditable(a, userId, cur);
          removeLocked(repo, forgotten, k, cur);
          changeLog.record(
              k,
              null,
              SharedAiMemoryChangeLog.DELETED,
              userId,
              id,
              List.of(SharedMemorySnapshot.of(cur)),
              null,
              OffsetDateTime.now(ZoneOffset.UTC));
        });
  }

  /**
   * 잠근 행을 지우고, 걷어 낼 때 기억할 출처({@link SharedMemorySpaces#rememberOnRemoval} — AI 항목·대화로 요청한 항목)면 지운
   * 기록에 남긴다. 같은 발화에서 배경 추출이 되살리지 않게 하려는 것(WP-385 개인 delete 와 같은 뜻). 직접 추가한 항목은 남기지 않는다. 지우기·추가
   * 되돌리기가 함께 쓴다 — 호출자 트랜잭션 안, 공간·행 잠금을 잡은 뒤에 부른다.
   */
  static void removeLocked(
      SharedAiMemoryRepository repo,
      SharedAiMemoryForgottenService forgotten,
      SpaceKey k,
      Row row) {
    repo.delete(row.id());
    if (SharedMemorySpaces.rememberOnRemoval(row.origin())) {
      forgotten.remember(k, List.of(row.content()));
    }
  }

  private void requireEditable(Access a, long userId, Row r) {
    if (!spaces.canEdit(a, userId, r.origin(), r.authorUserId())) {
      throw SharedAiMemoryException.forbidden("이 항목을 바꿀 권한이 없어요.");
    }
  }

  private SpaceKey keyOrInvalid(String type, Long id) {
    SpaceKey k = SpaceKey.of(type, id);
    if (k == null) throw SharedAiMemoryException.invalid("공간을 알 수 없어요.");
    return k;
  }

  /** 행 → 응답(작성자 이름은 한 번에 읽는다). 대화에서 뽑힌 항목은 작성자를 싣지 않는다. */
  private List<SharedAiMemoryItem> items(Access a, long userId, List<Row> rows) {
    Map<Long, String> names =
        repo.userNames(
            rows.stream()
                .map(Row::authorUserId)
                .filter(Objects::nonNull)
                .collect(Collectors.toSet()));
    return rows.stream()
        .map(
            r ->
                new SharedAiMemoryItem(
                    r.id(),
                    r.content(),
                    r.origin(),
                    r.authorUserId() == null
                            || !SharedMemorySpaces.USER_ORIGINS.contains(r.origin())
                        ? null
                        : new SharedAiMemoryItem.Author(
                            names.getOrDefault(r.authorUserId(), "알 수 없는 사용자")),
                    r.createdAt(),
                    r.updatedAt(),
                    spaces.canEdit(a, userId, r.origin(), r.authorUserId())))
        .toList();
  }

  /**
   * 검색 순위 — 개인 메모리 검색과 같은 키워드·의미·최신 RRF({@link RrfRanking})로 매기고, 맞은 것(키워드 일치 또는 거리 ≤ 0.45)만 순위순으로
   * 돌려준다. 공용은 감쇠가 없어 최신 갈래에 모든 행이 든다.
   */
  static List<Row> rank(List<Scored> scored) {
    Comparator<Scored> newest = Comparator.comparing(Scored::row, NEWEST);
    return RrfRanking.rank(scored, s -> s.row().id(), newest, s -> true, newest).stream()
        .filter(Ranked::matched)
        .map(r -> r.item().row())
        .toList();
  }
}
