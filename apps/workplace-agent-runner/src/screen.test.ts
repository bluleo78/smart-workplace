// 작업 화면 중계(WP-1277) — 가짜 Works 소켓·가짜 exec 로 붙기·출력·입력 막기·입력 허용 다시 붙기·창 고르기·끝내기를 본다.
import { describe, expect, it, vi } from 'vitest';
import type { Readable, Writable } from 'node:stream';
import { AGENT_SCREEN, execFailureReason, openScreen, openScreenCount, parseWindows, type ExecHandle, type PodExec, type ScreenSocket } from './screen.js';
import { screenSocketUrl } from './works/screenSocket.js';

const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

class FakeSocket implements ScreenSocket {
  sent: (Buffer | string)[] = [];
  closed: { code: number; reason: string } | null = null;
  private msg: ((d: Buffer, b: boolean) => void) | null = null;
  private closeCb: (() => void) | null = null;
  send(d: Buffer | string) {
    this.sent.push(d);
  }
  close(code: number, reason: string) {
    this.closed = { code, reason };
  }
  onMessage(cb: (d: Buffer, b: boolean) => void) {
    this.msg = cb;
  }
  onClose(cb: () => void) {
    this.closeCb = cb;
  }
  /** Works 에서 온 프레임 흉내 */
  text(o: unknown) {
    this.msg?.(Buffer.from(JSON.stringify(o)), false);
  }
  binary(s: string) {
    this.msg?.(Buffer.from(s), true);
  }
  remoteClose() {
    this.closeCb?.();
  }
  json() {
    return this.sent.filter((d): d is string => typeof d === 'string').map((d) => JSON.parse(d));
  }
}

interface Run {
  command: string[];
  stdin: Readable | null;
  stdout: Writable;
  tty: boolean;
  onExit: (e: string | null) => void;
  closed: boolean;
}

/** 가짜 exec — windows 는 정해 둔 출력, attach 는 열어 둔다(테스트가 stdout 에 쓰고 onExit 를 부른다). */
class FakeExec implements PodExec {
  runs: Run[] = [];
  windowsOut = '0\tWP\t240\t60\t1\n1\tevents\t240\t60\t0\n';
  failAttach: Error | null = null;
  async run(opts: Omit<Run, 'closed'> & { pod: string }): Promise<ExecHandle> {
    const r: Run = { ...opts, closed: false };
    this.runs.push(r);
    if (opts.command[1] === 'attach' && this.failAttach) throw this.failAttach;
    if (opts.command[1] === 'windows') {
      opts.stdout.write(Buffer.from(this.windowsOut));
      queueMicrotask(() => opts.onExit(null));
    }
    if (opts.command[1] === 'select') queueMicrotask(() => opts.onExit(null));
    return { close: () => (r.closed = true) };
  }
  attaches() {
    return this.runs.filter((r) => r.command[1] === 'attach');
  }
}

async function open(exec = new FakeExec(), pod: string | null = 'agent-7', allowInput = true) {
  const socket = new FakeSocket();
  await openScreen({ connect: async () => socket, exec, findAgentPod: async () => pod, log, allowInput, windowsIntervalMs: 60_000 }, { sessionId: 's-1', agentUserId: 7 });
  await new Promise((r) => setTimeout(r, 0));
  return { socket, exec };
}

