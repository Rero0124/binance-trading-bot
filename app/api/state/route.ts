import { getAllBotStates } from '@/lib/db';

export const runtime = 'nodejs';

export function GET() {
  const states = getAllBotStates();
  return Response.json({ states });
}
