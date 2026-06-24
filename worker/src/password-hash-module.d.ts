declare module "@shared/password-hash" {
  export const PBKDF2_ITERATIONS: number;
  export function hashPassword(password: string): Promise<string>;
  export function verifyPassword(
    password: string,
    stored: string
  ): Promise<boolean>;
}
