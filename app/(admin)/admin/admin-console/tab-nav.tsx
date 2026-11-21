'use client';

import { Layers, Clock, Building2, Users as UsersIcon, QrCode } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { AdminTab } from './types';

interface TabNavProps {
  activeTab: AdminTab;
  onSelectTab: (tab: AdminTab) => void;
  pendingCount: number;
  businessesCount: number;
  usersCount: number;
}

export function TabNav({
  activeTab,
  onSelectTab,
  pendingCount,
  businessesCount,
  usersCount,
}: TabNavProps) {
  const tabs = [
    { id: 'overview' as const, label: 'Overview & Analytics', icon: Layers },
    {
      id: 'pending' as const,
      label: 'Pending Claims',
      icon: Clock,
      badge: pendingCount,
      badgeHighlight: pendingCount > 0,
    },
    { id: 'businesses' as const, label: 'Businesses Directory', icon: Building2, badge: businessesCount },
    { id: 'users' as const, label: 'Platform Users', icon: UsersIcon, badge: usersCount },
    { id: 'settings' as const, label: 'Gateways & Settings', icon: QrCode },
  ];

  return (
    <div className="flex items-center justify-between border-b border-border/60 pb-px">
      {/* One line per tab; on narrow screens the row swipes sideways (no scrollbar track). */}
      <div className="flex min-w-0 gap-2 overflow-x-auto py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;

          return (
            <button
              key={tab.id}
              type="button"
              aria-pressed={isActive}
              onClick={() => onSelectTab(tab.id)}
              className={cn(
                'group flex shrink-0 items-center gap-2 whitespace-nowrap rounded-lg px-3 sm:px-3.5 py-2 text-[13px] sm:text-sm font-bold transition-all cursor-pointer select-none outline-none',
                isActive
                  ? 'bg-indigo-600 text-white shadow-xs'
                  : 'text-muted-foreground hover:bg-muted/80 hover:text-foreground'
              )}
            >
              <Icon className={cn('size-4 shrink-0 transition-colors', isActive ? 'text-white' : 'text-muted-foreground group-hover:text-foreground')} />
              <span>{tab.label}</span>
              {tab.badge !== undefined && (
                <span
                  className={cn(
                    'rounded-full px-1.5 py-0.5 text-xs font-bold leading-tight transition-colors',
                    isActive
                      ? 'bg-white/20 text-white'
                      : tab.badgeHighlight
                        ? 'bg-amber-700 text-white'
                        : 'bg-muted text-muted-foreground group-hover:bg-muted/80'
                  )}
                >
                  {tab.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

