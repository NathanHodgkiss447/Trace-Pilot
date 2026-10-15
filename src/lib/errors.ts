export class AppError extends Error {
  constructor(public code: string, message: string, public statusCode = 500, public usage?: Record<string, number>) {
    super(message);
    this.name = 'AppError';
  }
}
export function safeError(error: unknown): AppError {
  return error instanceof AppError ? error : new AppError('INTERNAL_ERROR', 'The request could not be completed.');
}
