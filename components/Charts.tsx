
import React from 'react';
import { 
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, 
  PieChart, Pie, Cell, BarChart, Bar, CartesianGrid, LineChart, Line
} from 'recharts';

const fmtAmount = (n: number) => Math.round(n).toLocaleString('en-IN');
const fmtPct = (n: number) => `${n >= 0 ? '+' : '-'}${Math.abs(n).toFixed(2)}%`;

const TooltipCard: React.FC<{ name: string; amount: number; pct: number }> = ({ name, amount, pct }) => (
  <div style={{ borderRadius: '14px', border: 'none', boxShadow: '0 10px 30px rgba(0,0,0,0.08)', fontSize: '12px', maxWidth: '180px', background: '#fff', padding: '10px 12px' }}>
    <div style={{ fontWeight: 700, color: '#334155', marginBottom: 4 }}>{name}</div>
    <div style={{ fontWeight: 700, color: '#0f172a', marginBottom: 2 }}>Amount: {fmtAmount(amount)}</div>
    <div style={{ fontWeight: 700, color: pct >= 0 ? '#10b981' : '#e11d48' }}>Change: {fmtPct(pct)}</div>
  </div>
);

const SeriesTooltip = ({ active, payload, label, data }: { active?: boolean; payload?: any[]; label?: string; data: any[] }) => {
  if (!active || !payload || !payload.length) return null;
  const value = Number(payload[0]?.value || 0);
  const name = String(label || payload[0]?.payload?.name || 'Point');
  const first = Number(data.find((p) => Number.isFinite(Number(p?.price)) && Number(p?.price) !== 0)?.price || 0);
  const pct = first !== 0 ? ((value - first) / Math.abs(first)) * 100 : 0;
  return <TooltipCard name={name} amount={value} pct={pct} />;
};

const PieTooltip = ({ active, payload, total }: { active?: boolean; payload?: any[]; total: number }) => {
  if (!active || !payload || !payload.length) return null;
  const point = payload[0]?.payload;
  const name = String(point?.name || 'Slice');
  const value = Number(point?.value || 0);
  const weight = total > 0 ? (value / total) * 100 : 0;
  return (
    <div style={{ borderRadius: '14px', border: 'none', boxShadow: '0 10px 30px rgba(0,0,0,0.08)', fontSize: '12px', maxWidth: '180px', background: '#fff', padding: '10px 12px' }}>
      <div style={{ fontWeight: 700, color: '#334155', marginBottom: 4 }}>{name}</div>
      <div style={{ fontWeight: 700, color: '#0f172a', marginBottom: 2 }}>Amount: {fmtAmount(value)}</div>
      <div style={{ fontWeight: 700, color: '#2563eb' }}>Weight: {Math.abs(weight).toFixed(2)}%</div>
    </div>
  );
};

const BarTooltip = ({ active, payload, label }: { active?: boolean; payload?: any[]; label?: string }) => {
  if (!active || !payload || !payload.length) return null;
  const name = String(label || payload[0]?.payload?.name || 'Bar');
  const current = payload.find((p) => p?.dataKey === 'current')?.value;
  const invested = payload.find((p) => p?.dataKey === 'invested')?.value;
  const fallback = Number(payload[0]?.value || 0);
  const amount = Number(current ?? fallback);
  const pct = Number.isFinite(Number(current)) && Number.isFinite(Number(invested)) && Number(invested) !== 0
    ? ((Number(current) - Number(invested)) / Math.abs(Number(invested))) * 100
    : 0;
  return <TooltipCard name={name} amount={amount} pct={pct} />;
};

