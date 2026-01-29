import { getAllBots, getAllBotStates } from '@/lib/db';

export const runtime = 'nodejs';

export async function GET() {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let isClosed = false;
      let lastConfigHash = '';
      let lastStateHash = '';

      const sendEvent = (event: string, data: any) => {
        if (isClosed) return;
        try {
          const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
          controller.enqueue(encoder.encode(message));
        } catch (e) {
          isClosed = true;
        }
      };

      const sendConfig = () => {
        try {
          const bots = getAllBots();
          const config = { bots };
          lastConfigHash = JSON.stringify(bots);
          sendEvent('config', config);
        } catch (e) {
          sendEvent('config', { bots: [] });
        }
      };

      const sendState = () => {
        try {
          const states = getAllBotStates();
          const state = { states };
          lastStateHash = JSON.stringify(states);
          sendEvent('state', state);
        } catch (e) {
          sendEvent('state', { states: [] });
        }
      };

      const sendPm2Status = async () => {
        try {
          const { exec } = await import('child_process');
          const { promisify } = await import('util');
          const execAsync = promisify(exec);
          const { stdout } = await execAsync('npx pm2 jlist', {
            cwd: process.cwd(),
          });
          const processes = JSON.parse(stdout);
          const botProcess = processes.find(
            (p: any) => p.name === 'binance-bot',
          );
          sendEvent('pm2', {
            running: botProcess?.pm2_env?.status === 'online',
            status: botProcess?.pm2_env?.status || 'stopped',
          });
        } catch (e) {
          sendEvent('pm2', { running: false, status: 'stopped' });
        }
      };

      const checkChanges = () => {
        try {
          const bots = getAllBots();
          const configHash = JSON.stringify(bots);
          if (configHash !== lastConfigHash) {
            lastConfigHash = configHash;
            sendConfig();
          }
        } catch (e) {
          // Ignore
        }

        try {
          const states = getAllBotStates();
          const stateHash = JSON.stringify(states);
          if (stateHash !== lastStateHash) {
            lastStateHash = stateHash;
            sendState();
          }
        } catch (e) {
          // Ignore
        }
      };

      // 초기 데이터 전송
      sendConfig();
      sendState();
      await sendPm2Status();

      // 1초마다 변경 체크
      const checkInterval = setInterval(() => {
        if (isClosed) {
          clearInterval(checkInterval);
          clearInterval(pm2Interval);
          return;
        }
        checkChanges();
      }, 1000);

      // 5초마다 PM2 상태 체크
      const pm2Interval = setInterval(async () => {
        if (isClosed) {
          clearInterval(checkInterval);
          clearInterval(pm2Interval);
          return;
        }
        await sendPm2Status();
      }, 5000);

      // 연결 종료 시 정리
      return () => {
        isClosed = true;
        clearInterval(checkInterval);
        clearInterval(pm2Interval);
      };
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
