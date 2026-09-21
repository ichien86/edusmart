export interface ServerTimerState {
  remainingAtRecv: number;
  perfAtRecv: number;
}

let currentTimer: ServerTimerState | null = null;

/**
 * Synchronize local countdown timer using authoritative server remainingMs and RTT compensation.
 */
export function onServerTimeSync(
  remainingMs: number,
  sendPerfTimestamp: number,
  receivePerfTimestamp: number
) {
  const rtt = receivePerfTimestamp - sendPerfTimestamp;
  const remainingAtRecv = remainingMs - rtt / 2;

  currentTimer = {
    remainingAtRecv,
    perfAtRecv: receivePerfTimestamp,
  };
}

/**
 * Returns remaining milliseconds based on monotonic performance.now() clock.
 * Immune to user changes of system date/time.
 */
export function getRemainingMs(): number {
  if (!currentTimer) {
    return 0;
  }
  const elapsed = performance.now() - currentTimer.perfAtRecv;
  return Math.max(0, currentTimer.remainingAtRecv - elapsed);
}

/**
 * Format remaining time to HH:MM:SS string.
 */
export function formatCountdown(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

