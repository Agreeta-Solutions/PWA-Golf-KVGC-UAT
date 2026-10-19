import React, { useRef, useState, useEffect, useCallback } from 'react';
import { Camera, RefreshCw, Check, X, Image as ImageIcon } from 'lucide-react';
import { logSafeError } from '../utils/logger';

interface TaskCameraScreenProps {
  onClose: () => void;
  onPhotoCaptured: (file: File) => void;
}

export const TaskCameraScreen: React.FC<TaskCameraScreenProps> = ({ onClose, onPhotoCaptured }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [stream, setStream] = useState<MediaStream | null>(null);
  const [capturedBlob, setCapturedBlob] = useState<Blob | null>(null);
  const [capturedUrl, setCapturedUrl] = useState<string | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);

  const startCamera = useCallback(async () => {
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setCameraError('Camera access requires HTTPS or localhost. Tap below to select or take photo.');
        return;
      }
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false
      });
      setStream(mediaStream);
      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream;
      }
    } catch (err: any) {
      logSafeError('Camera access', err);
      setCameraError('Camera permission blocked or unavailable over HTTP. Tap below to capture photo using native camera app.');
    }
  }, []);

  useEffect(() => {
    startCamera();
    return () => {
      if (stream) {
        stream.getTracks().forEach(t => t.stop());
      }
    };
  }, []);

  useEffect(() => {
    if (!capturedUrl && videoRef.current && stream) {
      videoRef.current.srcObject = stream;
      videoRef.current.play().catch(() => {});
    }
  }, [capturedUrl, stream]);

  const handleCapture = () => {
    if (!videoRef.current || !canvasRef.current) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;

    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;

    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((blob) => {
        if (blob) {
          setCapturedBlob(blob);
          setCapturedUrl(URL.createObjectURL(blob));
        }
      }, 'image/jpeg', 0.85);
    }
  };

  const handleRetake = () => {
    if (capturedUrl) {
      URL.revokeObjectURL(capturedUrl);
    }
    setCapturedBlob(null);
    setCapturedUrl(null);
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
      videoRef.current.play().catch(() => {});
    }
  };

  const handleConfirmUpload = () => {
    if (!capturedBlob) return;
    const file = new File([capturedBlob], `task_photo_${Date.now()}.jpg`, { type: 'image/jpeg' });
    onPhotoCaptured(file);
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const selectedFile = e.target.files[0];
      onPhotoCaptured(selectedFile);
    }
  };

  const triggerNativeCamera = () => {
    fileInputRef.current?.click();
  };

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: '#000000',
      zIndex: 1000,
      display: 'flex',
      flexDirection: 'column'
    }}>
      {/* Hidden Native File Input Fallback (Works on ALL HTTP & HTTPS Contexts) */}
      <input
        type="file"
        accept="image/*"
        capture="environment"
        ref={fileInputRef}
        onChange={handleFileInputChange}
        style={{ display: 'none' }}
      />

      {/* Top Bar */}
      <div style={{
        padding: '16px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        color: '#FFFFFF',
        zIndex: 10
      }}>
        <h2 style={{ fontSize: 16, fontWeight: 700 }}>Task Photo Capture</h2>
        <button
          onClick={onClose}
          style={{ background: 'none', border: 'none', color: '#FFFFFF', cursor: 'pointer' }}
        >
          <X size={24} />
        </button>
      </div>

      {/* Viewfinder / Preview / Fallback UI */}
      <div style={{ flex: 1, position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            borderRadius: 12,
            display: capturedUrl ? 'none' : 'block'
          }}
        />

        {capturedUrl && (
          <img
            src={capturedUrl}
            alt="Captured"
            style={{ width: '100%', height: '100%', objectFit: 'contain', borderRadius: 12 }}
          />
        )}

        {!capturedUrl && cameraError && (
          <div style={{
            position: 'absolute',
            padding: '24px 20px',
            color: '#FFFFFF',
            backgroundColor: 'rgba(20, 20, 20, 0.92)',
            textAlign: 'center',
            borderRadius: 16,
            maxWidth: '90%',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 16,
            border: '1px solid rgba(255,255,255,0.15)'
          }}>
            <span style={{ fontSize: 14, color: '#FFD54F', lineHeight: 1.4 }}>
              {cameraError}
            </span>

            <button
              onClick={triggerNativeCamera}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '12px 20px',
                borderRadius: 24,
                backgroundColor: '#1B5E20',
                color: '#FFFFFF',
                border: 'none',
                fontSize: 14,
                fontWeight: 600,
                cursor: 'pointer'
              }}
            >
              <Camera size={20} /> Take Photo via Native Camera App
            </button>
          </div>
        )}
        <canvas ref={canvasRef} style={{ display: 'none' }} />
      </div>

      {/* Bottom Action Controls */}
      <div style={{
        padding: '20px 24px',
        backgroundColor: '#111111',
        display: 'flex',
        justifyContent: 'space-around',
        alignItems: 'center'
      }}>
        {capturedUrl ? (
          <>
            <button
              onClick={handleRetake}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '12px 20px',
                borderRadius: 30,
                backgroundColor: '#333333',
                color: '#FFFFFF',
                border: 'none',
                fontSize: 14,
                fontWeight: 600,
                cursor: 'pointer'
              }}
            >
              <RefreshCw size={18} /> Retake
            </button>
            <button
              onClick={handleConfirmUpload}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '12px 24px',
                borderRadius: 30,
                backgroundColor: 'var(--gs-nav-selected)',
                color: '#FFFFFF',
                border: 'none',
                fontSize: 14,
                fontWeight: 600,
                cursor: 'pointer'
              }}
            >
              <Check size={18} /> Use Photo
            </button>
          </>
        ) : (
          <div style={{ display: 'flex', gap: 20, alignItems: 'center' }}>
            <button
              onClick={triggerNativeCamera}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '10px 16px',
                borderRadius: 20,
                backgroundColor: '#333333',
                color: '#FFFFFF',
                border: 'none',
                fontSize: 13,
                fontWeight: 500,
                cursor: 'pointer'
              }}
              title="Open Device Photo Gallery or Camera"
            >
              <ImageIcon size={18} /> Native App
            </button>

            <button
              onClick={handleCapture}
              style={{
                width: 68,
                height: 68,
                borderRadius: '50%',
                backgroundColor: '#FFFFFF',
                border: '4px solid #1B5E20',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer'
              }}
              title="Capture Photo"
            >
              <Camera size={32} color="#1B5E20" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
