// 간단한 비동기 카운팅 세마포어. 동시에 슬롯을 점유할 수 있는 수를 limit 개로 제한한다.
// acquire()/release() 를 반드시 짝으로 호출한다(try/finally 권장). release 는 대기자가 있으면
// 가용 슬롯을 되돌리지 않고 대기자에게 직접 넘겨 FIFO 순서를 보장한다.
export class Semaphore {
  private available: number;
  private readonly waiters: Array<() => void> = [];

  constructor(limit: number) {
    // 0 이하로 설정되면(오설정 방어) 최소 1 을 보장 — 0 이면 영구 교착이 되기 때문.
    this.available = Math.max(1, Math.floor(limit));
  }

  // 대기 없이 슬롯 획득을 시도한다. 성공하면 true(슬롯 1 소비), 없으면 false(아무 변화 없음).
  tryAcquire(): boolean {
    if (this.available > 0) {
      this.available -= 1;
      return true;
    }
    return false;
  }

  // 슬롯을 획득한다. 남은 슬롯이 있으면 즉시, 없으면 누군가 release 할 때까지 대기한다.
  async acquire(): Promise<void> {
    if (this.available > 0) {
      this.available -= 1;
      return;
    }
    await new Promise<void>((resolve) => this.waiters.push(resolve));
    // 여기 도달했다는 것은 release 가 이 대기자에게 슬롯을 직접 넘겼다는 뜻 — available 은 건드리지 않음.
  }

  // 슬롯을 반납한다. 대기자가 있으면 그 슬롯을 그대로 넘기고, 없으면 가용 슬롯을 늘린다.
  release(): void {
    const next = this.waiters.shift();
    if (next) {
      next();
    } else {
      this.available += 1;
    }
  }

  // 관측/테스트용.
  get availableSlots(): number {
    return this.available;
  }
  get queuedCount(): number {
    return this.waiters.length;
  }
}
