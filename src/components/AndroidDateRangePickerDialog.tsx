import React, { useState, useMemo, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';

interface AndroidDateRangePickerDialogProps {
  initialStartDateMs: number | null;
  initialEndDateMs: number | null;
  onDismiss: () => void;
  onApply: (startMs: number | null, endMs: number | null) => void;
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

export const AndroidDateRangePickerDialog: React.FC<AndroidDateRangePickerDialogProps> = ({
  initialStartDateMs,
  initialEndDateMs,
  onDismiss,
  onApply
}) => {
  const today = useMemo(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }, []);

  // When initialStartDateMs is not provided, start with null (do NOT force today, matching Android screenshot)
  const [selectedStart, setSelectedStart] = useState<Date | null>(() => {
    if (initialStartDateMs) {
      const d = new Date(initialStartDateMs);
      return new Date(d.getFullYear(), d.getMonth(), d.getDate());
    }
    return null;
  });

  const [selectedEnd, setSelectedEnd] = useState<Date | null>(() => {
    if (initialEndDateMs) {
      const d = new Date(initialEndDateMs);
      return new Date(d.getFullYear(), d.getMonth(), d.getDate());
    }
    return null;
  });

  // Reference for the scrollable container and current month element
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const currentMonthRef = useRef<HTMLDivElement | null>(null);

  // Generate a STABLE array of months around current month (2 prior, current, and 4 upcoming)
  // This memo NEVER depends on selectedStart so clicking dates never reshuffles months or causes jumpy scroll
  const months = useMemo(() => {
    const result: Date[] = [];
    const currentYear = today.getFullYear();
    const currentMonth = today.getMonth();

    // 2 past months, current month, and 4 future months
    for (let offset = -2; offset <= 4; offset++) {
      result.push(new Date(currentYear, currentMonth + offset, 1));
    }
    return result;
  }, [today]);

  // On mount, auto-scroll directly to the current month (or selected month), matching Android screenshot
  useEffect(() => {
    const timer = setTimeout(() => {
      if (currentMonthRef.current && scrollContainerRef.current) {
        scrollContainerRef.current.scrollTop = currentMonthRef.current.offsetTop - 8;
      }
    }, 50);
    return () => clearTimeout(timer);
  }, []);

  const handleDateClick = (date: Date) => {
    const clickedTime = date.getTime();

    if (!selectedStart) {
      // 1. First selection: select start date
      setSelectedStart(date);
      setSelectedEnd(null);
    } else if (selectedStart && !selectedEnd) {
      // 2. Start date exists, user selects second date
      const startTime = selectedStart.getTime();

      if (clickedTime > startTime) {
        // Tapped date is after start date -> set end date
        setSelectedEnd(date);
      } else if (clickedTime < startTime) {
        // Tapped date is before start date -> create range [clickedDate, previousStartDate]
        setSelectedStart(date);
        setSelectedEnd(selectedStart);
      } else {
        // Tapped the exact same date -> single day range
        setSelectedEnd(date);
      }
    } else {
      // 3. A range was already selected -> start fresh with this date
      setSelectedStart(date);
      setSelectedEnd(null);
    }
  };

  const handleTodayClick = () => {
    setSelectedStart(today);
    setSelectedEnd(today);
  };

  const handleApplyClick = () => {
    if (!selectedStart) return;

    const startMs = new Date(
      selectedStart.getFullYear(),
      selectedStart.getMonth(),
      selectedStart.getDate(),
      0, 0, 0, 0
    ).getTime();

    const endTarget = selectedEnd || selectedStart;
    const endMs = new Date(
      endTarget.getFullYear(),
      endTarget.getMonth(),
      endTarget.getDate(),
      23, 59, 59, 999
    ).getTime();

    onApply(startMs, endMs);
  };

  // Subtitle formatting matching Android Material 3 DateRangePicker
  const subtitleText = useMemo(() => {
    if (!selectedStart) {
      return 'Choose From & To dates';
    }

    const startStr = `${SHORT_MONTH_NAMES[selectedStart.getMonth()]} ${selectedStart.getDate()}, ${selectedStart.getFullYear()}`;

    if (!selectedEnd) {
      return `${startStr} – Choose end date`;
    }

    if (selectedStart.getTime() === selectedEnd.getTime()) {
      return startStr;
    }

    const endStr = `${SHORT_MONTH_NAMES[selectedEnd.getMonth()]} ${selectedEnd.getDate()}, ${selectedEnd.getFullYear()}`;
    return `${startStr} – ${endStr}`;
  }, [selectedStart, selectedEnd]);

  const isCurrentMonth = (monthDate: Date) => {
    return monthDate.getFullYear() === today.getFullYear() && monthDate.getMonth() === today.getMonth();
  };

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
          position: 'relative',
          touchAction: 'pan-y'
        }}
      >
        {/* Title */}
        <div style={{ fontSize: 16, fontWeight: 700, color: '#FFFFFF', marginBottom: 6 }}>
          Select Date Range
        </div>

        {/* Subtitle */}
        <div style={{ fontSize: 13, color: '#8E8D94', marginBottom: 12 }}>
          {subtitleText}
        </div>

        {/* Top subtle divider */}
        <div style={{ height: 1, backgroundColor: 'rgba(255, 255, 255, 0.1)', marginBottom: 12 }} />

        {/* Fixed Day-of-week header row */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', textAlign: 'center', marginBottom: 8 }}>
          {DAYS_OF_WEEK.map((day, idx) => (
            <div key={idx} style={{ fontSize: 13, fontWeight: 500, color: '#B0AFB6', padding: '4px 0' }}>
              {day}
            </div>
          ))}
        </div>

        {/* Scrollable Month Calendar Body */}
        <div
          ref={scrollContainerRef}
          className="no-scrollbar"
          style={{
            maxHeight: 330,
            overflowY: 'auto',
            paddingRight: 2,
            position: 'relative',
            WebkitOverflowScrolling: 'touch',
            touchAction: 'pan-y'
          }}
        >
          {months.map((monthDate) => {
            const year = monthDate.getFullYear();
            const month = monthDate.getMonth();
            const monthName = `${MONTH_NAMES[month]} ${year}`;
            const daysInMonth = new Date(year, month + 1, 0).getDate();
            const firstDayOfWeek = new Date(year, month, 1).getDay(); // 0 = Sunday
            const isThisMonth = isCurrentMonth(monthDate);

            // Create blank padding cells for first week
            const blanks = Array.from({ length: firstDayOfWeek });
            const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);

            return (
              <div
                key={`${year}-${month}`}
                ref={isThisMonth ? currentMonthRef : undefined}
                style={{ marginBottom: 20 }}
              >
                {/* Month Title */}
                <div style={{ fontSize: 14.5, fontWeight: 700, color: '#FFFFFF', marginBottom: 12, paddingLeft: 4 }}>
                  {monthName}
                </div>

                {/* Days Grid */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', rowGap: 4 }}>
                  {blanks.map((_, bIdx) => (
                    <div key={`blank_${bIdx}`} style={{ height: 38 }} />
                  ))}

                  {days.map((day) => {
                    const currentDate = new Date(year, month, day);
                    const currentTime = currentDate.getTime();

                    const isTodayDate = currentDate.toDateString() === today.toDateString();
                    const isStart = selectedStart && currentDate.toDateString() === selectedStart.toDateString();
                    const isEnd = selectedEnd && currentDate.toDateString() === selectedEnd.toDateString();
                    const isInRange =
                      selectedStart &&
                      selectedEnd &&
                      currentTime > selectedStart.getTime() &&
                      currentTime < selectedEnd.getTime();

                    let cellBg = 'transparent';
                    let textColor = '#FFFFFF';
                    let borderStyle = 'none';

                    if (isStart || isEnd) {
                      cellBg = '#81C784';
                      textColor = '#122414';
                    } else if (isTodayDate) {
                      borderStyle = '1.5px solid #81C784';
                    }

                    return (
                      <div
                        key={`day_${day}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDateClick(currentDate);
                        }}
                        style={{
                          height: 38,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          cursor: 'pointer',
                          position: 'relative',
                          touchAction: 'manipulation',
                          userSelect: 'none'
                        }}
                      >
                        {/* Range background bridge */}
                        {isInRange && (
                          <div
                            style={{
                              position: 'absolute',
                              top: 2,
                              bottom: 2,
                              left: 0,
                              right: 0,
                              backgroundColor: 'rgba(129, 199, 132, 0.22)',
                              zIndex: 1,
                              pointerEvents: 'none'
                            }}
                          />
                        )}
                        {/* Left half bridge for end date if multi-day range */}
                        {isEnd && selectedStart && selectedStart.getTime() !== selectedEnd.getTime() && (
                          <div
                            style={{
                              position: 'absolute',
                              top: 2,
                              bottom: 2,
                              left: 0,
                              right: '50%',
                              backgroundColor: 'rgba(129, 199, 132, 0.22)',
                              zIndex: 1,
                              pointerEvents: 'none'
                            }}
                          />
                        )}
                        {/* Right half bridge for start date if multi-day range */}
                        {isStart && selectedEnd && selectedStart.getTime() !== selectedEnd.getTime() && (
                          <div
                            style={{
                              position: 'absolute',
                              top: 2,
                              bottom: 2,
                              left: '50%',
                              right: 0,
                              backgroundColor: 'rgba(129, 199, 132, 0.22)',
                              zIndex: 1,
                              pointerEvents: 'none'
                            }}
                          />
                        )}

                        {/* Date Circle */}
                        <div
                          style={{
                            width: 34,
                            height: 34,
                            borderRadius: '50%',
                            backgroundColor: cellBg,
                            border: borderStyle,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: 13.5,
                            fontWeight: isStart || isEnd || isTodayDate ? 700 : 500,
                            color: textColor,
                            position: 'relative',
                            zIndex: 2,
                            transition: 'background-color 0.15s ease',
                            pointerEvents: 'none'
                          }}
                        >
                          {day}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        {/* Bottom Actions Row matching Android: Today   Cancel   Apply */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            alignItems: 'center',
            gap: 16,
            marginTop: 14,
            paddingTop: 8
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
              padding: '6px 8px',
              touchAction: 'manipulation'
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
              padding: '6px 8px',
              touchAction: 'manipulation'
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleApplyClick}
            disabled={!selectedStart}
            style={{
              background: 'none',
              border: 'none',
              color: selectedStart ? '#81C784' : 'rgba(129, 199, 132, 0.4)',
              fontSize: 14,
              fontWeight: 700,
              cursor: selectedStart ? 'pointer' : 'not-allowed',
              padding: '6px 8px',
              touchAction: 'manipulation'
            }}
          >
            Apply
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};
