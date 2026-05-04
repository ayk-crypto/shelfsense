import type { NextFunction, Request, Response } from "express";
import { logger } from "../lib/logger.js";

type HttpError = Error & {
  status?: number;
  statusCode?: number;
  expose?: boolean;
};

function getStatus(error: unknown) {
  if (typeof error !== "object" || error === null) {
    return 500;
  }

  const candidate = (error as HttpError).status ?? (error as HttpError).statusCode;
  return typeof candidate === "number" && candidate >= 400 && candidate < 600 ? candidate : 500;
}

function getMessage(error: unknown, status: number) {
  if (error instanceof Error) {
    if (status < 500) {
      return error.message;
    }
  }

  return status >= 500 ? "Internal server error" : "Request failed";
}

export function errorHandler(
  error: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
) {
  const status = getStatus(error);
  const message = getMessage(error, status);

  if (status >= 500) {
    logger.error("Unhandled error", {
      method: req.method,
      path: req.path,
      status,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  res.status(status).json({ error: message });
}
