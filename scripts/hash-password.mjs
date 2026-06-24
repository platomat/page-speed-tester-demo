#!/usr/bin/env node
/**
 * Local password hash for D1 emergency reset (no Cloudflare/network required).
 *
 * Usage:
 *   npm run hash-password -- 'your-new-password'
 *   node scripts/hash-password.mjs 'your-new-password'
 */

import { hashPassword } from "../shared/password-hash.mjs";

const password = process.argv[2];

if (!password) {
  console.error("Usage: npm run hash-password -- '<password>'");
  console.error("       node scripts/hash-password.mjs '<password>'");
  process.exit(1);
}

console.log(await hashPassword(password));
