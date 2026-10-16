import type { APIRoute } from 'astro';
import { feedIcs } from '../lib/endpoints';

export const GET: APIRoute = ({ site }) => feedIcs('fr', site!);
