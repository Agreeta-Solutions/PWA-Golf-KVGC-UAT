import React, { useState, useEffect } from 'react';
import type { 
  HomeTaskUi, 
  FilterType, 
  FilterOption, 
  HomeSortMode, 
  HomeTaskTab, 
  TaskType 
} from '../types/task';
import { 
  Zap, 
  ChevronRight, 
  CheckCircle, 
  Image as ImageIcon, 
  TrendingUp, 
  ArrowDown, 
  Filter as FilterIcon,
  Bug,
  Droplet,
  Leaf,
  Layers,
  Sparkles,
  Bell,
  X,
  List,
  Calendar,
  ClipboardList
} from 'lucide-react';
import { TopHeader } from '../components/TopHeader';
import { AndroidDateRangePickerDialog } from '../components/AndroidDateRangePickerDialog';
import { fetchNotificationsApi, markNotificationRead } from '../services/apiService';
import type { NotificationItem } from '../services/apiService';

export function getSectionDisplayName(secId?: number, secDesc?: string): string {
  if (secDesc && secDesc.trim()) {
    const cleaned = secDesc.replace(/\d+$/, '').trim();
    if (cleaned) return cleaned;
  }
  if (!secId) return '';
  switch (secId) {
    case 1: return 'Tee';
    case 2: return 'Rough';
    case 3: return 'Fairway';
    case 4: return 'Green';
    case 5: return 'Tee';
    default: return `Section ${secId}`;
  }
}

export function parseTaskDate(dateStr?: string | null): Date | null {
  if (!dateStr || !dateStr.trim()) return null;
  const trimmed = dateStr.trim();

  // 1. dd/MM/yyyy or d/M/yyyy (e.g. 10/04/2026)
  const dmyMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (dmyMatch) {
    const day = parseInt(dmyMatch[1], 10);
    const month = parseInt(dmyMatch[2], 10) - 1;
    const year = parseInt(dmyMatch[3], 10);
    return new Date(year, month, day);
  }

  // 2. yyyy-MM-dd or ISO 8601 (e.g. 2026-09-28 or 2026-09-28T10:00:00)
  const isoMatch = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (isoMatch) {
    const year = parseInt(isoMatch[1], 10);
    const month = parseInt(isoMatch[2], 10) - 1;
    const day = parseInt(isoMatch[3], 10);
    return new Date(year, month, day);
  }

  // 3. Fallback to Date.parse
  const parsed = Date.parse(trimmed);
  if (!isNaN(parsed)) {
    const d = new Date(parsed);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }

  return null;
}

export function isDueDatePassed(dueDateStr?: string | null): boolean {
  if (!dueDateStr || !dueDateStr.trim()) return false;
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const dateObj = parseTaskDate(dueDateStr);
  if (dateObj) {
    return dateObj.getTime() < todayStart;
  }
  return false;
}

export function isDateInRange(dateStr?: string | null, startMs?: number | null, endMs?: number | null): boolean {
  if (!dateStr || !dateStr.trim() || startMs == null) return false;
  const dateObj = parseTaskDate(dateStr);
  if (!dateObj) return false;
  const time = dateObj.getTime();
  const actualEndMs = endMs != null ? endMs : (startMs + 86400000 - 1);
  return time >= startMs && time <= actualEndMs;
}

const FILTER_OPTIONS: FilterOption[] = [
  { id: 'ALL', displayName: 'All Issues', categoryDescription: 'All Issues' },
  { id: 'PEST', displayName: 'Pest', categoryDescription: 'Pest' },
  { id: 'FERTILIZER', displayName: 'Fertilizer', categoryDescription: 'Fertilizer' },
  { id: 'VEG_STRESS', displayName: 'Veg stress', categoryDescription: 'Vegetative Stress' },
  { id: 'MOISTURE', displayName: 'Moisture', categoryDescription: 'Moisture' },
  { id: 'GENERAL', displayName: 'General', categoryDescription: 'General' }
];

interface HomeScreenProps {
  tasks: HomeTaskUi[];
  userFirstName?: string;
  isRefreshing?: boolean;
  completingTaskId?: string | null;
  selectedTaskId?: string | null;
  onClearSelectedTaskId?: () => void;
  onRefresh?: () => void;
  onMarkTaskDone?: (task: HomeTaskUi) => void;
  onRequestAddImages?: (taskLogId: number) => void;
  onSelectHoleTask?: (task: HomeTaskUi) => void;
  onLogout?: () => void;
}

