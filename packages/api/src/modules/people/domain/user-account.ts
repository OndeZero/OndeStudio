import { Entity } from "../../../kernel/entity";

export interface UserAccountProps {
  id: number;
  azAccountRef: string | null;
  displayName: string;
  email: string;
  role: "team" | "external";
  hasPassword: boolean;
}

/**
 * A person with access to the studio (PD §4.12). Two levels for now: team
 * (full) and external (own slots only, M4+). The account exists as soon as it
 * is seeded; it becomes *usable* once its one-time setup link set a password.
 */
export class UserAccount extends Entity<number> {
  private constructor(private readonly props: UserAccountProps) {
    super(props.id);
  }

  static rehydrate(props: UserAccountProps): UserAccount {
    return new UserAccount(props);
  }

  get displayName(): string {
    return this.props.displayName;
  }
  get email(): string {
    return this.props.email;
  }
  get role(): "team" | "external" {
    return this.props.role;
  }
  get azAccountRef(): string | null {
    return this.props.azAccountRef;
  }
  get hasPassword(): boolean {
    return this.props.hasPassword;
  }

  get isTeam(): boolean {
    return this.props.role === "team";
  }
}
