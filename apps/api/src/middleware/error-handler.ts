import type { NextFunction, Request, Response } from "express";
import { env } from "../config/env.js";

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
    if (status < 500 || env.nodeEnv !== "production") {
      return error.message;
    }
  }

  return status >= 500 ? "Internal server error" : "Request failed";
}

export function errorHandler(
  error: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
) {
  console.error(error);
  const status = getStatus(error);
  const response: { error: string; stack?: string } = {
    error: getMessage(error, status),
  };

  if (env.nodeEnv !== "production" && status >= 500 && error instanceof Error) {
    response.stack = error.stack;
  }

  res.status(status).json(response);
}
