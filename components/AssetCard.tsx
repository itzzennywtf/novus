import React from 'react';
import { AssetType } from '../types';
import { ASSET_META } from '../constants';

interface Props {
  type: AssetType;
  totalValue: number;
  returns: number;
  onClick: () => void;
}

export const AssetCard: React.FC<Props> = ({ type, totalValue, returns, onClick }) => {
  const meta = ASSET_META[type];
  const base = totalValue - returns;
  const pctRaw = base > 0 ? (returns / base) * 100 : 0;
  const returnsPercent = Number.isFinite(pctRaw) ? pctRaw.toFixed(1) : '0.0';
  const isZeroValue = Math.round(totalValue) === 0;
  const valueText = Math.round(totalValue).toLocaleString('en-IN');
  const valueClass =
    valueText.length >= 10
      ? 'text-[clamp(0.74rem,2vw,0.9rem)]'
      : valueText.length >= 8
        ? 'text-[clamp(0.82rem,2.2vw,1rem)]'
        : 'text-[clamp(0.92rem,2.6vw,1.12rem)]';

  return (
    <button
      onClick={onClick}
      className="w-full text-left bg-white p-6 rounded-[2rem] premium-shadow border border-slate-100 transition-all active:scale-95 hover:border-slate-300 min-h-[190px]"
    >
      <div className="flex items-start justify-between mb-5">
        <div className={`p-3 rounded-2xl ${meta.bg} text-slate-800`}>
          {meta.icon}
        </div>
        <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${returns >= 0 ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-600'}`}>
          {returns >= 0 ? '+' : '-'}{Math.abs(Number(returnsPercent)).toFixed(1)}%
        </span>
      </div>
      <div>
        <h3 className="text-slate-600 text-[11px] font-black uppercase tracking-[0.18em] leading-tight">
          {meta.label}
        </h3>
        <p className={`mt-2 ${valueClass} leading-none font-black whitespace-nowrap tabular-nums ${
          isZeroValue ? 'text-slate-300' : (returns > 0 ? 'text-emerald-600' : returns < 0 ? 'text-rose-600' : 'text-slate-900')
        }`}>
          {'\u20B9'}{valueText}
        </p>
      </div>
    </button>
  );
};

