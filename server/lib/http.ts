import type { NextFunction, Request, Response } from 'express';
import { ZodError, type ZodTypeAny } from 'zod';

export class ApiError extends Error {
  status: number;
  code: string;
  details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message: string, details?: unknown) =>
  new ApiError(400, 'bad_request', message, details);
export const unauthorized = (message = 'Authentication required') =>
  new ApiError(401, 'unauthorized', message);
export const forbidden = (message = 'You do not have permission to perform this action') =>
  new ApiError(403, 'forbidden', message);
export const notFound = (message = 'Resource not found') => new ApiError(404, 'not_found', message);
export const conflict = (message: string) => new ApiError(409, 'conflict', message);

/** Feature exists in the product but needs an external connection the user must provide. */
export const unavailable = (message: string, details?: unknown) =>
  new ApiError(409, 'integration_required', message, details);

export const notImplementedByProvider = (message: string) =>
  new ApiError(501, 'provider_unsupported', message);

type Handler = (req: Request, res: Response, next: NextFunction) => Promise<unknown> | unknown;

export function route(handler: Handler) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      await handler(req, res, next);
    } catch (err) {
      next(err);
    }
  };
}

export function parse<T extends ZodTypeAny>(schema: T, data: unknown): T['_output'] {
  try {
    return schema.parse(data);
  } catch (err) {
    if (err instanceof ZodError) {
      throw badRequest(
        'Invalid request payload',
        err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      );
    }
    throw err;
  }
}

export function slugify(input: string): string {
  const base = input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\u0600-\u06FF]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return base || 'item';
}

export function nowIso(): string {
  return new Date().toISOString();
}
