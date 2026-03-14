import { z } from 'zod';

export const searchQuerySchema = z.object({
  query: z.string().min(1),
  filters: z.object({
    type: z.array(z.string()).optional(),
    domain: z.array(z.string()).optional(),
    lang: z.string().optional(),
    quality_min: z.string().optional(),
    tags: z.array(z.string()).optional(),
  }).optional(),
  limit: z.number().int().min(1).max(100).default(20),
});

export const inventoryQuerySchema = z.object({
  topic: z.string().optional(),
  lang: z.string().optional(),
});

export const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

export const createUserSchema = z.object({
  login: z.string().min(1),
  password: z.string().min(6),
  display_name: z.string().min(1),
  role: z.enum(['reader', 'contributor', 'expert', 'admin']),
});

export const createTokenSchema = z.object({
  name: z.string().min(1),
  role: z.enum(['reader', 'contributor', 'expert', 'admin']),
});

export type SearchQuery = z.infer<typeof searchQuerySchema>;
export type InventoryQuery = z.infer<typeof inventoryQuerySchema>;
