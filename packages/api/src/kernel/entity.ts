/**
 * Base for domain objects with identity and a lifecycle (docs/2 §4.1).
 * Equality is identity, never shape; mutations go through methods that
 * protect invariants — subclasses expose no bare field writes.
 */
export abstract class Entity<TId> {
  protected constructor(readonly id: TId) {}

  equals(other: Entity<TId>): boolean {
    return other.constructor === this.constructor && other.id === this.id;
  }
}