export const HomeScreen: React.FC<HomeScreenProps> = ({
  tasks,
  userFirstName,
  completingTaskId,
  selectedTaskId,
  onClearSelectedTaskId,
  onMarkTaskDone,
  onRequestAddImages,
  onSelectHoleTask,
  onLogout
}) => {
  const [selectedFilter, setSelectedFilter] = useState<FilterType>('ALL');
  const [selectedTab, setSelectedTab] = useState<HomeTaskTab>('Active');
  const [sortMode, setSortMode] = useState<HomeSortMode>('All');
  const [filterHoleId, setFilterHoleId] = useState<number | null>(null);
  const [filterTaskId, setFilterTaskId] = useState<string | null>(null);
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);

  const [startDateMs, setStartDateMs] = useState<number | null>(null);
  const [endDateMs, setEndDateMs] = useState<number | null>(null);
  const [showDateDialog, setShowDateDialog] = useState(false);

  const [showNotifications, setShowNotifications] = useState(false);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [isLoadingNotifications, setIsLoadingNotifications] = useState(false);

  const handleNotificationClick = async () => {
    const nextState = !showNotifications;
    setShowNotifications(nextState);
    if (nextState) {
      setIsLoadingNotifications(true);
      const items = await fetchNotificationsApi();
      setNotifications(items);
      setIsLoadingNotifications(false);
    }
  };

  const handleSelectNotification = (notif: NotificationItem) => {
    // Opening a notification marks it as read (turns from green to white)
    if (!notif.isRead) {
      markNotificationRead(notif.id);
      setNotifications(prev => prev.map(n => (n.id === notif.id ? { ...n, isRead: true } : n)));
    }

    // Extract hole number from notification holeDescription (e.g. "HOLE 2" -> 2)
    const holeNumStr = (notif.holeDescription || '').replace(/\D/g, '');
    const holeNum = holeNumStr ? parseInt(holeNumStr, 10) : null;

    let targetTask: HomeTaskUi | undefined = undefined;

    // 1. If explicit taskId is set on notification, try finding task by taskId
    if (notif.taskId) {
      targetTask = tasks.find(t => String(t.id) === String(notif.taskId));
    }

    // 2. Find task matching exact holeId AND operationType/title
    if (!targetTask && holeNum !== null) {
      targetTask = tasks.find(t => 
        t.holeId === holeNum && (
          t.taskCategoryDescription.toLowerCase().includes(notif.operationType.toLowerCase()) ||
          notif.operationType.toLowerCase().includes(t.taskCategoryDescription.toLowerCase()) ||
          t.description.toLowerCase().includes(notif.title.toLowerCase())
        )
      );
      // Fallback: any task on that exact hole
      if (!targetTask) {
        targetTask = tasks.find(t => t.holeId === holeNum);
      }
    }

    if (targetTask) {
      setFilterHoleId(null);
      setFilterTaskId(targetTask.id);
      setExpandedTaskId(targetTask.id);
      setSelectedTab(targetTask.isCompleted ? 'Completed' : 'Active');
      setShowNotifications(false);
    } else if (holeNum !== null) {
      setFilterTaskId(null);
      setFilterHoleId(holeNum);
      setShowNotifications(false);
    } else {
      setShowNotifications(false);
    }
  };

  useEffect(() => {
    if (selectedTaskId && tasks.length > 0) {
      const targetTask = tasks.find(t => String(t.id) === String(selectedTaskId));
      if (targetTask) {
        setSelectedFilter('ALL');
        setFilterTaskId(null);
        setFilterHoleId(null);
        setSortMode('All');
        setSelectedTab(targetTask.isCompleted ? 'Completed' : 'Active');
        setExpandedTaskId(targetTask.id);

        if (onClearSelectedTaskId) {
          onClearSelectedTaskId();
        }

        setTimeout(() => {
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }, 50);
      }
    }
  }, [selectedTaskId, tasks, onClearSelectedTaskId]);

  const matchesCategoryFilter = (task: HomeTaskUi, filter: FilterType) => {
    if (filter === 'ALL') return true;
    const cat = (task.taskCategoryDescription || '').toLowerCase();
    const type = task.type;
    if (filter === 'PEST') {
      return type === 'PEST' || cat.includes('pest');
    }
    if (filter === 'FERTILIZER') {
      return type === 'FERTILIZER' || cat.includes('fertilizer');
    }
    if (filter === 'VEG_STRESS') {
      return type === 'VEG_STRESS' || cat.includes('veg') || cat.includes('stress') || cat.includes('turf');
    }
    if (filter === 'MOISTURE') {
      return type === 'MOISTURE' || cat.includes('moisture') || cat.includes('irrigation') || cat.includes('water');
    }
    if (filter === 'GENERAL') {
      return type === 'GENERAL' || cat.includes('general') || (
        !cat.includes('pest') &&
        !cat.includes('fertilizer') &&
        !cat.includes('veg') &&
        !cat.includes('stress') &&
        !cat.includes('moisture') &&
        !cat.includes('irrigation') &&
        !cat.includes('water')
      );
    }
    return true;
  };

  // Filter tasks matching Android HomeFilterMode
  const filteredTasks = tasks.filter(task => {
    // Specific Task Filter (e.g. redirected from notification or hole view)
    if (filterTaskId !== null) {
      return String(task.id) === String(filterTaskId);
    }

    // 1. Hole Filter
    if (filterHoleId !== null && task.holeId !== filterHoleId) return false;

    // 2. Issue Category Filter
    if (!matchesCategoryFilter(task, selectedFilter)) return false;

    // 3. Filter Mode (All, Latest, Urgent, Oldest, Date)
    if (sortMode === 'All') return true;
    if (sortMode === 'Latest') return !isDueDatePassed(task.expectedCompletionDate);
    if (sortMode === 'Urgent') return task.isUrgent === true;
    if (sortMode === 'Oldest') return isDueDatePassed(task.expectedCompletionDate) && !task.isCompleted;
    if (sortMode === 'Date') return isDateInRange(task.expectedCompletionDate, startDateMs, endDateMs);

    return true;
  });

  // Sort tasks matching Android sortedForHome
  const sortedTasks = [...filteredTasks].sort((a, b) => {
    const idA = parseInt(a.id, 10) || 0;
    const idB = parseInt(b.id, 10) || 0;
    if (sortMode === 'Oldest') return idA - idB;
    return idB - idA;
  });

  // When a task is expanded (e.g. redirected from hole view "View Task"), place it on top while keeping all other tasks visible below
  const orderedTasks = React.useMemo(() => {
    if (expandedTaskId) {
      const target = sortedTasks.find(t => String(t.id) === String(expandedTaskId));
      if (target) {
        return [target, ...sortedTasks.filter(t => String(t.id) !== String(expandedTaskId))];
      }
    }
    return sortedTasks;
  }, [sortedTasks, expandedTaskId]);

  const activeTasks = orderedTasks.filter(t => !t.isCompleted);
  const completedTasks = orderedTasks.filter(t => t.isCompleted);

  const activeCount = tasks.filter(task => {
    if (task.isCompleted) return false;
    if (filterHoleId !== null && task.holeId !== filterHoleId) return false;
    if (!matchesCategoryFilter(task, selectedFilter)) return false;
    if (sortMode === 'All') return true;
    if (sortMode === 'Latest') return !isDueDatePassed(task.expectedCompletionDate);
    if (sortMode === 'Urgent') return task.isUrgent === true;
    if (sortMode === 'Oldest') return isDueDatePassed(task.expectedCompletionDate);
    if (sortMode === 'Date') return isDateInRange(task.expectedCompletionDate, startDateMs, endDateMs);
    return true;
  }).length;

  const completedCount = tasks.filter(task => {
    if (!task.isCompleted) return false;
    if (filterHoleId !== null && task.holeId !== filterHoleId) return false;
    if (!matchesCategoryFilter(task, selectedFilter)) return false;
    if (sortMode === 'All') return true;
    if (sortMode === 'Latest') return !isDueDatePassed(task.expectedCompletionDate);
    if (sortMode === 'Urgent') return task.isUrgent === true;
    if (sortMode === 'Oldest') return isDueDatePassed(task.expectedCompletionDate);
    if (sortMode === 'Date') return isDateInRange(task.expectedCompletionDate, startDateMs, endDateMs);
    return true;
  }).length;

  const renderTaskTypeIcon = (type: TaskType) => {
    switch (type) {
      case 'PEST':
        return <Bug size={20} color="#E65100" />;
      case 'FERTILIZER':
        return <Sparkles size={20} color="#2E7D32" />;
      case 'VEG_STRESS':
        return <Leaf size={20} color="#2E7D32" />;
      case 'MOISTURE':
      case 'IRRIGATION':
        return <Droplet size={20} color="#1565C0" />;
      case 'GENERAL':
      default:
        return <ClipboardList size={20} color="#4A5A4E" />;
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <TopHeader userFirstName={userFirstName} onNotificationClick={handleNotificationClick} onLogout={onLogout} />

      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px 24px 16px' }}>
        {showNotifications ? (
          <NotificationsOverlay
            notifications={notifications}
            isLoading={isLoadingNotifications}
            onClose={() => setShowNotifications(false)}
            onSelectNotification={handleSelectNotification}
          />
        ) : (
          <>
        <div className="no-scrollbar" style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 12, scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
          {FILTER_OPTIONS.map(filter => {
            const isSelected = selectedFilter === filter.id;
            return (
              <button
                key={filter.id}
                className={`filter-pill ${isSelected ? 'selected' : ''}`}
                onClick={() => setSelectedFilter(filter.id)}
              >
                {filter.id === 'ALL' && <Layers size={14} />}
                {filter.id === 'PEST' && <Bug size={14} />}
                {filter.id === 'FERTILIZER' && <Sparkles size={14} />}
                {filter.id === 'VEG_STRESS' && <Leaf size={14} />}
                {filter.id === 'MOISTURE' && <Droplet size={14} />}
                {filter.id === 'GENERAL' && <ClipboardList size={14} />}
                {filter.displayName}
              </button>
            );
          })}
        </div>

        {/* Task Tabs (Active / Completed) */}
        <div style={{ display: 'flex', borderBottom: '1px solid var(--gs-outline-soft)', marginTop: 8, marginBottom: 14 }}>
          <button
            onClick={() => setSelectedTab('Active')}
            style={{
              flex: 1,
              padding: '8px 0',
              background: 'none',
              border: 'none',
              borderBottom: selectedTab === 'Active' ? '3px solid var(--gs-nav-selected)' : '3px solid transparent',
              fontSize: '14px',
              fontWeight: selectedTab === 'Active' ? 700 : 500,
              color: selectedTab === 'Active' ? 'var(--gs-nav-selected)' : 'var(--gs-text-muted)',
              cursor: 'pointer'
            }}
          >
            Active Tasks ({activeCount})
          </button>
          <button
            onClick={() => setSelectedTab('Completed')}
            style={{
              flex: 1,
              padding: '8px 0',
              background: 'none',
              border: 'none',
              borderBottom: selectedTab === 'Completed' ? '3px solid var(--gs-nav-selected)' : '3px solid transparent',
              fontSize: '14px',
              fontWeight: selectedTab === 'Completed' ? 700 : 500,
              color: selectedTab === 'Completed' ? 'var(--gs-nav-selected)' : 'var(--gs-text-muted)',
              cursor: 'pointer'
            }}
          >
            Completed Tasks ({completedCount})
          </button>
        </div>

        {/* Sort / Filter Row matching Android HomeFilterMode */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
          <FilterIcon size={16} color="var(--gs-text-muted)" />
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--gs-text-secondary)' }}>Filters</span>
          
          <div className="no-scrollbar" style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 2, scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
            <button
              className={`sort-chip ${sortMode === 'All' ? 'selected' : ''}`}
              onClick={() => {
                setSortMode('All');
                setStartDateMs(null);
                setEndDateMs(null);
              }}
            >
              <List size={14} /> All
            </button>
            <button
              className={`sort-chip ${sortMode === 'Latest' ? 'selected' : ''}`}
              onClick={() => setSortMode('Latest')}
            >
              <TrendingUp size={14} /> Latest
            </button>
            <button
              className={`sort-chip ${sortMode === 'Urgent' ? 'selected' : ''}`}
              onClick={() => setSortMode('Urgent')}
            >
              <Zap size={14} /> Urgent
            </button>
            <button
              className={`sort-chip ${sortMode === 'Date' ? 'selected' : ''}`}
              onClick={() => {
                setSortMode('Date');
                setShowDateDialog(true);
              }}
            >
              <Calendar size={14} /> By Date
            </button>
            <button
              className={`sort-chip ${sortMode === 'Oldest' ? 'selected' : ''}`}
              onClick={() => setSortMode('Oldest')}
            >
              <ArrowDown size={14} /> Oldest
            </button>
          </div>
        </div>

        {/* Filtered by Hole Banner matching Android */}
        {filterHoleId !== null && (
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            backgroundColor: '#E8F5E9',
            borderRadius: 12,
            border: '1px solid #C8E6C9',
            padding: '8px 14px',
            marginBottom: 12
          }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: '#1B5E20' }}>
              Filtered by Hole {filterHoleId}
            </span>
            <button
              onClick={() => setFilterHoleId(null)}
              style={{
                background: 'none',
                border: 'none',
                color: '#2E7D32',
                fontSize: 13,
                fontWeight: 700,
                cursor: 'pointer'
              }}
            >
              Clear
            </button>
          </div>
        )}



        {/* Task Cards List */}
        {selectedTab === 'Active' && (
          activeTasks.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '36px 0', color: 'var(--gs-text-secondary)', fontSize: 14 }}>
              No active tasks for this filter.
            </div>
          ) : (
            activeTasks.map(task => {
              const isExpanded = expandedTaskId === task.id;
              const isCompleting = completingTaskId === task.id;

              return (
                <div
                  key={task.id}
                  style={{
                    backgroundColor: '#F4F4F4',
                    borderRadius: 16,
                    border: '1px solid rgba(0, 0, 0, 0.08)',
                    boxShadow: '0 2px 6px rgba(0,0,0,0.06)',
                    padding: '14px 16px',
                    marginBottom: 12
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center' }}>
                    <div style={{
                      width: 42,
                      height: 42,
                      borderRadius: '50%',
                      backgroundColor: '#FFFFFF',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      marginRight: 10,
                      flexShrink: 0
                    }}>
                      {renderTaskTypeIcon(task.type)}
                    </div>

                    <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                      <div style={{
                        fontSize: 17,
                        fontWeight: 600,
                        color: 'var(--gs-text-primary)',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis'
                      }}>
                        {task.description || task.taskCategoryDescription}
                      </div>
                      {task.isUrgent && <Zap size={18} color="#FF4D4D" fill="none" strokeWidth={2.2} style={{ flexShrink: 0 }} />}
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, marginLeft: 6, flexShrink: 0 }}>
                      <button
                        onClick={() => onSelectHoleTask?.(task)}
                        style={{
                          padding: '6px 12px',
                          borderRadius: 12,
                          backgroundColor: '#FFFFFF',
                          border: '1px solid var(--gs-outline-soft)',
                          fontSize: 12,
                          fontWeight: 600,
                          color: 'var(--gs-text-secondary)',
                          cursor: 'pointer'
                        }}
                      >
                        {task.holeDescription}
                      </button>
                      {(task.sectionId || task.sectionDescription) && (
                        <span style={{
                          padding: '3px 8px',
                          borderRadius: 8,
                          backgroundColor: '#FFFFFF',
                          border: '1px solid var(--gs-outline-soft)',
                          fontSize: 11,
                          fontWeight: 500,
                          color: 'var(--gs-text-muted)'
                        }}>
                          {getSectionDisplayName(task.sectionId, task.sectionDescription)}
                        </span>
                      )}
                    </div>
                  </div>

                  <hr style={{ border: 'none', borderTop: '1px solid rgba(0, 0, 0, 0.08)', margin: '10px 0' }} />

                  {/* Expanded Content */}
                  {isExpanded ? (
                    <div style={{ marginBottom: 12 }}>
                      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--gs-text-muted)' }}>Issue</div>
                      <div style={{ fontSize: 14, color: 'var(--gs-text-primary)', marginBottom: 8 }}>
                        {task.taskCategoryDescription}: {task.description}
                      </div>

                      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--gs-text-muted)' }}>Action</div>
                      <div style={{ fontSize: 14, color: 'var(--gs-text-primary)', marginBottom: 12 }}>
                        {task.recommendation}
                      </div>

                      {task.imageUrl && (
                        <div style={{ width: '100%', height: 168, borderRadius: 14, overflow: 'hidden', marginBottom: 12, border: '1px solid var(--gs-outline-soft)' }}>
                          <img src={task.imageUrl} alt="Task Media" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        </div>
                      )}

                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {task.type === 'PEST' && (task.taskLogId || parseInt(task.id, 10)) && onRequestAddImages && (
                          <button
                            onClick={() => onRequestAddImages(task.taskLogId || parseInt(task.id, 10))}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              gap: 6,
                              padding: '10px',
                              borderRadius: 14,
                              border: '1px solid var(--gs-outline-soft)',
                              backgroundColor: '#FFFFFF',
                              fontSize: 13,
                              fontWeight: 600,
                              color: 'var(--gs-text-primary)',
                              cursor: 'pointer'
                            }}
                          >
                            <ImageIcon size={18} color="var(--gs-text-secondary)" /> Add images
                          </button>
                        )}

                        {onMarkTaskDone && (
                          <button
                            onClick={() => onMarkTaskDone(task)}
                            disabled={isCompleting}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              gap: 6,
                              padding: '10px',
                              borderRadius: 14,
                              border: '1px solid var(--gs-outline-soft)',
                              backgroundColor: '#FFFFFF',
                              fontSize: 13,
                              fontWeight: 600,
                              color: 'var(--gs-done-green)',
                              cursor: 'pointer'
                            }}
                          >
                            <CheckCircle size={18} color="var(--gs-done-green)" />
                            {isCompleting ? 'Saving…' : 'Mark as done'}
                          </button>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div style={{ fontSize: 13, color: 'var(--gs-text-secondary)', marginBottom: 8 }}>
                      {task.taskCategoryDescription}: {task.description}
                    </div>
                  )}

                  {/* Task Footer Row */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--gs-text-secondary)' }}>
                        Status: {task.statusDescription || 'Assigned'}
                      </div>
                      {task.expectedCompletionDate && (
                        <div style={{ fontSize: 11, color: 'var(--gs-text-muted)' }}>
                          Due {task.expectedCompletionDate}
                        </div>
                      )}
                    </div>

                    <button
                      onClick={() => setExpandedTaskId(isExpanded ? null : task.id)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4,
                        padding: '6px 12px',
                        borderRadius: 20,
                        backgroundColor: '#FFFFFF',
                        border: '1px solid var(--gs-outline-soft)',
                        fontSize: 12,
                        fontWeight: 600,
                        color: 'var(--gs-nav-selected)',
                        cursor: 'pointer'
                      }}
                    >
                      {isExpanded ? 'View Less' : 'View More'}
                      <ChevronRight size={16} />
                    </button>
                  </div>
                </div>
              );
            })
          )
        )}

        {selectedTab === 'Completed' && (
          completedTasks.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '36px 0', color: 'var(--gs-text-secondary)', fontSize: 14 }}>
              No completed tasks for this filter.
            </div>
          ) : (
            completedTasks.map(task => {
              const isExpanded = expandedTaskId === task.id;

              return (
                <div
                  key={task.id}
                  style={{
                    backgroundColor: '#F4F4F4',
                    borderRadius: 16,
                    border: '1px solid rgba(0, 0, 0, 0.08)',
                    boxShadow: '0 2px 6px rgba(0,0,0,0.06)',
                    padding: '14px 16px',
                    marginBottom: 12
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center' }}>
                    <div style={{
                      width: 42,
                      height: 42,
                      borderRadius: '50%',
                      backgroundColor: '#FFFFFF',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      marginRight: 10,
                      flexShrink: 0
                    }}>
                      {renderTaskTypeIcon(task.type)}
                    </div>

                    <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                      <div style={{
                        fontSize: 17,
                        fontWeight: 600,
                        color: 'var(--gs-text-primary)',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis'
                      }}>
                        {task.description || task.taskCategoryDescription}
                      </div>
                      {task.isUrgent && <Zap size={18} color="#FF4D4D" fill="none" strokeWidth={2.2} style={{ flexShrink: 0 }} />}
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, marginLeft: 6, flexShrink: 0 }}>
                      <button
                        onClick={() => onSelectHoleTask?.(task)}
                        style={{
                          padding: '6px 12px',
                          borderRadius: 12,
                          backgroundColor: '#FFFFFF',
                          border: '1px solid var(--gs-outline-soft)',
                          fontSize: 12,
                          fontWeight: 600,
                          color: 'var(--gs-text-secondary)',
                          cursor: 'pointer'
                        }}
                      >
                        {task.holeDescription}
                      </button>
                      {(task.sectionId || task.sectionDescription) && (
                        <span style={{
                          padding: '3px 8px',
                          borderRadius: 8,
                          backgroundColor: '#FFFFFF',
                          border: '1px solid var(--gs-outline-soft)',
                          fontSize: 11,
                          fontWeight: 500,
                          color: 'var(--gs-text-muted)'
                        }}>
                          {getSectionDisplayName(task.sectionId, task.sectionDescription)}
                        </span>
                      )}
                    </div>
                  </div>

                  <hr style={{ border: 'none', borderTop: '1px solid rgba(0, 0, 0, 0.08)', margin: '10px 0' }} />

                  {/* Expanded Content */}
                  {isExpanded && (
                    <div style={{ marginBottom: 12 }}>
                      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--gs-text-muted)' }}>Issue</div>
                      <div style={{ fontSize: 14, color: 'var(--gs-text-primary)', marginBottom: 8 }}>
                        {task.taskCategoryDescription}: {task.description}
                      </div>

                      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--gs-text-muted)' }}>Action</div>
                      <div style={{ fontSize: 14, color: 'var(--gs-text-primary)', marginBottom: 12 }}>
                        {task.recommendation}
                      </div>

                      {task.imageUrl && (
                        <div style={{ width: '100%', height: 168, borderRadius: 14, overflow: 'hidden', marginBottom: 12, border: '1px solid var(--gs-outline-soft)' }}>
                          <img src={task.imageUrl} alt="Completed Task Media" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        </div>
                      )}
                    </div>
                  )}

                  {/* Task Footer Row */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--gs-text-secondary)' }}>
                        Status: {task.statusDescription || 'Completed'}
                      </div>
                      {task.expectedCompletionDate && (
                        <div style={{ fontSize: 11, color: 'var(--gs-text-muted)' }}>
                          Due {task.expectedCompletionDate}
                        </div>
                      )}
                    </div>

                    <button
                      onClick={() => setExpandedTaskId(isExpanded ? null : task.id)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4,
                        padding: '6px 12px',
                        borderRadius: 20,
                        backgroundColor: '#FFFFFF',
                        border: '1px solid var(--gs-outline-soft)',
                        fontSize: 12,
                        fontWeight: 600,
                        color: 'var(--gs-nav-selected)',
                        cursor: 'pointer'
                      }}
                    >
                      {isExpanded ? 'View Less' : 'View More'}
                      <ChevronRight size={16} />
                    </button>
                  </div>
                </div>
              );
            })
          )
        )}
          </>
        )}
      </div>

      {/* Android Calendar Modal matching exact screenshot */}
      {showDateDialog && (
        <AndroidDateRangePickerDialog
          initialStartDateMs={startDateMs}
          initialEndDateMs={endDateMs}
          onDismiss={() => setShowDateDialog(false)}
          onApply={(startMs, endMs) => {
            setStartDateMs(startMs);
            setEndDateMs(endMs);
            setSortMode('Date');
            setShowDateDialog(false);
          }}
        />
      )}
    </div>
  );
};

