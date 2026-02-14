
import React from 'react';
import { Goal } from '../types';

export const GoalCard: React.FC<{ goal: Goal }> = ({ goal }) => {
  const percentage = Math.min(100, (goal.currentAmount / goal.targetAmount) * 100);
  
  return (
    <div className="bg-white p-5 rounded-3xl premium-shadow border border-slate-50 space-y-3">
      <div className="flex justify-between items-center">
        <h4 className="font-bold text-slate-800">{goal.name}</h4>
        <span className="text-xs font-semibold text-slate-400">Target: ₹{(goal.targetAmount / 100000).toFixed(1)}L</span>
      </div>
      <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
        <div 
          className="h-full bg-indigo-500 rounded-full transition-all duration-1000" 
          style={{ width: `${percentage}%` }}
        />
      </div>
      <div className="flex justify-between text-[10px] font-bold uppercase tracking-wider text-slate-500">
        <span>{percentage.toFixed(0)}% Complete</span>
        <span>₹{goal.currentAmount.toLocaleString('en-IN')} Saved</span>
      </div>
    </div>
  );
};
