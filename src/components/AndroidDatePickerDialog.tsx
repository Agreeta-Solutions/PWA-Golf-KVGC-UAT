import React, { useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface AndroidDatePickerDialogProps {
  initialDate?: string; // "YYYY-MM-DD"
  onDismiss: () => void;
  onApply: (dateIso: string) => void; // "YYYY-MM-DD"
}

const DAYS_OF_WEEK = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

const SHORT_MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
];

export const AndroidDatePickerDialog: React.FC<AndroidDatePickerDialogProps> = ({
  initialDate,
  onDismiss,
  onApply
}) => {
  const today = useMemo(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }, []);

  // Parse initialDate YYYY-MM-DD safely
  const initialSelected = useMemo(() => {
    if (initialDate && /^\d{4}-\d{2}-\d{2}$/.test(initialDate)) {
      const [y, m, d] = initialDate.split('-').map(Number);
      return new Date(y, m - 1, d);
    }
    return today;
  }, [initialDate, today]);

  const [selectedDate, setSelectedDate] = useState<Date>(initialSelected);
  const [viewYear, setViewYear] = useState<number>(initialSelected.getFullYear());
  const [viewMonth, setViewMonth] = useState<number>(initialSelected.getMonth());

  const handlePrevMonth = () => {
    if (viewMonth === 0) {
      setViewYear(y => y - 1);
      setViewMonth(11);
    } else {
      setViewMonth(m => m - 1);
    }
  };

  const handleNextMonth = () => {
    if (viewMonth === 11) {
      setViewYear(y => y + 1);
      setViewMonth(0);
    } else {
      setViewMonth(m => m + 1);
    }
  };

  const handleSelectDay = (day: number) => {
    const newDate = new Date(viewYear, viewMonth, day);
    setSelectedDate(newDate);
  };

  const handleTodayClick = () => {
    setSelectedDate(today);
    setViewYear(today.getFullYear());
    setViewMonth(today.getMonth());
  };

  const handleOkClick = () => {
    const y = selectedDate.getFullYear();
    const m = String(selectedDate.getMonth() + 1).padStart(2, '0');
    const d = String(selectedDate.getDate()).padStart(2, '0');
    const formattedIso = `${y}-${m}-${d}`;
    onApply(formattedIso);
  };

  // Subtitle headline formatting (e.g., "Wed, Oct 7, 2026")
  const subtitleText = useMemo(() => {
    const weekday = selectedDate.toLocaleDateString('en-US', { weekday: 'short' });
    const month = SHORT_MONTH_NAMES[selectedDate.getMonth()];
    const day = selectedDate.getDate();
    const year = selectedDate.getFullYear();
    return `${weekday}, ${month} ${day}, ${year}`;
  }, [selectedDate]);

  // Calendar days grid computation
  const daysInMonth = useMemo(() => {
    return new Date(viewYear, viewMonth + 1, 0).getDate();
  }, [viewYear, viewMonth]);

  const firstDayOfWeek = useMemo(() => {
    return new Date(viewYear, viewMonth, 1).getDay(); // 0 = Sunday
  }, [viewYear, viewMonth]);

  const blanks = useMemo(() => Array.from({ length: firstDayOfWeek }), [firstDayOfWeek]);
  const days = useMemo(() => Array.from({ length: daysInMonth }, (_, i) => i + 1), [daysInMonth]);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="modal-overlay"
      onClick={onDismiss}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.65)',
        backdropFilter: 'blur(2px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 999999,
        padding: '16px',
        touchAction: 'none'
      }}
    >
      <div
        className="modal-content"
        onClick={(e) => e.stopPropagation()}
        style={{
          backgroundColor: '#26252B',
          borderRadius: 24,
          padding: '22px 20px 16px 20px',
          width: '92%',
          maxWidth: 340,
          boxShadow: '0 12px 36px rgba(0, 0, 0, 0.6)',
          display: 'flex',
          flexDirection: 'column',
          boxSizing: 'border-box',
          color: '#FFFFFF',
          userSelect: 'none',
          position: 'relative'
        }}
      >
        {/* Title */}
        <div style={{ fontSize: 13, fontWeight: 500, color: '#B0AFB6', marginBottom: 4, letterSpacing: '0.4px', textTransform: 'uppercase' }}>
          Select Date
        </div>

        {/* Subtitle / Selected Date Headline */}
        <div style={{ fontSize: 18, fontWeight: 700, color: '#FFFFFF', marginBottom: 14 }}>
          {subtitleText}
        </div>

        {/* Top Divider */}
        <div style={{ height: 1, backgroundColor: 'rgba(255, 255, 255, 0.12)', marginBottom: 14 }} />

        {/* Month Navigation Header with Chevrons */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 12,
            padding: '0 4px'
          }}
        >
          <span style={{ fontSize: 15, fontWeight: 700, color: '#FFFFFF' }}>
            {MONTH_NAMES[viewMonth]} {viewYear}
          </span>
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              type="button"
              onClick={handlePrevMonth}
              style={{
                background: 'rgba(255, 255, 255, 0.08)',
                border: 'none',
                borderRadius: '50%',
                width: 32,
                height: 32,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#FFFFFF',
                cursor: 'pointer'
              }}
            >
              <ChevronLeft size={18} />
            </button>
            <button
              type="button"
              onClick={handleNextMonth}
              style={{
                background: 'rgba(255, 255, 255, 0.08)',
                border: 'none',
                borderRadius: '50%',
                width: 32,
                height: 32,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#FFFFFF',
                cursor: 'pointer'
              }}
            >
              <ChevronRight size={18} />
            </button>
          </div>
        </div>

        {/* Days of Week Header Row */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', textAlign: 'center', marginBottom: 8 }}>
          {DAYS_OF_WEEK.map((day, idx) => (
            <div key={idx} style={{ fontSize: 12.5, fontWeight: 600, color: '#8E8D94', padding: '4px 0' }}>
              {day}
            </div>
          ))}
        </div>

        {/* Days Grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', rowGap: 6, minHeight: 210 }}>
          {blanks.map((_, bIdx) => (
            <div key={`blank_${bIdx}`} style={{ height: 36 }} />
          ))}

          {days.map((day) => {
            const isSelected =
              selectedDate.getFullYear() === viewYear &&
              selectedDate.getMonth() === viewMonth &&
              selectedDate.getDate() === day;

            const isToday =
              today.getFullYear() === viewYear &&
              today.getMonth() === viewMonth &&
              today.getDate() === day;

            let cellBg = 'transparent';
            let textColor = '#FFFFFF';
            let borderStyle = 'none';

            if (isSelected) {
              cellBg = '#2E7D32'; // Deep Green matching Android BottomNavSelected
              textColor = '#FFFFFF';
            } else if (isToday) {
              borderStyle = '1px solid #81C784';
              textColor = '#81C784';
            }

            return (
              <div
                key={`day_${day}`}
                onClick={() => handleSelectDay(day)}
                style={{
                  height: 36,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer'
                }}
              >
                <div
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: '50%',
                    backgroundColor: cellBg,
                    border: borderStyle,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 13.5,
                    fontWeight: isSelected || isToday ? 700 : 500,
                    color: textColor,
                    transition: 'background-color 0.15s ease',
                    boxShadow: isSelected ? '0 2px 6px rgba(0,0,0,0.3)' : 'none'
                  }}
                >
                  {day}
                </div>
              </div>
            );
          })}
        </div>

        {/* Bottom Actions Row matching Android: Today | Cancel | OK */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            alignItems: 'center',
            gap: 16,
            marginTop: 14,
            paddingTop: 8,
            borderTop: '1px solid rgba(255, 255, 255, 0.1)'
          }}
        >
          <button
            type="button"
            onClick={handleTodayClick}
            style={{
              background: 'none',
              border: 'none',
              color: '#81C784',
              fontSize: 14,
              fontWeight: 600,
              cursor: 'pointer',
              padding: '6px 8px'
            }}
          >
            Today
          </button>
          <button
            type="button"
            onClick={onDismiss}
            style={{
              background: 'none',
              border: 'none',
              color: '#81C784',
              fontSize: 14,
              fontWeight: 600,
              cursor: 'pointer',
              padding: '6px 8px'
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleOkClick}
            style={{
              background: 'none',
              border: 'none',
              color: '#81C784',
              fontSize: 14,
              fontWeight: 700,
              cursor: 'pointer',
              padding: '6px 8px'
            }}
          >
            OK
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};
