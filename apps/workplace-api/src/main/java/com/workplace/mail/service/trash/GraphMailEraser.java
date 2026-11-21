package com.workplace.mail.service.trash;

import com.workplace.mail.dto.EmailAccountResponse;
import com.workplace.mail.dto.MailProvider;
import com.workplace.mail.exception.EmailAccountNotFoundException;
import com.workplace.mail.exception.MailCredentialUnreadableException;
import com.workplace.mail.exception.MailSendException;
import com.workplace.mail.exception.MailSyncException;
import com.workplace.mail.exception.MailTrashException;
import com.workplace.mail.outbound.GraphApiClient;
import com.workplace.mail.outbound.GraphBatchRequest;
import com.workplace.mail.outbound.GraphBatchResponse;
import com.workplace.mail.service.GraphTokenService;
import com.workplace.mail.service.MailServerErrors;
import com.workplace.mail.service.graph.GraphMailFolder;
import com.workplace.mail.service.graph.GraphMessageIdPage;
import java.time.Duration;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.BiFunction;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

/**
 * Outlook(Graph) 휴지통 메일 완전히 삭제(WP-1682) — {@code POST
 * /me/mailFolders/deleteditems/messages/{id}/permanentDelete}(본문 {@code {}}) 를 $batch 로 20건씩 보낸다.
 * 2xx 와 404(이미 없음 — 목표 상태)는 성공, 그 밖은 실패다.
 *
 * <p>폴더 범위 경로여도 Graph 는 메시지 id 로 찾고 폴더를 확인하지 않는다 — 다른 메일 앱이 지운 편지함 밖으로 옮긴 메일(낡은 로컬 휴지통 행, 비우기 스냅샷 뒤
 * 옮긴 메일)도 그 자리에서 지워진다. 그래서 지우기 전에 묶음마다 {@code GET /me/messages/{id}?$select=id,parentFolderId} 를
 * $batch 로 보내 지금 지운 편지함에 있는 메일만 지운다(지운 편지함 id 는 실행마다 한 번 {@code GET /me/mailFolders/deleteditems} 로
 * 얻는다). 확인 GET 의 404 는 이미 없는 것이라 성공, 다른 메일함에 있으면 지우지 않는다(한 통 경로는 「메일함이 바뀌었습니다」, 비우기는 실패로 센다).
 *
 * <p>한 통 경로({@link #erase})는 옮기기({@code GraphMailMover})처럼 다시 보내지 않는다. 휴지통 비우기({@link
 * #emptyTrash})는 오래 걸리는 백그라운드 작업이라 항목 429·503·504 를 Retry-After 만큼 기다려 그 항목만 다시 보내고, batch 최상위 실패도
 * 2·5·10초 뒤 다시 보낸다. 로그에는 계정 id·개수만 남긴다(제목·주소·토큰 없음).
 *
 * <p>휴지통 행({@link TrashRef})은 쓰지 않는다 — Graph 휴지통은 well-known 이름으로 늘 같은 메일함을 가리켜 IMAP 처럼 「목록 갱신 뒤
 * 휴지통이 바뀌었는지」를 볼 필요가 없다.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class GraphMailEraser implements MailEraser {

  /** Graph JSON batch 상한(한 요청에 최대 20건). */
  static final int BATCH = 20;

  /** 비우기에서 항목 429·503·504 를 다시 보내는 횟수 — 처음 보낸 뒤 최대 3번 더(그 항목은 모두 최대 4번 보낸다). 넘으면 그 항목은 실패로 센다. */
  static final int ITEM_RETRY_MAX = 3;

  /** 항목 응답에 Retry-After 가 없을 때 기다리는 시간. */
  static final Duration DEFAULT_RETRY_AFTER = Duration.ofSeconds(5);

  /** 항목 재시도 대기 상한 — 서버가 더 길게 말해도 작업이 한 묶음에 오래 묶이지 않게 자른다. */
  static final Duration MAX_RETRY_AFTER = Duration.ofSeconds(30);

  /** batch 최상위 실패 뒤 다시 보내기 전 대기(차례로) — 이만큼 다시 보내고도 실패하면 서버 연결 실패로 멈춘다. */
  static final List<Duration> TOP_RETRY_DELAYS =
      List.of(Duration.ofSeconds(2), Duration.ofSeconds(5), Duration.ofSeconds(10));

  /** 다시 보낼 가치가 있는 항목 상태(조절·일시 장애). */
  private static final Set<Integer> RETRYABLE = Set.of(429, 503, 504);

  /** 지운 편지함 메시지 경로(well-known 이름, 배치 규약상 /v1.0 접두 없이). */
  private static final String TRASH_MESSAGES = "/me/mailFolders/deleteditems/messages";

  /** 지운 편지함 폴더 id 조회 — 확인 GET 의 parentFolderId 와 견준다. */
  private static final String TRASH_FOLDER = "/me/mailFolders/deleteditems?$select=id";

  /** 지운 편지함 메일 수 조회 — 확인 창 수(WP-1708)는 totalItemCount 가 함께 필요해 select 를 넓게 받는다. */
  private static final String TRASH_COUNT_FOLDER =
      "/me/mailFolders/deleteditems?$select=id,totalItemCount";

  /** 재시도 대기 — 테스트가 실제로 자지 않고 기록만 하는 것으로 바꾼다. */
  public interface Pauser {

    /** d 만큼 기다린다. 기다리는 중 인터럽트되면 던진다. */
    void pause(Duration d) throws InterruptedException;
  }

  private final GraphTokenService tokenService;
  private final GraphApiClient graphApiClient;

  /** 비우기 id 목록 한 쪽 크기($top). 테스트가 작은 값으로 바꿀 수 있게 상수가 아닌 필드로 둔다. */
  private int pageSize = 500;

  /** 비우기에서 성공 id 를 로컬에 반영하는 단위 — 이만큼 모일 때마다(끝에 남은 것도) sink 로 넘긴다. 테스트가 바꾼다. */
  private int localFlush = 100;

  /** 재시도 대기 방법 — 운영은 실제로 잔다. */
  private Pauser pauser = d -> Thread.sleep(d.toMillis());

  @Override
  public MailProvider provider() {
    return MailProvider.M365_GRAPH;
  }

  /**
   * 휴지통 메일들을 20건씩 지운다. Graph id 가 없는 로컬 행은 서버에서 찾을 수 없어 실패(batch 에 싣지 않는다). 묶음마다 먼저 지금 위치를
   * 확인해({@link #locateRequest}) 지운 편지함에 있는 메일만 permanentDelete 한다 — 확인 404 는 이미 없어 성공, 다른 메일함에 있으면
   * 「메일함이 바뀌었습니다」 실패(다음 동기화가 옮긴 자리로 다시 받는다), 그 밖 상태·응답에 빠진 항목은 결과를 몰라 실패다. 어느 단계든 batch 최상위
   * 실패({@code MailSendException})는 그 묶음의 남은 메일과 뒤 묶음을 실패로 두고 멈춘다 — 앞 묶음은 이미 지웠으니 결과를 유지한다. 토큰이나 지운
   * 편지함 id 를 받지 못하면(접속 실패) 아무것도 지우지 않고 그대로 던진다.
   */
  @Override
  public List<Outcome> erase(
      long userId, EmailAccountResponse account, TrashRef trash, List<Item> items) {
    String token = tokenService.getAccessToken(userId, account.id());
    String trashFolderId = trashFolderId(token);
    List<Outcome> out = new ArrayList<>();
    List<Item> remote = new ArrayList<>();
    for (Item it : items) {
      if (it.providerMessageId() == null) {
        out.add(Outcome.failed(it.messageId(), MailServerErrors.NOT_FOUND));
      } else {
        remote.add(it);
      }
    }
    for (int from = 0; from < remote.size(); from += BATCH) {
      List<Item> chunk = remote.subList(from, Math.min(from + BATCH, remote.size()));
      // 요청 id 는 메일 id — 응답 순서가 요청과 달라도 짝짓는다
      Map<String, Item> byReqId = new LinkedHashMap<>();
      Map<String, String> providerIdByReqId = new LinkedHashMap<>();
      for (Item it : chunk) {
        String reqId = String.valueOf(it.messageId());
        byReqId.put(reqId, it);
        providerIdByReqId.put(reqId, it.providerMessageId());
      }
      // ① 지금 위치 확인 — 지운 편지함에 있는 것만 남긴다
      List<GraphBatchResponse> located;
      try {
        located =
            graphApiClient.batch(
                token, requests(providerIdByReqId, GraphMailEraser::locateRequest));
      } catch (MailSendException e) {
        return failRest(out, account.id(), remote, from, List.of());
      }
      Map<String, String> toDelete = new LinkedHashMap<>();
      for (GraphBatchResponse r : located) {
        Item it = byReqId.get(r.id());
        if (it == null) {
          continue;
        }
        if (inFolder(r, trashFolderId)) {
          toDelete.put(r.id(), it.providerMessageId()); // 결과는 ② 지우기에서 정해진다
          continue;
        }
        byReqId.remove(r.id());
        if (r.status() == 404) {
          out.add(Outcome.ok(it.messageId())); // 다른 곳에서 이미 지웠다 — 목표 상태
        } else if (r.ok()) {
          // 다른 메일 앱이 지운 편지함 밖으로 옮겼다 — 그 자리에서 지우지 않는다(다음 동기화가 옮긴 자리로 다시 받는다)
          out.add(Outcome.failed(it.messageId(), MailServerErrors.MAILBOX_CHANGED));
        } else {
          out.add(Outcome.failed(it.messageId(), MailServerErrors.ERASE_FAILED));
        }
      }
      if (!toDelete.isEmpty()) {
        // ② 지운 편지함에 있는 메일만 지운다
        List<GraphBatchResponse> responses;
        try {
          responses =
              graphApiClient.batch(
                  token, requests(toDelete, GraphMailEraser::permanentDeleteRequest));
        } catch (MailSendException e) {
          List<Item> pending = toDelete.keySet().stream().map(byReqId::get).toList();
          return failRest(out, account.id(), remote, from + BATCH, pending);
        }
        for (GraphBatchResponse r : responses) {
          Item it = toDelete.containsKey(r.id()) ? byReqId.remove(r.id()) : null;
          if (it != null) {
            out.add(
                erased(r)
                    ? Outcome.ok(it.messageId())
                    : Outcome.failed(it.messageId(), MailServerErrors.ERASE_FAILED));
          }
        }
      }
      // 응답에 빠진 항목(확인·지우기)은 지웠는지 모른다 — 실패로 두고 로컬은 그대로(다음 동기화가 실제 상태를 맞춘다)
      byReqId
          .values()
          .forEach(it -> out.add(Outcome.failed(it.messageId(), MailServerErrors.ERASE_FAILED)));
    }
    return out;
  }

  /**
   * 한 통 경로의 batch 최상위 실패 — 결과가 아직 없는 이 묶음의 메일(pending)과 {@code from} 부터의 뒤 묶음 메일을 모두 실패로 두고 결과를
   * 돌려준다.
   */
  private static List<Outcome> failRest(
      List<Outcome> out, long accountId, List<Item> remote, int from, List<Item> pending) {
    log.warn("Graph 완전 삭제 batch 실패: accountId={}", accountId);
    pending.forEach(it -> out.add(Outcome.failed(it.messageId(), MailServerErrors.ERASE_FAILED)));
    for (int i = from; i < remote.size(); i++) {
      out.add(Outcome.failed(remote.get(i).messageId(), MailServerErrors.ERASE_FAILED));
    }
    return out;
  }

  /**
   * 지운 편지함의 Graph 폴더 id — 확인 GET 의 parentFolderId 와 견준다. 실패는 {@code MailSyncException}(접속 실패, 아무것도
   * 지우지 않았다). id 가 비어 오면 어느 메일도 지운 편지함에 있다고 볼 수 없어 같은 예외로 멈춘다.
   */
  private String trashFolderId(String token) {
    GraphMailFolder folder = graphApiClient.get(token, TRASH_FOLDER, GraphMailFolder.class);
    if (folder == null || folder.id() == null || folder.id().isEmpty()) {
      throw new MailSyncException("Graph 지운 편지함 id 없음");
    }
    return folder.id();
  }

  /**
   * 서버 휴지통의 실제 메일 수(WP-1708) — 지운 편지함의 {@code totalItemCount} 를 받는다(앱이 가져오지 않은 옛 메일 포함). 토큰· 클라이언트는
   * 기존 주입 그대로 쓰고, 수 가 없는 응답은 수를 얻지 못한 일이라 {@link MailSyncException} 으로 멈춘다(로컬 값으로 대신하지 않는다). 읽기만
   * 하므로 아무것도 지우지 않는다.
   */
  @Override
  public int countTrash(long userId, EmailAccountResponse account, TrashRef trash) {
    String token = tokenService.getAccessToken(userId, account.id());
    GraphMailFolder folder = graphApiClient.get(token, TRASH_COUNT_FOLDER, GraphMailFolder.class);
    if (folder == null || folder.totalItemCount() == null) {
      log.warn("Graph 휴지통 메일 수 없음: accountId={}", account.id());
      throw new MailSyncException("Graph 휴지통 메일 수 없음");
    }
    return folder.totalItemCount();
  }

  /**
   * 휴지통 비우기 — 지운 편지함 바로 아래의 모든 메일(앱이 가져오지 않은 30일 지난 메일 포함)을 지운다. 순서: 지운 편지함 id → id 목록을 {@code
   * nextLink} 끝까지 다 받는다(지우면서 쪽을 넘기면 건너뛰는 메일이 생긴다) → {@code sink.snapshot} → 20개씩 위치 확인 뒤 지운 편지함에 남은
   * 것만 지우기(스냅샷 뒤 다른 앱이 옮긴 메일은 실패로 센다) → 성공 id 를 {@link #localFlush} 개마다(끝에 남은 것도) {@code
   * sink.erasedGraph}. 토큰은 쪽·묶음마다 받는다(긴 작업 중 만료되면 갱신된다).
   *
   * <p>멈추는 길: 지운 편지함 id·목록 GET 실패는 {@code SERVER_UNREACHABLE}(아무것도 지우지 않았다). batch 최상위 실패를 다시 보내고도
   * 넘지 못하면 그 묶음의 남은 항목과 뒤 묶음을 실패로 세고 {@code SERVER_UNREACHABLE} — 그래서 {@code deleted + failed ==
   * total} 이 된다. 묶음 사이 인터럽트·대기 중 인터럽트(앱 종료)는 인터럽트 표시를 되살리고 {@code INTERRUPTED}. 멈출 때도 이미 지운 id 는 먼저
   * 로컬에 반영한다. 비우는 도중 계정 연결이 해제되면(토큰 조회에 계정이 없다) {@code ACCOUNT_GONE}. 저장된 토큰을 읽지 못하면(WP-1907) 다시
   * 보내지 않고 {@code MailCredentialUnreadableException} 을 그대로 던진다 — 도중이면 남은 항목을 실패로 세어 {@code deleted
   * + failed == total} 을 지킨다.
   */
  @Override
  public void emptyTrash(
      long userId, EmailAccountResponse account, TrashRef trash, EmptySink sink) {
    long accountId = account.id();
    String trashFolderId = emptyTrashFolderId(userId, accountId);
    List<String> ids = snapshotIds(userId, accountId);
    sink.snapshot(ids.size());
    List<String> erased = new ArrayList<>(); // 서버에서 지웠고 아직 로컬에 반영하지 않은 id
    for (int from = 0; from < ids.size(); from += BATCH) {
      if (Thread.currentThread().isInterrupted()) {
        throw interrupted(sink, erased);
      }
      int to = Math.min(from + BATCH, ids.size());
      boolean reachable;
      try {
        reachable =
            eraseChunk(userId, accountId, trashFolderId, ids.subList(from, to), erased, sink);
      } catch (InterruptedException e) {
        throw interrupted(sink, erased);
      } catch (MailCredentialUnreadableException e) {
        // 도중에 토큰을 읽지 못했다(refresh 토큰이 깨짐) — 연결 실패가 아닌 OAUTH_TOKEN_UNREADABLE 로 멈추게 그대로 던진다
        stopAfter(to, ids.size(), erased, sink);
        throw e;
      }
      if (!reachable) {
        stopAfter(to, ids.size(), erased, sink);
        throw MailTrashException.of(MailTrashException.SERVER_UNREACHABLE);
      }
      while (erased.size() >= localFlush) {
        List<String> head = erased.subList(0, localFlush);
        sink.erasedGraph(List.copyOf(head));
        head.clear();
      }
    }
    flush(sink, erased);
  }

  /**
   * 묶음 도중 멈출 때의 정리 — 이 묶음의 남은 항목은 eraseChunk 가 이미 셌다. 지운 것은 로컬에 반영하고 뒤 묶음을 실패로 세어 {@code deleted +
   * failed == total} 을 지킨다(연결 실패·토큰 읽기 실패가 함께 쓴다).
   */
  private void stopAfter(int to, int total, List<String> erased, EmptySink sink) {
    flush(sink, erased);
    if (to < total) {
      sink.failed(total - to);
    }
  }

  /**
   * 비우기의 지운 편지함 id — 실행마다 한 번 받는다. 실패는 아무것도 지우기 전이라 {@code SERVER_UNREACHABLE}(인터럽트로 끊겼으면 {@code
   * INTERRUPTED}), 계정이 그새 해제됐으면 {@code ACCOUNT_GONE}.
   */
  private String emptyTrashFolderId(long userId, long accountId) {
    try {
      return trashFolderId(token(userId, accountId));
    } catch (MailCredentialUnreadableException e) {
      // 토큰을 읽지 못함은 접속 실패가 아니다 — 서버 호출 전이고 아무것도 지우지 않았다. 그대로 던져 작업이 OAUTH_TOKEN_UNREADABLE 로 멈추게 한다
      throw e;
    } catch (MailSyncException e) {
      log.warn("Graph 지운 편지함 id 조회 실패: accountId={} {}", accountId, e.getClass().getSimpleName());
      throw unreachableOrInterrupted();
    }
  }

  /**
   * 시작 순간 지운 편지함의 모든 메시지 id — 첫 쪽부터 {@code nextLink} 를 끝까지 따른다. 쪽이 넘어가는 사이 같은 메일이 두 번 실릴 수 있어 한 번만
   * 센다. 실패는 아무것도 지우기 전이라 {@code SERVER_UNREACHABLE}(인터럽트로 끊겼으면 {@code INTERRUPTED}).
   */
  private List<String> snapshotIds(long userId, long accountId) {
    // 받은 순서대로 목록에 한 번만 담는다(seen 은 중복 확인용) — 끝에 다시 복사하지 않는다
    List<String> ids = new ArrayList<>();
    Set<String> seen = new HashSet<>();
    String next = TRASH_MESSAGES + "?$select=id&$top=" + pageSize;
    try {
      while (next != null) {
        if (Thread.currentThread().isInterrupted()) {
          throw MailTrashException.of(MailTrashException.INTERRUPTED);
        }
        GraphMessageIdPage page =
            graphApiClient.get(token(userId, accountId), next, GraphMessageIdPage.class);
        if (page == null) {
          break;
        }
        if (page.value() != null) {
          for (GraphMessageIdPage.Item it : page.value()) {
            if (it != null && it.id() != null && seen.add(it.id())) {
              ids.add(it.id());
            }
          }
        }
        next = page.nextLink();
      }
    } catch (MailCredentialUnreadableException e) {
      // 토큰을 읽지 못함은 접속 실패가 아니다 — 서버 호출 전이고 아무것도 지우지 않았다. 그대로 던져 작업이 OAUTH_TOKEN_UNREADABLE 로 멈추게 한다
      throw e;
    } catch (MailSyncException e) {
      log.warn("Graph 휴지통 id 목록 실패: accountId={} {}", accountId, e.getClass().getSimpleName());
      throw unreachableOrInterrupted();
    }
    return ids;
  }

  /**
   * 지우기 전 GET(지운 편지함 id·id 목록)이 실패했을 때의 멈춤 사유 — 인터럽트로 끊겼으면(앱 종료) {@code INTERRUPTED}, 아니면 {@code
   * SERVER_UNREACHABLE}. 둘 다 아무것도 지우기 전이다.
   */
  private static MailTrashException unreachableOrInterrupted() {
    return MailTrashException.of(
        Thread.currentThread().isInterrupted()
            ? MailTrashException.INTERRUPTED
            : MailTrashException.SERVER_UNREACHABLE);
  }

  /**
   * 한 묶음을 지운다 — ① 지금 위치 확인 GET 으로 지운 편지함에 남은 메일만 고르고(404 는 이미 없어 지운 것, 다른 메일함에 있거나 확인 실패면 실패) ② 그
   * 메일만 permanentDelete. 성공 id 는 erased 에 더하고, 실패는 그때그때 {@code sink.failed} 로 센다(인터럽트로 빠져나가도 센 것이
   * 남는다). 두 단계 모두 같은 재시도({@link #sendWithItemRetry})를 거친다.
   *
   * @return batch 최상위 실패를 다시 보내기로도 넘지 못했으면 false(그 묶음의 아직 결과 없는 항목은 실패로 셌다)
   * @throws InterruptedException 대기 중 인터럽트
   */
  private boolean eraseChunk(
      long userId,
      long accountId,
      String trashFolderId,
      List<String> chunk,
      List<String> erased,
      EmptySink sink)
      throws InterruptedException {
    List<String> inTrash = new ArrayList<>();
    ItemVerdict located =
        (pid, r) -> {
          if (r.status() == 404) {
            erased.add(pid); // 다른 곳에서 이미 지웠다 — 목표 상태
            return true;
          }
          if (inFolder(r, trashFolderId)) {
            inTrash.add(pid);
            return true;
          }
          return false; // 스냅샷 뒤 다른 메일함으로 옮겨졌거나 확인 실패 — 지우지 않는다
        };
    boolean reachable;
    try {
      reachable =
          sendWithItemRetry(
              userId, accountId, chunk, GraphMailEraser::locateRequest, located, sink);
    } catch (MailCredentialUnreadableException e) {
      sink.failed(inTrash.size()); // 확인은 마쳤지만 토큰을 읽지 못해 지우지 못했다
      throw e;
    }
    if (!reachable) {
      sink.failed(inTrash.size()); // 확인은 마쳤지만 지우지 못했다
      return false;
    }
    if (inTrash.isEmpty()) {
      return true;
    }
    return sendWithItemRetry(
        userId,
        accountId,
        inTrash,
        GraphMailEraser::permanentDeleteRequest,
        (pid, r) -> {
          if (erased(r)) {
            erased.add(pid);
            return true;
          }
          return false;
        },
        sink);
  }

  /** 항목 최종 응답(다시 보낼 상태가 아닌 것)을 판정한다 — false 면 그 항목은 실패로 센다. */
  @FunctionalInterface
  private interface ItemVerdict {
    boolean accept(String providerId, GraphBatchResponse response);
  }

  /**
   * 비우기의 한 단계 batch 를 보낸다 — 항목 429·503·504 는 그 항목들의 Retry-After 최댓값(없으면 5초, 30초 상한)만큼 기다려 그 항목만 다시
   * 보낸다(처음 보낸 뒤 최대 {@link #ITEM_RETRY_MAX}번, 그래도 안 되면 실패). 그 밖 응답은 verdict 가 판정하고, 응답에 빠진 항목은 결과를
   * 몰라 실패다. 실패는 그때그때 {@code sink.failed} 로 센다.
   *
   * @param request (요청 id, Graph 메시지 id) → batch 요청 한 건
   * @return batch 최상위 실패를 다시 보내기로도 넘지 못했으면 false(아직 결과 없는 항목은 실패로 셌다)
   * @throws InterruptedException 대기 중 인터럽트
   */
  private boolean sendWithItemRetry(
      long userId,
      long accountId,
      List<String> ids,
      BiFunction<String, String, GraphBatchRequest> request,
      ItemVerdict verdict,
      EmptySink sink)
      throws InterruptedException {
    List<String> pending = ids;
    for (int retries = 0; ; retries++) {
      // 요청 id 는 묶음 안 순번 — Graph id 는 길어 짝짓기 키로 순번을 쓴다
      Map<String, String> providerIdByReqId = new LinkedHashMap<>();
      for (int i = 0; i < pending.size(); i++) {
        providerIdByReqId.put(String.valueOf(i), pending.get(i));
      }
      List<GraphBatchResponse> responses;
      try {
        responses = sendWithTopRetry(userId, accountId, requests(providerIdByReqId, request));
      } catch (MailCredentialUnreadableException e) {
        // 토큰을 읽지 못해 이 단계의 남은 항목은 결과가 없다 — 실패로 세어 deleted + failed == total 을 지킨 뒤 던진다
        sink.failed(pending.size());
        throw e;
      }
      if (responses == null) {
        sink.failed(pending.size());
        return false;
      }
      List<String> retry = new ArrayList<>();
      Duration wait = Duration.ZERO;
      int failed = 0;
      for (GraphBatchResponse r : responses) {
        String pid = providerIdByReqId.remove(r.id());
        if (pid == null) {
          continue;
        }
        if (RETRYABLE.contains(r.status())) {
          retry.add(pid);
          Duration d = retryDelay(r.retryAfterSeconds());
          wait = d.compareTo(wait) > 0 ? d : wait;
        } else if (!verdict.accept(pid, r)) {
          failed++;
        }
      }
      failed += providerIdByReqId.size(); // 응답에 빠진 항목
      if (!retry.isEmpty() && retries >= ITEM_RETRY_MAX) {
        failed += retry.size(); // 처음 + 다시 3번을 모두 조절·장애로 돌려받았다
        retry.clear();
      }
      if (failed > 0) {
        sink.failed(failed);
      }
      if (retry.isEmpty()) {
        return true;
      }
      pauser.pause(wait);
      pending = retry;
    }
  }

  /**
   * 비우기 batch(위치 확인·permanentDelete)를 보낸다. 최상위 실패(429·5xx·네트워크 — {@code MailSendException})나 토큰 갱신
   * 실패({@code MailSyncException})면 {@link #TOP_RETRY_DELAYS} 만큼 차례로 기다려 다시 보내고, 네 번째도 실패하면 null.
   * 토큰은 보낼 때마다 받는다.
   *
   * @throws InterruptedException 대기 중 인터럽트, 또는 요청이 인터럽트로 끊겼다
   */
  private List<GraphBatchResponse> sendWithTopRetry(
      long userId, long accountId, List<GraphBatchRequest> reqs) throws InterruptedException {
    for (int attempt = 0; ; attempt++) {
      try {
        return graphApiClient.batch(token(userId, accountId), reqs);
      } catch (MailCredentialUnreadableException e) {
        // 저장된 토큰을 읽지 못함은 다시 보내도 낫지 않는다(접속 실패가 아니다) — 기다리지 않고 바로 던져 작업이 OAUTH_TOKEN_UNREADABLE 로 멈추게
        // 한다
        throw e;
      } catch (MailSendException | MailSyncException e) {
        if (Thread.interrupted()) {
          // 클라이언트가 인터럽트로 끊긴 요청을 실패로 바꿔 던졌다 — 연결 실패가 아니라 종료다
          throw new InterruptedException();
        }
        if (attempt >= TOP_RETRY_DELAYS.size()) {
          log.warn(
              "Graph 휴지통 비우기 batch 다시 보내기 소진: accountId={} {}",
              accountId,
              e.getClass().getSimpleName());
          return null;
        }
        log.warn(
            "Graph 휴지통 비우기 batch 실패 — 다시 보냄: accountId={} attempt={} {}",
            accountId,
            attempt + 1,
            e.getClass().getSimpleName());
        pauser.pause(TOP_RETRY_DELAYS.get(attempt));
      }
    }
  }

  /** 비우기용 토큰 — 계정이 그새 해제돼 조회되지 않으면 {@code ACCOUNT_GONE} 으로 멈춘다. */
  private String token(long userId, long accountId) {
    try {
      return tokenService.getAccessToken(userId, accountId);
    } catch (EmailAccountNotFoundException e) {
      throw MailTrashException.of(MailTrashException.ACCOUNT_GONE);
    }
  }

  /**
   * 인터럽트로 멈춘다 — 이미 지운 id 를 로컬에 반영한 뒤 인터럽트 표시를 되살린다. 반영(DB)은 인터럽트 표시가 없는 상태에서 한다(커넥션 풀 대기가 인터럽트로
   * 실패하지 않게).
   */
  private MailTrashException interrupted(EmptySink sink, List<String> erased) {
    Thread.interrupted();
    try {
      flush(sink, erased);
    } finally {
      Thread.currentThread().interrupt();
    }
    return MailTrashException.of(MailTrashException.INTERRUPTED);
  }

  /** 아직 반영하지 않은 성공 id 를 모두 sink 로 넘긴다. */
  private static void flush(EmptySink sink, List<String> erased) {
    if (!erased.isEmpty()) {
      sink.erasedGraph(List.copyOf(erased));
      erased.clear();
    }
  }

  /**
   * batch 요청 묶음 — 넣은 순서대로 (요청 id, Graph 메시지 id) 마다 한 건.
   *
   * @param providerIdByReqId 요청 id → Graph 메시지 id
   */
  private static List<GraphBatchRequest> requests(
      Map<String, String> providerIdByReqId,
      BiFunction<String, String, GraphBatchRequest> request) {
    return providerIdByReqId.entrySet().stream()
        .map(e -> request.apply(e.getKey(), e.getValue()))
        .toList();
  }

  /** 메일이 지금 든 메일함 확인 — 본문 없는 GET(parentFolderId 만). 한 통 지우기와 비우기가 같이 쓴다. */
  private static GraphBatchRequest locateRequest(String reqId, String providerId) {
    return new GraphBatchRequest(
        reqId, "GET", "/me/messages/" + providerId + "?$select=id,parentFolderId", null);
  }

  /**
   * permanentDelete 요청 — 한 통 지우기와 비우기가 같은 요청(폴더 범위 URL·POST·본문 {@code {}})을 쓴다. 본문은 없어도 되지만 POST 라
   * Content-Type 과 함께 빈 객체를 싣는다.
   */
  private static GraphBatchRequest permanentDeleteRequest(String reqId, String providerId) {
    return new GraphBatchRequest(
        reqId, "POST", TRASH_MESSAGES + "/" + providerId + "/permanentDelete", Map.of());
  }

  /** 확인 응답이 2xx 이고 메일이 지운 편지함(trashFolderId)에 있는지. */
  private static boolean inFolder(GraphBatchResponse r, String trashFolderId) {
    return r.ok()
        && r.body() != null
        && trashFolderId.equals(r.body().path("parentFolderId").asString(""));
  }

  /** 지운 것으로 보는 항목 응답 — 2xx, 또는 404(다른 곳에서 이미 지웠다 — 목표 상태). */
  private static boolean erased(GraphBatchResponse r) {
    return r.ok() || r.status() == 404;
  }

  /** 항목 재시도 대기 — Retry-After(초)가 없으면 5초, 30초 상한. */
  private static Duration retryDelay(Integer retryAfterSeconds) {
    Duration d =
        retryAfterSeconds == null ? DEFAULT_RETRY_AFTER : Duration.ofSeconds(retryAfterSeconds);
    return d.compareTo(MAX_RETRY_AFTER) > 0 ? MAX_RETRY_AFTER : d;
  }
}
