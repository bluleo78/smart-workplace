package com.workplace.mail.service.trash;

import com.workplace.mail.dto.EmailAccountResponse;
import com.workplace.mail.dto.MailProvider;
import java.util.List;

/**
 * 공급자별 서버 휴지통 메일 완전히 삭제(WP-1682) — {@code MailMover} 와 나란한 인터페이스. DB 를 쓰지 않고 서버(IMAP·Graph)에서만 지운 뒤
 * 메일별 결과를 돌려준다 — 로컬 반영은 {@link MailTrashService} 가 한 트랜잭션으로 한다. 휴지통 비우기({@link #emptyTrash})는 묶음마다
 * {@link EmptySink} 로 넘겨 {@link MailTrashEmptyJob} 이 반영한다. 네트워크 I/O 라 DB 트랜잭션 밖에서 부른다.
 */
public interface MailEraser {

  /** 이 구현이 담당하는 공급자. */
  MailProvider provider();

  /**
   * 휴지통 메일들을 서버에서 완전히 지운다. 트랜잭션 밖에서 부른다. 서버에 이미 없는 메일은 성공(목표 상태 — 다른 곳에서 이미 지웠다).
   *
   * @return 요청한 메일마다 결과 한 건(순서 무관)
   * @throws com.workplace.mail.exception.MailSyncException 서버 접속 자체가 실패(아무것도 지우지 않았다)
   * @throws com.workplace.mail.exception.MailTrashException 서버가 골라 지우기를 지원하지 않음({@code
   *     PERMANENT_DELETE_UNSUPPORTED}, 아무 플래그도 건드리지 않았다)
   */
  List<Outcome> erase(long userId, EmailAccountResponse account, TrashRef trash, List<Item> items);

  /**
   * 서버 휴지통의 실제 메일 수(WP-1708) — 휴지통 비우기 확인 창이 로컬 목록의 낡은 수 대신 이 값을 보여 주게 한다. 앱이 가져오지 않은 옛 메일도 센다. 읽기만
   * 하므로 아무것도 지우지 않는다. 네트워크 I/O 라 트랜잭션 밖에서 부른다.
   *
   * @throws com.workplace.mail.exception.MailSyncException 서버 접속·조회 실패 — 수를 얻지 못했으므로 호출자는 로컬 값으로
   *     대신하지 않는다
   */
  int countTrash(long userId, EmailAccountResponse account, TrashRef trash);

  /**
   * 서버 휴지통 바로 아래의 모든 메일(앱이 가져오지 않은 30일 지난 메일 포함)을 묶음씩 완전히 지운다(휴지통 비우기). 실행기 스레드에서 트랜잭션 밖으로 부른다.
   * 진행·로컬 반영은 묶음마다 sink 로 넘긴다 — 로컬 행 삭제는 sink(작업)가 짧은 트랜잭션으로 한다. 한 묶음의 명령 실패는 {@link
   * EmptySink#failed} 로 세고 다음 묶음으로 간다.
   *
   * @throws com.workplace.mail.exception.MailTrashException 중간에 멈춤 — 코드({@code
   *     PERMANENT_DELETE_UNSUPPORTED}·{@code TRASH_CHANGED}·{@code SERVER_UNREACHABLE}·{@code
   *     INTERRUPTED}·{@code ACCOUNT_GONE})가 FAILED 사유다. 그 전에 sink 로 넘긴 묶음은 이미 반영돼 있다.
   */
  void emptyTrash(long userId, EmailAccountResponse account, TrashRef trash, EmptySink sink);

  /** 휴지통 비우기의 진행·로컬 반영을 받는 쪽({@code MailTrashEmptyJob}). 지우개는 서버 일만 하고 DB·진행 상태는 이쪽이 맡는다. */
  interface EmptySink {

    /** 시작 때 센 서버 휴지통 메일 수. */
    void snapshot(int total);

    /**
     * IMAP 한 묶음을 서버에서 지웠다(이미 없던 UID 포함 — 목표 상태). 로컬 반영은 sink 가 휴지통 행의 UIDVALIDITY 가 서버 값과 같을 때만 한다.
     *
     * @param serverUidValidity 지운 휴지통의 서버 UIDVALIDITY
     * @param uids 지운 UID 들
     */
    void erasedImap(long serverUidValidity, List<Long> uids);

    /** Graph 메일들을 서버에서 지웠다(이미 없던 것 포함). */
    void erasedGraph(List<String> providerIds);

    /** 지우지 못한 메일 수. */
    void failed(int count);
  }

  /**
   * 계정의 휴지통 행(지난 목록 갱신 때 고른 것).
   *
   * @param folderId 휴지통 email_folder id
   * @param name 휴지통 이름(IMAP 은 폴더를 여는 전체 경로) — 지금 서버 휴지통과 다르면 지우지 않는다
   * @param uidValidity 휴지통 행에 기록된 IMAP UIDVALIDITY(아직 가져오지 않았으면 null — 그때는 UID 를 믿을 수 없어 지우지 않는다)
   */
  record TrashRef(long folderId, String name, Long uidValidity) {}

  /**
   * 지울 메일 한 통.
   *
   * @param imapUid 휴지통 안 IMAP UID(서버 위치를 모르면 null)
   * @param providerMessageId Graph 메시지 id
   */
  record Item(long messageId, Long imapUid, String providerMessageId) {}

  /**
   * 메일 한 통 결과.
   *
   * @param ok 서버에서 지웠거나 이미 없었는지
   * @param error 실패 사유 문구(성공이면 null)
   */
  record Outcome(long messageId, boolean ok, String error) {

    static Outcome ok(long messageId) {
      return new Outcome(messageId, true, null);
    }

    static Outcome failed(long messageId, String error) {
      return new Outcome(messageId, false, error);
    }
  }
}
