import winston from "winston";

const isDev = process.env.NODE_ENV !== "production";

export const logger = winston.createLogger({
  level: isDev ? "debug" : "info",
  format: isDev
    ? winston.format.combine(
        winston.format.colorize(),
        winston.format.timestamp({ format: "HH:mm:ss" }),
        winston.format.printf(({ timestamp, level, message, ...meta }) => {
          const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : "";
          return `${timestamp} [${level}] ${message}${metaStr}`;
        }),
      )
    : winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.json(),
      ),
  transports: [new winston.transports.Console()],
});

export function logSecurityEvent(
  event: string,
  meta: Record<string, unknown> = {},
) {
  logger.info(`[SECURITY] ${event}`, meta);
}

export function logAuthEvent(
  event: string,
  meta: Record<string, unknown> = {},
) {
  logger.info(`[AUTH] ${event}`, meta);
}

export function logRequest(meta: {
  requestId?: string;
  method: string;
  path: string;
  status: number;
  durationMs: number;
  userId?: string | null;
  workspaceId?: string | null;
}) {
  logger.info("[REQUEST]", meta);
}
