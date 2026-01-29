'use client';

import { useEffect, useState } from 'react';

type BotConfig = {
  id: string;
  name: string;
  enabled: boolean;
  market: 'spot' | 'futures';
  useTestnet: boolean;
  baseAsset: string;
  quoteAsset: string;
  interval: string;
  pollMs: number;
  dryRun: boolean;
  strategy: {
    type: 'ma_cross';
    fastPeriod: number;
    slowPeriod: number;
  };
  risk: {
    orderQuoteAmount: number;
    leverage: number;
    quantityStep: number;
    stopLossPercent: number;
    takeProfitPercent: number;
    maxDailyLossPercent: number;
    maxTotalLossPercent: number;
  };
  position: {
    preventDuplicateOrders: boolean;
    cooldownCandles: number;
  };
  virtualBalance?: {
    initialQuoteBalance: number;
    currentQuoteBalance: number;
    currentBaseBalance: number;
  };
};

type BotsConfig = {
  bots: BotConfig[];
};

type BotState = {
  botId: string;
  updatedAt: string | null;
  ok: boolean;
  status: string;
  error?: { message?: string } | null;
  marketData?: {
    lastClose?: number;
    fast?: number | null;
    slow?: number | null;
    signal?: string;
  };
  position?: Record<string, unknown>;
  lastDecision?: Record<string, unknown>;
};

type BotsState = {
  states: BotState[];
};

type WalletBalance = {
  asset: string;
  free: number;
  locked: number;
  total: number;
};

