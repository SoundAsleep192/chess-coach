import type { ErrorCode } from '@board/shared';

export class BoardError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'BoardError';
  }
}

export const HTTP_STATUS: Record<ErrorCode, number> = {
  bad_request: 400,
  forbidden: 403,
  not_found: 404,
  frozen: 409,
  illegal: 422,
  storage: 503,
};
