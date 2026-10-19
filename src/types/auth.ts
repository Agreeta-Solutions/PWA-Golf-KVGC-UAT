export interface SaltData {
  id?: number;
  salt?: string;
}

export interface SaltApiResponse {
  status: number;
  message?: string;
  data?: SaltData;
}

export interface UserDto {
  firstName?: string;
  lastName?: string;
  roleId?: number;
  userId?: number;
  id?: number;
}

export interface LoginData {
  userId?: string;
  UserId?: string;
  isValid?: boolean;
  messages?: string;
  userDto?: UserDto;
  apiBaseUrl?: string;
}

export interface LoginApiResponse {
  status: number;
  message?: string;
  data?: LoginData;
}

export interface UserSession {
  username: string;
  passwordHash: string;
  firstName?: string;
  userId?: string;
  roleId?: number;
  loginTimestamp?: number;
  isAuthenticated: boolean;
  apiBaseUrl?: string;
}
