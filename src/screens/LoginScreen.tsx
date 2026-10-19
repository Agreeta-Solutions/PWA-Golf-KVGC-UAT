import React, { useState } from 'react';
import { loginUser, changePasswordApi, forgotPasswordApi } from '../services/authService';
import type { UserSession } from '../types/auth';
import logoSvg from '../assets/logo.svg';

interface LoginScreenProps {
  onLoginSuccess: (session: UserSession) => void;
}

type AuthMode = 'login' | 'change_password' | 'forgot_password';

export const LoginScreen: React.FC<LoginScreenProps> = ({ onLoginSuccess }) => {
  const [authMode, setAuthMode] = useState<AuthMode>('login');

  // Shared state
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  // Errors & Feedback
  const [usernameError, setUsernameError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [currentPasswordError, setCurrentPasswordError] = useState<string | null>(null);
  const [newPasswordError, setNewPasswordError] = useState<string | null>(null);
  const [confirmPasswordError, setConfirmPasswordError] = useState<string | null>(null);

  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const resetErrors = () => {
    setUsernameError(null);
    setPasswordError(null);
    setCurrentPasswordError(null);
    setNewPasswordError(null);
    setConfirmPasswordError(null);
    setErrorMessage(null);
    setSuccessMessage(null);
  };

  const switchMode = (mode: AuthMode) => {
    resetErrors();
    setAuthMode(mode);
  };

  // --- Handlers ---
  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    let hasErr = false;

    if (!username.trim()) {
      setUsernameError('Username cannot be empty');
      hasErr = true;
    } else {
      setUsernameError(null);
    }

    if (!password.trim()) {
      setPasswordError('Password cannot be empty');
      hasErr = true;
    } else {
      setPasswordError(null);
    }

    if (hasErr) return;

    setIsLoading(true);
    setErrorMessage(null);

    try {
      const session = await loginUser(username, password);
      onLoginSuccess(session);
    } catch (err: any) {
      setErrorMessage(err.message || 'Login failed.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleChangePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    let hasErr = false;

    if (!username.trim()) {
      setUsernameError('Username / User ID cannot be empty');
      hasErr = true;
    } else {
      setUsernameError(null);
    }

    if (!currentPassword.trim()) {
      setCurrentPasswordError('Current password cannot be empty');
      hasErr = true;
    } else {
      setCurrentPasswordError(null);
    }

    if (!newPassword.trim()) {
      setNewPasswordError('New password cannot be empty');
      hasErr = true;
    } else {
      setNewPasswordError(null);
    }

    if (!confirmPassword.trim()) {
      setConfirmPasswordError('Please confirm your new password');
      hasErr = true;
    } else if (newPassword.trim() !== confirmPassword.trim()) {
      setConfirmPasswordError('New passwords do not match');
      hasErr = true;
    } else {
      setConfirmPasswordError(null);
    }

    if (hasErr) return;

    setIsLoading(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      const result = await changePasswordApi(username, currentPassword, newPassword, confirmPassword);
      setSuccessMessage(result.message || 'Password changed successfully! You can now log in.');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      // Switch to login mode after 2 seconds
      setTimeout(() => {
        setAuthMode('login');
      }, 2200);
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to change password.');
    } finally {
      setIsLoading(false);
    }
  };

  const configuredEnvBase = (import.meta.env.VITE_API_BASE_URL as string)?.trim() || '';
  const isRacvCourse = configuredEnvBase ? configuredEnvBase.toLowerCase().includes('racv') : false;

  const handleForgotPasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    let hasErr = false;

    if (!username.trim()) {
      setUsernameError('Username / User ID cannot be empty');
      hasErr = true;
    } else {
      setUsernameError(null);
    }

    if (!newPassword.trim()) {
      setNewPasswordError('New password cannot be empty');
      hasErr = true;
    } else {
      setNewPasswordError(null);
    }

    if (!confirmPassword.trim()) {
      setConfirmPasswordError('Please confirm your new password');
      hasErr = true;
    } else if (newPassword.trim() !== confirmPassword.trim()) {
      setConfirmPasswordError('New passwords do not match');
      hasErr = true;
    } else {
      setConfirmPasswordError(null);
    }

    if (hasErr) return;

    setIsLoading(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      const result = await forgotPasswordApi(username, newPassword, confirmPassword);
      setSuccessMessage(result.message || 'Password updated successfully! You can now log in.');
      setNewPassword('');
      setConfirmPassword('');
      // Switch to login mode after 2 seconds
      setTimeout(() => {
        setAuthMode('login');
      }, 2200);
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to reset password.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="login-screen">
      <div className="login-card">
        <div className="login-header">
          <span>
            {authMode === 'login' && 'Login to'}
            {authMode === 'change_password' && 'Change Password'}
            {!isRacvCourse && authMode === 'forgot_password' && 'Forgot Password'}
          </span>
          {authMode === 'login' && (
            <img src={logoSvg} alt="GroundSense" className="login-logo" />
          )}
        </div>

        {/* --- 1. LOGIN FORM --- */}
        {authMode === 'login' && (
          <form onSubmit={handleLoginSubmit} style={{ width: '100%' }}>
            <div style={{ marginBottom: 16 }}>
              <div className="pill-input-container">
                <input
                  type="text"
                  placeholder="Username"
                  value={username}
                  onChange={(e) => {
                    setUsername(e.target.value);
                    if (usernameError) setUsernameError(null);
                    if (errorMessage) setErrorMessage(null);
                  }}
                  disabled={isLoading}
                />
              </div>
              {usernameError && <div className="error-text">{usernameError}</div>}
            </div>

            <div style={{ marginBottom: 20 }}>
              <div className="pill-input-container">
                <input
                  type="password"
                  placeholder="Password"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    if (passwordError) setPasswordError(null);
                    if (errorMessage) setErrorMessage(null);
                  }}
                  disabled={isLoading}
                />
              </div>
              {passwordError && <div className="error-text">{passwordError}</div>}
            </div>

            <button
              type="submit"
              className="login-button"
              disabled={isLoading || !username.trim() || !password.trim()}
            >
              {isLoading ? 'Logging in...' : 'Login'}
            </button>

            {/* Left side: Change Password | Right side: Forgot Password (hidden on RACV, shown on Kharghar, Pune, etc.) */}
            <div className="login-links-row" style={isRacvCourse ? { justifyContent: 'center' } : undefined}>
              <button
                type="button"
                className="auth-link-button"
                onClick={() => switchMode('change_password')}
                disabled={isLoading}
              >
                Change Password
              </button>
              {!isRacvCourse && (
                <button
                  type="button"
                  className="auth-link-button"
                  onClick={() => switchMode('forgot_password')}
                  disabled={isLoading}
                >
                  Forgot Password?
                </button>
              )}
            </div>

            {errorMessage && (
              <div style={{ textAlign: 'center', marginTop: 14 }} className="error-text">
                {errorMessage}
              </div>
            )}
            {successMessage && (
              <div className="success-text">
                {successMessage}
              </div>
            )}
          </form>
        )}

        {/* --- 2. CHANGE PASSWORD FORM --- */}
        {authMode === 'change_password' && (
          <form onSubmit={handleChangePasswordSubmit} style={{ width: '100%' }}>
            <div style={{ marginBottom: 14 }}>
              <div className="pill-input-container">
                <input
                  type="text"
                  placeholder="Username / User ID"
                  value={username}
                  onChange={(e) => {
                    setUsername(e.target.value);
                    if (usernameError) setUsernameError(null);
                    if (errorMessage) setErrorMessage(null);
                  }}
                  disabled={isLoading}
                />
              </div>
              {usernameError && <div className="error-text">{usernameError}</div>}
            </div>

            <div style={{ marginBottom: 14 }}>
              <div className="pill-input-container">
                <input
                  type="password"
                  placeholder="Current Password"
                  value={currentPassword}
                  onChange={(e) => {
                    setCurrentPassword(e.target.value);
                    if (currentPasswordError) setCurrentPasswordError(null);
                    if (errorMessage) setErrorMessage(null);
                  }}
                  disabled={isLoading}
                />
              </div>
              {currentPasswordError && <div className="error-text">{currentPasswordError}</div>}
            </div>

            <div style={{ marginBottom: 14 }}>
              <div className="pill-input-container">
                <input
                  type="password"
                  placeholder="New Password"
                  value={newPassword}
                  onChange={(e) => {
                    setNewPassword(e.target.value);
                    if (newPasswordError) setNewPasswordError(null);
                    if (errorMessage) setErrorMessage(null);
                  }}
                  disabled={isLoading}
                />
              </div>
              {newPasswordError && <div className="error-text">{newPasswordError}</div>}
            </div>

            <div style={{ marginBottom: 18 }}>
              <div className="pill-input-container">
                <input
                  type="password"
                  placeholder="Confirm New Password"
                  value={confirmPassword}
                  onChange={(e) => {
                    setConfirmPassword(e.target.value);
                    if (confirmPasswordError) setConfirmPasswordError(null);
                    if (errorMessage) setErrorMessage(null);
                  }}
                  disabled={isLoading}
                />
              </div>
              {confirmPasswordError && <div className="error-text">{confirmPasswordError}</div>}
            </div>

            <button
              type="submit"
              className="login-button"
              disabled={isLoading || !username.trim() || !currentPassword.trim() || !newPassword.trim() || !confirmPassword.trim()}
            >
              {isLoading ? 'Updating Password...' : 'Change Password'}
            </button>

            <div style={{ display: 'flex', justifyContent: 'center', marginTop: 14 }}>
              <button
                type="button"
                className="auth-link-button"
                onClick={() => switchMode('login')}
                disabled={isLoading}
              >
                ← Back to Login
              </button>
            </div>

            {errorMessage && (
              <div style={{ textAlign: 'center', marginTop: 14 }} className="error-text">
                {errorMessage}
              </div>
            )}
            {successMessage && (
              <div className="success-text">
                {successMessage}
              </div>
            )}
          </form>
        )}

        {/* --- 3. FORGOT PASSWORD FORM (Hidden on RACV, active for Kharghar, Pune, etc.) --- */}
        {!isRacvCourse && authMode === 'forgot_password' && (
          <form onSubmit={handleForgotPasswordSubmit} style={{ width: '100%' }}>
            <div style={{ marginBottom: 14 }}>
              <div className="pill-input-container">
                <input
                  type="text"
                  placeholder="Username / User ID"
                  value={username}
                  onChange={(e) => {
                    setUsername(e.target.value);
                    if (usernameError) setUsernameError(null);
                    if (errorMessage) setErrorMessage(null);
                  }}
                  disabled={isLoading}
                />
              </div>
              {usernameError && <div className="error-text">{usernameError}</div>}
            </div>

            <div style={{ marginBottom: 14 }}>
              <div className="pill-input-container">
                <input
                  type="password"
                  placeholder="New Password"
                  value={newPassword}
                  onChange={(e) => {
                    setNewPassword(e.target.value);
                    if (newPasswordError) setNewPasswordError(null);
                    if (errorMessage) setErrorMessage(null);
                  }}
                  disabled={isLoading}
                />
              </div>
              {newPasswordError && <div className="error-text">{newPasswordError}</div>}
            </div>

            <div style={{ marginBottom: 18 }}>
              <div className="pill-input-container">
                <input
                  type="password"
                  placeholder="Confirm New Password"
                  value={confirmPassword}
                  onChange={(e) => {
                    setConfirmPassword(e.target.value);
                    if (confirmPasswordError) setConfirmPasswordError(null);
                    if (errorMessage) setErrorMessage(null);
                  }}
                  disabled={isLoading}
                />
              </div>
              {confirmPasswordError && <div className="error-text">{confirmPasswordError}</div>}
            </div>

            <button
              type="submit"
              className="login-button"
              disabled={isLoading || !username.trim() || !newPassword.trim() || !confirmPassword.trim()}
            >
              {isLoading ? 'Resetting Password...' : 'Reset Password'}
            </button>

            <div style={{ display: 'flex', justifyContent: 'center', marginTop: 14 }}>
              <button
                type="button"
                className="auth-link-button"
                onClick={() => switchMode('login')}
                disabled={isLoading}
              >
                ← Back to Login
              </button>
            </div>

            {errorMessage && (
              <div style={{ textAlign: 'center', marginTop: 14 }} className="error-text">
                {errorMessage}
              </div>
            )}
            {successMessage && (
              <div className="success-text">
                {successMessage}
              </div>
            )}
          </form>
        )}
      </div>
    </div>
  );
};
