import type { NextFunction, Request, Response } from "express";
import { Prisma } from "../generated/prisma/client.js";
import { logger } from "../lib/logger.js";

type HttpError = Error & {
  status?: number;
  statusCode?: number;
  expose?: boolean;
};

const STATUS_CODES: Record<number, string> = {
  400: "BAD_REQUEST",
  401: "UNAUTHORIZED",
  403: "FORBIDDEN",
  404: "NOT_FOUND",
  409: "CONFLICT",
  422: "UNPROCESSABLE_ENTITY",
  429: "TOO_MANY_REQUESTS",
  500: "INTERNAL_ERROR",
  503: "SERVICE_UNAVAILABLE",
};

function getStatus(error: unknown) {
  if (typeof error !== "object" || error === null) {
    return 500;
  }

  const candidate = (error as HttpError).status ?? (error as HttpError).statusCode;
  return typeof candidate === "number" && candidate >= 400 && candidate < 600 ? candidate : 500;
}

function getMessage(error: unknown, status: number) {
  if (error instanceof Error && status < 500) {
    return error.message;
  }

  return status >= 500 ? "Internal server error" : "Request failed";
}

function getCode(status: number) {
  return STATUS_CODES[status] ?? (status >= 500 ? "INTERNAL_ERROR" : "REQUEST_FAILED");
}

function getPrismaCode(error: unknown): string | undefined {
  if (error instanceof Prisma.PrismaClientKnownRequestError) return error.code;
  if (error instanceof Prisma.PrismaClientInitializationError) return error.errorCode ?? "INIT_ERROR";
  return undefined;
}

export function errorHandler(
  error: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
) {
  const status = getStatus(error);
  const message = getMessage(error, status);
  const requestId = req.requestId;

  if (status >= 500) {
    logger.error("Unhandled error", {
      requestId,
      method: req.method,
      path: req.path,
      status,
      userId: req.user?.userId ?? null,
      workspaceId: req.user?.workspaceId ?? null,
      error: error instanceof Error ? error.message : String(error),
      errorName: error instanceof Error ? error.constructor.name : typeof error,
      stack: error instanceof Error ? error.stack : undefined,
      prismaCode: getPrismaCode(error),
      prismaMeta: error instanceof Prisma.PrismaClientKnownRequestError
        ? (error.meta as Record<string, unknown> | undefined) ?? null
        : null,
    });
  }

  const body: Record<string, unknown> = { error: message, code: getCode(status) };
  if (requestId) body.requestId = requestId;

  res.status(status).json(body);
}
