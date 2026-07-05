/**
 * The API/domain contract (docs/2 §2.2): one Zod schema source that validates
 * server I/O, generates the OpenAPI document and types the web client.
 * This package depends on neither `api` nor `web`.
 */
export * from "./api-error";
export * from "./on-air";
export * from "./scheduling";
export * from "./scheduling-states";
export * from "./sse";
export * from "./station";
