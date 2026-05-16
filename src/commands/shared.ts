/** IO surface shared across CLI subcommand modules (channels, pairing, …).
 *  Injected so tests can capture output without spawning a shell. */
export interface CommandIO {
  log: (msg: string) => void;
  err: (msg: string) => void;
  exit: (code: number) => never;
}
