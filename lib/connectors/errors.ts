/** Errors raised by ConnectorStore implementations. Codes mirror lib/db/errors (DbError) so actions map them the same way. */
export type ConnectorStoreErrorCode = "not_found" | "forbidden" | "invalid_transition" | "validation_failed" | "precondition_failed" | "conflict" | "internal";

export class ConnectorStoreError extends Error {
  readonly code: ConnectorStoreErrorCode;
  constructor(code: ConnectorStoreErrorCode) {
    super(`connector store: ${code}`);
    this.code = code;
    this.name = "ConnectorStoreError";
  }
}
