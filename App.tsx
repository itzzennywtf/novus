
import React, { useState, useMemo, useEffect, useRef } from 'react';
import { AssetType, Investment, ViewState, PortfolioSummary, UserProfile } from './types';
import { ASSET_META } from './constants';
import { CustomPieChart, PerformanceLineChart, ProfitBarChart, ComparisonBarChart } from './components/Charts';
import { AssetCard } from './components/AssetCard';
import { getAssetSpecificInsights, getPortfolioAssistantReply, getHoldingPredictionFromLLM, getPortfolioRiskFromLLM, type AssistantChatTurn } from './services/geminiService';
import { fetchMarketData, calculateFDGrowth, searchInstruments, InstrumentSuggestion, fetchMutualFundSipSnapshot } from './services/priceService';
import { loadPortfolioState, savePortfolioState } from './services/supabaseService';

type ChatMessage = {
  id: string;
  role: 'assistant' | 'user';
  text: string;
  ts: string;
};

const AUTH_EMAIL = 'amitmahawa159@gmail.com';
const AUTH_PASSWORD = 'Amit@203';
const AUTH_STORAGE_KEY = 'novus_auth_ok';

const App: React.FC = () => {
  type TrendMode = 'current' | 'invested' | 'profit';
  type TrendRange = '6M' | '1Y' | '5Y' | '10Y';
  const getDateOnly = (value: string) => new Date(`${value}T00:00:00`);
  const startOfToday = () => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  };
  const startOfWeek = () => {
    const d = new Date();
    const day = d.getDay();
    const diff = day === 0 ? -6 : 1 - day; // Monday start
    d.setDate(d.getDate() + diff);
    d.setHours(0, 0, 0, 0);
    return d;
  };
  const startOfMonth = () => {
    const d = new Date();
    d.setDate(1);
    d.setHours(0, 0, 0, 0);
    return d;
  };
  const periodBaseline = (
    item: Investment,
    marketBaseline: number | undefined,
    periodStart: Date,
    usePurchaseFallback: boolean = true
  ) => {
    if (!marketBaseline) return undefined;
    if (!usePurchaseFallback) return marketBaseline;
    return getDateOnly(item.purchaseDate) >= periodStart ? item.purchasePrice : marketBaseline;
  };
  const [view, setView] = useState<ViewState>('HOME');
  const [selectedAsset, setSelectedAsset] = useState<AssetType | null>(null);
  const [selectedHolding, setSelectedHolding] = useState<Investment | null>(null);
  const [investments, setInvestments] = useState<Investment[]>([]);
  const [profile, setProfile] = useState<UserProfile>({ name: 'Investor', currency: 'Rs ' });
  
  const [aiInsight, setAiInsight] = useState<string | null>(null);
  const [isInsightLoading, setIsInsightLoading] = useState(false);
  const [aiMessages, setAiMessages] = useState<ChatMessage[]>([]);
  const [aiInput, setAiInput] = useState('');
  const [isAiChatLoading, setIsAiChatLoading] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [aiVoiceError, setAiVoiceError] = useState('');
  const [hasHydratedState, setHasHydratedState] = useState(false);
  const [supabaseError, setSupabaseError] = useState('');
  const [prediction, setPrediction] = useState<string | null>(null);
  const [holdingTrendData, setHoldingTrendData] = useState<{ trend6M: any[], trend1Y: any[], trend5Y: any[], trend10Y: any[] }>({
    trend6M: [], trend1Y: [], trend5Y: [], trend10Y: []
  });
  const [assetTrendData, setAssetTrendData] = useState<{ current6M: any[], invested6M: any[], profit6M: any[], current1Y: any[], invested1Y: any[], profit1Y: any[], current5Y: any[], invested5Y: any[], profit5Y: any[], current10Y: any[], invested10Y: any[], profit10Y: any[] }>({
    current6M: [], invested6M: [], profit6M: [], current1Y: [], invested1Y: [], profit1Y: [],
    current5Y: [], invested5Y: [], profit5Y: [], current10Y: [], invested10Y: [], profit10Y: []
  });
  const [isAssetTrendLoading, setIsAssetTrendLoading] = useState(false);
  const [trendRange, setTrendRange] = useState<TrendRange>('6M');
  const [assetTrendRange, setAssetTrendRange] = useState<TrendRange>('1Y');
  const [holdingPositionMode, setHoldingPositionMode] = useState<TrendMode>('current');
  const [portfolioTrendMode, setPortfolioTrendMode] = useState<TrendMode>('current');
  const [portfolioTrendRange, setPortfolioTrendRange] = useState<TrendRange>('1Y');
  const [portfolioTrendData, setPortfolioTrendData] = useState<{ current6M: any[], invested6M: any[], profit6M: any[], current1Y: any[], invested1Y: any[], profit1Y: any[], current5Y: any[], invested5Y: any[], profit5Y: any[], current10Y: any[], invested10Y: any[], profit10Y: any[] }>({
    current6M: [], invested6M: [], profit6M: [], current1Y: [], invested1Y: [], profit1Y: [],
    current5Y: [], invested5Y: [], profit5Y: [], current10Y: [], invested10Y: [], profit10Y: []
  });
  const [isPortfolioTrendLoading, setIsPortfolioTrendLoading] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState<{
    open: boolean;
    title: string;
    message: string;
    confirmText: string;
    onConfirm?: () => void;
  }>({ open: false, title: '', message: '', confirmText: 'Confirm' });
  const [riskDetailsOpen, setRiskDetailsOpen] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(() => localStorage.getItem(AUTH_STORAGE_KEY) === '1');
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authError, setAuthError] = useState('');

  // Asset Detail Toggles
  const [chartMode, setChartMode] = useState<TrendMode>('current');

  // Form State
  const [formStep, setFormStep] = useState(1);
  const [newAssetType, setNewAssetType] = useState<AssetType | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isSuggesting, setIsSuggesting] = useState(false);
  const [instrumentSuggestions, setInstrumentSuggestions] = useState<InstrumentSuggestion[]>([]);
  const [selectedSuggestion, setSelectedSuggestion] = useState<InstrumentSuggestion | null>(null);
  const [formData, setFormData] = useState({
    name: '', quantity: '', date: new Date().toISOString().split('T')[0],
    pricePaid: '', amount: '', interestRate: '7.0',
    sipMode: false, sipAmount: '', sipDay: '5'
  });
  const investmentsRef = useRef<Investment[]>(investments);
  const aiChatScrollRef = useRef<HTMLDivElement | null>(null);
  const speechRecognitionRef = useRef<any>(null);
  const trendStaticFingerprint = useMemo(
    () =>
      investments
        .map(
          (i) =>
            `${i.id}|${i.type}|${i.purchaseDate}|${i.investedAmount}|${i.quantity}|${i.trackingSymbol || i.name}|${i.isSip ? 1 : 0}|${i.sipAmount || 0}|${i.sipDay || 0}`
        )
        .join("||"),
    [investments]
  );

  const hydrateFromSupabase = async () => {
    setSupabaseError('');
    try {
      const cloud = await loadPortfolioState();
      if (cloud) {
        setInvestments(cloud.investments);
        setProfile(cloud.profile);
      } else {
        setInvestments([]);
      }
      setHasHydratedState(true);
    } catch (error) {
      console.warn('Supabase load failed:', error);
      setSupabaseError(String((error as any)?.message || error || 'Unknown Supabase error'));
      setHasHydratedState(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    const hydrateState = async () => {
      await hydrateFromSupabase();
      if (cancelled) return;
    };
    hydrateState();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    localStorage.setItem(AUTH_STORAGE_KEY, isAuthenticated ? '1' : '0');
  }, [isAuthenticated]);

  useEffect(() => {
    investmentsRef.current = investments;
  }, [investments]);

  useEffect(() => {
    if (!hasHydratedState) return;
    const timer = window.setTimeout(() => {
      savePortfolioState({ investments, profile })
        .catch((error) => console.warn('Supabase save failed:', error));
    }, 350);
    return () => window.clearTimeout(timer);
  }, [investments, profile, hasHydratedState]);

  useEffect(() => {
    if (!selectedHolding) return;
    const latest = investments.find(i => i.id === selectedHolding.id);
    if (latest) {
      setSelectedHolding(latest);
      return;
    }

    if (selectedHolding.memberIds && selectedHolding.memberIds.length > 0) {
      const mergedLatest = mergeHoldings(investments.filter(i => selectedHolding.memberIds?.includes(i.id)))
        .find(i => i.memberIds?.some(id => selectedHolding.memberIds?.includes(id)));
      if (mergedLatest) setSelectedHolding(mergedLatest);
    }
  }, [investments, selectedHolding?.id]);

  useEffect(() => {
    if (!aiChatScrollRef.current) return;
    aiChatScrollRef.current.scrollTop = aiChatScrollRef.current.scrollHeight;
  }, [aiMessages, isAiChatLoading, view]);

  useEffect(() => {
    return () => {
      try {
        speechRecognitionRef.current?.stop?.();
      } catch {
        // no-op
      }
    };
  }, []);

  useEffect(() => {
    if (!isAuthenticated) return;
    if (investments.length === 0) return;

    let cancelled = false;
    const refreshMarketValues = async () => {
      const snapshot = [...investmentsRef.current];
      const updates = await Promise.all(
        snapshot.map(async (item) => {
          try {
            if (item.type === AssetType.FIXED_DEPOSIT) {
              const current = calculateFDGrowth(item.investedAmount, item.interestRate || 7, item.purchaseDate);
              return { ...item, currentValue: current, lastUpdated: new Date().toISOString() };
            }
            if (item.type === AssetType.MUTUAL_FUNDS && item.isSip && item.trackingSymbol && item.sipAmount) {
              const sip = await fetchMutualFundSipSnapshot(
                item.trackingSymbol,
                item.purchaseDate,
                item.sipAmount,
                item.sipDay || 5
              );
              return {
                ...item,
                investedAmount: sip.investedAmount,
                quantity: sip.quantity,
                purchasePrice: sip.avgPurchasePrice,
                currentValue: sip.currentValue,
                lastUpdated: new Date().toISOString(),
                priceStartOfDay: sip.startOfDay,
                priceStartOfWeek: sip.startOfWeek,
                priceStartOfMonth: sip.startOfMonth,
              };
            }

            let fixedSymbol = item.trackingSymbol;
            if (!fixedSymbol && (item.type === AssetType.STOCKS || item.type === AssetType.MUTUAL_FUNDS)) {
              const picks = await searchInstruments(item.name, item.type);
              fixedSymbol = picks[0]?.symbol;
            }
            const searchName = item.type === AssetType.GOLD ? '24K Gold 1g India' : (fixedSymbol || item.name);
            const effectiveDate = item.type === AssetType.GOLD ? new Date().toISOString().split('T')[0] : item.purchaseDate;
            const market = await fetchMarketData(searchName, item.type, effectiveDate, { fixedSymbol, lite: true });
            const previousUnitPrice = item.quantity > 0 ? item.currentValue / item.quantity : 0;
            const nextUnitPrice = market.currentPrice;
            const ratio = previousUnitPrice > 0 ? nextUnitPrice / previousUnitPrice : 1;

            // Guard against bad symbol/data mismatches causing unrealistic jumps.
            if (
              (item.type === AssetType.STOCKS || item.type === AssetType.MUTUAL_FUNDS) &&
              previousUnitPrice > 0 &&
              (ratio > 2.5 || ratio < 0.4)
            ) {
              return item;
            }

            return {
              ...item,
              trackingSymbol: fixedSymbol || item.trackingSymbol,
              displaySymbol: item.displaySymbol || fixedSymbol || undefined,
              currentValue: market.currentPrice * item.quantity,
              lastUpdated: new Date().toISOString(),
              priceStartOfDay: periodBaseline(item, market.startOfDay, startOfToday(), item.type !== AssetType.GOLD),
              priceStartOfWeek: periodBaseline(item, market.startOfWeek, startOfWeek(), item.type !== AssetType.GOLD),
              priceStartOfMonth: periodBaseline(item, market.startOfMonth, startOfMonth(), item.type !== AssetType.GOLD),
            };
          } catch {
            return item;
          }
        })
      );

      if (cancelled) return;
      setInvestments(prev => prev.map(p => updates.find(u => u.id === p.id) || p));
    };

    refreshMarketValues();
    const id = window.setInterval(refreshMarketValues, 120000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [investments.length, isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated) return;
    if (view !== 'ASSET_DETAIL' || !selectedAsset) return;

    const assetHoldings = investments.filter(i => i.type === selectedAsset);
    if (assetHoldings.length === 0) {
      setAssetTrendData({
        current6M: [], invested6M: [], profit6M: [],
        current1Y: [], invested1Y: [], profit1Y: [],
        current5Y: [], invested5Y: [], profit5Y: [],
        current10Y: [], invested10Y: [], profit10Y: []
      });
      return;
    }

    let cancelled = false;
    const monthTimeline = buildMonthTimeline(120);

    const buildFdTrend = (item: Investment) => monthTimeline.map((p) => {
        const diffDays = Math.max(0, (p.date.getTime() - new Date(item.purchaseDate).getTime()) / (1000 * 60 * 60 * 24));
        const yearsPassed = diffDays / 365;
        const invested = p.date.getTime() >= new Date(item.purchaseDate).getTime() ? item.investedAmount : 0;
        const current = invested > 0 ? item.investedAmount * Math.pow(1 + ((item.interestRate || 7) / 400), 4 * yearsPassed) : 0;
        return { name: p.label, invested, current, profit: current - invested };
      });

    const loadAssetTrend = async () => {
      setIsAssetTrendLoading(true);
      try {
        const trendParts = await Promise.all(
          assetHoldings.map(async (item) => {
            if (item.type === AssetType.FIXED_DEPOSIT) {
              return buildFdTrend(item);
            }

            const searchName = item.type === AssetType.GOLD ? '24K Gold 1g India' : (item.trackingSymbol || item.name);
            const market = await fetchMarketData(searchName, item.type, item.purchaseDate, { fixedSymbol: item.trackingSymbol });
            const series = (market.trend10Y || market.trend5Y || market.trend1Y || []).filter(p => typeof p?.price === 'number' && !!p?.name);
            const purchaseTs = new Date(item.purchaseDate).getTime();
            const lastPrice = series.length ? series[series.length - 1].price : 0;
            const lastTrendValue = lastPrice * item.quantity;
            const trendScale = lastTrendValue > 0 ? item.currentValue / lastTrendValue : 1;

            return monthTimeline.map((t, idx) => {
              const isPurchased = t.date.getTime() >= purchaseTs;
              const unitPrice = series[idx]?.price ?? lastPrice;
              const current = isPurchased ? (unitPrice * item.quantity * trendScale) : 0;
              const invested = isPurchased ? item.investedAmount : 0;
              return { name: t.label, invested, current, profit: current - invested };
            });
          })
        );

        const current1Y = monthTimeline.map((t, idx) => ({
          name: t.label,
          price: Number(trendParts.reduce((sum, part) => sum + (part[idx]?.current || 0), 0).toFixed(2))
        }));
        const invested1Y = monthTimeline.map((t, idx) => ({
          name: t.label,
          price: Number(trendParts.reduce((sum, part) => sum + (part[idx]?.invested || 0), 0).toFixed(2))
        }));
        const profit1Y = monthTimeline.map((t, idx) => ({
          name: t.label,
          price: Number(trendParts.reduce((sum, part) => sum + (part[idx]?.profit || 0), 0).toFixed(2))
        }));

        if (!cancelled) {
          const current10Y = current1Y;
          const invested10Y = invested1Y;
          const profit10Y = profit1Y;
          const current5Y = current10Y.slice(-60);
          const invested5Y = invested10Y.slice(-60);
          const profit5Y = profit10Y.slice(-60);
          const currentYear = current10Y.slice(-12).map((p) => ({ ...p, name: p.name.split(' ')[0] }));
          const investedYear = invested10Y.slice(-12).map((p) => ({ ...p, name: p.name.split(' ')[0] }));
          const profitYear = profit10Y.slice(-12).map((p) => ({ ...p, name: p.name.split(' ')[0] }));

          setAssetTrendData({
            current10Y,
            invested10Y,
            profit10Y,
            current5Y,
            invested5Y,
            profit5Y,
            current1Y: currentYear,
            invested1Y: investedYear,
            profit1Y: profitYear,
            current6M: currentYear.slice(-6),
            invested6M: investedYear.slice(-6),
            profit6M: profitYear.slice(-6),
          });
        }
      } catch (e) {
        console.error(e);
        if (!cancelled) setAssetTrendData({
          current6M: [], invested6M: [], profit6M: [],
          current1Y: [], invested1Y: [], profit1Y: [],
          current5Y: [], invested5Y: [], profit5Y: [],
          current10Y: [], invested10Y: [], profit10Y: []
        });
      } finally {
        if (!cancelled) setIsAssetTrendLoading(false);
      }
    };

    loadAssetTrend();
    return () => { cancelled = true; };
  }, [view, selectedAsset, trendStaticFingerprint, isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated) return;
    if (view !== 'REPORTS') return;
    if (investments.length === 0) {
      setPortfolioTrendData({
        current6M: [], invested6M: [], profit6M: [],
        current1Y: [], invested1Y: [], profit1Y: [],
        current5Y: [], invested5Y: [], profit5Y: [],
        current10Y: [], invested10Y: [], profit10Y: []
      });
      return;
    }

    let cancelled = false;
    const monthTimeline = buildMonthTimeline(120);

    const buildFdTrend = (item: Investment) => monthTimeline.map((p) => {
      const diffDays = Math.max(0, (p.date.getTime() - new Date(item.purchaseDate).getTime()) / (1000 * 60 * 60 * 24));
      const yearsPassed = diffDays / 365;
      const invested = p.date.getTime() >= new Date(item.purchaseDate).getTime() ? item.investedAmount : 0;
      const current = invested > 0 ? item.investedAmount * Math.pow(1 + ((item.interestRate || 7) / 400), 4 * yearsPassed) : 0;
      return { invested, current, profit: current - invested };
    });

    const loadPortfolioTrend = async () => {
      setIsPortfolioTrendLoading(true);
      try {
        const trendParts = await Promise.all(
          investments.map(async (item) => {
            if (item.type === AssetType.FIXED_DEPOSIT) return buildFdTrend(item);

            const searchName = item.type === AssetType.GOLD ? '24K Gold 1g India' : (item.trackingSymbol || item.name);
            const market = await fetchMarketData(searchName, item.type, item.purchaseDate, { fixedSymbol: item.trackingSymbol });
            const series = (market.trend10Y || market.trend5Y || market.trend1Y || []).filter(p => typeof p?.price === 'number');
            const purchaseTs = new Date(item.purchaseDate).getTime();
            const lastPrice = series.length ? series[series.length - 1].price : 0;
            const lastTrendValue = lastPrice * item.quantity;
            const trendScale = lastTrendValue > 0 ? item.currentValue / lastTrendValue : 1;

            return monthTimeline.map((t, idx) => {
              const isPurchased = t.date.getTime() >= purchaseTs;
              const unitPrice = series[idx]?.price ?? lastPrice;
              const current = isPurchased ? (unitPrice * item.quantity * trendScale) : 0;
              const invested = isPurchased ? item.investedAmount : 0;
              return { invested, current, profit: current - invested };
            });
          })
        );

        const current1Y = monthTimeline.map((t, idx) => ({ name: t.label, price: Number(trendParts.reduce((sum, part) => sum + (part[idx]?.current || 0), 0).toFixed(2)) }));
        const invested1Y = monthTimeline.map((t, idx) => ({ name: t.label, price: Number(trendParts.reduce((sum, part) => sum + (part[idx]?.invested || 0), 0).toFixed(2)) }));
        const profit1Y = monthTimeline.map((t, idx) => ({ name: t.label, price: Number(trendParts.reduce((sum, part) => sum + (part[idx]?.profit || 0), 0).toFixed(2)) }));

        if (!cancelled) {
          const current10Y = current1Y;
          const invested10Y = invested1Y;
          const profit10Y = profit1Y;
          const current5Y = current10Y.slice(-60);
          const invested5Y = invested10Y.slice(-60);
          const profit5Y = profit10Y.slice(-60);
          const currentYear = current10Y.slice(-12).map((p) => ({ ...p, name: p.name.split(' ')[0] }));
          const investedYear = invested10Y.slice(-12).map((p) => ({ ...p, name: p.name.split(' ')[0] }));
          const profitYear = profit10Y.slice(-12).map((p) => ({ ...p, name: p.name.split(' ')[0] }));

          setPortfolioTrendData({
            current10Y,
            invested10Y,
            profit10Y,
            current5Y,
            invested5Y,
            profit5Y,
            current1Y: currentYear,
            invested1Y: investedYear,
            profit1Y: profitYear,
            current6M: currentYear.slice(-6),
            invested6M: investedYear.slice(-6),
            profit6M: profitYear.slice(-6),
          });
        }
      } catch (e) {
        console.error(e);
        if (!cancelled) setPortfolioTrendData({
          current6M: [], invested6M: [], profit6M: [],
          current1Y: [], invested1Y: [], profit1Y: [],
          current5Y: [], invested5Y: [], profit5Y: [],
          current10Y: [], invested10Y: [], profit10Y: []
        });
      } finally {
        if (!cancelled) setIsPortfolioTrendLoading(false);
      }
    };

    loadPortfolioTrend();
    return () => { cancelled = true; };
  }, [trendStaticFingerprint, isAuthenticated, view]);

  useEffect(() => {
    if (view !== 'ADD_FLOW' || formStep !== 2) return;
    if (newAssetType !== AssetType.STOCKS && newAssetType !== AssetType.MUTUAL_FUNDS) {
      setInstrumentSuggestions([]);
      setIsSuggesting(false);
      return;
    }

    const query = formData.name.trim();
    const minChars = newAssetType === AssetType.STOCKS ? 3 : 2;
    if (query.length < minChars) {
      setInstrumentSuggestions([]);
      setIsSuggesting(false);
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setIsSuggesting(true);
      try {
        const results = await searchInstruments(query, newAssetType);
        if (!cancelled) setInstrumentSuggestions(results.slice(0, 3));
      } catch {
        if (!cancelled) setInstrumentSuggestions([]);
      } finally {
        if (!cancelled) setIsSuggesting(false);
      }
    }, 850);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [view, formStep, newAssetType, formData.name]);

  useEffect(() => {
    setSelectedSuggestion(null);
    setInstrumentSuggestions([]);
  }, [newAssetType]);

  const shortenLabel = (text: string) => text.trim().split(/\s+/).slice(0, 3).join(' ');
  const trimLeadingZeroPoints = (points: { name: string; price: number }[]) => {
    if (!points.length) return points;
    const idx = points.findIndex((p) => Math.abs(Number(p.price || 0)) > 0.0001);
    if (idx <= 0) return points;
    return points.slice(idx);
  };
  const formatOneDecimal = (value: number) =>
    value.toLocaleString('en-IN', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const formatNav = (value: number) =>
    value.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  const amountTextClass = (value: number, mode: 'hero' | 'section' | 'holding' = 'section') => {
    const len = formatOneDecimal(value).length;
    if (mode === 'hero') {
      if (len >= 16) return 'text-[clamp(1.55rem,8.6vw,2.4rem)]';
      if (len >= 13) return 'text-[clamp(1.9rem,10vw,3rem)]';
      return 'text-[clamp(2.3rem,11vw,3.9rem)]';
    }
    if (mode === 'holding') {
      if (len >= 16) return 'text-[clamp(1.35rem,7vw,2rem)]';
      if (len >= 13) return 'text-[clamp(1.6rem,8.4vw,2.5rem)]';
      return 'text-[clamp(1.9rem,9.5vw,3.1rem)]';
    }
    if (len >= 16) return 'text-[clamp(1.4rem,7.6vw,2rem)]';
    if (len >= 13) return 'text-[clamp(1.7rem,8.8vw,2.6rem)]';
    return 'text-[clamp(2rem,10vw,3.2rem)]';
  };
  const buildMonthTimeline = (months: number) => Array.from({ length: months }, (_, idx) => {
    const d = new Date();
    d.setMonth(d.getMonth() - (months - 1 - idx));
    d.setDate(28);
    d.setHours(12, 0, 0, 0);
    const label = months > 12
      ? d.toLocaleString('en-US', { month: 'short', year: '2-digit' })
      : d.toLocaleString('en-US', { month: 'short' });
    return { label, date: d };
  });

  const mergeHoldings = (items: Investment[]): Investment[] => {
    const merged = new Map<string, Investment>();

    items.forEach((item) => {
      const shouldMerge = item.type === AssetType.STOCKS || item.type === AssetType.MUTUAL_FUNDS;
      const key = shouldMerge ? `${item.type}:${item.trackingSymbol || item.name.toUpperCase()}` : `${item.id}`;

      if (!merged.has(key)) {
        merged.set(key, {
          ...item,
          memberIds: [item.id],
        });
        return;
      }

      const prev = merged.get(key)!;
      const totalQty = prev.quantity + item.quantity;
      const startDayValue = (prev.priceStartOfDay || 0) * prev.quantity + (item.priceStartOfDay || 0) * item.quantity;
      const startWeekValue = (prev.priceStartOfWeek || 0) * prev.quantity + (item.priceStartOfWeek || 0) * item.quantity;
      const startMonthValue = (prev.priceStartOfMonth || 0) * prev.quantity + (item.priceStartOfMonth || 0) * item.quantity;

      merged.set(key, {
        ...prev,
        quantity: totalQty,
        investedAmount: prev.investedAmount + item.investedAmount,
        currentValue: prev.currentValue + item.currentValue,
        purchasePrice: totalQty > 0 ? (prev.investedAmount + item.investedAmount) / totalQty : prev.purchasePrice,
        purchaseDate: new Date(item.purchaseDate) < new Date(prev.purchaseDate) ? item.purchaseDate : prev.purchaseDate,
        lastUpdated: new Date(item.lastUpdated) > new Date(prev.lastUpdated) ? item.lastUpdated : prev.lastUpdated,
        priceStartOfDay: totalQty > 0 ? startDayValue / totalQty : prev.priceStartOfDay,
        priceStartOfWeek: totalQty > 0 ? startWeekValue / totalQty : prev.priceStartOfWeek,
        priceStartOfMonth: totalQty > 0 ? startMonthValue / totalQty : prev.priceStartOfMonth,
        isSip: Boolean(prev.isSip || item.isSip),
        sipAmount: (prev.sipAmount || 0) + (item.sipAmount || 0) || undefined,
        memberIds: [...(prev.memberIds || []), item.id],
      });
    });

    return Array.from(merged.values());
  };

  const computeRiskRating = (items: Investment[]) => {
    const byType = Object.values(AssetType).reduce((acc, type) => {
      acc[type] = 0;
      return acc;
    }, {} as Record<AssetType, number>);

    let total = 0;
    items.forEach((item) => {
      const value = Math.max(0, item.currentValue || 0);
      total += value;
      byType[item.type] += value;
    });

    if (total <= 0) {
      return {
        score: 0,
        label: "No Data",
        colorClass: "text-slate-300",
        note: "Add holdings to generate a real portfolio risk profile.",
        categoryBreakdown: [] as Array<{ type: AssetType; label: string; value: number; share: number; score: number; level: string }>,
        factors: [] as string[],
      };
    }

    const safeShare = (byType[AssetType.GOLD] + byType[AssetType.FIXED_DEPOSIT]) / total;
    const growthShare = (byType[AssetType.STOCKS] + byType[AssetType.MUTUAL_FUNDS]) / total;
    const baseRiskByType: Record<AssetType, number> = {
      [AssetType.STOCKS]: 78,
      [AssetType.MUTUAL_FUNDS]: 62,
      [AssetType.GOLD]: 28,
      [AssetType.FIXED_DEPOSIT]: 15,
    };

    const typeShares = Object.values(AssetType).map((type) => ({
      type,
      label: ASSET_META[type].label,
      share: byType[type] / total,
    }));
    const topType = typeShares.sort((a, b) => b.share - a.share)[0];

    const merged = mergeHoldings(items);
    const topHolding = merged.reduce(
      (best, item) => {
        const share = item.currentValue > 0 ? item.currentValue / total : 0;
        if (share > best.share) return { name: item.name, share };
        return best;
      },
      { name: "N/A", share: 0 }
    );
    const maxHoldingShare = topHolding.share;

    let score = 35;
    score += growthShare * 35;
    score -= safeShare * 18;
    score += Math.max(0, maxHoldingShare - 0.25) * 55;
    score += Math.max(0, topType.share - 0.5) * 40;
    if (merged.length <= 2) score += 8;
    score = Math.max(0, Math.min(100, score));

    let label = "Low";
    let colorClass = "text-emerald-400";
    if (score > 80) {
      label = "High";
      colorClass = "text-rose-400";
    } else if (score > 65) {
      label = "Moderate High";
      colorClass = "text-orange-400";
    } else if (score > 45) {
      label = "Moderate";
      colorClass = "text-amber-400";
    } else if (score > 25) {
      label = "Moderate Low";
      colorClass = "text-emerald-400";
    }

    const note = `${topType.label} is ${Math.round(topType.share * 100)}% of wealth, safe assets are ${Math.round(
      safeShare * 100
    )}%, largest holding is ${Math.round(maxHoldingShare * 100)}%.`;
    const categoryBreakdown = Object.values(AssetType).map((type) => {
      const share = byType[type] / total;
      const rawScore = baseRiskByType[type] + share * 35;
      const categoryScore = Math.max(0, Math.min(100, rawScore));
      const level = categoryScore > 80 ? "High" : categoryScore > 60 ? "Moderate High" : categoryScore > 35 ? "Moderate" : "Low";
      return {
        type,
        label: ASSET_META[type].label,
        value: byType[type],
        share,
        score: Math.round(categoryScore),
        level,
      };
    });
    const factors = [
      `Growth assets (Stocks + MF): ${Math.round(growthShare * 100)}%`,
      `Defensive assets (Gold + FD): ${Math.round(safeShare * 100)}%`,
      `Largest category: ${topType.label} (${Math.round(topType.share * 100)}%)`,
      `Largest holding: ${topHolding.name} (${Math.round(topHolding.share * 100)}%)`,
      `Diversification units: ${merged.length}`,
    ];

    return { score, label, colorClass, note, categoryBreakdown, factors };
  };

  const summary: PortfolioSummary = useMemo(() => {
    let totalInvested = 0, totalCurrent = 0, todayRet = 0, weekRet = 0, monthRet = 0;
    investments.forEach(i => {
      totalInvested += i.investedAmount;
      totalCurrent += i.currentValue;
      if (i.type === AssetType.FIXED_DEPOSIT) {
        const dailyGrowth = (i.currentValue - i.investedAmount) / 365;
        todayRet += dailyGrowth; weekRet += dailyGrowth * 7; monthRet += dailyGrowth * 30;
      } else {
        const qty = i.quantity;
        if (i.priceStartOfDay) todayRet += (i.currentValue - (i.priceStartOfDay * qty));
        if (i.priceStartOfWeek) weekRet += (i.currentValue - (i.priceStartOfWeek * qty));
        if (i.priceStartOfMonth) monthRet += (i.currentValue - (i.priceStartOfMonth * qty));
      }
    });
    const gain = totalCurrent - totalInvested;
    return {
      totalInvested, totalCurrentValue: totalCurrent, overallGain: gain,
      overallGainPercentage: totalInvested > 0 ? (gain / totalInvested) * 100 : 0,
      todayReturn: todayRet, weekReturn: weekRet, monthReturn: monthRet
    };
  }, [investments]);
  const baseRiskProfile = useMemo(() => computeRiskRating(investments), [investments]);
  const [riskProfile, setRiskProfile] = useState(baseRiskProfile);

  const riskColorClass = (label: string) => {
    if (label === 'High') return 'text-rose-400';
    if (label === 'Moderate High') return 'text-orange-400';
    if (label === 'Moderate') return 'text-amber-400';
    if (label === 'No Data') return 'text-slate-300';
    return 'text-emerald-400';
  };

  useEffect(() => {
    setRiskProfile(baseRiskProfile);
  }, [baseRiskProfile]);

  useEffect(() => {
    let cancelled = false;
    const loadLlmRisk = async () => {
      if (!investments.length) {
        if (!cancelled) setRiskProfile(baseRiskProfile);
        return;
      }
      try {
        const llmRisk = await getPortfolioRiskFromLLM(investments);
        if (cancelled) return;
        setRiskProfile({
          ...baseRiskProfile,
          ...llmRisk,
          colorClass: riskColorClass(llmRisk.label),
          categoryBreakdown: llmRisk.categoryBreakdown?.length ? llmRisk.categoryBreakdown : baseRiskProfile.categoryBreakdown,
          factors: llmRisk.factors?.length ? llmRisk.factors : baseRiskProfile.factors,
          note: llmRisk.note || baseRiskProfile.note,
        });
      } catch {
        if (!cancelled) setRiskProfile(baseRiskProfile);
      }
    };
    loadLlmRisk();
    return () => { cancelled = true; };
  }, [investments, baseRiskProfile]);

  const fetchInsights = async () => {
    if (investments.length === 0) {
      const emptyText = "Abhi aapka command center khaali hai. Shuruaat karne ke liye apna pehla nivesh record karein.";
      setAiInsight(emptyText);
      setAiMessages(prev => prev.length ? prev : [{
        id: `${Date.now()}-seed`,
        role: 'assistant',
        text: emptyText,
        ts: new Date().toISOString()
      }]);
      return;
    }
    setIsInsightLoading(true);
    try {
      const insight = await getAssetSpecificInsights(investments);
      setAiInsight(insight);
      setAiMessages(prev => prev.length ? prev : [{
        id: `${Date.now()}-seed`,
        role: 'assistant',
        text: insight,
        ts: new Date().toISOString()
      }]);
    } catch (error) {
      const fallback = "Market sanket sthir wealth creation dikha rahe hain. Apne SIP nivesh ko niyamit rakhein.";
      setAiInsight(fallback);
      setAiMessages(prev => prev.length ? prev : [{
        id: `${Date.now()}-seed`,
        role: 'assistant',
        text: fallback,
        ts: new Date().toISOString()
      }]);
    } finally {
      setIsInsightLoading(false);
    }
  };

  const sendAiMessage = async (rawText?: string) => {
    const text = (rawText ?? aiInput).trim();
    if (!text || isAiChatLoading) return;

    const assistantId = `${Date.now()}-assistant`;
    const userMsg: ChatMessage = {
      id: `${Date.now()}-user`,
      role: 'user',
      text,
      ts: new Date().toISOString()
    };
    const historyForModel: AssistantChatTurn[] = aiMessages
      .filter(m => (m.role === 'user' || m.role === 'assistant') && m.text.trim().length > 0)
      .slice(-8)
      .map(m => ({ role: m.role, content: m.text }));
    setAiMessages(prev => [...prev, userMsg]);
    setAiInput('');
    setIsAiChatLoading(true);

    try {
      const reply = await getPortfolioAssistantReply(investmentsRef.current, text, historyForModel);
      const botMsg: ChatMessage = {
        id: assistantId,
        role: 'assistant',
        text: reply,
        ts: new Date().toISOString()
      };
      setAiMessages(prev => [...prev, botMsg]);
    } catch {
      const botMsg: ChatMessage = {
        id: assistantId,
        role: 'assistant',
        text: "Main abhi ise process nahi kar paaya. Kripya thodi der baad phir se koshish karein.",
        ts: new Date().toISOString()
      };
      setAiMessages(prev => [...prev, botMsg]);
    } finally {
      setIsAiChatLoading(false);
    }
  };

  const toggleVoiceInput = () => {
    const SpeechRecognitionCtor =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognitionCtor) {
      setAiVoiceError('Is browser me voice input support nahi hai.');
      return;
    }

    if (isListening) {
      try {
        speechRecognitionRef.current?.stop?.();
      } catch {
        // no-op
      }
      setIsListening(false);
      return;
    }

    setAiVoiceError('');
    const recognition = new SpeechRecognitionCtor();
    recognition.lang = 'hi-IN';
    recognition.interimResults = true;
    recognition.continuous = false;

    recognition.onresult = (event: any) => {
      let transcript = '';
      for (let i = 0; i < event.results.length; i += 1) {
        if (event.results[i]?.isFinal) {
          transcript += event.results[i][0]?.transcript || '';
        }
      }
      if (transcript.trim()) {
        setAiInput((prev) => `${prev} ${transcript}`.trim());
      }
    };

    recognition.onerror = (event: any) => {
      const code = event?.error ? ` (${event.error})` : '';
      setAiVoiceError(`Voice input fail hua${code}. Kripya dobara koshish karein.`);
      setIsListening(false);
    };

    recognition.onend = () => {
      setIsListening(false);
    };

    speechRecognitionRef.current = recognition;
    recognition.start();
    setIsListening(true);
  };

  const handleLogin = () => {
    const email = authEmail.trim().toLowerCase();
    const password = authPassword;
    if (email === AUTH_EMAIL && password === AUTH_PASSWORD) {
      setIsAuthenticated(true);
      setAuthError('');
      setAuthPassword('');
      return;
    }
    setAuthError('Invalid email or password');
  };

  const handleLogout = () => {
    setIsAuthenticated(false);
    setAuthEmail('');
    setAuthPassword('');
    setAuthError('');
    setView('HOME');
    setRiskDetailsOpen(false);
  };

  const navigateToHolding = async (holding: Investment) => {
    setSelectedHolding(holding);
    setView('HOLDING_DETAIL');
    setIsProcessing(true);
    try {
      const [pred, mData] = await Promise.all([
        getHoldingPredictionFromLLM(holding),
        fetchMarketData(holding.name, holding.type, holding.purchaseDate, { fixedSymbol: holding.trackingSymbol })
      ]);
      setPrediction(pred);
      setHoldingTrendData({
        trend6M: mData.trend6M || [],
        trend1Y: mData.trend1Y || [],
        trend5Y: mData.trend5Y || [],
        trend10Y: mData.trend10Y || []
      });
    } catch (e) {
      console.error(e);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleSell = (id: string, memberIds?: string[]) => {
    setConfirmDialog({
      open: true,
      title: 'Delete Asset',
      message: 'Delete this record? It will be permanently removed from your active ledger.',
      confirmText: 'Delete',
      onConfirm: () => {
        const toDelete = new Set(memberIds && memberIds.length ? memberIds : [id]);
        setInvestments(prev => prev.filter(i => !toDelete.has(i.id)));
        setView('HOME');
      }
    });
  };

  const processNewInvestment = async () => {
    setIsProcessing(true);
    try {
      let invAmt = 0, curVal = 0, purPr = 0, qty = parseFloat(formData.quantity) || 1;
      let sDay, sWeek, sMonth;
      let trackingSymbol: string | undefined;
      let displaySymbol: string | undefined;
      let displayName = formData.name.trim();
      const isMfSip = newAssetType === AssetType.MUTUAL_FUNDS && formData.sipMode;
      const sipAmount = parseFloat(formData.sipAmount) || 0;
      const sipDay = Math.max(1, Math.min(28, parseInt(formData.sipDay || '5', 10) || 5));

      if (newAssetType === AssetType.FIXED_DEPOSIT) {
        invAmt = parseFloat(formData.amount); purPr = invAmt; qty = 1;
        curVal = calculateFDGrowth(invAmt, parseFloat(formData.interestRate), formData.date);
      } else {
        if (newAssetType === AssetType.STOCKS || newAssetType === AssetType.MUTUAL_FUNDS) {
          const picked = selectedSuggestion || (await searchInstruments(formData.name, newAssetType))[0];
          if (picked) {
            trackingSymbol = picked.symbol;
            displaySymbol = picked.symbol;
            displayName = picked.label;
          } else if (newAssetType === AssetType.MUTUAL_FUNDS) {
            const manualCode = formData.name.match(/\d{5,8}/)?.[0];
            if (manualCode) {
              trackingSymbol = manualCode;
              displaySymbol = manualCode;
            }
          }
        }

        if (isMfSip) {
          if (!trackingSymbol) {
            throw new Error('Select a mutual fund from suggestions or enter valid scheme code.');
          }
          if (!Number.isFinite(sipAmount) || sipAmount <= 0) {
            throw new Error('Enter valid SIP amount.');
          }
          const sip = await fetchMutualFundSipSnapshot(trackingSymbol, formData.date, sipAmount, sipDay);
          invAmt = sip.investedAmount;
          qty = sip.quantity;
          purPr = sip.avgPurchasePrice;
          curVal = sip.currentValue;
          sDay = sip.startOfDay;
          sWeek = sip.startOfWeek;
          sMonth = sip.startOfMonth;
        } else {
        const searchName = newAssetType === AssetType.GOLD ? '24K Gold 1g India' : (trackingSymbol || formData.name);
        const effectiveDate = newAssetType === AssetType.GOLD ? new Date().toISOString().split('T')[0] : formData.date;
        const market = await fetchMarketData(searchName, newAssetType!, effectiveDate, { fixedSymbol: trackingSymbol });
        purPr = newAssetType === AssetType.GOLD ? parseFloat(formData.pricePaid) : market.historicalPrice;
        invAmt = purPr * qty;
        curVal = market.currentPrice * qty;
        const pseudoItem = { purchaseDate: formData.date, purchasePrice: purPr } as Investment;
        const usePurchaseFallback = newAssetType !== AssetType.GOLD;
        sDay = periodBaseline(pseudoItem, market.startOfDay, startOfToday(), usePurchaseFallback);
        sWeek = periodBaseline(pseudoItem, market.startOfWeek, startOfWeek(), usePurchaseFallback);
        sMonth = periodBaseline(pseudoItem, market.startOfMonth, startOfMonth(), usePurchaseFallback);
        }
      }

      const newInv: Investment = {
        id: Math.random().toString(36).substr(2, 9),
        name: displayName || formData.name, type: newAssetType!, trackingSymbol, displaySymbol, investedAmount: invAmt, currentValue: curVal,
        quantity: qty, purchasePrice: purPr, purchaseDate: formData.date, lastUpdated: new Date().toISOString(),
        priceStartOfDay: sDay, priceStartOfWeek: sWeek, priceStartOfMonth: sMonth,
        interestRate: newAssetType === AssetType.FIXED_DEPOSIT ? parseFloat(formData.interestRate) : undefined,
        isSip: isMfSip || undefined,
        sipAmount: isMfSip ? sipAmount : undefined,
        sipDay: isMfSip ? sipDay : undefined,
        sipFrequency: isMfSip ? 'MONTHLY' : undefined
      };

      setInvestments(prev => [...prev, newInv]);
      setFormStep(1); setNewAssetType(null); setView('HOME');
      setSelectedSuggestion(null);
      setInstrumentSuggestions([]);
      setFormData({ name: '', quantity: '', date: new Date().toISOString().split('T')[0], pricePaid: '', amount: '', interestRate: '7.0', sipMode: false, sipAmount: '', sipDay: '5' });
    } catch (e) {
      alert("Recording failed. Check your connection.");
    } finally {
      setIsProcessing(false);
    }
  };

  const ReturnPill = ({ label, value }: { label: string, value: number }) => (
    <div className="bg-white/5 backdrop-blur-md p-3 rounded-2xl border border-white/5 flex flex-col items-center min-w-0">
      <span className="text-[8px] font-black uppercase tracking-[0.2em] text-white/40 mb-1">{label}</span>
      <span className={`text-[clamp(0.82rem,3.1vw,0.96rem)] leading-none whitespace-nowrap tabular-nums font-black ${value >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
        {value >= 0 ? '+' : '-'}{profile.currency}{Math.abs(value).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
      </span>
    </div>
  );

  const renderHome = () => (
    <div className="space-y-8 animate-in fade-in pb-24">
      <section className="bg-slate-900 text-white p-7 sm:p-10 rounded-[2.75rem] sm:rounded-[4rem] premium-shadow relative overflow-hidden">
        <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-500/20 rounded-full -mr-32 -mt-32 blur-[100px]"></div>
        <div className="relative z-10 text-center">
          <p className="text-white/30 text-[10px] font-black uppercase tracking-[0.4em] mb-4">Total Wealth</p>
          <h2 className={`${amountTextClass(summary.totalCurrentValue, 'hero')} font-black tracking-tighter leading-none mb-8 whitespace-nowrap`}>
            {profile.currency}{formatOneDecimal(summary.totalCurrentValue)}
          </h2>
          <p className="text-white/50 text-[clamp(0.58rem,2.5vw,0.72rem)] font-black uppercase tracking-[0.2em] mb-4 whitespace-nowrap">
            Invested Value: {profile.currency}{summary.totalInvested.toLocaleString('en-IN')}
          </p>
          <div className="grid grid-cols-3 gap-3">
             <ReturnPill label="Today" value={summary.todayReturn} />
             <ReturnPill label="Month" value={summary.monthReturn} />
             <ReturnPill label="Total" value={summary.overallGain} />
          </div>
        </div>
      </section>

      <section className="px-2">
        <div className="flex justify-between items-end mb-6">
           <div>
              <h3 className="text-slate-900 font-black text-2xl tracking-tight">Active Shelves</h3>
              <p className="text-slate-400 text-xs font-bold uppercase tracking-widest mt-1">Portfolio Snapshot</p>
           </div>
        </div>
        <div className="grid grid-cols-2 gap-5">
          {Object.values(AssetType).map(type => {
            const filtered = investments.filter(i => i.type === type);
            const val = filtered.reduce((sum, i) => sum + i.currentValue, 0);
            const gain = val - filtered.reduce((sum, i) => sum + i.investedAmount, 0);
            return <AssetCard key={type} type={type} totalValue={val} returns={gain} onClick={() => { setSelectedAsset(type); setView('ASSET_DETAIL'); }} />;
          })}
        </div>
      </section>
    </div>
  );

  const renderAssetDetail = () => {
    if (!selectedAsset) return null;
    const meta = ASSET_META[selectedAsset];
    const rawAssetHoldings = investments
      .filter(i => i.type === selectedAsset)
      .sort((a, b) => new Date(b.purchaseDate).getTime() - new Date(a.purchaseDate).getTime());
    const assetHoldings = mergeHoldings(rawAssetHoldings);
    
    const pieData = assetHoldings.map(i => ({ 
      name: shortenLabel(i.name), 
      value: chartMode === 'profit' ? Math.max(0, i.currentValue - i.investedAmount) : (chartMode === 'invested' ? i.investedAmount : i.currentValue), 
      color: `hsl(${Math.random() * 360}, 65%, 55%)` 
    })).filter(d => d.value > 0);

    const assetSummary = assetHoldings.reduce((acc, i) => {
      acc.total += i.currentValue;
      acc.invested += i.investedAmount;
      if (i.priceStartOfDay) acc.daily += (i.currentValue - (i.priceStartOfDay * i.quantity));
      if (i.priceStartOfMonth) acc.monthly += (i.currentValue - (i.priceStartOfMonth * i.quantity));
      return acc;
    }, { total: 0, invested: 0, daily: 0, monthly: 0 });
    const assetTotalChange = assetSummary.total - assetSummary.invested;
    const categoryTrendData = chartMode === 'invested'
      ? (assetTrendRange === '6M' ? assetTrendData.invested6M : assetTrendRange === '1Y' ? assetTrendData.invested1Y : assetTrendRange === '5Y' ? assetTrendData.invested5Y : assetTrendData.invested10Y)
      : chartMode === 'profit'
      ? (assetTrendRange === '6M' ? assetTrendData.profit6M : assetTrendRange === '1Y' ? assetTrendData.profit1Y : assetTrendRange === '5Y' ? assetTrendData.profit5Y : assetTrendData.profit10Y)
      : (assetTrendRange === '6M' ? assetTrendData.current6M : assetTrendRange === '1Y' ? assetTrendData.current1Y : assetTrendRange === '5Y' ? assetTrendData.current5Y : assetTrendData.current10Y);
    const visibleCategoryTrendData = trimLeadingZeroPoints(categoryTrendData);

    return (
      <div className="space-y-8 animate-in fade-in pb-24">
        <div className="flex items-center gap-5">
          <button onClick={() => setView('HOME')} className="p-5 bg-white rounded-[2rem] premium-shadow text-slate-400 active:scale-90 transition-transform"><svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M15 19l-7-7 7-7" /></svg></button>
          <h2 className="text-3xl font-black text-slate-900 tracking-tight">{meta.label}</h2>
        </div>

        <div className={`p-7 sm:p-10 rounded-[2.75rem] sm:rounded-[4rem] ${meta.bg} relative shadow-sm`}>
           <p className="text-slate-500 text-[10px] font-black uppercase mb-2">Shelf Value</p>
           <h3 className={`${amountTextClass(assetSummary.total, 'section')} font-black text-slate-900 tracking-tighter leading-none whitespace-nowrap`}>{profile.currency}{assetSummary.total.toLocaleString('en-IN')}</h3>
           <p className="text-slate-500 text-[clamp(0.58rem,2.5vw,0.72rem)] font-black uppercase tracking-[0.16em] mt-2 whitespace-nowrap">
             Invested Value: {profile.currency}{assetSummary.invested.toLocaleString('en-IN')}
           </p>
           <div className="grid grid-cols-3 gap-3 mt-6">
              <div className="bg-white/50 backdrop-blur rounded-3xl p-4 min-w-0">
                 <p className="text-[8px] font-black uppercase text-slate-400 mb-1">Today</p>
                 <p className={`font-black text-sm whitespace-nowrap tabular-nums ${assetSummary.daily >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{assetSummary.daily >= 0 ? '+' : '-'}{profile.currency}{Math.abs(assetSummary.daily).toLocaleString('en-IN')}</p>
              </div>
              <div className="bg-white/50 backdrop-blur rounded-3xl p-4 min-w-0">
                 <p className="text-[8px] font-black uppercase text-slate-400 mb-1">Monthly</p>
                 <p className={`font-black text-sm whitespace-nowrap tabular-nums ${assetSummary.monthly >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{assetSummary.monthly >= 0 ? '+' : '-'}{profile.currency}{Math.abs(assetSummary.monthly).toLocaleString('en-IN')}</p>
              </div>
              <div className="bg-white/50 backdrop-blur rounded-3xl p-4 min-w-0">
                 <p className="text-[8px] font-black uppercase text-slate-400 mb-1">Total</p>
                 <p className={`font-black text-sm whitespace-nowrap tabular-nums ${assetTotalChange >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{assetTotalChange >= 0 ? '+' : '-'}{profile.currency}{Math.abs(assetTotalChange).toLocaleString('en-IN')}</p>
              </div>
           </div>
        </div>

        <div className="bg-white p-8 rounded-[4rem] premium-shadow">
          <div className="flex justify-between items-center mb-6">
            <h4 className="text-[10px] font-black uppercase tracking-widest text-slate-400">Distribution</h4>
            <div className="flex bg-slate-50 p-1 rounded-2xl">
              {['current', 'invested', 'profit'].map(mode => (
                <button 
                  key={mode} onClick={() => setChartMode(mode as any)}
                  className={`px-3 py-1.5 rounded-xl text-[8px] font-black uppercase tracking-widest transition-all ${chartMode === mode ? 'bg-slate-900 text-white shadow-lg' : 'text-slate-400'}`}
                >
                  {mode}
                </button>
              ))}
            </div>
          </div>
          {pieData.length > 0 ? <CustomPieChart data={pieData} height={200} /> : <div className="h-[200px] flex items-center justify-center text-slate-200 font-bold italic">No holdings recorded.</div>}
        </div>

        <div className="bg-white p-8 rounded-[4rem] premium-shadow">
           <div className="flex justify-between items-center mb-6">
             <h4 className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-2">Growth History</h4>
             <div className="flex bg-slate-100 p-1 rounded-xl">
              {(['6M', '1Y', '5Y', '10Y'] as const).map(r => (
                <button key={r} onClick={() => setAssetTrendRange(r)} className={`px-3 py-1 rounded-lg text-[9px] font-black transition-all ${assetTrendRange === r ? 'bg-white shadow-sm' : 'text-slate-400'}`}>{r}</button>
              ))}
             </div>
           </div>
           {isAssetTrendLoading
             ? <div className="h-[200px] flex items-center justify-center animate-pulse text-slate-300 font-bold">Loading category trend...</div>
             : <PerformanceLineChart data={visibleCategoryTrendData} height={200} color={meta.color} />}
        </div>

        <div className="space-y-4">
          <h4 className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-4">Detailed Ledger</h4>
          {rawAssetHoldings.map(item => (
            <button key={item.id} onClick={() => navigateToHolding(item)} className="w-full bg-white p-8 rounded-[3rem] premium-shadow border border-slate-50 flex items-center justify-between group transition-all hover:border-indigo-100">
              <div className="text-left">
                <h5 className="font-black text-slate-900 text-lg group-hover:text-indigo-600 transition-colors">{item.name}</h5>
                <p className="text-[10px] text-slate-400 font-black uppercase tracking-widest">
                  {item.isSip && item.sipAmount
                    ? `SIP ${profile.currency}${Math.round(item.sipAmount).toLocaleString('en-IN')}/mo • ${new Date(item.purchaseDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}`
                    : `${item.quantity} units • ${new Date(item.purchaseDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}`}
                </p>
              </div>
              <div className="text-right">
                <p className="font-black text-slate-900 text-xl tracking-tight">{profile.currency}{item.currentValue.toLocaleString('en-IN')}</p>
                <p className={`text-[10px] font-black uppercase tracking-widest mt-1 ${item.currentValue >= item.investedAmount ? 'text-emerald-500' : 'text-rose-600'}`}>
                  {item.currentValue >= item.investedAmount ? '▲' : '▼'} {((item.currentValue - item.investedAmount) / item.investedAmount * 100).toFixed(1)}%
                </p>
                {item.type === AssetType.MUTUAL_FUNDS && item.quantity > 0 && (
                  <p className="text-[9px] font-black text-slate-400 mt-1">
                    NAV {profile.currency}{formatNav(item.currentValue / item.quantity)}
                  </p>
                )}
              </div>
            </button>
          ))}
        </div>
      </div>
    );
  };

  const renderHoldingDetail = () => {
    if (!selectedHolding) return null;
    const item = selectedHolding;
    const gain = item.currentValue - item.investedAmount;
    const daily = item.priceStartOfDay ? (item.currentValue - (item.priceStartOfDay * item.quantity)) : 0;
    const monthly = item.priceStartOfMonth ? (item.currentValue - (item.priceStartOfMonth * item.quantity)) : 0;
    const isMf = item.type === AssetType.MUTUAL_FUNDS;
    const currentNav = item.quantity > 0 ? item.currentValue / item.quantity : 0;
    const buyNav = item.purchasePrice || 0;
    const navDayBase = item.priceStartOfDay || 0;
    const navMonthBase = item.priceStartOfMonth || 0;
    const navDayChangePct = navDayBase > 0 ? ((currentNav - navDayBase) / navDayBase) * 100 : 0;
    const navMonthChangePct = navMonthBase > 0 ? ((currentNav - navMonthBase) / navMonthBase) * 100 : 0;
    const trendData = trendRange === '6M'
      ? holdingTrendData.trend6M
      : trendRange === '1Y'
      ? holdingTrendData.trend1Y
      : trendRange === '5Y'
      ? holdingTrendData.trend5Y
      : holdingTrendData.trend10Y;
    const positionTrend = trendData.map((point, idx) => {
      const sourcePrice = typeof point?.price === 'number' ? point.price : 0;
      const stepDate = new Date();
      stepDate.setMonth(stepDate.getMonth() - (trendData.length - 1 - idx));
      stepDate.setDate(28);
      stepDate.setHours(12, 0, 0, 0);
      const isPurchased = stepDate.getTime() >= new Date(item.purchaseDate).getTime();

      if (!isPurchased) return { name: point?.name || '', price: 0 };

      const invested = item.investedAmount;
      const current = item.type === AssetType.FIXED_DEPOSIT
        ? calculateFDGrowth(item.investedAmount, item.interestRate || 7, stepDate.toISOString().split('T')[0])
        : sourcePrice * item.quantity;
      const profit = current - invested;

      return {
        name: point?.name || '',
        price: holdingPositionMode === 'invested'
          ? Number(invested.toFixed(2))
          : holdingPositionMode === 'profit'
          ? Number(profit.toFixed(2))
          : Number(current.toFixed(2))
      };
    });
    const visiblePositionTrend = trimLeadingZeroPoints(positionTrend);

    return (
      <div className="space-y-8 animate-in slide-in-from-right duration-500 pb-24">
        <div className="flex items-center gap-5">
          <button onClick={() => setView('ASSET_DETAIL')} className="p-5 bg-white rounded-[2rem] premium-shadow text-slate-400 active:scale-90"><svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M15 19l-7-7 7-7" /></svg></button>
          <h2 className="text-3xl font-black text-slate-900 tracking-tighter">{item.name}</h2>
        </div>

        <section className="bg-slate-900 text-white p-7 sm:p-10 rounded-[2.75rem] sm:rounded-[4rem] premium-shadow relative overflow-hidden">
          <p className="text-white/40 text-[10px] font-black uppercase mb-2">Live Price</p>
          <h2 className={`${amountTextClass(item.currentValue, 'holding')} font-black mb-8 leading-none whitespace-nowrap`}>{profile.currency}{item.currentValue.toLocaleString('en-IN')}</h2>
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-white/5 p-4 rounded-3xl border border-white/5">
              <span className="text-[8px] font-black uppercase text-white/40">Total Change</span>
              <p className={`text-lg font-black whitespace-nowrap tabular-nums ${gain >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{gain >= 0 ? '+' : '-'}{profile.currency}{Math.abs(gain).toLocaleString('en-IN')}</p>
            </div>
            <div className="bg-white/5 p-4 rounded-3xl border border-white/5">
              <span className="text-[8px] font-black uppercase text-white/40">Invested Value</span>
              <p className="text-lg font-black text-white whitespace-nowrap tabular-nums">{profile.currency}{item.investedAmount.toLocaleString('en-IN')}</p>
            </div>
          </div>
        </section>

        <div className="grid grid-cols-2 gap-4">
           <div className="bg-white p-6 rounded-[3rem] premium-shadow border border-slate-50 text-center">
              <p className="text-[9px] font-black uppercase text-slate-400 mb-2">Daily Return</p>
              <p className={`font-black text-xl whitespace-nowrap tabular-nums ${daily >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{daily >= 0 ? '+' : '-'}{profile.currency}{Math.round(Math.abs(daily)).toLocaleString('en-IN')}</p>
           </div>
           <div className="bg-white p-6 rounded-[3rem] premium-shadow border border-slate-50 text-center">
              <p className="text-[9px] font-black uppercase text-slate-400 mb-2">Monthly Return</p>
              <p className={`font-black text-xl whitespace-nowrap tabular-nums ${monthly >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{monthly >= 0 ? '+' : '-'}{profile.currency}{Math.round(Math.abs(monthly)).toLocaleString('en-IN')}</p>
           </div>
        </div>

        {isMf && (
          <div className="bg-white p-6 rounded-[3rem] premium-shadow border border-slate-50">
            <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-4">NAV Snapshot</p>
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-slate-50 rounded-2xl px-4 py-3">
                <p className="text-[8px] font-black uppercase tracking-wider text-slate-400">Current NAV</p>
                <p className="text-sm font-black text-slate-900 mt-1">{profile.currency}{formatNav(currentNav)}</p>
              </div>
              <div className="bg-slate-50 rounded-2xl px-4 py-3">
                <p className="text-[8px] font-black uppercase tracking-wider text-slate-400">{item.isSip ? 'Avg Buy NAV' : 'Buy NAV'}</p>
                <p className="text-sm font-black text-slate-900 mt-1">{profile.currency}{formatNav(buyNav)}</p>
              </div>
              <div className="bg-slate-50 rounded-2xl px-4 py-3">
                <p className="text-[8px] font-black uppercase tracking-wider text-slate-400">NAV 1D</p>
                <p className={`text-sm font-black mt-1 ${navDayChangePct >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                  {navDayChangePct >= 0 ? '+' : ''}{navDayChangePct.toFixed(2)}%
                </p>
              </div>
              <div className="bg-slate-50 rounded-2xl px-4 py-3">
                <p className="text-[8px] font-black uppercase tracking-wider text-slate-400">NAV 1M</p>
                <p className={`text-sm font-black mt-1 ${navMonthChangePct >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                  {navMonthChangePct >= 0 ? '+' : ''}{navMonthChangePct.toFixed(2)}%
                </p>
              </div>
            </div>
          </div>
        )}

        <div className="bg-white p-8 rounded-[4rem] premium-shadow border border-slate-50">
          <div className="flex justify-between items-center mb-8 ml-2">
            <h4 className="text-[10px] font-black uppercase tracking-widest text-slate-400">Historical Trend</h4>
            <div className="flex bg-slate-100 p-1 rounded-xl">
               {(['6M', '1Y', '5Y', '10Y'] as const).map(r => (
                 <button key={r} onClick={() => setTrendRange(r)} className={`px-3 py-1 rounded-lg text-[9px] font-black transition-all ${trendRange === r ? 'bg-white shadow-sm' : 'text-slate-400'}`}>{r}</button>
               ))}
            </div>
          </div>
          {isProcessing ? <div className="h-[200px] flex items-center justify-center animate-pulse text-slate-200 font-black">Syncing ledger...</div> : <PerformanceLineChart data={trendData} height={200} />}
        </div>

        <div className="bg-white p-8 rounded-[4rem] premium-shadow border border-slate-50">
          <div className="flex justify-between items-center mb-8 ml-2">
            <h4 className="text-[10px] font-black uppercase tracking-widest text-slate-400">Your Position Trend</h4>
            <div className="flex bg-slate-100 p-1 rounded-xl">
              {(['current', 'invested', 'profit'] as const).map(mode => (
                <button key={mode} onClick={() => setHoldingPositionMode(mode)} className={`px-3 py-1 rounded-lg text-[9px] font-black transition-all ${holdingPositionMode === mode ? 'bg-white shadow-sm' : 'text-slate-400'}`}>{mode}</button>
              ))}
            </div>
          </div>
          {isProcessing ? <div className="h-[200px] flex items-center justify-center animate-pulse text-slate-200 font-black">Syncing your position...</div> : <PerformanceLineChart data={visiblePositionTrend} height={200} color="#10B981" />}
        </div>

        <div className="bg-indigo-600 text-white p-7 sm:p-10 rounded-[2.75rem] sm:rounded-[4rem] shadow-2xl flex flex-col items-center text-center">
           <div className="w-16 h-16 bg-white/20 rounded-3xl flex items-center justify-center mb-6"><svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg></div>
           <h4 className="font-black text-xl mb-3 uppercase tracking-tighter">AI Prediction</h4>
           <p className="text-indigo-100 text-sm italic font-medium leading-relaxed">"{prediction || "Gathering market intelligence..."}"</p>
           <p className="mt-4 text-[9px] font-black uppercase tracking-widest text-indigo-300">Targeting 30 Day Window</p>
        </div>

        <div className="px-4 space-y-4">
          <div className="bg-white p-6 rounded-[2.5rem] border border-slate-100 flex justify-between items-center">
            <span className="text-xs font-black uppercase text-slate-400">Purchased On</span>
            <span className="text-xs font-black text-slate-900">{new Date(item.purchaseDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</span>
          </div>
          <button onClick={() => handleSell(item.id, item.memberIds)} className="w-full bg-rose-50 text-rose-600 py-6 rounded-[2.5rem] font-black text-xs uppercase tracking-widest hover:bg-rose-600 hover:text-white transition-all">Sell Asset</button>
        </div>
      </div>
    );
  };

  const renderReports = () => {
    const assetSplit = Object.values(AssetType).map(t => ({ 
      name: ASSET_META[t].label, 
      value: investments.filter(i => i.type === t).reduce((s,v)=>s+v.currentValue,0), 
      color: ASSET_META[t].color 
    })).filter(d => d.value > 0);

    const mergedForReports = mergeHoldings(investments);
    const holdingPnl = mergedForReports.map(i => {
      const profit = i.currentValue - i.investedAmount;
      const returnPct = i.investedAmount > 0 ? (profit / i.investedAmount) * 100 : 0;
      return { name: shortenLabel(i.name), profit, returnPct };
    });
    const topProfitAssets = [...holdingPnl]
      .filter(i => i.profit > 0)
      .sort((a, b) => b.profit - a.profit)
      .slice(0, 4);
    const topLossAssets = [...holdingPnl]
      .sort((a, b) => a.returnPct - b.returnPct)
      .slice(0, 4);
    const investedVsCurrent = Object.values(AssetType).map(t => ({ 
      name: ASSET_META[t].label, 
      invested: investments.filter(i => i.type === t).reduce((s,v)=>s+v.investedAmount,0), 
      current: investments.filter(i => i.type === t).reduce((s,v)=>s+v.currentValue,0) 
    }));
    const portfolioSeries = portfolioTrendMode === 'invested'
      ? (portfolioTrendRange === '6M' ? portfolioTrendData.invested6M : portfolioTrendRange === '1Y' ? portfolioTrendData.invested1Y : portfolioTrendRange === '5Y' ? portfolioTrendData.invested5Y : portfolioTrendData.invested10Y)
      : portfolioTrendMode === 'profit'
      ? (portfolioTrendRange === '6M' ? portfolioTrendData.profit6M : portfolioTrendRange === '1Y' ? portfolioTrendData.profit1Y : portfolioTrendRange === '5Y' ? portfolioTrendData.profit5Y : portfolioTrendData.profit10Y)
      : (portfolioTrendRange === '6M' ? portfolioTrendData.current6M : portfolioTrendRange === '1Y' ? portfolioTrendData.current1Y : portfolioTrendRange === '5Y' ? portfolioTrendData.current5Y : portfolioTrendData.current10Y);
    const visiblePortfolioSeries = trimLeadingZeroPoints(portfolioSeries);

    return (
      <div className="space-y-8 animate-in fade-in pb-24">
        <h2 className="text-4xl font-black text-slate-900 tracking-tighter">Alpha Analytics</h2>
        {investments.length > 0 ? (
           <div className="space-y-8">
             <div className="bg-white p-7 sm:p-10 rounded-[2.75rem] sm:rounded-[4rem] premium-shadow">
               <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-8 text-center">1. Asset Diversification</p>
               <CustomPieChart data={assetSplit} height={200} />
             </div>
             <div className="bg-white p-7 sm:p-10 rounded-[2.75rem] sm:rounded-[4rem] premium-shadow">
               <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-8 text-center">2. Top Profit Assets</p>
               <ProfitBarChart data={topProfitAssets} height={200} />
             </div>
             <div className="bg-white p-7 sm:p-10 rounded-[2.75rem] sm:rounded-[4rem] premium-shadow">
               <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-8 text-center">3. Lowest Return Assets</p>
               <ProfitBarChart data={topLossAssets} height={200} />
             </div>
             <div className="bg-white p-7 sm:p-10 rounded-[2.75rem] sm:rounded-[4rem] premium-shadow">
               <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-8 text-center">4. Valuation Gap</p>
               <ComparisonBarChart data={investedVsCurrent} height={200} />
             </div>
             <div className="bg-white p-7 sm:p-10 rounded-[2.75rem] sm:rounded-[4rem] premium-shadow">
               <div className="flex justify-between items-center mb-6">
                 <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">5. Portfolio History</p>
                 <div className="flex bg-slate-50 p-1 rounded-xl">
                   {(['current', 'invested', 'profit'] as const).map(mode => (
                     <button key={mode} onClick={() => setPortfolioTrendMode(mode)} className={`px-3 py-1 rounded-lg text-[9px] font-black transition-all ${portfolioTrendMode === mode ? 'bg-white shadow-sm' : 'text-slate-400'}`}>{mode}</button>
                   ))}
                 </div>
               </div>
               <div className="flex justify-end mb-5">
                 <div className="flex bg-slate-50 p-1 rounded-xl">
                   {(['6M', '1Y', '5Y', '10Y'] as const).map(r => (
                     <button key={r} onClick={() => setPortfolioTrendRange(r)} className={`px-3 py-1 rounded-lg text-[9px] font-black transition-all ${portfolioTrendRange === r ? 'bg-white shadow-sm' : 'text-slate-400'}`}>{r}</button>
                   ))}
                 </div>
               </div>
               {isPortfolioTrendLoading
                 ? <div className="h-[200px] flex items-center justify-center animate-pulse text-slate-300 font-bold">Loading portfolio history...</div>
                 : <PerformanceLineChart data={visiblePortfolioSeries} height={200} color="#6366F1" />}
             </div>
             <button
                onClick={() => setRiskDetailsOpen(true)}
               className="w-full bg-slate-900 p-7 sm:p-10 rounded-[2.75rem] sm:rounded-[4rem] premium-shadow text-white text-center"
             >
                <p className="text-[10px] font-black uppercase tracking-widest text-white/40 mb-4">6. Risk Rating</p>
                <h4 className={`text-3xl font-black ${riskProfile.colorClass}`}>{riskProfile.label}</h4>
                <p className="text-white/40 text-[10px] mt-2 italic font-medium">{riskProfile.note}</p>
                <p className="text-white/30 text-[9px] mt-2 font-black uppercase tracking-widest">Score {Math.round(riskProfile.score)}/100 • Tap for details</p>
             </button>
           </div>
        ) : <div className="p-20 text-center opacity-30 italic font-black text-xs uppercase">No analytics found.</div>}
      </div>
    );
  };

  const renderSettings = () => (
    <div className="space-y-8 animate-in fade-in pb-24">
      <h2 className="text-4xl font-black text-slate-900 tracking-tighter">Command Settings</h2>
      <div className="bg-white rounded-[4rem] premium-shadow border border-slate-50 overflow-hidden">
        <div className="p-12 border-b border-slate-50 flex flex-col items-center text-center">
           <div className="w-28 h-28 rounded-[2.5rem] bg-slate-900 text-white flex items-center justify-center font-black text-4xl mb-6 uppercase shadow-2xl">{profile.name[0]}</div>
           <div className="space-y-6 w-full px-4">
              <div className="space-y-1">
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Identity</label>
                <input 
                  type="text" value={profile.name} 
                  onChange={(e) => setProfile(p => ({...p, name: e.target.value}))} 
                  className="w-full text-center bg-slate-50 border-none p-5 rounded-3xl font-black text-xl text-slate-900 focus:ring-4 focus:ring-indigo-500/10 transition-all" 
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Preferred Currency</label>
                <input 
                  type="text" value={profile.currency} 
                  onChange={(e) => setProfile(p => ({...p, currency: e.target.value}))} 
                  className="w-full text-center bg-slate-50 border-none p-5 rounded-3xl font-black text-xl text-slate-900" 
                />
              </div>
           </div>
        </div>
      </div>
      <div className="bg-rose-50 p-12 rounded-[4rem] border border-rose-100/50">
         <h5 className="font-black text-rose-800 text-[10px] uppercase tracking-widest mb-4">Wipe Novus Database</h5>
         <button onClick={() => {
           setConfirmDialog({
             open: true,
             title: 'Reset Ledger',
             message: 'Erase all ledger data? This action is irreversible.',
             confirmText: 'Reset',
             onConfirm: () => { setInvestments([]); setView('HOME'); }
           });
         }} className="bg-white text-rose-600 px-10 py-5 rounded-[2rem] font-black text-xs uppercase tracking-widest shadow-xl border border-rose-100 transition-all active:scale-95">Reset Ledger</button>
      </div>
      <div className="bg-slate-100 p-12 rounded-[4rem] border border-slate-200">
         <h5 className="font-black text-slate-700 text-[10px] uppercase tracking-widest mb-4">Session</h5>
         <button onClick={handleLogout} className="bg-slate-900 text-white px-10 py-5 rounded-[2rem] font-black text-xs uppercase tracking-widest shadow-xl transition-all active:scale-95">Logout</button>
      </div>
    </div>
  );

  const renderAuth = () => (
    <div className="max-w-md mx-auto min-h-screen bg-gradient-to-b from-[#eef2ff] via-[#f8fafc] to-[#eef2ff] flex items-center px-6 relative overflow-hidden">
      <div className="absolute -top-20 -left-20 w-56 h-56 bg-indigo-200/50 rounded-full blur-3xl" />
      <div className="absolute -bottom-24 -right-16 w-64 h-64 bg-sky-200/40 rounded-full blur-3xl" />
      <div className="w-full bg-white/90 backdrop-blur-xl p-9 rounded-[2.75rem] premium-shadow border border-white/70 relative z-10">
        <div className="w-14 h-14 rounded-2xl bg-slate-900 text-white flex items-center justify-center mb-5 shadow-lg shadow-slate-200">
          <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M12 11c1.657 0 3-1.567 3-3.5S13.657 4 12 4 9 5.567 9 7.5 10.343 11 12 11zm0 2c-2.761 0-5 2.015-5 4.5V19h10v-1.5c0-2.485-2.239-4.5-5-4.5z" /></svg>
        </div>
        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Secure Access</p>
        <h1 className="text-4xl font-black text-slate-900 mt-2 tracking-tight">Welcome Back</h1>
        <p className="text-sm text-slate-500 mt-2">Login to continue to your portfolio dashboard.</p>
        <div className="space-y-4 mt-7">
          <input
            type="email"
            value={authEmail}
            onChange={(e) => setAuthEmail(e.target.value)}
            placeholder="Email"
            className="w-full bg-slate-50/90 border border-slate-200 p-4 rounded-2xl font-bold text-slate-800 focus:outline-none focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-200 transition-all"
          />
          <input
            type="password"
            value={authPassword}
            onChange={(e) => setAuthPassword(e.target.value)}
            placeholder="Password"
            className="w-full bg-slate-50/90 border border-slate-200 p-4 rounded-2xl font-bold text-slate-800 focus:outline-none focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-200 transition-all"
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleLogin();
            }}
          />
          {authError && <p className="text-xs font-black text-rose-600">{authError}</p>}
          <button
            onClick={handleLogin}
            className="w-full bg-slate-900 text-white py-4 rounded-2xl font-black text-xs uppercase tracking-[0.2em] shadow-xl shadow-slate-200 hover:bg-slate-800 transition-all active:scale-[0.99]"
          >
            Login
          </button>
        </div>
      </div>
    </div>
  );

  const mergedRiskHoldings = mergeHoldings(investments);
  const totalRiskValue = mergedRiskHoldings.reduce((sum, h) => sum + h.currentValue, 0);
  const riskContributionData = mergedRiskHoldings
    .map((h) => {
      const sharePct = totalRiskValue > 0 ? (h.currentValue / totalRiskValue) * 100 : 0;
      const typeRiskWeight =
        h.type === AssetType.STOCKS ? 1.25 :
        h.type === AssetType.MUTUAL_FUNDS ? 1.05 :
        h.type === AssetType.GOLD ? 0.55 : 0.35;
      return {
        name: shortenLabel(h.name),
        profit: Number((sharePct * typeRiskWeight).toFixed(2)),
      };
    })
    .sort((a, b) => b.profit - a.profit)
    .slice(0, 4);

  const concentrationHolding = mergedRiskHoldings
    .map((h) => ({ name: h.name, share: totalRiskValue > 0 ? (h.currentValue / totalRiskValue) * 100 : 0 }))
    .sort((a, b) => b.share - a.share)[0];

  const laggingHolding = mergedRiskHoldings
    .map((h) => ({
      name: h.name,
      returnPct: h.investedAmount > 0 ? ((h.currentValue - h.investedAmount) / h.investedAmount) * 100 : 0,
    }))
    .sort((a, b) => a.returnPct - b.returnPct)[0];

  const suggestedShiftPct = concentrationHolding?.share && concentrationHolding.share > 35
    ? Math.max(3, Math.round((concentrationHolding.share - 30) * 0.4))
    : 0;

  if (!isAuthenticated) return renderAuth();
  if (supabaseError) {
    return (
      <div className="max-w-md mx-auto min-h-screen bg-[#F8FAFC] flex items-center justify-center px-8">
        <div className="w-full bg-white p-7 sm:p-10 rounded-[2.5rem] sm:rounded-[3rem] premium-shadow border border-rose-100 text-center">
          <p className="text-[10px] font-black uppercase tracking-widest text-rose-400">Supabase Error</p>
          <h2 className="text-2xl font-black text-slate-900 mt-3">Failed to load data</h2>
          <p className="text-xs text-slate-500 mt-2 break-words">{supabaseError}</p>
          <button
            onClick={hydrateFromSupabase}
            className="mt-6 bg-slate-900 text-white px-8 py-4 rounded-2xl font-black text-xs uppercase tracking-widest"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }
  if (!hasHydratedState) {
    return (
      <div className="max-w-md mx-auto min-h-screen bg-[#F8FAFC] flex items-center justify-center px-8">
        <div className="w-full bg-white p-7 sm:p-10 rounded-[2.5rem] sm:rounded-[3rem] premium-shadow border border-slate-100 text-center">
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Syncing</p>
          <h2 className="text-2xl font-black text-slate-900 mt-3">Loading Portfolio</h2>
          <p className="text-sm text-slate-500 mt-2">Fetching latest data from Supabase...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto min-h-screen bg-[#F8FAFC] flex flex-col relative overflow-x-hidden no-scrollbar">
      <header className="px-5 sm:px-10 pt-8 sm:pt-16 pb-6 sm:pb-8 flex justify-between items-center sticky top-0 z-[90] backdrop-blur-xl">
        <h1 className="text-3xl sm:text-4xl font-black text-slate-900 tracking-tighter">Novus</h1>
        <div className="flex items-center gap-3 sm:gap-4 text-right">
          <div><p className="text-[8px] font-black uppercase text-slate-400">Account</p><p className="text-xs font-black text-slate-900">{profile.name}</p></div>
          <button onClick={() => setView('SETTINGS')} className="w-12 h-12 sm:w-14 sm:h-14 rounded-3xl bg-white premium-shadow flex items-center justify-center text-slate-400"><svg className="w-6 h-6 sm:w-7 sm:h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg></button>
        </div>
      </header>

      <main className="flex-1 px-5 sm:px-10 pb-56 sm:pb-44">
        {view === 'HOME' && renderHome()}
        {view === 'REPORTS' && renderReports()}
        {view === 'ASSET_DETAIL' && renderAssetDetail()}
        {view === 'HOLDING_DETAIL' && renderHoldingDetail()}
        {view === 'AI_HUB' && (
          <div className="space-y-6 animate-in fade-in pb-24">
            <div className="bg-slate-900 rounded-[3rem] px-8 py-7 text-white">
              <p className="text-[9px] font-black uppercase tracking-widest text-white/50">Novus AI</p>
              <h3 className="text-2xl font-black mt-1">पोर्टफोलियो कोपायलट</h3>
              <p className="text-xs text-white/60 mt-2">जो भी पूछना हो हिंदी में पूछें: जोखिम, रीबैलेंस, सुझाव, अपडेट।</p>
            </div>

            <div className="flex gap-2 overflow-x-auto no-scrollbar">
              {[
                'मेरा पोर्टफोलियो सारांश',
                'क्या मैं पर्याप्त बचत कर रहा हूँ?',
                'क्या मैं ₹20,000 का फोन खरीद सकता हूँ?',
                '10 साल बाद नेट वर्थ कितनी होगी?',
                '5 साल में ₹10 लाख का लक्ष्य',
                'खर्च बनाम निवेश चेक',
                'स्मार्ट चेतावनियां',
                'मार्केट अपडेट'
              ].map((q) => (
                <button
                  key={q}
                  onClick={() => sendAiMessage(q)}
                  className="shrink-0 bg-white border border-slate-100 rounded-2xl px-4 py-2 text-[10px] font-black uppercase tracking-wider text-slate-600 premium-shadow"
                >
                  {q}
                </button>
              ))}
            </div>

            <div ref={aiChatScrollRef} className="bg-white rounded-[2.5rem] premium-shadow border border-slate-50 p-5 h-[420px] overflow-y-auto no-scrollbar space-y-3">
              {isInsightLoading && aiMessages.length === 0 && (
                <div className="h-full flex items-center justify-center">
                  <div className="animate-spin w-10 h-10 border-4 border-indigo-100 border-t-indigo-600 rounded-full" />
                </div>
              )}

              {!isInsightLoading && aiMessages.length === 0 && (
                <div className="h-full flex items-center justify-center text-center px-6">
                  <p className="text-sm text-slate-400 font-bold">पोर्टफोलियो आधारित सुझाव पाने के लिए चैट शुरू करें।</p>
                </div>
              )}

              {aiMessages.map((m) => (
                <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`${m.role === 'user' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-700'} max-w-[85%] rounded-2xl px-4 py-3`}>
                    <p className="text-xs leading-relaxed whitespace-pre-wrap">
                      {m.text || (m.role === 'assistant' && isAiChatLoading ? 'सोच रहा हूँ...' : '')}
                    </p>
                  </div>
                </div>
              ))}

              {isAiChatLoading && (
                <div className="flex justify-start">
                  <div className="bg-slate-100 text-slate-600 rounded-2xl px-4 py-3">
                    <p className="text-xs font-bold animate-pulse">पोर्टफोलियो विश्लेषण चल रहा है...</p>
                  </div>
                </div>
              )}
            </div>

            <div className="bg-white rounded-[2rem] premium-shadow border border-slate-50 p-3 flex items-end gap-2">
              <textarea
                value={aiInput}
                onChange={(e) => setAiInput(e.target.value)}
                placeholder="पूछें: मेरा पोर्टफोलियो कैसा चल रहा है?"
                rows={2}
                className="flex-1 resize-none bg-transparent px-3 py-2 text-sm font-medium text-slate-700 focus:outline-none"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    sendAiMessage();
                  }
                }}
              />
              <button
                onClick={toggleVoiceInput}
                className={`h-11 w-11 shrink-0 rounded-xl flex items-center justify-center transition-colors ${isListening ? 'bg-rose-600 text-white' : 'bg-slate-900 text-white'}`}
                title={isListening ? 'वॉइस इनपुट रोकें' : 'वॉइस इनपुट शुरू करें'}
              >
                <span className="relative inline-flex items-center justify-center w-full h-full">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3a3 3 0 00-3 3v6a3 3 0 106 0V6a3 3 0 00-3-3z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 11a6 6 0 0012 0M12 17v3" />
                  </svg>
                  {isListening && <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-white" />}
                </span>
              </button>
              <button
                onClick={() => sendAiMessage()}
                disabled={isAiChatLoading || !aiInput.trim()}
                className="h-12 px-5 rounded-2xl bg-slate-900 text-white text-xs font-black uppercase tracking-wider disabled:opacity-40"
              >
                भेजें
              </button>
            </div>
            {(isListening || aiVoiceError) && (
              <div className="px-1">
                {isListening && <p className="text-[11px] font-black text-indigo-600">सुन रहा हूँ... अब बोलें।</p>}
                {!!aiVoiceError && <p className="text-[11px] font-black text-rose-600">{aiVoiceError}</p>}
              </div>
            )}
          </div>
        )}
        {view === 'SETTINGS' && renderSettings()}
        {view === 'ADD_FLOW' && (
          <div className="fixed inset-0 z-[300] bg-white flex flex-col p-5 sm:p-10 overflow-y-auto no-scrollbar animate-in slide-in-from-bottom">
            <div className="flex justify-between items-center mb-12">
               <h2 className="text-3xl font-black tracking-tight">{formStep === 1 ? 'New Asset' : 'Details'}</h2>
               <button onClick={() => { setView('HOME'); setSelectedSuggestion(null); setInstrumentSuggestions([]); }} className="p-4 bg-slate-50 rounded-[1.5rem]"><svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg></button>
            </div>
            {formStep === 1 ? (
              <div className="space-y-4">
                 {Object.values(AssetType).map(t => (
                   <button key={t} onClick={() => { setNewAssetType(t); setFormStep(2); setSelectedSuggestion(null); setInstrumentSuggestions([]); }} className="w-full p-8 bg-slate-50 rounded-[3rem] flex items-center gap-6 text-left hover:bg-white hover:premium-shadow transition-all group">
                     <div className={`p-5 rounded-2xl ${ASSET_META[t].bg} group-hover:scale-110 transition-transform`}>{ASSET_META[t].icon}</div>
                     <div><h4 className="font-black text-lg">{ASSET_META[t].label}</h4><p className="text-xs text-slate-400">Record {ASSET_META[t].label.toLowerCase()}</p></div>
                   </button>
                 ))}
              </div>
            ) : (
              <div className="space-y-6">
                 <div className="space-y-2">
                    <label className="text-[10px] font-black uppercase text-slate-400 ml-4">Identifier</label>
                    <input type="text" placeholder={newAssetType === AssetType.MUTUAL_FUNDS ? "e.g. Axis Small Cap Fund" : "e.g. RELIANCE"} className="w-full bg-slate-50 p-6 rounded-[2rem] font-bold text-xl" value={formData.name} onChange={e=>{ setFormData({...formData, name:e.target.value}); setSelectedSuggestion(null); }} />
                    {(newAssetType === AssetType.STOCKS || newAssetType === AssetType.MUTUAL_FUNDS) && (
                      <div className="bg-slate-50 rounded-2xl border border-slate-100 overflow-hidden mt-2">
                        {isSuggesting && <div className="px-4 py-3 text-xs font-black uppercase tracking-widest text-slate-400">Searching...</div>}
                        {!isSuggesting && instrumentSuggestions.map(s => (
                          <button
                            key={`${s.type}-${s.symbol}`}
                            type="button"
                            onClick={() => {
                              setSelectedSuggestion(s);
                              setFormData({ ...formData, name: s.label });
                              setInstrumentSuggestions([]);
                            }}
                            className="w-full px-4 py-3 text-left border-b last:border-b-0 border-slate-100 hover:bg-white transition-colors"
                          >
                            <div className="flex justify-between items-center">
                              <span className="text-xs font-black text-slate-700">{s.label}</span>
                              <span className="text-xs font-black text-slate-500">{profile.currency}{s.currentPrice.toLocaleString('en-IN')}</span>
                            </div>
                            <div className="text-[10px] font-black uppercase tracking-wider text-slate-400 mt-1">{s.symbol}</div>
                          </button>
                        ))}
                        {!isSuggesting && instrumentSuggestions.length === 0 && formData.name.trim().length >= (newAssetType === AssetType.STOCKS ? 3 : 2) && (
                          <div className="px-4 py-3 text-xs font-black uppercase tracking-widest text-slate-300">No matching instruments</div>
                        )}
                      </div>
                    )}
                 </div>
                 {newAssetType === AssetType.MUTUAL_FUNDS && (
                   <div className="space-y-2">
                     <label className="text-[10px] font-black uppercase text-slate-400 ml-4">Investment Mode</label>
                     <div className="grid grid-cols-2 gap-3">
                       <button type="button" onClick={() => setFormData({ ...formData, sipMode: false })} className={`py-4 rounded-2xl text-xs font-black uppercase tracking-wider ${!formData.sipMode ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-500'}`}>One-time</button>
                       <button type="button" onClick={() => setFormData({ ...formData, sipMode: true })} className={`py-4 rounded-2xl text-xs font-black uppercase tracking-wider ${formData.sipMode ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-500'}`}>SIP</button>
                     </div>
                   </div>
                 )}
                 {newAssetType !== AssetType.FIXED_DEPOSIT && !(newAssetType === AssetType.MUTUAL_FUNDS && formData.sipMode) && <div className="space-y-2"><label className="text-[10px] font-black uppercase text-slate-400 ml-4">{newAssetType === AssetType.GOLD ? 'Grams' : 'Shares / Units'}</label><input type="number" className="w-full bg-slate-50 p-6 rounded-[2rem] font-black text-3xl" value={formData.quantity} onChange={e=>setFormData({...formData, quantity:e.target.value})} /></div>}
                 {newAssetType === AssetType.MUTUAL_FUNDS && formData.sipMode && (
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-[10px] font-black uppercase text-slate-400 ml-4">Monthly SIP</label>
                      <input type="number" className="w-full bg-slate-50 p-6 rounded-[2rem] font-black" value={formData.sipAmount} onChange={e=>setFormData({...formData, sipAmount:e.target.value})} />
                    </div>
                    <div className="space-y-2">
                      <label className="text-[10px] font-black uppercase text-slate-400 ml-4">SIP Day (1-28)</label>
                      <input type="number" min={1} max={28} className="w-full bg-slate-50 p-6 rounded-[2rem] font-black" value={formData.sipDay} onChange={e=>setFormData({...formData, sipDay:e.target.value})} />
                    </div>
                  </div>
                 )}
                 {newAssetType === AssetType.GOLD && <div className="space-y-2"><label className="text-[10px] font-black uppercase text-slate-400 ml-4">Price Paid / Gram</label><input type="number" className="w-full bg-slate-50 p-6 rounded-[2rem] font-black text-3xl" value={formData.pricePaid} onChange={e=>setFormData({...formData, pricePaid:e.target.value})} /></div>}
                 {newAssetType === AssetType.FIXED_DEPOSIT && <div className="grid grid-cols-2 gap-4"><div className="space-y-2"><label className="text-[10px] font-black uppercase text-slate-400 ml-4">Principal</label><input type="number" className="w-full bg-slate-50 p-6 rounded-[2rem] font-black" value={formData.amount} onChange={e=>setFormData({...formData, amount:e.target.value})} /></div><div className="space-y-2"><label className="text-[10px] font-black uppercase text-slate-400 ml-4">Interest %</label><input type="number" className="w-full bg-slate-50 p-6 rounded-[2rem] font-black" value={formData.interestRate} onChange={e=>setFormData({...formData, interestRate:e.target.value})} /></div></div>}
                 <div className="space-y-2"><label className="text-[10px] font-black uppercase text-slate-400 ml-4">{newAssetType === AssetType.MUTUAL_FUNDS && formData.sipMode ? 'SIP Start Date' : 'Purchase Date'}</label><input type="date" className="w-full bg-slate-50 p-6 rounded-[2rem] font-bold" value={formData.date} onChange={e=>setFormData({...formData, date:e.target.value})} /></div>
                 <button disabled={isProcessing} onClick={processNewInvestment} className="w-full bg-slate-900 text-white py-8 rounded-[3rem] font-black text-xl shadow-2xl disabled:opacity-50 mt-10">{isProcessing ? 'SCANNING MARKETS...' : 'RECORD ASSET'}</button>
              </div>
            )}
          </div>
        )}
      </main>

      {confirmDialog.open && (
        <div className="fixed inset-0 z-[400] bg-slate-900/40 backdrop-blur-sm flex items-end justify-center p-6">
          <div className="w-full max-w-md bg-white rounded-[2.5rem] p-8 premium-shadow">
            <h4 className="text-xl font-black text-slate-900 tracking-tight">{confirmDialog.title}</h4>
            <p className="text-sm text-slate-500 mt-3 leading-relaxed">{confirmDialog.message}</p>
            <div className="grid grid-cols-2 gap-3 mt-8">
              <button
                onClick={() => setConfirmDialog({ open: false, title: '', message: '', confirmText: 'Confirm' })}
                className="py-4 rounded-2xl bg-slate-100 text-slate-500 font-black text-xs uppercase tracking-widest"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  confirmDialog.onConfirm?.();
                  setConfirmDialog({ open: false, title: '', message: '', confirmText: 'Confirm' });
                }}
                className="py-4 rounded-2xl bg-rose-600 text-white font-black text-xs uppercase tracking-widest"
              >
                {confirmDialog.confirmText}
              </button>
            </div>
          </div>
        </div>
      )}

      {riskDetailsOpen && (
        <div className="fixed inset-0 z-[350] bg-slate-900/45 backdrop-blur-sm flex items-end justify-center p-4">
          <div className="w-full max-w-md max-h-[90vh] overflow-y-auto no-scrollbar bg-white rounded-[2.5rem] p-7 premium-shadow">
            <div className="flex justify-between items-start gap-4">
              <div>
                <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Portfolio Risk</p>
                <h4 className={`text-3xl font-black mt-1 ${riskProfile.colorClass}`}>{riskProfile.label}</h4>
                <p className="text-xs font-black text-slate-500 mt-1">Score {Math.round(riskProfile.score)}/100</p>
              </div>
              <button onClick={() => setRiskDetailsOpen(false)} className="w-10 h-10 rounded-2xl bg-slate-100 text-slate-500 font-black">×</button>
            </div>

            <div className="mt-5 bg-slate-50 rounded-2xl p-4">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Why this score</p>
              <p className="text-xs text-slate-600 font-medium mt-2">{riskProfile.note}</p>
            </div>

            <div className="mt-6">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-3">Category Risk Detail</p>
              <div className="space-y-3">
                {riskProfile.categoryBreakdown.map((c) => (
                  <div key={c.type} className="bg-slate-50 rounded-2xl p-4 border border-slate-100">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-black text-slate-800">{c.label}</p>
                      <span className="text-[10px] font-black uppercase tracking-wider text-slate-500">{c.level}</span>
                    </div>
                    <div className="mt-2 flex items-center justify-between text-xs">
                      <span className="font-black text-slate-500">Weight {Math.round(c.share * 100)}%</span>
                      <span className="font-black text-slate-700">Score {c.score}/100</span>
                    </div>
                    <p className="text-xs font-black text-slate-700 mt-1">{profile.currency}{Math.round(c.value).toLocaleString('en-IN')}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-6">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-3">Risk Contribution (Top 4)</p>
              {riskContributionData.length > 0 ? (
                <div className="bg-slate-50 border border-slate-100 rounded-2xl p-3">
                  <ProfitBarChart data={riskContributionData} height={170} />
                </div>
              ) : (
                <div className="text-xs text-slate-500 font-bold bg-slate-50 border border-slate-100 rounded-xl px-3 py-3">
                  Not enough holdings to generate contribution chart.
                </div>
              )}
            </div>

            <div className="mt-6">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-3">Predictions & Action</p>
              <div className="space-y-2">
                <div className="text-xs text-slate-700 font-bold bg-slate-50 border border-slate-100 rounded-xl px-3 py-3">
                  Most concentration risk: {concentrationHolding ? `${concentrationHolding.name} (${concentrationHolding.share.toFixed(1)}%)` : 'N/A'}.
                </div>
                <div className="text-xs text-slate-700 font-bold bg-slate-50 border border-slate-100 rounded-xl px-3 py-3">
                  Watchlist laggard: {laggingHolding ? `${laggingHolding.name} (${laggingHolding.returnPct >= 0 ? '+' : ''}${laggingHolding.returnPct.toFixed(1)}%)` : 'N/A'}.
                </div>
                <div className="text-xs text-slate-700 font-bold bg-slate-50 border border-slate-100 rounded-xl px-3 py-3">
                  Suggested rebalance: {suggestedShiftPct > 0 ? `shift about ${suggestedShiftPct}% from the top concentration into underweight assets over the next few weeks.` : 'no urgent rebalance needed; continue staggered investing.'}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      <nav className="fixed bottom-4 sm:bottom-8 left-4 sm:left-10 right-4 sm:right-10 h-20 sm:h-24 glass-effect rounded-[2.5rem] sm:rounded-[3.5rem] premium-shadow z-[150] flex items-center justify-around px-2 sm:px-4">
        <NavButton active={view === 'HOME'} onClick={() => setView('HOME')} icon={<svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" /></svg>} />
        <NavButton active={view === 'REPORTS'} onClick={() => setView('REPORTS')} icon={<svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>} />
        <button onClick={() => { setFormStep(1); setView('ADD_FLOW'); setSelectedSuggestion(null); setInstrumentSuggestions([]); }} className="w-16 h-16 sm:w-20 sm:h-20 bg-slate-900 rounded-[1.75rem] sm:rounded-[2.25rem] flex items-center justify-center text-white shadow-2xl relative -top-3 sm:-top-4 transition-transform active:scale-90"><svg className="w-8 h-8 sm:w-10 sm:h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={4} d="M12 4v16m8-8H4" /></svg></button>
        <NavButton active={view === 'AI_HUB'} onClick={() => { setView('AI_HUB'); fetchInsights(); }} icon={<svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>} />
        <NavButton active={view === 'SETTINGS'} onClick={() => setView('SETTINGS')} icon={<svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>} />
      </nav>
    </div>
  );
};

const NavButton: React.FC<{ active: boolean, onClick: () => void, icon: React.ReactNode }> = ({ active, onClick, icon }) => (
  <button onClick={onClick} className={`p-3.5 sm:p-5 rounded-[1.25rem] sm:rounded-[2rem] transition-all duration-300 ${active ? 'bg-indigo-600 text-white shadow-xl shadow-indigo-100' : 'text-slate-300'}`}>{icon}</button>
);

export default App;
