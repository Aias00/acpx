import { constants as osConstants } from "node:os";
import { extractAcpError, normalizeOutputError } from "../../acp/error-normalization.js";
import { AcpxOperationalError, AgentDisconnectedError, AgentStartupError } from "../../errors.js";
import type { AcpRuntimeTurnResultError } from "./contract.js";
import { AcpRuntimeError, type AcpRuntimeErrorCode } from "./errors.js";

const VALID_SIGNALS = new Set<string>(
  Object.keys((osConstants as { signals?: Record<string, number> }).signals ?? {}),
);

export type ObservedProcessExit = {
  exitCode?: number;
  signal?: NodeJS.Signals;
};

export type ObservedFailureFields = {
  rpcCode?: number;
  exitCode?: number;
  signal?: NodeJS.Signals;
  detailCode?: string;
};

function finiteInteger(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value)) {
    return undefined;
  }
  return value;
}

export function normalizeObservedSignal(value: unknown): NodeJS.Signals | undefined {
  if (typeof value !== "string" || !VALID_SIGNALS.has(value)) {
    return undefined;
  }
  return value as NodeJS.Signals;
}

export function readObservedRpcCode(error: unknown): number | undefined {
  const direct = extractAcpError(error)?.code;
  if (direct !== undefined) {
    return finiteInteger(direct);
  }
  const normalized = normalizeOutputError(error);
  return finiteInteger(normalized.acp?.code);
}

function isCleanupOnlyDisconnect(error: AgentDisconnectedError): boolean {
  return error.reason === "connection_close" && error.exitCode === null && error.signal === null;
}

function readObservedProcessExitRecord(error: unknown): ObservedProcessExit {
  const record = error as { exitCode?: unknown; signal?: unknown };
  const signal: NodeJS.Signals | null =
    record.signal === null || record.signal === undefined
      ? null
      : (normalizeObservedSignal(record.signal) ?? null);
  return observedExitFromFields(
    record.exitCode === null || record.exitCode === undefined
      ? null
      : (finiteInteger(record.exitCode) ?? null),
    signal,
  );
}

export function readObservedProcessExit(error: unknown): ObservedProcessExit {
  if (error instanceof AgentStartupError) {
    return observedExitFromFields(error.exitCode, error.signal);
  }
  if (error instanceof AgentDisconnectedError) {
    return isCleanupOnlyDisconnect(error)
      ? {}
      : observedExitFromFields(error.exitCode, error.signal);
  }
  return readObservedProcessExitRecord(error);
}

function observedExitFromFields(
  exitCode: number | null,
  signal: NodeJS.Signals | null,
): ObservedProcessExit {
  const observed: ObservedProcessExit = {};
  const code = exitCode === null ? undefined : finiteInteger(exitCode);
  if (code !== undefined) {
    observed.exitCode = code;
  }
  const normalizedSignal = signal === null ? undefined : normalizeObservedSignal(signal);
  if (normalizedSignal) {
    observed.signal = normalizedSignal;
  }
  return observed;
}

export function readObservedDetailCode(error: unknown): string | undefined {
  if (error instanceof AcpxOperationalError && error.detailCode) {
    return error.detailCode;
  }
  const normalized = normalizeOutputError(error);
  return normalized.detailCode;
}

export function attachObservedFailureFields<T extends ObservedFailureFields>(
  target: T,
  error: unknown,
  options?: { rpcCode?: number },
): T {
  const rpcCode = options?.rpcCode ?? readObservedRpcCode(error);
  if (rpcCode !== undefined) {
    target.rpcCode = rpcCode;
  }
  const processExit = readObservedProcessExit(error);
  if (processExit.exitCode !== undefined) {
    target.exitCode = processExit.exitCode;
  }
  if (processExit.signal !== undefined) {
    target.signal = processExit.signal;
  }
  const detailCode = readObservedDetailCode(error);
  if (detailCode && target.detailCode === undefined) {
    target.detailCode = detailCode;
  }
  return target;
}

export function buildRuntimeTurnResultError(error: unknown): AcpRuntimeTurnResultError {
  const normalized = normalizeOutputError(error, { origin: "runtime" });
  const result: AcpRuntimeTurnResultError = {
    message: normalized.message,
    ...(normalized.code ? { code: normalized.code } : {}),
    ...(normalized.detailCode ? { detailCode: normalized.detailCode } : {}),
    ...(normalized.retryable !== undefined ? { retryable: normalized.retryable } : {}),
  };
  return attachObservedFailureFields(result, error);
}

function runtimeErrorEvidence(error: unknown): ObservedFailureFields {
  const evidence: ObservedFailureFields = {};
  attachObservedFailureFields(evidence, error);
  return evidence;
}

function enrichExistingRuntimeError(error: AcpRuntimeError): AcpRuntimeError {
  attachObservedFailureFields(error, error.cause ?? error);
  error.detailCode ??= readObservedDetailCode(error.cause ?? error);
  return error;
}

export function mapEnsureSessionFailure(error: unknown): AcpRuntimeError {
  if (error instanceof AcpRuntimeError) {
    return enrichExistingRuntimeError(error);
  }
  const message = error instanceof Error ? error.message : String(error);
  const evidence = runtimeErrorEvidence(error);
  evidence.detailCode ??= readObservedDetailCode(error);
  return new AcpRuntimeError("ACP_SESSION_INIT_FAILED", message, {
    cause: error instanceof Error ? error : undefined,
    detailCode: evidence.detailCode,
    rpcCode: evidence.rpcCode,
    exitCode: evidence.exitCode,
    signal: evidence.signal,
  });
}

export function enrichRuntimeSetupError(
  code: AcpRuntimeErrorCode,
  message: string,
  cause?: unknown,
): AcpRuntimeError {
  const evidence = cause === undefined ? {} : runtimeErrorEvidence(cause);
  if (cause !== undefined) {
    evidence.detailCode ??= readObservedDetailCode(cause);
  }
  return new AcpRuntimeError(code, message, {
    cause,
    detailCode: evidence.detailCode,
    rpcCode: evidence.rpcCode,
    exitCode: evidence.exitCode,
    signal: evidence.signal,
  });
}
