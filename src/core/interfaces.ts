/**
 * Sandbox — OS-level command isolation interface.
 * Implementations: Bun.spawn wrapping (firejail, Docker, bubblewrap).
 */
export interface Sandbox {
  readonly name: string;
  wrapCommand(command: string[]): string[];
  isAvailable(): boolean;
}
