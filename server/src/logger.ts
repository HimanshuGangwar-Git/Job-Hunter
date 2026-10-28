import pino from 'pino';

// Logs never include request bodies, passwords, tokens or CV contents. Redaction is a second line of defence.
export function createLogger(level: string = process.env.LOG_LEVEL ?? 'info') {
  return pino({
    level,
    redact: {
      paths: ['req.headers.authorization', 'req.body.password', 'password', 'token', '*.password', '*.token'],
      censor: '[redacted]',
    },
  });
}

export type Logger = ReturnType<typeof createLogger>;
