// packages/server/src/auth/index.ts
export { hashPassword, verifyPassword, hashTokenSha256, hashTokenScrypt, verifyTokenScrypt } from './hash.js';
export { buildAuthMiddleware, requireRole, hasRole, type AuthUser } from './middleware.js';
