/**
 * The API/domain contract (docs/2 §2.2): one Zod schema source that validates
 * server I/O, generates the OpenAPI document and types the web client.
 * This package depends on neither `api` nor `web`.
 */
export * from "./api-error";
export * from "./auth";
export * from "./board";
export * from "./broadcasters";
export * from "./media";
export * from "./on-air";
export * from "./scheduling";
export * from "./scheduling-states";
export * from "./shows";
export * from "./sse";
export * from "./station";
