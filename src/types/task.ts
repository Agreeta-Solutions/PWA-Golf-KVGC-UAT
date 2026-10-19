export type TaskType = 'PEST' | 'FERTILIZER' | 'VEG_STRESS' | 'MOISTURE' | 'GENERAL' | 'IRRIGATION';

export interface TaskApiItem {
  taskLogId?: number;
  id?: string | number;
  holeId?: number;
  holeDescription?: string;
  sectionId?: number;
  sectionDescription?: string;
  taskCategoryId?: number;
  taskCategoryDescription?: string;
  description?: string;
  recommendation?: string;
  expectedCompletionDate?: string;
  statusDescription?: string;
  imageUrl?: string;
  isCompleted?: boolean;
  isUrgent?: boolean;
  latitude?: number;
  longitude?: number;
}

export interface TaskListApiResponse {
  status: number;
  message: string;
  data: TaskApiItem[];
}

export interface TaskUpdateRequest {
  taskLogId: number;
  isCompleted: boolean;
  userId: number;
  holeId: number;
  taskCategoryId: number;
}

export interface HomeTaskUi {
  id: string;
  taskLogId: number | null;
  holeId: number;
  holeDescription: string;
  sectionId?: number;
  sectionDescription?: string;
  taskCategoryId: number;
  taskCategoryDescription: string;
  description: string;
  recommendation: string;
  statusDescription: string;
  expectedCompletionDate?: string;
  scheduledDate?: string;
  labourHours?: number;
  imageUrl?: string;
  isCompleted: boolean;
  isUrgent: boolean;
  type: TaskType;
  latitude?: number;
  longitude?: number;
  createdBy?: string;
  assignedTo?: string;
  senderUserId?: string;
}

export type FilterType = 'ALL' | 'PEST' | 'FERTILIZER' | 'VEG_STRESS' | 'MOISTURE' | 'GENERAL';

export interface FilterOption {
  id: FilterType;
  displayName: string;
  categoryDescription: string;
}

export type HomeSortMode = 'All' | 'Latest' | 'Urgent' | 'Oldest' | 'Date';
export type HomeTaskTab = 'Active' | 'Completed';