const getOperationIconInfo = (operationType: string) => {
  const op = (operationType || '').toLowerCase();
  if (op.includes('pest')) {
    return { icon: <Bug size={16} color="#E65100" />, bgColor: '#FFF3E0' };
  }
  if (op.includes('irrigation') || op.includes('moisture')) {
    return { icon: <Droplet size={16} color="#1565C0" />, bgColor: '#E3F2FD' };
  }
  if (op.includes('veg') || op.includes('stress')) {
    return { icon: <Leaf size={16} color="#2E7D32" />, bgColor: '#E8F5E9' };
  }
  if (op.includes('fertilizer')) {
    return { icon: <Sparkles size={16} color="#8E24AA" />, bgColor: '#F3E5F5' };
  }
  return { icon: <Layers size={16} color="#4A5A4E" />, bgColor: '#EEEEEE' };
};

const NotificationsOverlay: React.FC<{
  notifications: NotificationItem[];
  isLoading?: boolean;
  onClose: () => void;
  onSelectNotification?: (item: NotificationItem) => void;
}> = ({ notifications, isLoading, onClose, onSelectNotification }) => {
  const [selectedNotifId, setSelectedNotifId] = useState<string | null>(null);

  return (
    <div style={{
      backgroundColor: '#F4F4F4',
      borderRadius: 24,
      border: '1px solid rgba(0, 0, 0, 0.08)',
      boxShadow: '0 8px 24px rgba(0, 0, 0, 0.12)',
      padding: 16,
      minHeight: 400,
      display: 'flex',
      flexDirection: 'column',
      boxSizing: 'border-box'
    }}>
      {/* Header Row */}
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16 }}>
        <Bell size={26} color="var(--gs-text-primary)" style={{ marginRight: 10 }} />
        <h2 style={{ fontSize: 22, fontWeight: 700, color: 'var(--gs-text-primary)', margin: 0, flex: 1 }}>
          Notifications
        </h2>
        <button
          onClick={onClose}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: 4,
            display: 'flex',
            alignItems: 'center',
            color: 'var(--gs-text-primary)'
          }}
        >
          <X size={24} />
        </button>
      </div>

      {/* Body Section */}
      <div style={{ flex: 1, overflowY: 'auto' }} className="no-scrollbar">
        {isLoading ? (
          <div style={{ textAlign: 'center', padding: '48px 0', color: 'var(--gs-text-muted)', fontSize: 14 }}>
            Loading notifications…
          </div>
        ) : notifications.length === 0 ? (
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '48px 16px',
            textAlign: 'center'
          }}>
            <Bell size={64} color="var(--gs-text-muted)" style={{ opacity: 0.4, marginBottom: 16 }} />
            <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--gs-text-primary)', marginBottom: 8 }}>
              No notifications yet
            </div>
            <div style={{ fontSize: 13, color: 'var(--gs-text-secondary)', maxWidth: 280, lineHeight: 1.4 }}>
              Live push notifications received from Firebase will appear here in real-time.
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {notifications.map((item, idx) => {
              const opInfo = getOperationIconInfo(item.operationType);
              const isSelected = selectedNotifId === item.id;
              const isUnread = !item.isRead;

              return (
                <React.Fragment key={item.id || idx}>
                  <div
                    onClick={() => {
                      setSelectedNotifId(item.id);
                      if (onSelectNotification) {
                        onSelectNotification(item);
                      }
                    }}
                    style={{
                      // Unread = green, read = white
                      backgroundColor: isUnread ? '#DCEFD8' : '#FFFFFF',
                      border: isSelected
                        ? '2px solid #2E7D32'
                        : isUnread ? '1px solid #A5D6A7' : '1px solid var(--gs-outline-soft)',
                      borderRadius: 16,
                      padding: 14,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 8,
                      cursor: 'pointer',
                      transition: 'all 0.2s ease'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{
                        padding: '4px 10px',
                        borderRadius: 8,
                        backgroundColor: isUnread ? '#C1D9BD' : '#EEEEEE',
                        fontSize: 10,
                        fontWeight: 700,
                        color: 'var(--gs-text-primary)',
                        border: '1px solid var(--gs-outline-soft)'
                      }}>
                        {item.holeDescription}
                      </span>

                      <div style={{
                        width: 30,
                        height: 30,
                        borderRadius: 8,
                        backgroundColor: opInfo.bgColor,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center'
                      }}>
                        {opInfo.icon}
                      </div>

                      <div style={{ flex: 1 }} />

                      <span style={{ fontSize: 10, color: 'var(--gs-text-muted)' }}>
                        {item.timestamp}
                      </span>
                      {isUnread && (
                        <span
                          title="Unread"
                          style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: '#2E7D32', flexShrink: 0 }}
                        />
                      )}
                    </div>

                    <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--gs-text-primary)' }}>
                      {item.title}
                    </div>

                    <div style={{ fontSize: 12, color: 'var(--gs-text-secondary)', lineHeight: '1.4' }}>
                      {item.description}
                    </div>
                  </div>
                </React.Fragment>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
