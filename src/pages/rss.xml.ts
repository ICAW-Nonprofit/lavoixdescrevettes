import type { APIRoute } from 'astro';
import { rssFeed } from '../lib/endpoints';

export const GET: APIRoute = (ctx) => rssFeed('fr', ctx.site!);
