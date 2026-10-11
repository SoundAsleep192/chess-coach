import type { ErrorCode } from '@board/shared';

export class TreeError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'TreeError';
  }
}
