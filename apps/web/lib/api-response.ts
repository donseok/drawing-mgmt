// API response envelope helpers — TRD §6.1
// Success: { data, meta? }
// Error:   { error: { code, message, details? } }

import { NextResponse } from 'next/server';
import {
  ApiErrorCodes,
  ApiErrorMessages,
  ApiErrorStatusMap,
  type ApiErrorCode,
} from './api-errors';

export interface ApiSuccess<T> {
  data: T;
  meta?: Record<string, unknown>;
}

export interface ApiErrorBody {
  error: {
    code: ApiErrorCode;
    message: string;
    details?: unknown;
  };
}

/**
 * Build a JSON success response with `{ data, meta? }`.
 * BigInt is auto-stringified so attachments (BigInt size) survive serialization.
 */
export function ok<T>(
  data: T,
  meta?: Record<string, unknown>,
  init?: ResponseInit,
): NextResponse<ApiSuccess<T>> {
  const body: ApiSuccess<T> = meta !== undefined ? { data, meta } : { data };
  return new NextResponse(safeJsonStringify(body), {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  }) as NextResponse<ApiSuccess<T>>;
}

/**
 * Build a JSON error response. `code` selects default message + status.
 * Caller may override `message`, `status`, and attach `details` (e.g. zod issues).
 */
export function error(
  code: ApiErrorCode,
  message?: string,
  status?: number,
  details?: unknown,
): NextResponse<ApiErrorBody> {
  const body: ApiErrorBody = {
    error: {
      code,
      message: message ?? ApiErrorMessages[code],
      ...(details !== undefined ? { details } : {}),
    },
  };
  return NextResponse.json(body, {
    status: status ?? ApiErrorStatusMap[code],
  }) as NextResponse<ApiErrorBody>;
}

/** Convenience accessor so callers don't need to import the codes object. */
export const ErrorCode = ApiErrorCodes;

/**
 * Stringify with BigInt support (Prisma returns BigInt for `BigInt` columns).
 * Native JSON.stringify throws on BigInt; we coerce to string to keep precision.
 */
function safeJsonStringify(value: unknown): string {
  return JSON.stringify(value, (_key, val) =>
    typeof val === 'bigint' ? val.toString() : val,
  );
}