export const PerformanceLineChart: React.FC<{ data: any[], color?: string, height?: number }> = ({ data, color = "#6366F1", height = 200 }) => (
  <div style={{ height: `${height}px`, minHeight: `${height}px` }} className="w-full max-w-full min-w-0">
    <ResponsiveContainer width="100%" height="100%" minWidth={10} minHeight={10}>
      <AreaChart data={data}>
        <defs>
          <linearGradient id="colorArea" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={color} stopOpacity={0.2}/>
            <stop offset="95%" stopColor={color} stopOpacity={0}/>
          </linearGradient>
        </defs>
        <XAxis dataKey="name" hide />
        <YAxis hide domain={['auto', 'auto']} />
        <Tooltip
          content={(props) => <SeriesTooltip {...props} data={data} />}
        />
        <Area type="monotone" dataKey="price" stroke={color} fill="url(#colorArea)" strokeWidth={4} dot={false} />
      </AreaChart>
    </ResponsiveContainer>
  </div>
);

export const GrowthLineChart: React.FC<{ data?: any[], color?: string, height?: number }> = ({ data, color = "#6366F1", height = 200 }) => {
  const defaultData = [
    { name: '1M', val: 40 }, { name: '3M', val: 45 }, { name: '6M', val: 42 }, 
    { name: '1Y', val: 55 }, { name: '3Y', val: 78 }, { name: '5Y', val: 110 }
  ];
  return (
  <div style={{ height: `${height}px`, minHeight: `${height}px` }} className="w-full max-w-full min-w-0">
    <ResponsiveContainer width="100%" height="100%" minWidth={10} minHeight={10}>
      <AreaChart data={data || defaultData}>
        <XAxis dataKey="name" hide />
        <Tooltip
          content={(props) => <SeriesTooltip {...props} data={(data || defaultData).map((d) => ({ name: d.name, price: d.val }))} />}
        />
        <Area type="monotone" dataKey="val" stroke={color} fillOpacity={0.1} fill={color} strokeWidth={3} dot={false} />
      </AreaChart>
    </ResponsiveContainer>
  </div>
);
};

export const CustomPieChart: React.FC<{ data: { name: string, value: number, color: string }[], height?: number }> = ({ data, height = 250 }) => (
  <div style={{ height: `${height}px`, minHeight: `${height}px` }} className="w-full max-w-full min-w-0">
    <ResponsiveContainer width="100%" height="100%" minWidth={10} minHeight={10}>
      <PieChart>
        <Pie
          data={data}
          cx="50%"
          cy="50%"
          innerRadius={70}
          outerRadius={95}
          paddingAngle={8}
          dataKey="value"
        >
          {data.map((entry, index) => (
            <Cell key={`cell-${index}`} fill={entry.color} strokeWidth={0} />
          ))}
        </Pie>
        <Tooltip
          content={(props) => <PieTooltip {...props} total={data.reduce((s, d) => s + d.value, 0)} />}
        />
      </PieChart>
    </ResponsiveContainer>
  </div>
);

export const ProfitBarChart: React.FC<{ data: any[], height?: number }> = ({ data, height = 200 }) => (
  <div style={{ height: `${height}px`, minHeight: `${height}px` }} className="w-full max-w-full min-w-0">
    <ResponsiveContainer width="100%" height="100%" minWidth={10} minHeight={10}>
      <BarChart data={data}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
        <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#94a3b8' }} />
        <Tooltip
          content={(props) => <BarTooltip {...props} />}
          cursor={{ fill: '#f8fafc' }}
        />
        <Bar dataKey="profit" radius={[4, 4, 0, 0]} barSize={20}>
          {data.map((entry, index) => (
            <Cell key={`profit-${index}`} fill={(entry?.profit ?? 0) >= 0 ? "#10B981" : "#EF4444"} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  </div>
);

export const ComparisonBarChart: React.FC<{ data: any[], height?: number }> = ({ data, height = 200 }) => (
  <div style={{ height: `${height}px`, minHeight: `${height}px` }} className="w-full max-w-full min-w-0">
    <ResponsiveContainer width="100%" height="100%" minWidth={10} minHeight={10}>
      <BarChart data={data}>
        <XAxis dataKey="name" hide />
        <Tooltip
          content={(props) => <BarTooltip {...props} />}
        />
        <Bar dataKey="invested" fill="#e2e8f0" radius={[4, 4, 0, 0]} />
        <Bar dataKey="current" fill="#6366F1" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  </div>
);
