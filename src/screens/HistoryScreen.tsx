import React from 'react';
import type { HomeTaskUi } from '../types/task';
import { ChevronDown, ArrowRight, UserCheck, Clock, CheckCircle } from 'lucide-react';

interface HistoryScreenProps {
  tasks: HomeTaskUi[];
}

export const HistoryScreen: React.FC<HistoryScreenProps> = ({ tasks }) => {
  const completedTasks = tasks.filter(t => t.isCompleted);

  return (
    <div style={{ padding: '16px', height: '100%', overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h1 style={{ fontSize: 26, fontWeight: 800, color: 'var(--gs-text-primary)' }}>
          History
        </h1>

        <button style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          padding: '6px 14px',
          borderRadius: 20,
          backgroundColor: 'var(--gs-surface)',
          border: '1px solid var(--gs-outline-soft)',
          fontSize: 13,
          fontWeight: 600,
          color: 'var(--gs-text-secondary)',
          cursor: 'pointer'
        }}>
          Today <ChevronDown size={18} color="var(--gs-text-muted)" />
        </button>
      </div>

      {/* Task History Cards */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {completedTasks.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--gs-text-secondary)', fontSize: 14 }}>
            No completed tasks yet.
          </div>
        ) : (
          completedTasks.map((task) => (
            <div
              key={task.id}
              style={{
                backgroundColor: 'var(--gs-sage-card)',
                borderRadius: 20,
                padding: 16,
                boxShadow: '0 2px 6px rgba(0, 0, 0, 0.04)',
                border: '1px solid rgba(221, 229, 221, 0.5)'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{
                  width: 40,
                  height: 40,
                  borderRadius: '50%',
                  background: 'linear-gradient(180deg, #7E57C2 0%, #42A5F5 100%)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#FFFFFF'
                }}>
                  <CheckCircle size={22} />
                </div>

                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--gs-text-primary)' }}>
                    {task.description || task.taskCategoryDescription}
                  </div>
                </div>

                <div style={{
                  padding: '4px 10px',
                  borderRadius: 10,
                  backgroundColor: 'var(--gs-surface)',
                  border: '1px solid var(--gs-outline-soft)',
                  fontSize: 12,
                  fontWeight: 600,
                  color: 'var(--gs-text-secondary)'
                }}>
                  {task.holeDescription}
                </div>

                <button style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: '6px 10px',
                  borderRadius: 20,
                  backgroundColor: 'var(--gs-surface)',
                  border: '1px solid var(--gs-outline-soft)',
                  fontSize: 12,
                  fontWeight: 600,
                  color: 'var(--gs-text-secondary)',
                  cursor: 'pointer'
                }}>
                  Details <ArrowRight size={14} color="var(--gs-text-muted)" />
                </button>
              </div>

              <hr style={{ border: 'none', borderTop: '1px solid rgba(221, 229, 221, 0.6)', margin: '12px 0' }} />

              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--gs-text-secondary)' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <UserCheck size={13} color="var(--gs-text-muted)" /> Assigned By Gaurav T.
                </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <Clock size={13} color="var(--gs-text-muted)" /> Assigned @ 12:08 PM
                </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <CheckCircle size={13} color="var(--gs-text-muted)" /> Resolved @ 1:23 PM
                </span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
