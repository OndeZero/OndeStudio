import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import {
  ApiErrorSchema,
  CardIntentSchema,
  CardSchema,
  CardStatusSchema,
  CardsResponseSchema,
  CommentSchema,
  CommentsResponseSchema,
  CreateCardInputSchema,
  CreateCommentInputSchema,
  NotificationsResponseSchema,
  PromoteCardInputSchema,
  StationSlugSchema,
  UpdateCardInputSchema,
  VoteInputSchema,
} from "@ondestudio/shared";
import { DomainError } from "../../kernel/domain-error";
import { err, ok, type Result } from "../../kernel/result";
import { StationId } from "../../kernel/station-id";
import { createRouter, respondDomainError } from "../../platform/http";
import { cardToContract, commentToContract, notificationToContract } from "./contract";
import type { CardFilters } from "./repo";
import type { CollaborationService } from "./service";

const stationParam = z.object({ station: StationSlugSchema });
const cardParam = stationParam.extend({ id: z.coerce.number().int().positive() });
const idParam = z.object({ id: z.coerce.number().int().positive() });
const errorContent = { "application/json": { schema: ApiErrorSchema } };
/** Response/body shorthands — 12 routes would otherwise drown in envelope noise. */
const res = <T extends z.ZodType>(description: string, schema: T) => ({
  description,
  content: { "application/json": { schema } },
});
const body = <T extends z.ZodType>(schema: T) => ({ content: { "application/json": { schema } } });
const invalid = { 422: { description: "Invalid input", content: errorContent } };
const missing = { 404: { description: "Unknown card", content: errorContent } };

const listCardsRoute = createRoute({
  method: "get",
  path: "/stations/{station}/cards",
  tags: ["collaboration"],
  summary: "The board: cards enriched for the caller, latest activity first",
  request: {
    params: stationParam,
    query: z.object({ status: z.string().optional(), intent: z.string().optional() }),
  },
  responses: { 200: res("Cards", CardsResponseSchema), ...invalid },
});

const createCardRoute = createRoute({
  method: "post",
  path: "/stations/{station}/cards",
  tags: ["collaboration"],
  summary: "Open a card; assignees are notified",
  request: { params: stationParam, body: body(CreateCardInputSchema) },
  responses: { 201: res("Created", CardSchema), ...invalid },
});

const getCardRoute = createRoute({
  method: "get",
  path: "/stations/{station}/cards/{id}",
  tags: ["collaboration"],
  summary: "One card, enriched for the caller",
  request: { params: cardParam },
  responses: { 200: res("The card", CardSchema), ...missing, ...invalid },
});

const updateCardRoute = createRoute({
  method: "put",
  path: "/stations/{station}/cards/{id}",
  tags: ["collaboration"],
  summary: "Edit fields; assigneeIds is a replace-set (new assignees are notified)",
  request: { params: cardParam, body: body(UpdateCardInputSchema) },
  responses: { 200: res("Updated", CardSchema), ...missing, ...invalid },
});

const addCommentRoute = createRoute({
  method: "post",
  path: "/stations/{station}/cards/{id}/comments",
  tags: ["collaboration"],
  summary: "Reply on a card; creator and assignees are notified",
  request: { params: cardParam, body: body(CreateCommentInputSchema) },
  responses: { 201: res("Created", CommentSchema), ...missing, ...invalid },
});

const listCommentsRoute = createRoute({
  method: "get",
  path: "/stations/{station}/cards/{id}/comments",
  tags: ["collaboration"],
  summary: "The thread, oldest first",
  request: { params: cardParam },
  responses: { 200: res("Comments", CommentsResponseSchema), ...missing, ...invalid },
});

const voteRoute = createRoute({
  method: "put",
  path: "/stations/{station}/cards/{id}/vote",
  tags: ["collaboration"],
  summary: "Set or clear (kind: null) the caller's vote — one per person, changeable",
  request: { params: cardParam, body: body(VoteInputSchema) },
  responses: { 200: res("The card with the new tally", CardSchema), ...missing, ...invalid },
});

const markReadRoute = createRoute({
  method: "post",
  path: "/stations/{station}/cards/{id}/read",
  tags: ["collaboration"],
  summary: "Mark the thread seen — clears the caller's unread dot",
  request: { params: cardParam },
  responses: { 204: { description: "Marked" }, ...missing, ...invalid },
});

const promoteRoute = createRoute({
  method: "post",
  path: "/stations/{station}/cards/{id}/promote",
  tags: ["collaboration"],
  summary: "Promote an idea/prospect into a real object; the thread re-anchors (PD §4.14)",
  request: { params: cardParam, body: body(PromoteCardInputSchema) },
  responses: {
    200: res("The re-anchored card", CardSchema),
    404: { description: "Unknown card or slot", content: errorContent },
    409: { description: "Card is not promotable", content: errorContent },
    ...invalid,
  },
});

// Notifications are user-scoped, not station-scoped — no /stations prefix.
const listNotificationsRoute = createRoute({
  method: "get",
  path: "/notifications",
  tags: ["collaboration"],
  summary: "The caller's inbox, newest first (PD §5.12)",
  responses: { 200: res("Notifications + unread count", NotificationsResponseSchema) },
});

const readNotificationRoute = createRoute({
  method: "post",
  path: "/notifications/{id}/read",
  tags: ["collaboration"],
  summary: "Mark one of the caller's notifications read",
  request: { params: idParam },
  responses: {
    204: { description: "Marked" },
    404: { description: "Unknown notification", content: errorContent },
    ...invalid,
  },
});

