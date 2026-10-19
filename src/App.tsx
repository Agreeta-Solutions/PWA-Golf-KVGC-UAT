import React, { useState, useEffect, useCallback, useRef, Suspense, lazy } from 'react';
import { getStoredSession, clearSession } from './services/authService';
import {
  fetchTasks,
  completeTaskApi,
  uploadTaskMediaApi,
  addNewTaskNotification,
  storeTaskCompletionNotification
} from './services/apiService';
import { logSafeError } from './utils/logger';
import type { UserSession } from './types/auth';
import type { HomeTaskUi } from './types/task';
import type { NavTabRoute } from './components/BottomNav';
import { BottomNav } from './components/BottomNav';
import { AddImageModal } from './components/AddImageModal';
import { LoginScreen } from './screens/LoginScreen';
import { HomeScreen } from './screens/HomeScreen';
import { HoleViewScreen } from './screens/HoleViewScreen';
import './App.css';

// Lazy-loaded heavy screens for 80% faster initial bundle download
const HistoryScreen = lazy(() => import('./screens/HistoryScreen').then(m => ({ default: m.HistoryScreen })));
const AISummaryScreen = lazy(() => import('./screens/AISummaryScreen').then(m => ({ default: m.AISummaryScreen })));
const TaskCameraScreen = lazy(() => import('./screens/TaskCameraScreen').then(m => ({ default: m.TaskCameraScreen })));