describe('openScreen', () => {
  it('attachesReadOnlyAndRelaysOutputThenSendsStatusInputAndWindows', async () => {
    const { socket, exec } = await open();
    const [a] = exec.attaches();
    expect(a.command).toEqual([AGENT_SCREEN, 'attach', 's-1-1']);
    expect(a.tty).toBe(true);
    a.stdout.write(Buffer.from('hello'));
    expect(socket.sent.some((d) => Buffer.isBuffer(d) && d.toString() === 'hello')).toBe(true);
    const j = socket.json();
    expect(j).toContainEqual({ type: 'status', state: 'attached' });
    expect(j).toContainEqual({ type: 'input', enabled: false, allowed: true });
    expect(j).toContainEqual({
      type: 'windows',
      items: [
        { index: 0, name: 'WP', width: 240, height: 60, active: true },
        { index: 1, name: 'events', width: 240, height: 60, active: false },
      ],
    });
    socket.remoteClose();
  });

  it('dropsInputBytesWhileReadOnlyAndReattachesWithInputWhenEnabled', async () => {
    const { socket, exec } = await open();
    const first = exec.attaches()[0];
    const seen: string[] = [];
    first.stdin!.on('data', (c: Buffer) => seen.push(c.toString()));
    socket.binary('rm -rf /');
    await new Promise((r) => setTimeout(r, 0));
    expect(seen).toEqual([]);

    socket.text({ type: 'input', enabled: true });
    await new Promise((r) => setTimeout(r, 0));
    expect(first.closed).toBe(true);
    // 옛 exec 가 늦게 끝나도 새 화면을 닫지 않는다
    first.onExit(null);
    expect(socket.closed).toBeNull();
    const second = exec.attaches()[1];
    // 회차마다 다른 보기 세션 — 옛 exec 의 정리가 새 보기 세션을 지우지 않게
    expect(second.command).toEqual([AGENT_SCREEN, 'attach', 's-1-2', '--input']);
    const got: string[] = [];
    second.stdin!.on('data', (c: Buffer) => got.push(c.toString()));
    socket.binary('1\r');
    await new Promise((r) => setTimeout(r, 0));
    expect(got).toEqual(['1\r']);
    expect(socket.json()).toContainEqual({ type: 'input', enabled: true, allowed: true });
    socket.remoteClose();
  });

  it('refusesInputWhenLocationDoesNotAllowItAndStaysReadOnly', async () => {
    const { socket, exec } = await open(new FakeExec(), 'agent-7', false);
    expect(socket.json()).toContainEqual({ type: 'input', enabled: false, allowed: false });
    const first = exec.attaches()[0];
    const seen: string[] = [];
    first.stdin!.on('data', (c: Buffer) => seen.push(c.toString()));
    socket.text({ type: 'input', enabled: true });
    socket.binary('rm -rf /');
    await new Promise((r) => setTimeout(r, 0));
    expect(socket.json()).toContainEqual({ type: 'error', message: '이 실행 환경은 작업 화면 입력을 허용하지 않아요' });
    expect(exec.attaches()).toHaveLength(1);
    expect(first.closed).toBe(false);
    expect(seen).toEqual([]);
    socket.remoteClose();
  });

  it('selectsWindowInViewSessionAndRemembersItOnReattach', async () => {
    const { socket, exec } = await open();
    socket.text({ type: 'window', index: 1 });
    await new Promise((r) => setTimeout(r, 0));
    expect(exec.runs.some((r) => r.command.join(' ') === `${AGENT_SCREEN} select s-1-1 1`)).toBe(true);
    socket.text({ type: 'input', enabled: true });
    await new Promise((r) => setTimeout(r, 0));
    expect(exec.attaches()[1].command).toEqual([AGENT_SCREEN, 'attach', 's-1-2', '--input', '--window', '1']);
    // 모양이 틀린 제어 프레임은 무시
    socket.text({ type: 'window', index: -1 });
    socket.text({ type: 'window', index: '1; rm' });
    socket.remoteClose();
  });

  it('closesAnAttachThatResolvesAfterAnotherToggleOrClose', async () => {
    // attach 를 붙잡아 두는 exec — 테스트가 차례로 풀어 준다
    class SlowExec extends FakeExec {
      pending: (() => void)[] = [];
      async run(opts: Parameters<FakeExec['run']>[0]): Promise<ExecHandle> {
        if (opts.command[1] === 'attach' && this.runs.some((r) => r.command[1] === 'attach')) {
          await new Promise<void>((r) => this.pending.push(r));
        }
        return super.run(opts);
      }
    }
    const exec = new SlowExec();
    const { socket } = await open(exec);
    socket.text({ type: 'input', enabled: true });
    socket.text({ type: 'input', enabled: false });
    await new Promise((r) => setTimeout(r, 0));
    exec.pending.forEach((r) => r());
    await new Promise((r) => setTimeout(r, 0));
    const [first, second, third] = exec.attaches();
    expect(first.closed).toBe(true);
    // 늦게 풀린 두 번째(입력 켜기)는 이미 세 번째가 시작돼 바로 닫힌다
    expect(second.closed).toBe(true);
    expect(third.closed).toBe(false);
    expect(third.command).toEqual([AGENT_SCREEN, 'attach', 's-1-3']);
    socket.remoteClose();
    expect(third.closed).toBe(true);
    expect(openScreenCount()).toBe(0);
  });

  it('noticesWorksClosingWhileLookingUpThePod', async () => {
    const socket = new FakeSocket();
    const exec = new FakeExec();
    let found!: (p: string) => void;
    const done = openScreen(
      { connect: async () => socket, exec, findAgentPod: () => new Promise((r) => (found = r)), log, allowInput: false },
      { sessionId: 's-9', agentUserId: 7 },
    );
    await new Promise((r) => setTimeout(r, 0));
    socket.remoteClose();
    found('agent-7');
    await done;
    expect(exec.runs).toEqual([]);
    expect(openScreenCount()).toBe(0);
  });

  it('periodicWindowsPollSendsOnlyWhenTheListChanges', async () => {
    const socket = new FakeSocket();
    const exec = new FakeExec();
    await openScreen(
      { connect: async () => socket, exec, findAgentPod: async () => 'agent-7', log, allowInput: false, windowsIntervalMs: 5 },
      { sessionId: 's-w', agentUserId: 7 },
    );
    await new Promise((r) => setTimeout(r, 40));
    const windowsFrames = () => socket.json().filter((j) => j.type === 'windows').length;
    // 붙은 뒤 한 번 — 같은 목록이면 주기 조회가 다시 보내지 않는다
    expect(windowsFrames()).toBe(1);
    exec.windowsOut = '0\tWP\t240\t60\t1\n';
    await new Promise((r) => setTimeout(r, 40));
    expect(windowsFrames()).toBe(2);
    socket.remoteClose();
  });

  it('resizeEmitsTerminalSizeForTheExecTty', async () => {
    const { socket, exec } = await open();
    const term = exec.attaches()[0].stdout as Writable & { rows: number; columns: number };
    const sizes: string[] = [];
    term.on('resize', () => sizes.push(`${term.columns}x${term.rows}`));
    socket.text({ type: 'resize', cols: 132, rows: 40 });
    socket.text({ type: 'resize', cols: 99999, rows: 1 });
    expect(sizes).toEqual(['132x40', '500x5']);
    socket.remoteClose();
  });

  it('endsWithReasonWhenExecExitsOrPodMissing', async () => {
    const { socket, exec } = await open();
    exec.attaches()[0].onExit('Failure: command terminated with non-zero exit code: exit code 3');
    expect(socket.json()).toContainEqual({ type: 'status', state: 'ended', reason: 'AI 의 작업 화면이 아직 준비되지 않았어요' });
    expect(socket.closed).not.toBeNull();

    const missing = await open(new FakeExec(), null);
    expect(missing.socket.json()).toEqual([{ type: 'status', state: 'ended', reason: 'AI 작업 공간이 떠 있지 않아요' }]);
    expect(missing.exec.runs).toEqual([]);
    expect(openScreenCount()).toBe(0);
  });

  it('explainsMissingExecPermissionFromOldChart', async () => {
    const exec = new FakeExec();
    exec.failAttach = new Error('Unexpected server response: 403');
    const { socket } = await open(exec);
    expect(socket.json()).toContainEqual({
      type: 'status',
      state: 'ended',
      reason: '실행 환경 runner 에 작업 화면 권한(pods/exec)이 없어요 — runner 차트를 업그레이드하세요',
    });
    expect(openScreenCount()).toBe(0);
  });

  it('closingFromWorksClosesExecAndIgnoresBadRequests', async () => {
    const { socket, exec } = await open();
    socket.remoteClose();
    expect(exec.attaches()[0].closed).toBe(true);
    const connect = vi.fn();
    await openScreen({ connect, exec, findAgentPod: async () => 'agent-7', log, allowInput: false }, { sessionId: '../x', agentUserId: 7 });
    expect(connect).not.toHaveBeenCalled();
  });
});

describe('helpers', () => {
  it('parseWindowsSkipsMalformedLines', () => {
    expect(parseWindows('0\tWP\t240\t60\t1\nbad\n2\tx\ty\t1\t0\n')).toEqual([{ index: 0, name: 'WP', width: 240, height: 60, active: true }]);
  });
  it('execFailureReasonDefaultsToGenericLine', () => {
    expect(execFailureReason('socket hang up')).toBe('작업 화면 연결이 끊겼어요');
  });
  it('screenSocketUrlUsesWsScheme', () => {
    expect(screenSocketUrl('https://works.example', 'a-b')).toBe('wss://works.example/api/v1/agent-runtime/runner/screen/a-b');
    expect(screenSocketUrl('http://127.0.0.1:6060', 's')).toBe('ws://127.0.0.1:6060/api/v1/agent-runtime/runner/screen/s');
  });
});
