/**
 * Public surface of the collaboration module — the only entry point other
 * modules may import (docs/2 §3.4). The concrete repo lives in ./wiring.ts
 * for the composition root only.
 */
export { cardToContract, commentToContract, notificationToContract } from "./contract";
export { Card, type CardAnchor, type CardProps, type UpdateCardFields } from "./domain/card";
export type { EnrichedCard } from "./enrich";
export type { CardChangedDomainEvent, NotifiedDomainEvent } from "./events";
export type { AnchorResolverPort, DirectoryUser, PromotionPort, UserDirectoryPort } from "./ports";
export type {
  CardFilters,
  CollaborationRepo,
  CommentRecord,
  NotificationRecord,
  VoteRecord,
} from "./repo";
export { createCollaborationRoutes } from "./routes";
export { CollaborationService, type CommentView } from "./service";

import "./events";
