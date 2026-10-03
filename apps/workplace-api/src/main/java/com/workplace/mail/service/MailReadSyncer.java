package com.workplace.mail.service;

import com.workplace.mail.dto.EmailAccountResponse;
import com.workplace.mail.dto.MailProvider;
import com.workplace.mail.dto.SeenSyncItem;
import com.workplace.mail.dto.SeenSyncResult;
import java.util.List;

/**
 * 로컬 읽음 상태를 원본 서버(Graph/IMAP)에 역동기화하는 공급자별 인터페이스(WP-187 일반화).
 *
 * <p>계약: 받은 항목의 seen(처리 시점 DB 값)을 서버에 맞춘다. 재시도로 나아질 수 있는 전체 실패(접속·인증 등)는 예외로 던지고(호출 측이 그 묶음 전체의 대기
 * 표시를 유지), 항목별 결과와 "이후 처리 중단(429·장애)" 여부는 {@link SeenSyncResult} 로 돌려준다. 다시 해도 안 되는 항목(서버 식별자·비밀번호
 * 없음, 서버에 메일 없음)은 성공으로 본다 — 남길 이유가 없다.
 */
public interface MailReadSyncer {

  /** 이 구현체가 처리하는 메일 공급자. */
  MailProvider provider();

  /**
   * 원본 서버에 항목별 읽음/안읽음을 반영한다.
   *
   * @param userId 현재 사용자 id (Graph 토큰·IMAP 비밀번호 조회에 사용)
   * @param account 메일 계정 응답 DTO (IMAP 접속 정보 — Graph 구현은 무시 가능)
   * @param items 같은 계정의 반영 대기 항목(처리 시점 seen 포함)
   * @return 반영이 끝난 메일 id 와 중단 여부
   * @throws Exception 묶음 전체가 실패(네트워크·인증 등) — 호출 측이 대기 표시를 유지한다
   */
  SeenSyncResult syncSeen(long userId, EmailAccountResponse account, List<SeenSyncItem> items)
      throws Exception;
}
