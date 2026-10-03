package com.workplace.mail.service;

import com.workplace.mail.dto.EmailAccountResponse;
import com.workplace.mail.dto.MailProvider;
import com.workplace.mail.dto.SeenSyncItem;
import com.workplace.mail.dto.SeenSyncResult;
import java.util.List;

/**
 * 로컬 읽음 상태를 원본 서버(Graph/IMAP)에 역동기화하는 공급자별 인터페이스(WP-187 일반화).
 *
 * <p>WP-215: 디스패치(이벤트) 1회에 {@link #open} 으로 세션 하나를 열어 조각끼리 재사용한다. 자격(토큰·비밀번호) 조회는 RLS 스코프라 {@link
 * #open} 은 호출 측 트랜잭션(테넌트 GUC) 안에서 부르고, 원격 반영({@link Session#push})은 DB 커넥션을 잡지 않도록 트랜잭션 밖에서 부른다.
 *
 * <p>계약: 받은 항목의 seen(처리 시점 DB 값)을 서버에 맞춘다. 재시도로 나아질 수 있는 전체 실패(접속·인증 등)는 예외로 던지고(호출 측이 그 묶음 전체의 대기
 * 표시를 유지), 항목별 결과와 "이후 처리 중단(429·장애)" 여부는 {@link SeenSyncResult} 로 돌려준다. 다시 해도 안 되는 항목(서버 식별자·비밀번호
 * 없음, 서버에 메일 없음)은 성공으로 본다 — 남길 이유가 없다.
 */
public interface MailReadSyncer {

  /** 이 구현체가 처리하는 메일 공급자. */
  MailProvider provider();

  /**
   * 디스패치 1회 동안 쓸 반영 세션을 연다 — 자격만 준비하고 원격 접속은 하지 않는다(접속은 첫 push 때, 트랜잭션 밖에서).
   *
   * @param userId 현재 사용자 id (Graph 토큰·IMAP 비밀번호 조회에 사용)
   * @param account 메일 계정 응답 DTO (계정 id·IMAP 접속 정보)
   */
  Session open(long userId, EmailAccountResponse account);

  /** 한 계정의 반영 세션. 조각마다 {@link #push} 를 부르고, 디스패치가 끝나면 {@link #close} 로 연결을 정리한다. */
  interface Session extends AutoCloseable {

    /**
     * 원본 서버에 항목별 읽음/안읽음을 반영한다. 트랜잭션 밖에서 불린다 — DB 를 읽지 않는다.
     *
     * @param items 같은 계정의 반영 대기 항목(처리 시점 seen 포함)
     * @return 반영이 끝난 메일 id 와 중단 여부
     * @throws Exception 묶음 전체가 실패(네트워크·인증 등) — 호출 측이 대기 표시를 유지한다
     */
    SeenSyncResult push(List<SeenSyncItem> items) throws Exception;

    /**
     * 자격이 오래돼 다시 열어야 하는지. 호출 측은 push 전에 확인해 true 면 닫고 {@link MailReadSyncer#open} 으로 새로 연다(트랜잭션 안).
     * 기본은 디스패치 내내 유효하다.
     */
    default boolean stale() {
      return false;
    }

    /** 열린 원격 연결 정리. 연결이 없으면 아무것도 하지 않는다. */
    @Override
    default void close() {}
  }
}
