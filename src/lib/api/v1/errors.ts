// Assumed PR1 contract: the single typed-error envelope used across `/api/v1`.
// Codes come from the API Contract V1 scope ("Error Codes").

export type ApiErrorCode =
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "validation_failed"
  | "idempotency_conflict"
  | "asset_not_ready"
  | "asset_invalid"
  | "brief_missing"
  | "timeline_invalid"
  | "job_not_cancelable"
  | "job_failed"
  | "render_failed"
  | "model_output_invalid"
  | "rate_limited"
  | "internal_error";

const STATUS_BY_CODE: Record<ApiErrorCode, number> = {
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  validation_failed: 400,
  idempotency_conflict: 409,
  asset_not_ready: 409,
  asset_invalid: 400,
  brief_missing: 400,
  timeline_invalid: 400,
  job_not_cancelable: 409,
  job_failed: 500,
  render_failed: 500,
  model_output_invalid: 502,
  rate_limited: 429,
  internal_error: 500,
};

export interface ApiErrorDetails {
  [key: string]: unknown;
}

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly details?: ApiErrorDetails;

  constructor(code: ApiErrorCode, message: string, details?: ApiErrorDetails) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = STATUS_BY_CODE[code];
    this.details = details;
  }
}

export interface ApiErrorEnvelope {
  error: {
    code: ApiErrorCode;
    message: string;
    requestId: string;
    details?: ApiErrorDetails;
  };
}

export function errorEnvelope(
  err: ApiError,
  requestId: string
): ApiErrorEnvelope {
  return {
    error: {
      code: err.code,
      message: err.message,
      requestId,
      ...(err.details ? { details: err.details } : {}),
    },
  };
}

// Field-level validation detail shape, matching the contract's example.
export function fieldError(path: string, message: string): ApiErrorDetails {
  return { fields: [{ path, message }] };
}
