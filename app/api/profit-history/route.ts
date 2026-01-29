import { NextRequest } from 'next/server';
import { getProfitHistory, getTotalProfitHistory } from '@/lib/db';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const botId = searchParams.get('botId');
  const limit = parseInt(searchParams.get('limit') || '100', 10);

  try {
    if (botId) {
      // Get profit history for a specific bot
      const history = getProfitHistory(botId, limit);
      return Response.json({ history });
    } else {
      // Get total profit history for all real trading bots
      const history = getTotalProfitHistory(limit);
      return Response.json({ history });
    }
  } catch (error) {
    console.error('Error fetching profit history:', error);
    return Response.json(
      { error: 'Failed to fetch profit history' },
      { status: 500 }
    );
  }
}
