// packages/server/src/routes/auth-routes.ts
import type { FastifyInstance } from 'fastify';
import { loginSchema } from '../schema/api.js';
import { UserService } from '../services/user-service.js';

export function authRoutes(app: FastifyInstance, userService: UserService) {
  app.post('/v1/auth/login', async (request, reply) => {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ data: null, meta: null, error: parsed.error.message });
    }

    const user = await userService.authenticate(parsed.data.username, parsed.data.password);
    if (!user) {
      return reply.status(401).send({ data: null, meta: null, error: 'Invalid credentials' });
    }

    const token = app.jwt.sign(
      { sub: user.login, role: user.role, display_name: user.display_name },
    );

    return { data: { token, user }, meta: null, error: null };
  });
}
