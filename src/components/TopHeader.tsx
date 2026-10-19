import React, { useState, useRef, useEffect } from 'react';
import { Bell, LogOut } from 'lucide-react';
import logoSvg from '../assets/logo.svg';

interface TopHeaderProps {
  userFirstName?: string;
  onNotificationClick?: () => void;
  onLogout?: () => void;
}

export const TopHeader: React.FC<TopHeaderProps> = ({ userFirstName = '', onNotificationClick, onLogout }) => {
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const profileRef = useRef<HTMLDivElement | null>(null);

  // Close dropdown on click outside
  useEffect(() => {
    if (!showProfileMenu) return;
    const handleClickOutside = (e: MouseEvent | TouchEvent) => {
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) {
        setShowProfileMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('touchstart', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    };
  }, [showProfileMenu]);

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      width: '100%',
      padding: 'calc(12px + env(safe-area-inset-top, 0px)) 16px 8px 16px',
      backgroundColor: 'var(--gs-bg)',
      position: 'relative'
    }}>
      {/* Profile Section on Left with Clickable Avatar & Dropdown */}
      <div ref={profileRef} style={{ position: 'relative' }}>
        <div 
          onClick={() => setShowProfileMenu(prev => !prev)}
          title="Profile menu"
          style={{ 
            display: 'flex', 
            alignItems: 'center', 
            gap: '10px', 
            cursor: 'pointer',
            userSelect: 'none'
          }}
        >
          <div style={{
            width: 38,
            height: 38,
            borderRadius: '50%',
            backgroundColor: 'var(--gs-surface)',
            border: showProfileMenu ? '2px solid #81C784' : '1px solid var(--gs-outline-soft)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'hidden',
            transition: 'border 0.15s ease'
          }}>
            <img 
              src="/assets/ic_profile_placeholder.jpg" 
              alt="User" 
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              onError={(e) => {
                (e.target as HTMLElement).style.display = 'none';
              }}
            />
          </div>
          <div>
            <div style={{ fontSize: '11px', color: 'var(--gs-text-muted)', fontWeight: 500 }}>
              Welcome back
            </div>
            <div style={{ fontSize: '15px', color: 'var(--gs-text-primary)', fontWeight: 700, lineHeight: 1.2 }}>
              {userFirstName || 'Greenskeeper'}
            </div>
          </div>
        </div>

        {/* Logout Popover appearing when profile pic is clicked */}
        {showProfileMenu && (
          <div style={{
            position: 'absolute',
            top: 'calc(100% + 8px)',
            left: 0,
            backgroundColor: '#FFFFFF',
            borderRadius: 14,
            boxShadow: '0 8px 24px rgba(0, 0, 0, 0.15)',
            border: '1px solid rgba(0, 0, 0, 0.08)',
            padding: '6px',
            minWidth: 150,
            zIndex: 1000,
            display: 'flex',
            flexDirection: 'column'
          }}>
            {onLogout && (
              <button
                type="button"
                onClick={() => {
                  setShowProfileMenu(false);
                  onLogout();
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  width: '100%',
                  padding: '10px 12px',
                  borderRadius: 10,
                  border: 'none',
                  backgroundColor: 'transparent',
                  color: '#D32F2F',
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: 'pointer',
                  textAlign: 'left',
                  transition: 'background-color 0.15s ease'
                }}
                onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#FDEAEA'; }}
                onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
              >
                <LogOut size={16} color="#D32F2F" />
                <span>Log Out</span>
              </button>
            )}
          </div>
        )}
      </div>

      {/* Right side: Logo and Notification Bell only (Logout removed from top right) */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <img 
          src={logoSvg} 
          alt="GroundSense" 
          style={{ height: '22px', objectFit: 'contain' }}
        />
        <button
          onClick={onNotificationClick}
          title="Notifications"
          style={{
            width: 38,
            height: 38,
            borderRadius: 12,
            backgroundColor: '#EEEEEE',
            border: 'none',
            cursor: 'pointer',
            color: '#1C1B1F',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 0
          }}
        >
          <Bell size={20} color="#1C1B1F" />
        </button>
      </div>
    </div>
  );
};
