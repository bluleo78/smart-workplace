package com.workplace.mail.service.folder;

import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.stereotype.Component;

/**
 * 메일함별 동기화 동시 실행 가드(WP-960) — (계정, 폴더) 단위 인메모리 점유. 같은 메일함을 두 번 겹쳐 가져오면 같은 UID 범위를 두 번 받고 커서 저장이
 * 엇갈리므로 막는다. 계정 단위 동기화 가드({@code MailSyncProgress})와는 별개라 받은편지함 동기화와 메일함 동기화는 함께 돌 수 있다(서로 다른 폴더 행만
 * 쓴다). 인스턴스 로컬 가드라 여러 API 인스턴스 사이의 겹침은 막지 못한다 — 겹쳐도 넣기가 멱등이라 결과는 같다.
 */
@Component
public class MailFolderSyncGuard {

  private final Set<String> running = ConcurrentHashMap.newKeySet();

  /** 점유를 시도한다. 이미 진행 중이면 false. */
  public boolean tryStart(long accountId, long folderId) {
    return running.add(key(accountId, folderId));
  }

  /** 점유를 푼다. */
  public void finish(long accountId, long folderId) {
    running.remove(key(accountId, folderId));
  }

  private static String key(long accountId, long folderId) {
    return accountId + ":" + folderId;
  }
}
