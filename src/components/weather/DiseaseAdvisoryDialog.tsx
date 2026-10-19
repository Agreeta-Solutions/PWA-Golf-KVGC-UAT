import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import {
  X,
  Droplet,
  Sprout,
  Scissors,
  Trees,
  ShieldAlert,
  ShieldCheck,
  Images
} from 'lucide-react';
import type { DiseaseRiskItem } from '../../utils/diseaseRiskEngine';
import type { AdvisoryItem } from '../../services/advisoryService';
import { S3PhotoGalleryDialog } from './S3PhotoGalleryDialog';

interface DiseaseAdvisoryDialogProps {
  disease: DiseaseRiskItem;
  advisory: AdvisoryItem | null;
  onDismiss: () => void;
}

export const DiseaseAdvisoryDialog: React.FC<DiseaseAdvisoryDialogProps> = ({
  disease,
  advisory,
  onDismiss
}) => {
  const [showGallery, setShowGallery] = useState<boolean>(false);

  const hasContent = advisory && (
    (advisory.prevention && advisory.prevention.trim() && advisory.prevention.toLowerCase() !== 'null') ||
    (advisory.chemicalOptions && advisory.chemicalOptions.trim() && advisory.chemicalOptions.toLowerCase() !== 'null') ||
    (advisory.irrigation && advisory.irrigation.trim() && advisory.irrigation.toLowerCase() !== 'null') ||
    (advisory.fertilization && advisory.fertilization.trim() && advisory.fertilization.toLowerCase() !== 'null') ||
    (advisory.mowing && advisory.mowing.trim() && advisory.mowing.toLowerCase() !== 'null') ||
    (advisory.cultural && advisory.cultural.trim() && advisory.cultural.toLowerCase() !== 'null')
  );

  return (
    <>
      {createPortal(
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(15, 23, 42, 0.6)',
            backdropFilter: 'blur(4px)',
            WebkitBackdropFilter: 'blur(4px)',
            zIndex: 9999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 'calc(16px + env(safe-area-inset-top, 0px)) 16px calc(24px + env(safe-area-inset-bottom, 0px)) 16px',
            boxSizing: 'border-box'
          }}
          onClick={onDismiss}
        >
          <div
            style={{
              width: '100%',
              maxWidth: 440,
              maxHeight: 'calc(100dvh - 32px - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px))',
              backgroundColor: '#FFFFFF',
              borderRadius: 24,
              padding: '20px 20px 18px 20px',
              boxShadow: '0 20px 40px rgba(0, 0, 0, 0.25)',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
              boxSizing: 'border-box'
            }}
            onClick={(e) => e.stopPropagation()}
          >
          {/* Header Row */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 16
            }}
          >
            <div>
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: '#00BFA5',
                  letterSpacing: '0.8px',
                  textTransform: 'uppercase'
                }}
              >
                DISEASE ADVISORY
              </div>
              <h2
                style={{
                  margin: '2px 0 0 0',
                  fontSize: 22,
                  fontWeight: 700,
                  color: '#0F172A'
                }}
              >
                {disease.name}
              </h2>
            </div>

            <button
              onClick={onDismiss}
              style={{
                width: 34,
                height: 34,
                borderRadius: '50%',
                border: 'none',
                backgroundColor: '#F1F5F9',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                color: '#64748B'
              }}
            >
              <X size={18} />
            </button>
          </div>

          {/* Scrollable Advisory Content List */}
          <div
            style={{
              flex: 1,
              minHeight: 0,
              overflowY: 'auto',
              WebkitOverflowScrolling: 'touch',
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
              paddingRight: 4
            }}
          >
            {!hasContent ? (
              <div
                style={{
                  backgroundColor: '#F8FAFC',
                  borderRadius: 16,
                  border: '1px solid #E2E8F0',
                  padding: 24,
                  textAlign: 'center'
                }}
              >
                <div
                  style={{
                    fontSize: 15,
                    fontWeight: 700,
                    color: '#64748B',
                    marginBottom: 4
                  }}
                >
                  Advisory Details Coming Soon
                </div>
                <div style={{ fontSize: 12, color: '#94A3B8' }}>
                  Standard agronomic practices recommended for {disease.name}.
                </div>
              </div>
            ) : (
              <>
                {/* Irrigation Card */}
                {advisory?.irrigation && (
                  <InsightCard
                    title="Irrigation"
                    content={advisory.irrigation}
                    icon={<Droplet size={18} color="#00BFA5" />}
                    iconBackground="#E0F7FA"
                  />
                )}

                {/* Fertility Card */}
                {advisory?.fertilization && (
                  <InsightCard
                    title="Fertility"
                    content={advisory.fertilization}
                    icon={<Sprout size={18} color="#16A34A" />}
                    iconBackground="#DCFCE7"
                  />
                )}

                {/* Mowing Card */}
                {advisory?.mowing && (
                  <InsightCard
                    title="Mowing"
                    content={advisory.mowing}
                    icon={<Scissors size={18} color="#D97706" />}
                    iconBackground="#FEF3C7"
                  />
                )}

                {/* Cultural Management Card */}
                {advisory?.cultural && (
                  <InsightCard
                    title="Cultural Management"
                    content={advisory.cultural}
                    icon={<Trees size={18} color="#9333EA" />}
                    iconBackground="#F3E8FF"
                  />
                )}

                {/* Fungicides / Chemical Options Card */}
                {advisory?.chemicalOptions && (
                  <InsightCard
                    title="Fungicides / Chemical Options"
                    content={advisory.chemicalOptions}
                    icon={<ShieldAlert size={18} color="#DC2626" />}
                    iconBackground="#FEE2E2"
                  />
                )}

                {/* Prevention Card */}
                {advisory?.prevention && (
                  <InsightCard
                    title="Prevention"
                    content={advisory.prevention}
                    icon={<ShieldCheck size={18} color="#0284C7" />}
                    iconBackground="#E0F2FE"
                  />
                )}
              </>
            )}
          </div>

          {/* Action Button: View Photo Gallery */}
          <div style={{ marginTop: 14, flexShrink: 0, width: '100%' }}>
            <button
              type="button"
              onClick={() => setShowGallery(true)}
              style={{
                width: '100%',
                height: 48,
                borderRadius: 12,
                backgroundColor: '#00C853',
                border: 'none',
                color: '#FFFFFF',
                fontSize: 15,
                fontWeight: 700,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                cursor: 'pointer',
                boxShadow: '0 4px 12px rgba(0, 200, 83, 0.25)'
              }}
            >
              <Images size={20} />
              <span>View Photo Gallery</span>
            </button>
          </div>
        </div>
      </div>,
      document.body
    )}

      {showGallery && (
        <S3PhotoGalleryDialog
          diseaseName={disease.name}
          onDismiss={() => setShowGallery(false)}
        />
      )}
    </>
  );
};

interface InsightCardProps {
  title: string;
  content: string;
  icon: React.ReactNode;
  iconBackground: string;
}

const InsightCard: React.FC<InsightCardProps> = ({
  title,
  content,
  icon,
  iconBackground
}) => {
  return (
    <div
      style={{
        backgroundColor: '#F8FAFC',
        borderRadius: 16,
        border: '1px solid #E2E8F0',
        padding: 16,
        display: 'flex',
        flexDirection: 'column'
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
        <div
          style={{
            width: 36,
            height: 36,
            borderRadius: '50%',
            backgroundColor: iconBackground,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0
          }}
        >
          {icon}
        </div>
        <div
          style={{
            fontSize: 15,
            fontWeight: 700,
            color: '#0F172A'
          }}
        >
          {title}
        </div>
      </div>

      <div
        style={{
          fontSize: 13,
          color: '#475569',
          lineHeight: '20px',
          whiteSpace: 'pre-line'
        }}
      >
        {content}
      </div>
    </div>
  );
};
