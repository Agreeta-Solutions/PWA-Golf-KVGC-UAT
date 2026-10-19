import React from 'react';
import { Home, Flag } from 'lucide-react';
import { AccountTreeIcon } from './AccountTreeIcon';

export type NavTabRoute = 'home' | 'history' | 'hole_view' | 'ai_summary';

interface BottomNavProps {
  currentTab: NavTabRoute;
  onSelectTab: (tab: NavTabRoute) => void;
}

export const BottomNav: React.FC<BottomNavProps> = ({ currentTab, onSelectTab }) => {
  const navItems = [
    { route: 'home' as NavTabRoute, label: 'HOME', icon: Home },
    // { route: 'history' as NavTabRoute, label: 'TASK HISTORY', icon: History }, // Commented out for now; will be needed later
    { route: 'hole_view' as NavTabRoute, label: 'HOLE VIEW', icon: Flag },
    { route: 'ai_summary' as NavTabRoute, label: 'WEATHER INSIGHTS', icon: AccountTreeIcon }
  ];

  return (
    <nav className="bottom-nav">
      {navItems.map((item) => {
        const isSelected = currentTab === item.route;
        const IconComponent = item.icon;

        return (
          <button
            key={item.route}
            className={`nav-item ${isSelected ? 'selected' : ''}`}
            onClick={() => onSelectTab(item.route)}
          >
            <div className="indicator-bar" />
            <IconComponent 
              className="nav-icon" 
              size={22} 
              color={isSelected ? 'var(--gs-nav-selected)' : 'var(--gs-nav-unselected)'} 
            />
            <span className="nav-label">{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
};