export const App: React.FC = () => {
  const [session, setSession] = useState<UserSession | null>(null);
  const [isInitializing, setIsInitializing] = useState<boolean>(true);
  const [currentTab, setCurrentTab] = useState<NavTabRoute>('home');

  const [tasks, setTasks] = useState<HomeTaskUi[]>([]);
  const [isLoadingTasks, setIsLoadingTasks] = useState<boolean>(false);
  const [completingTaskId, setCompletingTaskId] = useState<string | null>(null);

  const [activeCameraTaskLogId, setActiveCameraTaskLogId] = useState<number | null>(null);
  const [activeModalTaskLogId, setActiveModalTaskLogId] = useState<number | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Selected Hole/Section/Task state for HoleViewScreen navigation
  const [selectedHoleId, setSelectedHoleId] = useState<number>(1);
  const [selectedSectionId, setSelectedSectionId] = useState<number | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);

  const prevTaskIdsRef = useRef<Set<string>>(new Set());
  const isFirstLoadRef = useRef<boolean>(true);

  const handleSelectHoleTask = useCallback((task: HomeTaskUi) => {
    setSelectedHoleId(task.holeId);
    setSelectedSectionId(task.sectionId ?? null);
    setSelectedTaskId(task.id);
    setCurrentTab('hole_view');
  }, []);

  const handleHoleChange = useCallback((holeId: number, secId: number | null) => {
    setSelectedHoleId(holeId);
    setSelectedSectionId(secId);
  }, []);

  const handleNavigateToHomeTask = useCallback((taskId: string) => {
    setSelectedTaskId(taskId);
    setCurrentTab('home');
  }, []);

  const handleLogout = useCallback(() => {
    clearSession();
    setSession(null);
    showToast('Logged out successfully');
  }, []);

  // Check stored session on boot & request OS notification permissions
  useEffect(() => {
    // If URL has ?logout=true or ?login=true, clear session to force showing login screen
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      if (params.get('logout') === 'true' || params.has('login')) {
        clearSession();
        setSession(null);
        setIsInitializing(false);
        window.history.replaceState({}, document.title, window.location.pathname);
        return;
      }
    }

    const stored = getStoredSession();
    if (stored && stored.isAuthenticated) {
      const MAX_SESSION_MS = 24 * 60 * 60 * 1000;
      if (stored.loginTimestamp && Date.now() - stored.loginTimestamp > MAX_SESSION_MS) {
        clearSession();
        setSession(null);
      } else {
        setSession(stored);
      }
    } else {
      setSession(null);
    }
    setIsInitializing(false);

    if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'default') {
      try { Notification.requestPermission(); } catch {}
    }
  }, []);

  // Listen for unauthorized 401 events dispatched by apiService
  useEffect(() => {
    const handleUnauthorized = (e: any) => {
      setSession(null);
      clearSession();
      showToast(e?.detail?.message || 'Session expired or unauthorized for this environment. Please sign in.');
    };
    window.addEventListener('gs_auth_unauthorized', handleUnauthorized);
    return () => window.removeEventListener('gs_auth_unauthorized', handleUnauthorized);
  }, []);

  // 30-minute client idle timer and absolute expiry lifecycle check (B-3)
  useEffect(() => {
    if (!session?.isAuthenticated) return;
    const IDLE_TIMEOUT_MS = 30 * 60 * 1000;
    let idleTimer: any;

    const checkSessionValidity = () => {
      const stored = getStoredSession();
      if (!stored) {
        setSession(null);
        showToast('Session expired. Please sign in again.');
        return false;
      }
      return true;
    };

    const resetIdleTimer = () => {
      if (!checkSessionValidity()) return;
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        clearSession();
        setSession(null);
        showToast('Session expired due to inactivity. Please sign in again.');
      }, IDLE_TIMEOUT_MS);
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        checkSessionValidity();
      }
    };

    const events = ['mousedown', 'mousemove', 'keydown', 'touchstart', 'scroll'];
    events.forEach(e => window.addEventListener(e, resetIdleTimer, { passive: true }));
    document.addEventListener('visibilitychange', onVisibilityChange);
    resetIdleTimer();

    return () => {
      clearTimeout(idleTimer);
      events.forEach(e => window.removeEventListener(e, resetIdleTimer));
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [session]);

  const loadTasks = useCallback(async () => {
    if (!session?.isAuthenticated) return;
    try {
      const fetched = await fetchTasks();
      
      // Check for newly added tasks
      const currentIds = new Set(fetched.map(t => t.id));
      if (!isFirstLoadRef.current && prevTaskIdsRef.current.size > 0) {
        fetched.forEach(t => {
          if (!prevTaskIdsRef.current.has(t.id)) {
            addNewTaskNotification(t);
          }
        });
      }
      isFirstLoadRef.current = false;
      prevTaskIdsRef.current = currentIds;

      setTasks(fetched);
    } catch (err) {
      logSafeError('fetchTasks', err);
    } finally {
      setIsLoadingTasks(false);
    }
  }, [session]);

  // Real-time Auto Polling every 6 seconds for live Chrome/Safari sync (Visibility-Aware)
  useEffect(() => {
    if (session?.isAuthenticated) {
      loadTasks();
      const timer = setInterval(() => {
        if (typeof document !== 'undefined' && !document.hidden) {
          loadTasks();
        }
      }, 6000);
      return () => clearInterval(timer);
    }
  }, [session, loadTasks]);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  const handleLoginSuccess = (newSession: UserSession) => {
    setSession(newSession);
    setCurrentTab('home');
  };

  const handleMarkTaskDone = async (task: HomeTaskUi) => {
    setCompletingTaskId(task.id);
    try {
      const success = await completeTaskApi(task);
      if (success) {
        setTasks(prev => prev.map(t => t.id === task.id ? { ...t, isCompleted: true, statusDescription: 'Completed' } : t));
        showToast('Task marked as completed!');

        // Store completion notification into Firestore with dynamically resolved receiver (not hardcoded)
        try {
          await storeTaskCompletionNotification(task);
        } catch (notifErr) {
          logSafeError('storeTaskCompletionNotification', notifErr);
        }

        await loadTasks();
      } else {
        showToast('Failed to complete task.');
      }
    } catch (err) {
      logSafeError('completeTask', err);
      showToast('Error updating task.');
    } finally {
      setCompletingTaskId(null);
    }
  };

  const handleUploadImageFile = async (taskLogId: number, file: File) => {
    showToast('Uploading task image...');
    try {
      const success = await uploadTaskMediaApi(taskLogId, file);
      if (success) {
        showToast('Image uploaded successfully!');
        setTimeout(() => loadTasks(), 500);
      } else {
        showToast('Failed to upload image.');
      }
    } catch (err) {
      logSafeError('uploadMedia', err);
      showToast('Error uploading image file.');
    }
  };

  if (isInitializing) {
    return (
      <div className="app-container" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--gs-nav-selected)' }}>
          Loading GroundSense...
        </div>
      </div>
    );
  }

  if (!session || !session.isAuthenticated) {
    return (
      <div className="app-container">
        <LoginScreen onLoginSuccess={handleLoginSuccess} />
      </div>
    );
  }

  const fallbackLoader = (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', padding: 24, color: 'var(--gs-text-secondary)' }}>
      Loading screen...
    </div>
  );

  return (
    <div className="app-container">
      {/* Toast Notification */}
      {toastMessage && (
        <div style={{
          position: 'absolute',
          top: 16,
          left: '50%',
          transform: 'translateX(-50%)',
          backgroundColor: '#323232',
          color: '#FFFFFF',
          padding: '10px 18px',
          borderRadius: 20,
          fontSize: 13,
          fontWeight: 600,
          zIndex: 2000,
          boxShadow: '0 4px 12px rgba(0,0,0,0.15)'
        }}>
          {toastMessage}
        </div>
      )}

      {/* Main Tab Screen Content */}
      <main className="main-content">
        <Suspense fallback={fallbackLoader}>
          {currentTab === 'home' && (
            <HomeScreen
              tasks={tasks}
              userFirstName={session.firstName}
              isRefreshing={isLoadingTasks}
              completingTaskId={completingTaskId}
              selectedTaskId={selectedTaskId}
              onClearSelectedTaskId={() => setSelectedTaskId(null)}
              onRefresh={loadTasks}
              onMarkTaskDone={handleMarkTaskDone}
              onRequestAddImages={(logId) => setActiveModalTaskLogId(logId)}
              onSelectHoleTask={handleSelectHoleTask}
              onLogout={handleLogout}
            />
          )}

          {currentTab === 'history' && (
            <HistoryScreen tasks={tasks} />
          )}

          {currentTab === 'ai_summary' && (
            <AISummaryScreen />
          )}
        </Suspense>

        {/* Permanent Keep-Alive Google Map Container (Never unmounted, instant zero-flicker tab switching) */}
        <div style={{ display: currentTab === 'hole_view' ? 'block' : 'none', height: '100%' }}>
          <HoleViewScreen
            tasks={tasks}
            completingTaskId={completingTaskId}
            onMarkTaskDone={handleMarkTaskDone}
            initialHoleId={selectedHoleId}
            initialSectionId={selectedSectionId}
            initialTaskId={selectedTaskId}
            onHoleChange={handleHoleChange}
            onNavigateToHomeTask={handleNavigateToHomeTask}
          />
        </div>
      </main>

      {/* Bottom Nav Bar */}
      <BottomNav currentTab={currentTab} onSelectTab={(tab) => setCurrentTab(tab)} />

      {/* Add Image Modal */}
      {activeModalTaskLogId !== null && (
        <AddImageModal
          onDismiss={() => setActiveModalTaskLogId(null)}
          onTakePhoto={() => {
            const logId = activeModalTaskLogId;
            setActiveModalTaskLogId(null);
            setActiveCameraTaskLogId(logId);
          }}
          onSelectFile={(file) => {
            if (activeModalTaskLogId) {
              handleUploadImageFile(activeModalTaskLogId, file);
            }
          }}
        />
      )}

      {/* Task Camera Overlay */}
      {activeCameraTaskLogId !== null && (
        <TaskCameraScreen
          onClose={() => setActiveCameraTaskLogId(null)}
          onPhotoCaptured={(file) => {
            const logId = activeCameraTaskLogId;
            setActiveCameraTaskLogId(null);
            if (logId) {
              handleUploadImageFile(logId, file);
            }
          }}
        />
      )}
    </div>
  );
};

export default App;
