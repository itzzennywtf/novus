
import React from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import { Investment, AssetType } from '../types';
import { ASSET_META } from '../constants';

interface Props {
  data: Investment[];
}

export const PortfolioChart: React.FC<Props> = ({ data }) => {
  const chartData = Object.values(AssetType).map(type => {
    const total = data
      .filter(i => i.type === type)
      .reduce((sum, i) => sum + i.currentValue, 0);
    return {
      name: ASSET_META[type].label,
      value: total,
      color: ASSET_META[type].color
    };
  }).filter(d => d.value > 0);

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={chartData}
            cx="50%"
            cy="50%"
            innerRadius={60}
            outerRadius={80}
            paddingAngle={5}
            dataKey="value"
          >
            {chartData.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={entry.color} strokeWidth={0} />
            ))}
          </Pie>
          <Tooltip 
            contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
            formatter={(value: number) => `₹${value.toLocaleString('en-IN')}`}
          />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
};
