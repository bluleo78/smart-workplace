// AI 처리 기록 묶음 전송기 (WP-1828).
// 범위가 만든 레코드를 메모리 버퍼에 모아 100건 또는 2초마다 API 로 묶어 보낸다. 기록은 부가 기능이라
// 전송 실패·버퍼 초과가 응답 경로를 절대 막거나 깨뜨리지 않게, 모든 오류를 안에서 삼키고 로그만 남긴다.
import { errorMessage } from './scope.js';
import type { AiRunRecord, AiRunSink } from './types.js';

export interface AiRunReporterOptions {
  /** 묶음을 API 로 보내는 함수. reject·동기 throw 모두 이 클래스가 처리한다. */
  send: (runs: AiRunRecord[]) => Promise<unknown>;
  /** 버퍼 상한 — 넘으면 가장 오래된 것부터 버린다. 기본 2000. */
  maxBuffer?: number;
  /** 이 건수에 닿으면 바로 비우기 시작한다. 기본 100. */
  batchSize?: number;
  /** 한 요청에 실을 최대 건수. 기본 500. */
  maxPerRequest?: number;
  /** 주기 비우기 간격(ms). 기본 2000. */
  intervalMs?: number;
  /** 경고 로그 — 기본 console.warn. */
  log?: (m: string) => void;
}

export class AiRunReporter implements AiRunSink {
  private buffer: AiRunRecord[] = [];
  private timer: NodeJS.Timeout | undefined;
  /** 진행 중인 flush — 동시 호출이 같은 레코드를 두 번 보내지 않게 재사용한다. */
  private flushing: Promise<void> | undefined;
  /** 직전 flush 이후 상한 초과로 버린 건수 — 레코드마다 경고하면 폭주 때 로그가 넘쳐 flush 주기마다 한 번만 알린다. */
  private overflowDropped = 0;

  private readonly send: (runs: AiRunRecord[]) => Promise<unknown>;
  private readonly maxBuffer: number;
  private readonly batchSize: number;
  private readonly maxPerRequest: number;
  private readonly intervalMs: number;
  private readonly log: (m: string) => void;

  constructor(opts: AiRunReporterOptions) {
    this.send = opts.send;
    this.maxBuffer = opts.maxBuffer ?? 2000;
    this.batchSize = opts.batchSize ?? 100;
    this.maxPerRequest = opts.maxPerRequest ?? 500;
    this.intervalMs = opts.intervalMs ?? 2000;
    this.log = opts.log ?? ((m) => console.warn(m));
  }

  /** 버퍼에 쌓인 건수. */
  get size(): number {
    return this.buffer.length;
  }

  /** 레코드를 버퍼에 넣는다. 테넌트를 모르면 API 가 받지 않으므로 넣지 않는다. 절대 throw·대기하지 않는다. */
  enqueue(record: AiRunRecord): void {
    try {
      if (record.tenantId == null) return;
      this.buffer.push(record);
      if (this.buffer.length > this.maxBuffer) {
        this.buffer.shift();
        this.overflowDropped++;
      }
      if (this.buffer.length >= this.batchSize && !this.flushing) void this.flush();
    } catch {
      // 기록은 부가 기능 — 응답 경로에 영향 없게 삼킨다.
    }
  }

  /** 버퍼가 빌 때까지 maxPerRequest 건씩 보낸다. 동시에 하나만 돌고, 진행 중이면 그 promise 를 쓴다. throw 하지 않는다. */
  async flush(): Promise<void> {
    // 보낼 것도 진행 중인 것도 없으면 빈 drain 을 만들지 않는다.
    if (this.buffer.length === 0 && !this.flushing) return;
    // 진행 중 flush 가 끝난 직후 finally 가 flushing 을 비우기 전 틈에 들어온 레코드가 남을 수 있어,
    // 버퍼가 빌 때까지 다시 돈다 — 종료 때 flush() 한 번이 모든 것을 보내도록 보장한다(WP-1828).
    do {
      if (!this.flushing) {
        this.flushing = this.drain().finally(() => {
          this.flushing = undefined;
        });
      }
      await this.flushing;
    } while (this.buffer.length > 0);
  }

  /** log 가 throw 해도 flush 가 reject 되지 않게 감싼다. */
  private warn(m: string): void {
    try {
      this.log(m);
    } catch {
      // 로그 실패는 무시한다.
    }
  }

  private async drain(): Promise<void> {
    if (this.overflowDropped > 0) {
      const n = this.overflowDropped;
      this.overflowDropped = 0;
      this.warn(`[ai-run] 버퍼 상한(${this.maxBuffer}) 초과로 오래된 기록 ${n}건을 버렸다`);
    }
    while (this.buffer.length > 0) {
      const batch = this.buffer.splice(0, this.maxPerRequest);
      try {
        await this.send(batch);
      } catch (e) {
        // 재시도 없이 그 묶음을 버린다 — 실패 묶음당 한 번만 알린다.
        this.warn(`[ai-run] 기록 ${batch.length}건 전송 실패, 버림: ${errorMessage(e)}`);
      }
    }
  }

  /** 주기 비우기를 시작한다. unref 해 이 타이머가 프로세스 종료를 막지 않게 한다. */
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.flush(), this.intervalMs);
    this.timer.unref();
  }

  /** 주기 비우기를 멈춘다. */
  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }
}
