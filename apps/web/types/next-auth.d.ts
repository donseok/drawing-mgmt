// Module augmentation for Auth.js v5 — adds custom claims to Session/User/JWT.
// Loaded automatically because tsconfig.json includes "**/*.ts".

import type { DefaultSession, DefaultUser } from 'next-auth';
import type { Role } from '@prisma/client';

declare module 'next-auth' {
  /** Returned by useSession / auth() / getSession */
  interface Session {
    user: {
      id: string;
      role: Role;
      securityLevel: number;
      organizationId: string | null;
      username: string;
    } & DefaultSession['user'];
  }

  /**
   * Returned by Credentials authorize() and stored in adapter.
   * Augmented to carry our custom fields onto the JWT token.
   */
  interface User extends DefaultUser {
    id: string;
    role: Role;
    securityLevel: number;
    organizationId: string | null;
    username: string;
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    id: string;
    role: Role;
    securityLevel: number;
    organizationId: string | null;
    username: string;
  }
}
