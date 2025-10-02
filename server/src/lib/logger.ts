type LogLevel = 'debug' | 'info' | 'warn' | 'error';

function write(level: LogLevel, event: string, context?: Record<string, unknown>): void {
  try {
    const entry = { ts: new Date().toISOString(), level, event, ...(context || {}) };
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(entry));
  } catch {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ ts: new Date().toISOString(), level, event }));
  }
}

export const logger = {
  debug(event: string, context?: Record<string, unknown>) { write('debug', event, context); },
  info(event: string, context?: Record<string, unknown>) { write('info', event, context); },
  warn(event: string, context?: Record<string, unknown>) { write('warn', event, context); },
  error(event: string, context?: Record<string, unknown>) { write('error', event, context); },
};


