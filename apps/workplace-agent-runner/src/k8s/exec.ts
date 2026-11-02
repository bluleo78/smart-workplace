// Pod exec(WP-1277) — @kubernetes/client-node 의 Exec 로 AI Pod 의 agent 컨테이너에서 명령을 돌린다. 작업 화면 보기만 쓴다.
// Exec 는 tty 크기 큐를 인스턴스에 두므로 exec 마다 새로 만든다. 오류 문구에는 서버 응답 본문을 넣지 않는다(상태·첫 줄만).
import { Exec, type KubeConfig, type V1Status } from '@kubernetes/client-node';
import type { Readable, Writable } from 'node:stream';
import type { ExecHandle, PodExec } from '../screen.js';

/** agent 컨테이너 이름 — 계약 문서 「컨테이너」. */
const AGENT_CONTAINER = 'agent';

export class KubePodExec implements PodExec {
  constructor(
    private readonly kc: KubeConfig,
    private readonly namespace: string,
  ) {}

  async run(opts: {
    pod: string;
    command: string[];
    stdin: Readable | null;
    stdout: Writable;
    tty: boolean;
    onExit: (error: string | null) => void;
  }): Promise<ExecHandle> {
    let done = false;
    const exit = (error: string | null) => {
      if (done) return;
      done = true;
      opts.onExit(error);
    };
    const ws = await new Exec(this.kc).exec(
      this.namespace,
      opts.pod,
      AGENT_CONTAINER,
      opts.command,
      opts.stdout,
      // tty 면 stderr 가 stdout 에 섞인다. 아니면 버린다(명령의 오류 줄은 종료 상태로 본다).
      null,
      opts.stdin,
      opts.tty,
      (status: V1Status) => exit(status.status === 'Success' ? null : `${status.reason ?? 'Failure'}: ${(status.message ?? '').split('\n')[0].slice(0, 200)}`),
    );
    ws.on('close', () => exit(null));
    ws.on('error', (e: Error) => exit(e.message.split('\n')[0].slice(0, 200)));
    return { close: () => ws.close() };
  }
}
