import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, Images } from 'lucide-react';
import { fetchDiseaseImages } from '../../services/diseaseImageService';

interface S3PhotoGalleryDialogProps {
  diseaseName: string;
  onDismiss: () => void;
}

export const S3PhotoGalleryDialog: React.FC<S3PhotoGalleryDialogProps> = ({
  diseaseName,
  onDismiss
}) => {
  const [imageUrls, setImageUrls] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [selectedPhoto, setSelectedPhoto] = useState<string | null>(null);

  useEffect(() => {
    let isCancelled = false;
    setIsLoading(true);

    fetchDiseaseImages(diseaseName)
      .then((urls) => {
        if (!isCancelled) {
          setImageUrls(urls);
          setIsLoading(false);
        }
      })
      .catch((err) => {
        console.error('Error fetching dynamic disease images from S3:', err);
        if (!isCancelled) {
          setImageUrls([]);
          setIsLoading(false);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [diseaseName]);

  return createPortal(
    <>
      <div
        style={{
          position: 'fixed',
          inset: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.55)',
          backdropFilter: 'blur(3px)',
          WebkitBackdropFilter: 'blur(3px)',
          zIndex: 10000,
          display: 'flex',
          alignItems: 'flex-end',
          justifyContent: 'center',
          animation: 'fadeIn 0.2s ease-out'
        }}
        onClick={onDismiss}
      >
        <div
          style={{
            width: '100%',
            maxWidth: 540,
            backgroundColor: '#FFFFFF',
            borderTopLeftRadius: 24,
            borderTopRightRadius: 24,
            padding: '20px 20px calc(24px + env(safe-area-inset-bottom, 0px)) 20px',
            boxShadow: '0 -4px 24px rgba(0, 0, 0, 0.25)',
            display: 'flex',
            flexDirection: 'column',
            maxHeight: 'calc(85dvh - env(safe-area-inset-bottom, 0px))',
            animation: 'slideUp 0.25s ease-out',
            boxSizing: 'border-box'
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 16
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Images size={22} color="#00C853" />
              <div>
                <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: '#0F172A' }}>
                  {diseaseName} Gallery
                </h3>
                {!isLoading && imageUrls.length > 0 && (
                  <span style={{ fontSize: 12, color: '#64748B', fontWeight: 500 }}>
                    {imageUrls.length} live image{imageUrls.length > 1 ? 's' : ''} from S3
                  </span>
                )}
              </div>
            </div>

            <button
              onClick={onDismiss}
              style={{
                background: '#F1F5F9',
                border: 'none',
                cursor: 'pointer',
                width: 32,
                height: 32,
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#64748B'
              }}
            >
              <X size={18} />
            </button>
          </div>

          {/* Content Body */}
          {isLoading ? (
            <div
              style={{
                height: 200,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 12
              }}
            >
              <div
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: '50%',
                  border: '3px solid #E2E8F0',
                  borderTopColor: '#00C853',
                  animation: 'spin 0.8s linear infinite'
                }}
              />
              <span style={{ fontSize: 13, color: '#64748B', fontWeight: 500 }}>
                Fetching images from S3...
              </span>
            </div>
          ) : imageUrls.length === 0 ? (
            <div
              style={{
                height: 160,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 10,
                backgroundColor: '#F8FAFC',
                borderRadius: 16,
                border: '1px dashed #CBD5E1',
                padding: 16,
                textAlign: 'center'
              }}
            >
              <Images size={34} color="#94A3B8" />
              <span style={{ fontSize: 14, color: '#64748B', fontWeight: 600 }}>
                No images available for this disease.
              </span>
              <span style={{ fontSize: 12, color: '#94A3B8', maxWidth: 300 }}>
                Images uploaded to the S3 bucket for {diseaseName} will automatically appear here.
              </span>
            </div>
          ) : (
            <div
              style={{
                display: 'flex',
                gap: 14,
                overflowX: 'auto',
                paddingBottom: 10,
                paddingTop: 4,
                scrollSnapType: 'x mandatory'
              }}
            >
              {imageUrls.map((url, idx) => (
                <div
                  key={idx}
                  onClick={() => setSelectedPhoto(url)}
                  style={{
                    minWidth: 260,
                    maxWidth: 280,
                    height: 200,
                    borderRadius: 14,
                    overflow: 'hidden',
                    backgroundColor: '#F1F5F9',
                    boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
                    cursor: 'pointer',
                    flexShrink: 0,
                    scrollSnapAlign: 'start',
                    position: 'relative'
                  }}
                >
                  <img
                    src={url}
                    alt={`${diseaseName} ${idx + 1}`}
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    loading="lazy"
                  />
                  <div
                    style={{
                      position: 'absolute',
                      bottom: 8,
                      right: 8,
                      backgroundColor: 'rgba(0,0,0,0.6)',
                      color: '#FFFFFF',
                      fontSize: 11,
                      fontWeight: 600,
                      padding: '2px 8px',
                      borderRadius: 10
                    }}
                  >
                    #{idx + 1}
                  </div>
                </div>
              ))}
            </div>
          )}

          <div style={{ height: 12 }} />
        </div>
      </div>

      {/* Fullscreen Photo Lightbox when clicked */}
      {selectedPhoto && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.9)',
            zIndex: 10001,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16
          }}
          onClick={() => setSelectedPhoto(null)}
        >
          <button
            onClick={() => setSelectedPhoto(null)}
            style={{
              position: 'absolute',
              top: 20,
              right: 20,
              background: 'rgba(255,255,255,0.2)',
              border: 'none',
              borderRadius: '50%',
              width: 40,
              height: 40,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              color: '#FFFFFF'
            }}
          >
            <X size={24} />
          </button>
          <img
            src={selectedPhoto}
            alt={diseaseName}
            style={{
              maxWidth: '94%',
              maxHeight: '85vh',
              borderRadius: 12,
              objectFit: 'contain',
              boxShadow: '0 8px 32px rgba(0,0,0,0.5)'
            }}
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </>,
    document.body
  );
};
