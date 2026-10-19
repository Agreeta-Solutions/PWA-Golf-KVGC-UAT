import React, { useRef } from 'react';
import { Camera, Image as ImageIcon, X } from 'lucide-react';

interface AddImageModalProps {
  onDismiss: () => void;
  onTakePhoto: () => void;
  onSelectFile: (file: File) => void;
}

export const AddImageModal: React.FC<AddImageModalProps> = ({
  onDismiss,
  onTakePhoto,
  onSelectFile
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      onSelectFile(e.target.files[0]);
      onDismiss();
    }
  };

  return (
    <div className="modal-overlay" onClick={onDismiss}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h3 style={{ fontSize: 16, fontWeight: 700, color: 'var(--gs-text-primary)' }}>
            Add Task Image
          </h3>
          <button
            onClick={onDismiss}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--gs-text-muted)' }}
          >
            <X size={20} />
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <button
            onClick={onTakePhoto}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 10,
              padding: '12px 16px',
              borderRadius: 14,
              border: '1px solid var(--gs-outline-soft)',
              backgroundColor: 'var(--gs-surface)',
              fontSize: 14,
              fontWeight: 600,
              color: 'var(--gs-text-primary)',
              cursor: 'pointer'
            }}
          >
            <Camera size={20} color="var(--gs-nav-selected)" />
            Take Photo
          </button>

          <button
            onClick={() => fileInputRef.current?.click()}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 10,
              padding: '12px 16px',
              borderRadius: 14,
              border: '1px solid var(--gs-outline-soft)',
              backgroundColor: 'var(--gs-surface)',
              fontSize: 14,
              fontWeight: 600,
              color: 'var(--gs-text-primary)',
              cursor: 'pointer'
            }}
          >
            <ImageIcon size={20} color="var(--gs-text-secondary)" />
            Upload from device
          </button>

          <input
            type="file"
            ref={fileInputRef}
            accept="image/*"
            style={{ display: 'none' }}
            onChange={handleFileChange}
          />
        </div>
      </div>
    </div>
  );
};
