declare const idBrand: unique symbol;

/**
 * Branded numeric database id: a `ShowId` cannot be passed where a `SlotId`
 * is expected, while staying a plain number at runtime (and in SQLite).
 */
export type Id<TKind extends string> = number & { readonly [idBrand]: TKind };

export const asId = <TKind extends string>(raw: number): Id<TKind> => raw as Id<TKind>;
