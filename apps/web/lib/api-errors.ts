// Error code constants used in API responses.
// Codes are stable English identifiers; user-facing messages are Korean.
// See TRD §6.1 for envelope contract.

export const ApiErrorCodes = {
  E_AUTH: 'E_AUTH',
  E_FORBIDDEN: 'E_FORBIDDEN',
  E_NOT_FOUND: 'E_NOT_FOUND',
  E_VALIDATION: 'E_VALIDATION',
  E_STATE_CONFLICT: 'E_STATE_CONFLICT',
  E_LOCKED: 'E_LOCKED',
  E_RATE_LIMIT: 'E_RATE_LIMIT',
  E_INTERNAL: 'E_INTERNAL',
} as const;

export type ApiErrorCode = (typeof ApiErrorCodes)[keyof typeof ApiErrorCodes];

/** Default Korean messages for each error code. */
export const ApiErrorMessages: Record<ApiErrorCode, string> = {
  E_AUTH: '인증이 필요합니다.',
  E_FORBIDDEN: '접근 권한이 없습니다.',
  E_NOT_FOUND: '리소스를 찾을 수 없습니다.',
  E_VALIDATION: '입력값이 유효하지 않습니다.',
  E_STATE_CONFLICT: '현재 상태에서 수행할 수 없는 작업입니다.',
  E_LOCKED: '다른 사용자가 잠금 중입니다.',
  E_RATE_LIMIT: '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.',
  E_INTERNAL: '서버 오류가 발생했습니다.',
};

/** Default HTTP status code for each error code. */
export const ApiErrorStatusMap: Record<ApiErrorCode, number> = {
  E_AUTH: 401,
  E_FORBIDDEN: 403,
  E_NOT_FOUND: 404,
  E_VALIDATION: 400,
  E_STATE_CONFLICT: 409,
  E_LOCKED: 423,
  E_RATE_LIMIT: 429,
  E_INTERNAL: 500,
};