const readAllNotificationsRoute = createRoute({
  method: "post",
  path: "/notifications/read-all",
  tags: ["collaboration"],
  summary: "Mark the caller's whole inbox read",
  responses: { 204: { description: "Marked" } },
});

/** Thin HTTP surface: validate (shared Zod) → call the service → map out (docs/2 §3.2). */
export function createCollaborationRoutes(service: CollaborationService): OpenAPIHono {
  const routes = createRouter();

  routes.openapi(listCardsRoute, async (c) => {
    const station = StationId.parse(c.req.valid("param").station);
    if (!station.ok) return respondDomainError(c, station.error) as never;
    const query = c.req.valid("query");
    const filters = parseFilters(query.status, query.intent);
    if (!filters.ok) return respondDomainError(c, filters.error) as never;
    const cards = await service.listCards(station.value, filters.value, c.get("user").id);
    return c.json({ cards: cards.map(cardToContract) }, 200);
  });

  routes.openapi(createCardRoute, async (c) => {
    const station = StationId.parse(c.req.valid("param").station);
    if (!station.ok) return respondDomainError(c, station.error) as never;
    const result = await service.createCard(station.value, c.req.valid("json"), c.get("user").id);
    if (!result.ok) return respondDomainError(c, result.error) as never;
    return c.json(cardToContract(result.value), 201);
  });

  routes.openapi(getCardRoute, async (c) => {
    const station = StationId.parse(c.req.valid("param").station);
    if (!station.ok) return respondDomainError(c, station.error) as never;
    const result = await service.getCard(station.value, c.req.valid("param").id, c.get("user").id);
    if (!result.ok) return respondDomainError(c, result.error) as never;
    return c.json(cardToContract(result.value), 200);
  });

  routes.openapi(updateCardRoute, async (c) => {
    const station = StationId.parse(c.req.valid("param").station);
    if (!station.ok) return respondDomainError(c, station.error) as never;
    const { id } = c.req.valid("param");
    const result = await service.updateCard(
      station.value,
      id,
      c.req.valid("json"),
      c.get("user").id,
    );
    if (!result.ok) return respondDomainError(c, result.error) as never;
    return c.json(cardToContract(result.value), 200);
  });

  routes.openapi(addCommentRoute, async (c) => {
    const station = StationId.parse(c.req.valid("param").station);
    if (!station.ok) return respondDomainError(c, station.error) as never;
    const { id } = c.req.valid("param");
    const { body: text } = c.req.valid("json");
    const result = await service.addComment(station.value, id, text, c.get("user").id);
    if (!result.ok) return respondDomainError(c, result.error) as never;
    return c.json(commentToContract(result.value), 201);
  });

  routes.openapi(listCommentsRoute, async (c) => {
    const station = StationId.parse(c.req.valid("param").station);
    if (!station.ok) return respondDomainError(c, station.error) as never;
    const result = await service.listComments(station.value, c.req.valid("param").id);
    if (!result.ok) return respondDomainError(c, result.error) as never;
    return c.json({ comments: result.value.map(commentToContract) }, 200);
  });

  routes.openapi(voteRoute, async (c) => {
    const station = StationId.parse(c.req.valid("param").station);
    if (!station.ok) return respondDomainError(c, station.error) as never;
    const { id } = c.req.valid("param");
    const { kind } = c.req.valid("json");
    const result = await service.setVote(station.value, id, kind, c.get("user").id);
    if (!result.ok) return respondDomainError(c, result.error) as never;
    return c.json(cardToContract(result.value), 200);
  });

  routes.openapi(markReadRoute, async (c) => {
    const station = StationId.parse(c.req.valid("param").station);
    if (!station.ok) return respondDomainError(c, station.error) as never;
    const result = await service.markCardRead(
      station.value,
      c.req.valid("param").id,
      c.get("user").id,
    );
    if (!result.ok) return respondDomainError(c, result.error) as never;
    return c.body(null, 204);
  });

  routes.openapi(promoteRoute, async (c) => {
    const station = StationId.parse(c.req.valid("param").station);
    if (!station.ok) return respondDomainError(c, station.error) as never;
    const { id } = c.req.valid("param");
    const result = await service.promote(station.value, id, c.req.valid("json"), c.get("user").id);
    if (!result.ok) return respondDomainError(c, result.error) as never;
    return c.json(cardToContract(result.value), 200);
  });

  routes.openapi(listNotificationsRoute, async (c) => {
    const { rows, unreadCount } = await service.listNotifications(c.get("user").id);
    return c.json({ notifications: rows.map(notificationToContract), unreadCount }, 200);
  });

  routes.openapi(readNotificationRoute, async (c) => {
    const result = await service.markNotificationRead(c.req.valid("param").id, c.get("user").id);
    if (!result.ok) return respondDomainError(c, result.error) as never;
    return c.body(null, 204);
  });

  routes.openapi(readAllNotificationsRoute, async (c) => {
    await service.markAllNotificationsRead(c.get("user").id);
    return c.body(null, 204);
  });

  return routes;
}

function parseFilters(
  statusRaw: string | undefined,
  intentRaw: string | undefined,
): Result<CardFilters, DomainError> {
  const filters: CardFilters = {};
  if (statusRaw) {
    const parsed = z.array(CardStatusSchema).safeParse(statusRaw.split(","));
    if (!parsed.success) return err(DomainError.validation(`invalid status filter: ${statusRaw}`));
    filters.status = parsed.data;
  }
  if (intentRaw) {
    const parsed = z.array(CardIntentSchema).safeParse(intentRaw.split(","));
    if (!parsed.success) return err(DomainError.validation(`invalid intent filter: ${intentRaw}`));
    filters.intent = parsed.data;
  }
  return ok(filters);
}