export default function Home() {
  const [botsConfig, setBotsConfig] = useState<BotsConfig | null>(null);
  const [botsState, setBotsState] = useState<BotsState | null>(null);
  const [selectedBotId, setSelectedBotId] = useState<string | null>(null);
  const [editingBot, setEditingBot] = useState<BotConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [pm2Running, setPm2Running] = useState(false);
  const [controlLoading, setControlLoading] = useState(false);
  const [showRealTradeConfirm, setShowRealTradeConfirm] = useState(false);
  const [realTradeAcknowledged, setRealTradeAcknowledged] = useState(false);
  const [pendingRealTradeBot, setPendingRealTradeBot] =
    useState<BotConfig | null>(null);
  const [walletBalances, setWalletBalances] = useState<WalletBalance[]>([]);
  const [walletLoading, setWalletLoading] = useState(false);

  const selectedBot = botsConfig?.bots.find((b) => b.id === selectedBotId);
  const selectedState = botsState?.states.find(
    (s) => s.botId === selectedBotId,
  );

  useEffect(() => {
    const eventSource = new EventSource('/api/stream');

    eventSource.addEventListener('config', (e) => {
      const data = JSON.parse(e.data);
      setBotsConfig(data);
      if (!selectedBotId && data.bots?.length > 0) {
        setSelectedBotId(data.bots[0].id);
      }
    });

    eventSource.addEventListener('state', (e) => {
      const data = JSON.parse(e.data);
      setBotsState(data);
    });

    eventSource.addEventListener('pm2', (e) => {
      const data = JSON.parse(e.data);
      setPm2Running(data.running || false);
    });

    eventSource.onerror = () => {
      setError('서버 연결이 끊어졌습니다. 페이지를 새로고침하세요.');
    };

    return () => {
      eventSource.close();
    };
  }, []);

  useEffect(() => {
    loadWallet();
    const interval = setInterval(loadWallet, 10000);
    return () => clearInterval(interval);
  }, []);

  async function loadWallet() {
    setWalletLoading(true);
    try {
      const res = await fetch('/api/wallet');
      const data = await res.json();
      if (data.balances) {
        setWalletBalances(data.balances);
      }
    } catch (e) {
      console.error('Failed to load wallet:', e);
    } finally {
      setWalletLoading(false);
    }
  }

  async function controlBot(action: 'start' | 'stop' | 'restart') {
    setControlLoading(true);
    try {
      const res = await fetch('/api/bot/control', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (!data.success) {
        setError(data.error || '작업 실패');
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setControlLoading(false);
    }
  }

  async function toggleBotEnabled(bot: BotConfig) {
    try {
      if (!botsConfig) {
        return;
      }

      const updatedBots = botsConfig.bots.map((b) => {
        if (b.id === bot.id) {
          const newEnabled = !b.enabled;
          const updatedBot = { ...b, enabled: newEnabled };

          // dryRun 모드에서 봇을 켤 때 가상 잔액 초기화
          if (b.dryRun && newEnabled) {
            updatedBot.virtualBalance = {
              initialQuoteBalance: 1000,
              currentQuoteBalance: 1000,
              currentBaseBalance: 0,
            };
          } else if (!newEnabled) {
            // 봇을 끌 때는 virtualBalance 유지 (초기화 안 함)
          }

          return updatedBot;
        }
        return b;
      });

      const res = await fetch('/api/config', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ bots: updatedBots }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(`Failed to toggle bot: ${data.error || 'Unknown error'}`);
      } else if (data.errors) {
        setValidationErrors(data.errors);
      }
    } catch (e) {
      console.error('[toggleBotEnabled] Error:', e);
      setError(String(e));
    }
  }

  async function addBot() {
    try {
      await fetch('/api/config', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'create', name: `봇 ${Date.now()}` }),
      });
    } catch (e) {
      setError(String(e));
    }
  }

  async function deleteBot(id: string) {
    if (!confirm('이 봇을 삭제하시겠습니까?')) return;
    try {
      await fetch(`/api/config?id=${id}`, { method: 'DELETE' });
      if (selectedBotId === id) setSelectedBotId(null);
    } catch (e) {
      setError(String(e));
    }
  }

  async function saveBot() {
    if (!editingBot) return;

    if (!editingBot.useTestnet && !editingBot.dryRun) {
      setPendingRealTradeBot(editingBot);
      setShowRealTradeConfirm(true);
      return;
    }

    await performSave(editingBot);
  }

  async function performSave(bot: BotConfig) {
    try {
      if (!botsConfig) return;

      const updatedBots = botsConfig.bots.map((b) =>
        b.id === bot.id ? bot : b,
      );

      const res = await fetch('/api/config', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ bots: updatedBots }),
      });
      const data = await res.json();
      if (data.errors) {
        setValidationErrors(data.errors);
      } else {
        setEditingBot(null);
        setValidationErrors([]);
        setShowRealTradeConfirm(false);
        setRealTradeAcknowledged(false);
        setPendingRealTradeBot(null);
      }
    } catch (e) {
      setError(String(e));
    }
  }

  function confirmRealTrade() {
    if (!realTradeAcknowledged || !pendingRealTradeBot) return;
    performSave(pendingRealTradeBot);
  }

  function startEdit(bot: BotConfig) {
    setEditingBot(JSON.parse(JSON.stringify(bot)));
    setValidationErrors([]);
  }

  const getStatusColor = (status?: string) => {
    if (!status) return 'text-gray-400';
    if (status === 'RUNNING') return 'text-green-600';
    if (status === 'DISABLED') return 'text-gray-400';
    if (status === 'ERROR') return 'text-red-600';
    return 'text-yellow-600';
  };

  const getSignalBadge = (signal?: string) => {
    if (signal === 'LONG') return 'bg-green-100 text-green-800';
    if (signal === 'SHORT') return 'bg-red-100 text-red-800';
    return 'bg-gray-100 text-gray-600';
  };

  const calculatePositionInfo = (state: any) => {
    if (!state) return { entryAmount: 0, pnl: 0, pnlPercent: 0 };

    if (state.account?.virtual) {
      const totalValue = Number(state.account.totalValue) || 0;
      const profitLoss = Number(state.account.profitLoss) || 0;
      const profitLossPercent = Number(state.account.profitLossPercent) || 0;

      return {
        entryAmount: totalValue,
        pnl: profitLoss,
        pnlPercent: profitLossPercent,
      };
    }

    const position = state.position;
    if (!position) return { entryAmount: 0, pnl: 0, pnlPercent: 0 };

    if (position.positionAmt !== undefined) {
      const positionAmt = Math.abs(Number(position.positionAmt) || 0);
      const entryPrice = Number(position.entryPrice) || 0;
      const unrealizedProfit = Number(position.unrealizedProfit) || 0;
      const entryAmount = positionAmt * entryPrice;
      const pnlPercent =
        entryAmount > 0 ? (unrealizedProfit / entryAmount) * 100 : 0;

      return { entryAmount, pnl: unrealizedProfit, pnlPercent };
    }

    if (position.baseAsset && position.baseFree !== undefined) {
      const estValueQuote = Number(position.estValueQuote) || 0;
      return { entryAmount: estValueQuote, pnl: 0, pnlPercent: 0 };
    }

    return { entryAmount: 0, pnl: 0, pnlPercent: 0 };
  };

  const positionInfo = selectedState
    ? calculatePositionInfo(selectedState)
    : { entryAmount: 0, pnl: 0, pnlPercent: 0 };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-50">
      <div className="mx-auto max-w-7xl p-6">
        <div className="mb-6 rounded-xl bg-white p-6 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">
                바이낸스 트레이딩 봇
              </h1>
              <p className="mt-1 text-sm text-gray-500">
                실시간으로 여러 봇을 관리하고 모니터링하세요
              </p>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2 rounded-lg bg-gray-50 px-4 py-2">
                <div
                  className={`h-3 w-3 rounded-full ${pm2Running ? 'animate-pulse bg-green-500' : 'bg-gray-300'}`}
                />
                <span className="text-sm font-medium text-gray-700">
                  {pm2Running ? 'PM2 실행 중' : 'PM2 중지됨'}
                </span>
              </div>
              {pm2Running ? (
                <button
                  onClick={() => controlBot('stop')}
                  disabled={controlLoading}
                  className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
                >
                  {controlLoading ? '처리 중...' : 'PM2 중지'}
                </button>
              ) : (
                <button
                  onClick={() => controlBot('start')}
                  disabled={controlLoading}
                  className="rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
                >
                  {controlLoading ? '처리 중...' : 'PM2 시작'}
                </button>
              )}
              <button
                onClick={() => controlBot('restart')}
                disabled={controlLoading}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                재시작
              </button>
            </div>
          </div>

          <div className="border-t border-gray-200 pt-4">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900">내 지갑</h2>
              <button
                onClick={loadWallet}
                disabled={walletLoading}
                className="text-sm text-blue-600 hover:text-blue-700 disabled:opacity-50"
              >
                {walletLoading ? '로딩 중...' : '새로고침'}
              </button>
            </div>
            {walletBalances.length === 0 ? (
              <div className="rounded-lg bg-gray-50 p-4 text-center text-sm text-gray-500">
                지갑 정보를 불러오는 중...
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
                {walletBalances.map((balance) => (
                  <div
                    key={balance.asset}
                    className="rounded-lg border border-gray-200 bg-gray-50 p-3"
                  >
                    <div className="text-xs font-medium text-gray-500">
                      {balance.asset}
                    </div>
                    <div className="text-2xl font-bold text-gray-900">
                      {balance.total.toFixed(5)}
                    </div>
                    <div className="mt-1 text-sm text-gray-600">
                      사용 가능: {balance.free.toFixed(5)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {error && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            <div className="flex items-center gap-2">
              <span className="text-lg">⚠️</span>
              <span>{error}</span>
              <button
                onClick={() => setError(null)}
                className="ml-auto text-red-600 hover:text-red-800"
              >
                ✕
              </button>
            </div>
          </div>
        )}

        {validationErrors.length > 0 && (
          <div className="mb-4 rounded-lg border border-yellow-200 bg-yellow-50 p-4 text-sm text-yellow-800">
            <div className="font-semibold">설정 검증 오류:</div>
            <ul className="mt-2 list-inside list-disc space-y-1">
              {validationErrors.map((err, i) => (
                <li key={i}>{err}</li>
              ))}
            </ul>
            <button
              onClick={() => setValidationErrors([])}
              className="mt-2 text-yellow-600 hover:text-yellow-800"
            >
              닫기
            </button>
          </div>
        )}

        <div className="grid gap-6 lg:grid-cols-5">
          <div className="rounded-xl bg-white p-6 shadow-sm lg:col-span-1">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900">봇 목록</h2>
              <button
                onClick={addBot}
                className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
              >
                + 추가
              </button>
            </div>
            <div className="space-y-2">
              {botsConfig?.bots.length === 0 && (
                <div className="rounded-lg border-2 border-dashed border-gray-200 p-6 text-center">
                  <p className="text-sm text-gray-500">봇이 없습니다</p>
                  <p className="mt-1 text-xs text-gray-400">
                    + 추가 버튼을 눌러 새 봇을 만드세요
                  </p>
                </div>
              )}
              {botsConfig?.bots.map((bot) => {
                const state = botsState?.states.find((s) => s.botId === bot.id);
                const isSelected = selectedBotId === bot.id;
                return (
                  <div
                    key={bot.id}
                    className={`rounded-lg border-2 p-3 transition-all ${
                      isSelected
                        ? 'border-blue-500 bg-blue-50 shadow-md'
                        : 'border-gray-200 bg-white hover:border-gray-300 hover:shadow-sm'
                    }`}
                  >
                    <div className="flex items-start justify-between">
                      <div
                        className="flex-1 cursor-pointer"
                        onClick={() => setSelectedBotId(bot.id)}
                      >
                        <div className="flex items-center gap-2">
                          <h3 className="text-sm font-semibold text-gray-900">
                            {bot.name}
                          </h3>
                          {!bot.useTestnet && !bot.dryRun && (
                            <span className="rounded bg-red-100 px-1.5 py-0.5 text-xs font-medium text-red-700">
                              실거래
                            </span>
                          )}
                          {bot.dryRun && (
                            <span className="rounded bg-yellow-100 px-1.5 py-0.5 text-xs font-medium text-yellow-700">
                              시뮬
                            </span>
                          )}
                        </div>
                        <div className="mt-1 text-xs text-gray-600">
                          <div>
                            {bot.baseAsset}
                            {bot.quoteAsset}
                          </div>
                          <div
                            className={`mt-0.5 ${getStatusColor(state?.status)}`}
                          >
                            {state?.status === 'RUNNING'
                              ? '실행중'
                              : state?.status === 'DISABLED'
                                ? '비활성'
                                : state?.status === 'ERROR'
                                  ? '오류'
                                  : '대기'}
                          </div>
                        </div>
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleBotEnabled(bot);
                        }}
                        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                          bot.enabled ? 'bg-green-600' : 'bg-gray-300'
                        }`}
                      >
                        <span
                          className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${
                            bot.enabled ? 'translate-x-5' : 'translate-x-1'
                          }`}
                        />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {selectedBot && (
            <div className="rounded-xl bg-white p-6 shadow-sm lg:col-span-1">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-lg font-semibold text-gray-900">설정</h2>
                <div className="flex gap-2">
                  <button
                    onClick={() => startEdit(selectedBot)}
                    className="text-sm font-medium text-blue-600 hover:text-blue-700"
                  >
                    수정
                  </button>
                  <button
                    onClick={() => deleteBot(selectedBot.id)}
                    className="text-sm font-medium text-red-600 hover:text-red-700"
                  >
                    삭제
                  </button>
                </div>
              </div>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between rounded-lg bg-gray-50 p-2">
                  <span className="text-gray-600">상태</span>
                  <span
                    className={
                      selectedBot.enabled ? 'text-green-600' : 'text-gray-400'
                    }
                  >
                    {selectedBot.enabled ? '활성화' : '비활성화'}
                  </span>
                </div>
                <div className="flex justify-between rounded-lg bg-gray-50 p-2">
                  <span className="text-gray-600">거래쌍</span>
                  <span className="text-gray-900">
                    {selectedBot.baseAsset}
                    {selectedBot.quoteAsset}
                  </span>
                </div>
                <div className="flex justify-between rounded-lg bg-gray-50 p-2">
                  <span className="text-gray-600">마켓</span>
                  <span className="text-gray-900">
                    {selectedBot.market === 'spot' ? '현물' : '선물'}
                  </span>
                </div>
                <div className="flex justify-between rounded-lg bg-gray-50 p-2">
                  <span className="text-gray-600">환경</span>
                  <span className="text-gray-900">
                    {selectedBot.useTestnet ? '테스트넷' : '실거래'}
                  </span>
                </div>
                <div className="flex justify-between rounded-lg bg-gray-50 p-2">
                  <span className="text-gray-600">간격</span>
                  <span className="text-gray-900">{selectedBot.interval}</span>
                </div>
                <div className="flex justify-between rounded-lg bg-gray-50 p-2">
                  <span className="text-gray-600">드라이런</span>
                  <span
                    className={
                      selectedBot.dryRun ? 'text-yellow-600' : 'text-green-600'
                    }
                  >
                    {selectedBot.dryRun ? '시뮬레이션' : '실거래'}
                  </span>
                </div>
                <div className="flex justify-between rounded-lg bg-gray-50 p-2">
                  <span className="text-gray-600">이동평균</span>
                  <span className="text-gray-900">
                    {selectedBot.strategy.fastPeriod} /{' '}
                    {selectedBot.strategy.slowPeriod}
                  </span>
                </div>
                <div className="flex justify-between rounded-lg bg-gray-50 p-2">
                  <span className="text-gray-600">주문금액</span>
                  <span className="text-gray-900">
                    ${selectedBot.risk.orderQuoteAmount}
                  </span>
                </div>
                {selectedBot.market === 'futures' && (
                  <div className="flex justify-between rounded-lg bg-gray-50 p-2">
                    <span className="text-gray-600">레버리지</span>
                    <span className="text-gray-900">
                      {selectedBot.risk.leverage}x
                    </span>
                  </div>
                )}
                <div className="flex justify-between rounded-lg bg-gray-50 p-2">
                  <span className="text-gray-600">손절</span>
                  <span className="text-red-600">
                    -{selectedBot.risk.stopLossPercent}%
                  </span>
                </div>
                <div className="flex justify-between rounded-lg bg-gray-50 p-2">
                  <span className="text-gray-600">익절</span>
                  <span className="text-green-600">
                    +{selectedBot.risk.takeProfitPercent}%
                  </span>
                </div>
                <div className="flex justify-between rounded-lg bg-gray-50 p-2">
                  <span className="text-gray-600">쿨다운</span>
                  <span className="text-gray-900">
                    {selectedBot.position.cooldownCandles} 캔들
                  </span>
                </div>
              </div>
            </div>
          )}

          {selectedState && (
            <div className="rounded-xl bg-white p-6 shadow-sm lg:col-span-3">
              <h2 className="mb-4 text-lg font-semibold text-gray-900">
                실시간 상태
              </h2>
              <div className="space-y-4">
                <div className="grid grid-cols-3 gap-4">
                  <div className="rounded-lg border-2 border-blue-200 bg-blue-50 p-4">
                    <div className="text-xs font-medium text-blue-600">
                      총 진입 금액
                    </div>
                    <div className="mt-1 text-2xl font-bold text-blue-900">
                      ${positionInfo.entryAmount.toFixed(2)}
                    </div>
                  </div>
                  <div
                    className={`rounded-lg border-2 p-4 ${
                      positionInfo.pnl >= 0
                        ? 'border-green-200 bg-green-50'
                        : 'border-red-200 bg-red-50'
                    }`}
                  >
                    <div
                      className={`text-xs font-medium ${positionInfo.pnl >= 0 ? 'text-green-600' : 'text-red-600'}`}
                    >
                      손익 (USDT)
                    </div>
                    <div
                      className={`mt-1 text-2xl font-bold ${positionInfo.pnl >= 0 ? 'text-green-900' : 'text-red-900'}`}
                    >
                      {positionInfo.pnl >= 0 ? '+' : ''}
                      {positionInfo.pnl.toFixed(2)}
                    </div>
                  </div>
                  <div
                    className={`rounded-lg border-2 p-4 ${
                      positionInfo.pnlPercent >= 0
                        ? 'border-green-200 bg-green-50'
                        : 'border-red-200 bg-red-50'
                    }`}
                  >
                    <div
                      className={`text-xs font-medium ${positionInfo.pnlPercent >= 0 ? 'text-green-600' : 'text-red-600'}`}
                    >
                      수익률
                    </div>
                    <div
                      className={`mt-1 text-2xl font-bold ${positionInfo.pnlPercent >= 0 ? 'text-green-900' : 'text-red-900'}`}
                    >
                      {positionInfo.pnlPercent >= 0 ? '+' : ''}
                      {positionInfo.pnlPercent.toFixed(2)}%
                    </div>
                  </div>
                </div>

                <div className="rounded-lg border border-gray-200 p-4">
                  <div className="mb-2 text-xs font-medium text-gray-500">
                    마지막 업데이트
                  </div>
                  <div className="text-sm text-gray-900">
                    {selectedState.updatedAt
                      ? new Date(selectedState.updatedAt).toLocaleString(
                          'ko-KR',
                        )
                      : '-'}
                  </div>
                </div>

                <div className="rounded-lg border border-gray-200 p-4">
                  <div className="mb-2 text-xs font-medium text-gray-500">
                    시그널
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className={`rounded-full px-3 py-1 text-sm font-medium ${getSignalBadge(selectedState.marketData?.signal)}`}
                    >
                      {selectedState.marketData?.signal === 'LONG'
                        ? '매수 (LONG)'
                        : selectedState.marketData?.signal === 'SHORT'
                          ? '매도 (SHORT)'
                          : '대기 (HOLD)'}
                    </span>
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-3 text-xs">
                    <div className="rounded bg-gray-50 p-2">
                      <span className="text-gray-500">현재가</span>
                      <div className="mt-1 font-medium text-gray-900">
                        {selectedState.marketData?.lastClose?.toFixed(2) || '-'}
                      </div>
                    </div>
                    <div className="rounded bg-gray-50 p-2">
                      <span className="text-gray-500">빠른MA</span>
                      <div className="mt-1 font-medium text-gray-900">
                        {selectedState.marketData?.fast?.toFixed(2) || '-'}
                      </div>
                    </div>
                    <div className="rounded bg-gray-50 p-2">
                      <span className="text-gray-500">느린MA</span>
                      <div className="mt-1 font-medium text-gray-900">
                        {selectedState.marketData?.slow?.toFixed(2) || '-'}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="rounded-lg border border-gray-200 p-4">
                  <div className="mb-2 text-xs font-medium text-gray-500">
                    포지션 상세
                  </div>
                  <pre className="overflow-auto rounded bg-gray-50 p-3 text-xs text-gray-800">
                    {JSON.stringify(selectedState.position, null, 2)}
                  </pre>
                </div>

                <div className="rounded-lg border border-gray-200 p-4">
                  <div className="mb-2 text-xs font-medium text-gray-500">
                    마지막 결정
                  </div>
                  <pre className="overflow-auto rounded bg-gray-50 p-3 text-xs text-gray-800">
                    {JSON.stringify(selectedState.lastDecision, null, 2)}
                  </pre>
                </div>

                {selectedState.error && (
                  <div className="rounded-lg border border-red-200 bg-red-50 p-4">
                    <div className="mb-1 text-xs font-medium text-red-700">
                      오류
                    </div>
                    <div className="text-sm text-red-800">
                      {selectedState.error.message}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {editingBot && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-xl bg-white p-6 shadow-xl">
              <h2 className="mb-6 text-xl font-bold text-gray-900">
                봇 설정 수정
              </h2>
              <div className="space-y-4">
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">
                    봇 이름
                  </label>
                  <input
                    className="w-full rounded-lg border border-gray-300 px-4 py-2 focus:border-blue-500 focus:outline-none"
                    value={editingBot.name}
                    onChange={(e) =>
                      setEditingBot({ ...editingBot, name: e.target.value })
                    }
                  />
                </div>

                <div className="flex gap-6">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-gray-300"
                      checked={editingBot.enabled}
                      onChange={(e) =>
                        setEditingBot({
                          ...editingBot,
                          enabled: e.target.checked,
                        })
                      }
                    />
                    <span className="text-sm font-medium text-gray-700">
                      활성화
                    </span>
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-gray-300"
                      checked={editingBot.dryRun}
                      onChange={(e) =>
                        setEditingBot({
                          ...editingBot,
                          dryRun: e.target.checked,
                        })
                      }
                    />
                    <span className="text-sm font-medium text-gray-700">
                      드라이런 (시뮬레이션)
                    </span>
                  </label>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="mb-1 block text-sm font-medium text-gray-700">
                      마켓
                    </label>
                    <select
                      className="w-full rounded-lg border border-gray-300 px-4 py-2 focus:border-blue-500 focus:outline-none"
                      value={editingBot.market}
                      onChange={(e) =>
                        setEditingBot({
                          ...editingBot,
                          market: e.target.value as 'spot' | 'futures',
                        })
                      }
                    >
                      <option value="spot">현물 (Spot)</option>
                      <option value="futures">선물 (Futures)</option>
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium text-gray-700">
                      환경
                    </label>
                    <select
                      className="w-full rounded-lg border border-gray-300 px-4 py-2 focus:border-blue-500 focus:outline-none"
                      value={editingBot.useTestnet ? 'testnet' : 'mainnet'}
                      onChange={(e) =>
                        setEditingBot({
                          ...editingBot,
                          useTestnet: e.target.value === 'testnet',
                        })
                      }
                    >
                      <option value="testnet">테스트넷</option>
                      <option value="mainnet">실거래</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="mb-1 block text-sm font-medium text-gray-700">
                      구매 재화 (Base Asset)
                    </label>
                    <input
                      className="w-full rounded-lg border border-gray-300 px-4 py-2 focus:border-blue-500 focus:outline-none"
                      value={editingBot.baseAsset}
                      onChange={(e) =>
                        setEditingBot({
                          ...editingBot,
                          baseAsset: e.target.value.toUpperCase(),
                        })
                      }
                      placeholder="BTC"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium text-gray-700">
                      판매 재화 (Quote Asset)
                    </label>
                    <input
                      className="w-full rounded-lg border border-gray-300 px-4 py-2 focus:border-blue-500 focus:outline-none"
                      value={editingBot.quoteAsset}
                      onChange={(e) =>
                        setEditingBot({
                          ...editingBot,
                          quoteAsset: e.target.value.toUpperCase(),
                        })
                      }
                      placeholder="USDT"
                    />
                  </div>
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">
                    간격
                  </label>
                  <select
                    className="w-full rounded-lg border border-gray-300 px-4 py-2 focus:border-blue-500 focus:outline-none"
                    value={editingBot.interval}
                    onChange={(e) =>
                      setEditingBot({ ...editingBot, interval: e.target.value })
                    }
                  >
                    <option value="1m">1분</option>
                    <option value="5m">5분</option>
                    <option value="15m">15분</option>
                    <option value="1h">1시간</option>
                  </select>
                </div>

                <div className="rounded-lg border border-gray-200 p-4">
                  <h3 className="mb-3 text-sm font-semibold text-gray-900">
                    전략 설정
                  </h3>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="mb-1 block text-xs font-medium text-gray-600">
                        빠른 이동평균
                      </label>
                      <input
                        type="number"
                        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                        value={editingBot.strategy.fastPeriod}
                        onChange={(e) =>
                          setEditingBot({
                            ...editingBot,
                            strategy: {
                              ...editingBot.strategy,
                              fastPeriod: Number(e.target.value),
                            },
                          })
                        }
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium text-gray-600">
                        느린 이동평균
                      </label>
                      <input
                        type="number"
                        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                        value={editingBot.strategy.slowPeriod}
                        onChange={(e) =>
                          setEditingBot({
                            ...editingBot,
                            strategy: {
                              ...editingBot.strategy,
                              slowPeriod: Number(e.target.value),
                            },
                          })
                        }
                      />
                    </div>
                  </div>
                </div>

                <div className="rounded-lg border border-gray-200 p-4">
                  <h3 className="mb-3 text-sm font-semibold text-gray-900">
                    리스크 관리
                  </h3>
                  <div className="space-y-3">
                    <div>
                      <label className="mb-1 block text-xs font-medium text-gray-600">
                        주문 금액 (USDT) - 최소 10 USDT
                      </label>
                      <input
                        type="number"
                        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                        value={editingBot.risk.orderQuoteAmount}
                        min={10}
                        onChange={(e) =>
                          setEditingBot({
                            ...editingBot,
                            risk: {
                              ...editingBot.risk,
                              orderQuoteAmount: Number(e.target.value),
                            },
                          })
                        }
                      />
                    </div>

                    {editingBot.market === 'futures' && (
                      <div>
                        <label className="mb-1 block text-xs font-medium text-gray-600">
                          레버리지 (선물 전용)
                        </label>
                        <input
                          type="number"
                          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                          value={editingBot.risk.leverage}
                          min={1}
                          max={125}
                          onChange={(e) =>
                            setEditingBot({
                              ...editingBot,
                              risk: {
                                ...editingBot.risk,
                                leverage: Number(e.target.value),
                              },
                            })
                          }
                        />
                      </div>
                    )}

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="mb-1 block text-xs font-medium text-gray-600">
                          손절 비율 (%)
                        </label>
                        <input
                          type="number"
                          step="0.1"
                          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                          value={editingBot.risk.stopLossPercent}
                          onChange={(e) =>
                            setEditingBot({
                              ...editingBot,
                              risk: {
                                ...editingBot.risk,
                                stopLossPercent: Number(e.target.value),
                              },
                            })
                          }
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-medium text-gray-600">
                          익절 비율 (%)
                        </label>
                        <input
                          type="number"
                          step="0.1"
                          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                          value={editingBot.risk.takeProfitPercent}
                          onChange={(e) =>
                            setEditingBot({
                              ...editingBot,
                              risk: {
                                ...editingBot.risk,
                                takeProfitPercent: Number(e.target.value),
                              },
                            })
                          }
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="mb-1 block text-xs font-medium text-gray-600">
                          일일 최대 손실 (%)
                        </label>
                        <input
                          type="number"
                          step="0.1"
                          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                          value={editingBot.risk.maxDailyLossPercent}
                          onChange={(e) =>
                            setEditingBot({
                              ...editingBot,
                              risk: {
                                ...editingBot.risk,
                                maxDailyLossPercent: Number(e.target.value),
                              },
                            })
                          }
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-medium text-gray-600">
                          누적 최대 손실 (%)
                        </label>
                        <input
                          type="number"
                          step="0.1"
                          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                          value={editingBot.risk.maxTotalLossPercent}
                          onChange={(e) =>
                            setEditingBot({
                              ...editingBot,
                              risk: {
                                ...editingBot.risk,
                                maxTotalLossPercent: Number(e.target.value),
                              },
                            })
                          }
                        />
                      </div>
                    </div>
                  </div>
                </div>

                <div className="rounded-lg border border-gray-200 p-4">
                  <h3 className="mb-3 text-sm font-semibold text-gray-900">
                    포지션 관리
                  </h3>
                  <div className="space-y-3">
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border-gray-300"
                        checked={editingBot.position.preventDuplicateOrders}
                        onChange={(e) =>
                          setEditingBot({
                            ...editingBot,
                            position: {
                              ...editingBot.position,
                              preventDuplicateOrders: e.target.checked,
                            },
                          })
                        }
                      />
                      <span className="text-sm font-medium text-gray-700">
                        포지션 보유 중 신규 주문 금지
                      </span>
                    </label>

                    <div>
                      <label className="mb-1 block text-xs font-medium text-gray-600">
                        쿨다운 (캔들 수)
                      </label>
                      <input
                        type="number"
                        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                        value={editingBot.position.cooldownCandles}
                        min={0}
                        onChange={(e) =>
                          setEditingBot({
                            ...editingBot,
                            position: {
                              ...editingBot.position,
                              cooldownCandles: Number(e.target.value),
                            },
                          })
                        }
                      />
                      <p className="mt-1 text-xs text-gray-500">
                        주문 후 N개 캔들 동안 재진입 금지
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="mt-6 flex justify-end gap-3">
                <button
                  onClick={() => {
                    setEditingBot(null);
                    setValidationErrors([]);
                  }}
                  className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  취소
                </button>
                <button
                  onClick={saveBot}
                  className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
                >
                  저장
                </button>
              </div>
            </div>
          </div>
        )}

        {showRealTradeConfirm && pendingRealTradeBot && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
            <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
              <div className="mb-4 flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-red-100">
                  <span className="text-2xl">⚠️</span>
                </div>
                <h2 className="text-xl font-bold text-red-600">
                  실거래 전환 확인
                </h2>
              </div>

              <div className="mb-6 space-y-3 rounded-lg bg-gray-50 p-4 text-sm">
                <div className="flex justify-between">
                  <span className="font-medium text-gray-600">거래쌍:</span>
                  <span className="font-semibold text-gray-900">
                    {pendingRealTradeBot.baseAsset}
                    {pendingRealTradeBot.quoteAsset}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="font-medium text-gray-600">마켓:</span>
                  <span className="font-semibold text-gray-900">
                    {pendingRealTradeBot.market === 'spot' ? '현물' : '선물'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="font-medium text-gray-600">주문 금액:</span>
                  <span className="font-semibold text-gray-900">
                    ${pendingRealTradeBot.risk.orderQuoteAmount} USDT
                  </span>
                </div>
                {pendingRealTradeBot.market === 'futures' && (
                  <div className="flex justify-between">
                    <span className="font-medium text-gray-600">레버리지:</span>
                    <span className="font-semibold text-gray-900">
                      {pendingRealTradeBot.risk.leverage}x
                    </span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="font-medium text-gray-600">손절:</span>
                  <span className="font-semibold text-red-600">
                    -{pendingRealTradeBot.risk.stopLossPercent}%
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="font-medium text-gray-600">익절:</span>
                  <span className="font-semibold text-green-600">
                    +{pendingRealTradeBot.risk.takeProfitPercent}%
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="font-medium text-gray-600">전략:</span>
                  <span className="font-semibold text-gray-900">
                    MA {pendingRealTradeBot.strategy.fastPeriod}/
                    {pendingRealTradeBot.strategy.slowPeriod}
                  </span>
                </div>
              </div>

              <div className="mb-6 rounded-lg border-2 border-red-200 bg-red-50 p-4">
                <label className="flex cursor-pointer items-start gap-3">
                  <input
                    type="checkbox"
                    className="mt-1 h-5 w-5 rounded border-gray-300"
                    checked={realTradeAcknowledged}
                    onChange={(e) => setRealTradeAcknowledged(e.target.checked)}
                  />
                  <span className="text-sm font-medium text-red-900">
                    실제 자금이 사용되는 실거래임을 인지했으며, 손실 가능성을
                    이해했습니다.
                  </span>
                </label>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => {
                    setShowRealTradeConfirm(false);
                    setRealTradeAcknowledged(false);
                    setPendingRealTradeBot(null);
                  }}
                  className="flex-1 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  취소
                </button>
                <button
                  onClick={confirmRealTrade}
                  disabled={!realTradeAcknowledged}
                  className="flex-1 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  실거래 활성화
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
