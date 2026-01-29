import { exec } from 'child_process';
import { promisify } from 'util';

export const runtime = 'nodejs';

const execAsync = promisify(exec);

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { action } = body;

    if (action === 'start') {
      const { stdout, stderr } = await execAsync(
        'npx pm2 start ecosystem.config.cjs',
        { cwd: process.cwd() },
      );
      return Response.json({
        success: true,
        message: '봇이 시작되었습니다',
        stdout,
        stderr,
      });
    } else if (action === 'stop') {
      const { stdout, stderr } = await execAsync(
        'npx pm2 stop ecosystem.config.cjs',
        { cwd: process.cwd() },
      );
      return Response.json({
        success: true,
        message: '봇이 중지되었습니다',
        stdout,
        stderr,
      });
    } else if (action === 'restart') {
      const { stdout, stderr } = await execAsync(
        'npx pm2 restart ecosystem.config.cjs',
        { cwd: process.cwd() },
      );
      return Response.json({
        success: true,
        message: '봇이 재시작되었습니다',
        stdout,
        stderr,
      });
    } else if (action === 'status') {
      const { stdout } = await execAsync('npx pm2 jlist', {
        cwd: process.cwd(),
      });
      const processes = JSON.parse(stdout);
      const botProcess = processes.find((p: any) => p.name === 'binance-bot');
      return Response.json({
        success: true,
        running: botProcess?.pm2_env?.status === 'online',
        status: botProcess?.pm2_env?.status || 'stopped',
      });
    } else {
      return Response.json(
        { success: false, error: '잘못된 액션입니다' },
        { status: 400 },
      );
    }
  } catch (e: any) {
    return Response.json(
      { success: false, error: e.message || String(e) },
      { status: 500 },
    );
  }
}
