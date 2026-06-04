package com.workplace.mail.service;

import com.workplace.mail.dto.MailSyncStatus;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.stereotype.Component;

/** 계정당 수동 동기화 진행 상태를 in-memory 로 보관 + 동시 실행 가드. 단일 인스턴스/현 프로세스 전제(재시작 시 초기화) — v1 단순화. */
@Component
public class MailSyncProgress {

  private enum Phase {
    LIST,
    BODIES,
    IDLE
  }

  private static final class State {
    volatile Phase phase = Phase.LIST;
    volatile int total = 0;
    volatile int done = 0;
    volatile boolean running = false;
  }

  private final ConcurrentHashMap<Long, State> byAccount = new ConcurrentHashMap<>();

  /** 동기화 시작 시도. 이미 진행 중이면 false(가드). 성공 시 running=true, phase=LIST 로 리셋. */
  public synchronized boolean tryStart(long accountId) {
    State s = byAccount.computeIfAbsent(accountId, k -> new State());
    if (s.running) {
      return false;
    }
    s.running = true;
    s.phase = Phase.LIST;
    s.total = 0;
    s.done = 0;
    return true;
  }

  /** 목록 단계 완료 → 본문 보충 단계 진입(total = 보충 대상 수). */
  public void startBodies(long accountId, int total) {
    State s = byAccount.get(accountId);
    if (s != null) {
      s.phase = Phase.BODIES;
      s.total = total;
      s.done = 0;
    }
  }

  /** 본문 1건 적재 완료. */
  public void incBody(long accountId) {
    State s = byAccount.get(accountId);
    if (s != null) {
      s.done++;
    }
  }

  /** 동기화/보충 종료 → IDLE, running=false. */
  public void finish(long accountId) {
    State s = byAccount.get(accountId);
    if (s != null) {
      s.phase = Phase.IDLE;
      s.running = false;
    }
  }

  /** 현재 상태 스냅샷. 없으면 IDLE. */
  public MailSyncStatus snapshot(long accountId) {
    State s = byAccount.get(accountId);
    if (s == null) {
      return new MailSyncStatus("IDLE", 0, 0, false);
    }
    return new MailSyncStatus(s.phase.name(), s.total, s.done, s.running);
  }
}
