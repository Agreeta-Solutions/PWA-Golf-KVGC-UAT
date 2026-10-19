import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  ChevronRight,
  AlertTriangle,
  MoreHorizontal,
  RefreshCw,
  ChevronUp
} from 'lucide-react';
import {
  fetchWeatherForecast,
  extractNext5Hours,
  getActiveCourseInfo,
  type WeatherApiResponse,
  type HourlyForecastItem
} from '../services/weatherService';
import {
  evaluateRisks,
  dailyAverages,
  type DiseaseRiskItem
} from '../utils/diseaseRiskEngine';
import { courseNow } from '../utils/courseTime';
import { getAdvisoryByName, type AdvisoryItem } from '../services/advisoryService';
import { PestGaugeMetricCard } from '../components/weather/PestGaugeMetricCard';
import { DiseaseAdvisoryDialog } from '../components/weather/DiseaseAdvisoryDialog';

export type WeatherViewOption = 'Weather' | 'Pest & Disease Forecast';

export const AISummaryScreen: React.FC = () => {
  const [selectedOption, setSelectedOption] = useState<WeatherViewOption>('Weather');

  // Weather state
  const [weatherData, setWeatherData] = useState<WeatherApiResponse | null>(null);
  const [hourlyForecast, setHourlyForecast] = useState<HourlyForecastItem[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [errorMessage, setErrorMessage] = useState<string>('');

  // Live clock showing course-local time (e.g. Melbourne), not the viewer's browser time
  const [clock, setClock] = useState(() => courseClockText());

  // Dialog selection state
  const [selectedRiskItem, setSelectedRiskItem] = useState<DiseaseRiskItem | null>(null);
  const [selectedAdvisoryItem, setSelectedAdvisoryItem] = useState<AdvisoryItem | null>(null);

  // Expand / collapse for risk cards (limit 3 items initially)
  const [isHighRiskExpanded, setIsHighRiskExpanded] = useState<boolean>(false);
  const [isLowRiskExpanded, setIsLowRiskExpanded] = useState<boolean>(false);

  // When a risk list is expanded, bring its title to the top of the screen with the items listed
  // below it (otherwise they open below the fold and the tap looks like it did nothing).
  const highRiskSectionRef = useRef<HTMLDivElement>(null);
  const lowRiskSectionRef = useRef<HTMLDivElement>(null);
  const revealSection = (ref: React.RefObject<HTMLDivElement | null>) => {
    requestAnimationFrame(() => {
      ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };
  useEffect(() => {
    if (isHighRiskExpanded) revealSection(highRiskSectionRef);
  }, [isHighRiskExpanded]);
  useEffect(() => {
    if (isLowRiskExpanded) revealSection(lowRiskSectionRef);
  }, [isLowRiskExpanded]);

  // Active course information
  const courseInfo = useMemo(() => getActiveCourseInfo(), []);

  // Tick every second so the minute rolls over promptly; React skips the re-render when the
  // text is unchanged. Paused while the app is hidden and repainted on return.
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    const tick = () =>
      setClock(prev => {
        const next = courseClockText();
        return prev.date === next.date && prev.time === next.time ? prev : next;
      });
    const start = () => {
      if (timer) return;
      tick();
      timer = setInterval(tick, 1000);
    };
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };
    const onVisibility = () => (document.hidden ? stop() : start());
    start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  // Load weather data
  const loadWeatherData = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage('');
    try {
      const data = await fetchWeatherForecast(courseInfo.latitude, courseInfo.longitude);
      setWeatherData(data);
      const next5 = extractNext5Hours(data.hourly);
      setHourlyForecast(next5);
    } catch (err: any) {
      console.error('Failed to load weather data:', err);
      setErrorMessage(err?.message || 'Failed to load live weather data.');
    } finally {
      setIsLoading(false);
    }
  }, [courseInfo.latitude, courseInfo.longitude]);

  useEffect(() => {
    loadWeatherData();
  }, [loadWeatherData]);

  // Current and daily weather metrics
  const current = weatherData?.current;
  const daily = weatherData?.daily;

  const tempVal = current?.temperature_2m ?? 27.0;
  const feelsLikeVal = current?.apparent_temperature ?? 30.0;
  const humidityVal = current?.relative_humidity_2m ?? 68;
  const precipVal = current?.precipitation ?? 0;
  const pressureVal = current?.surface_pressure ? Math.round(current.surface_pressure) : 1012;
  const windVal = current?.wind_speed_10m ? Math.round(current.wind_speed_10m) : 5;

  // Pest & disease inputs: 24 h averages of today's hourly values (course-local day).
  // Falls back to the current reading for any value with no hourly data.
  const riskInputs = useMemo(() => {
    const today = current?.time?.slice(0, 10) || daily?.time?.[0] || '';
    const avg = dailyAverages(weatherData?.hourly, today);
    return {
      temp: avg.temp ?? tempVal,
      humidity: avg.humidity ?? Number(humidityVal),
      soilTemp: avg.soilTemp ?? tempVal
    };
  }, [weatherData?.hourly, current?.time, daily?.time, tempVal, humidityVal]);

  const uvIndexVal = daily?.uv_index_max?.[0] ?? 7.5;
  const etVal = daily?.et0_fao_evapotranspiration?.[0] ?? 4.2;

  // EV: today's actual evapotranspiration (mm) = sum of today's hourly `evapotranspiration`
  // (course-local day). null when no hourly values are available.
  const evVal = useMemo<number | null>(() => {
    const hourly = weatherData?.hourly;
    const today = current?.time?.slice(0, 10) || daily?.time?.[0] || '';
    if (!hourly?.time?.length || !hourly.evapotranspiration || !today) return null;
    let total = 0;
    let count = 0;
    hourly.time.forEach((t, i) => {
      const v = hourly.evapotranspiration?.[i];
      if (t.startsWith(today) && typeof v === 'number' && Number.isFinite(v)) {
        total += v;
        count++;
      }
    });
    return count > 0 ? total : null;
  }, [weatherData?.hourly, current?.time, daily?.time]);

  const sunriseTime = useMemo(() => {
    const sr = daily?.sunrise?.[0];
    if (sr && sr.includes('T')) return sr.split('T')[1].slice(0, 5);
    return '06:27';
  }, [daily?.sunrise]);

  const sunsetTime = useMemo(() => {
    const ss = daily?.sunset?.[0];
    if (ss && ss.includes('T')) return ss.split('T')[1].slice(0, 5);
    return '18:29';
  }, [daily?.sunset]);

  // Evaluated Disease & Pest Risks
  const evaluatedRisks = useMemo(() => {
    return evaluateRisks(riskInputs.temp, riskInputs.humidity, riskInputs.soilTemp);
  }, [riskInputs]);

  const highRiskDiseases = useMemo(() => evaluatedRisks.filter(r => r.isHighRisk), [evaluatedRisks]);
  const lowRiskDiseases = useMemo(() => evaluatedRisks.filter(r => !r.isHighRisk), [evaluatedRisks]);

  const visibleHighRisk = isHighRiskExpanded ? highRiskDiseases : highRiskDiseases.slice(0, 3);
  const visibleLowRisk = isLowRiskExpanded ? lowRiskDiseases : lowRiskDiseases.slice(0, 3);

  const formattedDate = clock.date;
  const formattedTime = clock.time;

  const handleCardClick = (disease: DiseaseRiskItem) => {
    const adv = getAdvisoryByName(disease.name);
    setSelectedRiskItem(disease);
    setSelectedAdvisoryItem(adv);
  };

  return (
    <div
      style={{
        paddingTop: 'calc(14px + env(safe-area-inset-top, 0px))',
        paddingLeft: '16px',
        paddingRight: '16px',
        paddingBottom: 'calc(24px + env(safe-area-inset-bottom, 0px))',
        height: '100%',
        overflowY: 'auto',
        WebkitOverflowScrolling: 'touch',
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: '#F5F7F5'
      }}
    >
      {/* Top Title: Switches dynamically between Weather Insights and Pest & Disease Forecast */}
      <h1
        style={{
          margin: '0 0 16px 0',
          fontSize: 24,
          fontWeight: 700,
          color: '#0F172A',
          letterSpacing: '-0.3px'
        }}
      >
        {selectedOption === 'Weather' ? 'Weather Insights' : 'Pest & Disease Forecast'}
      </h1>

      {/* Two-Segment Slide Bar / Pill Toggle matching Android WeatherInsightsToggle */}
      <div
        style={{
          backgroundColor: '#FFFFFF',
          borderRadius: 9999,
          border: '1px solid #E2E8F0',
          padding: 4,
          display: 'flex',
          marginBottom: 16,
          boxShadow: '0 1px 2px rgba(0,0,0,0.04)'
        }}
      >
        <button
          type="button"
          onClick={() => setSelectedOption('Weather')}
          style={{
            flex: 1,
            borderRadius: 9999,
            border: 'none',
            backgroundColor: selectedOption === 'Weather' ? '#1B5E20' : 'transparent',
            color: selectedOption === 'Weather' ? '#FFFFFF' : '#64748B',
            fontSize: 13,
            fontWeight: selectedOption === 'Weather' ? 600 : 500,
            padding: '10px 8px',
            cursor: 'pointer',
            textAlign: 'center',
            transition: 'background-color 0.2s ease, color 0.2s ease',
            whiteSpace: 'nowrap',
            outline: 'none'
          }}
        >
          Weather
        </button>

        <button
          type="button"
          onClick={() => setSelectedOption('Pest & Disease Forecast')}
          style={{
            flex: 1,
            borderRadius: 9999,
            border: 'none',
            backgroundColor: selectedOption === 'Pest & Disease Forecast' ? '#1B5E20' : 'transparent',
            color: selectedOption === 'Pest & Disease Forecast' ? '#FFFFFF' : '#64748B',
            fontSize: 13,
            fontWeight: selectedOption === 'Pest & Disease Forecast' ? 600 : 500,
            padding: '10px 8px',
            cursor: 'pointer',
            textAlign: 'center',
            transition: 'background-color 0.2s ease, color 0.2s ease',
            whiteSpace: 'nowrap',
            outline: 'none'
          }}
        >
          Pest & Disease Forecast
        </button>
      </div>

      {/* Error Notice if any */}
      {errorMessage && (
        <div
          style={{
            backgroundColor: '#FEF2F2',
            border: '1px solid #FCA5A5',
            borderRadius: 12,
            padding: '10px 14px',
            marginBottom: 12,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            fontSize: 12,
            color: '#B91C1C'
          }}
        >
          <span>{errorMessage}</span>
          <button
            onClick={loadWeatherData}
            style={{
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              color: '#B91C1C',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              fontWeight: 600
            }}
          >
            <RefreshCw size={14} /> Retry
          </button>
        </div>
      )}

      {/* Main Content Area */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {selectedOption === 'Weather' ? (
          <>
            {/* Location Header Card with Gradient */}
            <div
              style={{
                width: '100%',
                height: 180,
                borderRadius: 16,
                background: 'linear-gradient(90deg, #D81B60 0%, #8E24AA 50%, #00ACC1 100%)',
                padding: 20,
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                boxShadow: '0 4px 14px rgba(0,0,0,0.12)',
                color: '#FFFFFF'
              }}
            >
              <div>
                <div style={{ fontSize: 14, fontWeight: 500, opacity: 0.9 }}>
                  {formattedDate}
                </div>
                <div style={{ fontSize: 22, fontWeight: 700, marginTop: 4 }}>
                  {courseInfo.courseName}
                </div>
              </div>

              <div style={{ fontSize: 54, fontWeight: 700, lineHeight: 1 }}>
                {formattedTime}
              </div>
            </div>

            {/* Current Weather Metrics Card */}
            <div
              style={{
                backgroundColor: '#FFFFFF',
                borderRadius: 16,
                padding: 16,
                boxShadow: '0 1px 4px rgba(0,0,0,0.06)'
              }}
            >
              {/* Temp and Sunrise/Sunset Row */}
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: 16
                }}
              >
                <div>
                  <div
                    style={{
                      fontSize: 48,
                      fontWeight: 700,
                      color: '#3D5AFE',
                      lineHeight: 1.1
                    }}
                  >
                    {Math.round(tempVal)}°C
                  </div>
                  <div
                    style={{
                      fontSize: 16,
                      fontWeight: 500,
                      color: '#000000',
                      marginTop: 2
                    }}
                  >
                    Feels like: {Math.round(feelsLikeVal)}°C
                  </div>
                </div>

                {/* Sunrise / Sunset Pill */}
                <div
                  style={{
                    backgroundColor: '#EEEEFF',
                    borderRadius: 12,
                    padding: '8px 14px',
                    display: 'flex',
                    gap: 12,
                    alignItems: 'center'
                  }}
                >
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <img
                        src="/assets/weather/ic_sunrise.png"
                        alt="Sunrise"
                        style={{ width: 14, height: 14 }}
                      />
                      <span style={{ fontSize: 11, color: '#64748B', fontWeight: 600 }}>Sunrise</span>
                    </div>
                    <span style={{ fontSize: 13, color: '#000000', fontWeight: 700 }}>
                      {sunriseTime}
                    </span>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <img
                        src="/assets/weather/ic_sunset.png"
                        alt="Sunset"
                        style={{ width: 14, height: 14 }}
                      />
                      <span style={{ fontSize: 11, color: '#64748B', fontWeight: 600 }}>Sunset</span>
                    </div>
                    <span style={{ fontSize: 13, color: '#000000', fontWeight: 700 }}>
                      {sunsetTime}
                    </span>
                  </div>
                </div>
              </div>

              {/* Scrollable Metric Tiles Row */}
              <div
                style={{
                  backgroundColor: '#F1F8E9',
                  borderRadius: 12,
                  padding: 8,
                  display: 'flex',
                  gap: 8,
                  overflowX: 'auto',
                  alignItems: 'center'
                }}
              >
                <MetricTile
                  iconSrc="/assets/weather/ic_precipitation.png"
                  value={`${precipVal}%`}
                  label="Precip"
                />
                <MetricTile
                  iconSrc="/assets/weather/ic_pressure.png"
                  value={`${pressureVal}hPa`}
                  label="Pressure"
                />
                <MetricTile
                  iconSrc="/assets/weather/ic_humidity.png"
                  value={`${humidityVal}%`}
                  label="Humidity"
                />
                <MetricTile
                  iconSrc="/assets/weather/ic_wind.png"
                  value={`${windVal}km/h`}
                  label="Wind"
                />
                <MetricTile
                  iconSrc="/assets/weather/ic_uv.png"
                  value={uvIndexVal.toFixed(1)}
                  label="UV"
                />
                <MetricTile
                  iconSrc="/assets/weather/ic_uv.png"
                  value={`${etVal.toFixed(1)}mm`}
                  label="ET0"
                />
                <MetricTile
                  iconSrc="/assets/weather/ic_precipitation.png"
                  value={evVal !== null ? `${evVal.toFixed(1)}mm` : '--'}
                  label="EV"
                />
              </div>
            </div>

            {/* 5 Hours Forecast Card */}
            <div
              style={{
                backgroundColor: '#2E7D32',
                borderRadius: 16,
                padding: 16,
                boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
              }}
            >
              <div
                style={{
                  fontSize: 18,
                  fontWeight: 700,
                  color: '#FFFFFF',
                  marginBottom: 12
                }}
              >
                5 Hours Forecast
              </div>

              <div
                style={{
                  backgroundColor: '#FFFFFF',
                  borderRadius: 12,
                  padding: '8px 12px'
                }}
              >
                {isLoading && !weatherData ? (
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      padding: 16
                    }}
                  >
                    <div
                      style={{
                        width: 28,
                        height: 28,
                        borderRadius: '50%',
                        border: '3px solid #E2E8F0',
                        borderTopColor: '#2E7D32',
                        animation: 'spin 0.8s linear infinite'
                      }}
                    />
                  </div>
                ) : hourlyForecast.length === 0 ? (
                  <div style={{ padding: 16, textAlign: 'center', color: '#64748B', fontSize: 14 }}>
                    Forecast data unavailable
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    {hourlyForecast.slice(0, 5).map((item, idx) => (
                      <div
                        key={idx}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '8px 0',
                          borderBottom: idx < 4 ? '1px solid #F1F5F9' : 'none'
                        }}
                      >
                        <span style={{ fontSize: 20 }}>
                          {item.weatherCode > 0 ? '🌤️' : '☀️'}
                        </span>
                        <span style={{ fontSize: 18, fontWeight: 700, color: '#000000' }}>
                          {item.tempText}
                        </span>
                        <span style={{ fontSize: 14, color: '#64748B', fontWeight: 500 }}>
                          {item.hourText}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </>
        ) : (
          <>
            {/* Pest Gauge Metrics Header */}
            <div style={{ display: 'flex', gap: 8, width: '100%' }}>
              <PestGaugeMetricCard
                title="AVERAGE TEMP"
                valueText={`${Math.round(riskInputs.temp)}°C`}
                progress={riskInputs.temp / 50.0}
                gaugeColor="#FF9800"
              />
              <PestGaugeMetricCard
                title="AVERAGE HUMIDITY"
                valueText={`${Math.round(riskInputs.humidity)}%`}
                progress={riskInputs.humidity / 100.0}
                gaugeColor="#2979FF"
              />
              <PestGaugeMetricCard
                title="AVERAGE SOIL TEMP"
                valueText={`${Math.round(riskInputs.soilTemp)}°C`}
                progress={riskInputs.soilTemp / 50.0}
                gaugeColor="#00E676"
              />
            </div>

            {/* High Risk Section */}
            {highRiskDiseases.length > 0 && (
              <div
                ref={highRiskSectionRef}
                style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4, scrollMarginTop: 8 }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    paddingTop: 8,
                    paddingBottom: 4
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <AlertTriangle size={18} color="#E53935" />
                    <span
                      style={{
                        fontSize: 13,
                        fontWeight: 700,
                        color: '#E53935',
                        letterSpacing: '0.4px'
                      }}
                    >
                      HIGH RISK
                    </span>
                  </div>

                  {highRiskDiseases.length > 3 && (
                    <button
                      onClick={() => setIsHighRiskExpanded(!isHighRiskExpanded)}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        cursor: 'pointer',
                        padding: 4,
                        color: '#64748B',
                        display: 'flex',
                        alignItems: 'center'
                      }}
                      title={isHighRiskExpanded ? 'Show Less' : 'Show More'}
                    >
                      {isHighRiskExpanded ? <ChevronUp size={22} /> : <MoreHorizontal size={22} />}
                    </button>
                  )}
                </div>

                {visibleHighRisk.map(disease => (
                  <div
                    key={disease.name}
                    onClick={() => handleCardClick(disease)}
                    style={{
                      backgroundColor: '#FFF2F2',
                      border: '1px solid #FFCDD2',
                      borderRadius: 16,
                      padding: '14px 16px',
                      display: 'flex',
                      alignItems: 'center',
                      cursor: 'pointer',
                      transition: 'transform 0.1s ease',
                      boxShadow: '0 1px 3px rgba(0,0,0,0.03)'
                    }}
                  >
                    <div
                      style={{
                        width: 42,
                        height: 42,
                        borderRadius: '50%',
                        backgroundColor: '#FFEBEF',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 18,
                        fontWeight: 700,
                        color: '#D32F2F',
                        flexShrink: 0
                      }}
                    >
                      {disease.initial}
                    </div>

                    <div style={{ marginLeft: 14, flex: 1 }}>
                      <div style={{ fontSize: 15, fontWeight: 700, color: '#1E293B' }}>
                        {disease.name}
                      </div>
                      <div style={{ fontSize: 12, color: '#64748B', marginTop: 2 }}>
                        {disease.probability}
                      </div>
                    </div>

                    <AlertTriangle
                      size={18}
                      color="#E53935"
                      style={{ marginRight: 6, flexShrink: 0 }}
                    />
                    <ChevronRight size={20} color="#94A3B8" style={{ flexShrink: 0 }} />
                  </div>
                ))}
              </div>
            )}

            {/* Low Risk Section */}
            {lowRiskDiseases.length > 0 && (
              <div
                ref={lowRiskSectionRef}
                style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8, scrollMarginTop: 8 }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    paddingTop: 8,
                    paddingBottom: 4
                  }}
                >
                  <span
                    style={{
                      fontSize: 13,
                      fontWeight: 700,
                      color: '#00C853',
                      letterSpacing: '0.4px'
                    }}
                  >
                    LOW RISK
                  </span>

                  {lowRiskDiseases.length > 3 && (
                    <button
                      onClick={() => setIsLowRiskExpanded(!isLowRiskExpanded)}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        cursor: 'pointer',
                        padding: 4,
                        color: '#64748B',
                        display: 'flex',
                        alignItems: 'center'
                      }}
                      title={isLowRiskExpanded ? 'Show Less' : 'Show More'}
                    >
                      {isLowRiskExpanded ? <ChevronUp size={22} /> : <MoreHorizontal size={22} />}
                    </button>
                  )}
                </div>

                {visibleLowRisk.map(disease => (
                  <div
                    key={disease.name}
                    onClick={() => handleCardClick(disease)}
                    style={{
                      backgroundColor: '#F1F9F5',
                      border: '1px solid #C8E6C9',
                      borderRadius: 16,
                      padding: '14px 16px',
                      display: 'flex',
                      alignItems: 'center',
                      cursor: 'pointer',
                      transition: 'transform 0.1s ease',
                      boxShadow: '0 1px 3px rgba(0,0,0,0.03)'
                    }}
                  >
                    <div
                      style={{
                        width: 42,
                        height: 42,
                        borderRadius: '50%',
                        backgroundColor: '#E8F5E9',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 18,
                        fontWeight: 700,
                        color: '#2E7D32',
                        flexShrink: 0
                      }}
                    >
                      {disease.initial}
                    </div>

                    <div style={{ marginLeft: 14, flex: 1 }}>
                      <div style={{ fontSize: 15, fontWeight: 700, color: '#1E293B' }}>
                        {disease.name}
                      </div>
                      <div style={{ fontSize: 12, color: '#64748B', marginTop: 2 }}>
                        {disease.probability}
                      </div>
                    </div>

                    <ChevronRight size={20} color="#94A3B8" style={{ flexShrink: 0 }} />
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* Disease Advisory Modal Dialog */}
      {selectedRiskItem && (
        <DiseaseAdvisoryDialog
          disease={selectedRiskItem}
          advisory={selectedAdvisoryItem}
          onDismiss={() => {
            setSelectedRiskItem(null);
            setSelectedAdvisoryItem(null);
          }}
        />
      )}
    </div>
  );
};

/** Hero clock text in course time: e.g. { date: 'Wednesday, Oct 14', time: '22:39' }. */
function courseClockText(): { date: string; time: string } {
  const now = courseNow();
  let date = 'Today';
  let time = '--:--';
  try {
    date = now.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
    time = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
  } catch {
    /* keep fallbacks */
  }
  return { date, time };
}

interface MetricTileProps {
  iconSrc: string;
  value: string;
  label: string;
}

const MetricTile: React.FC<MetricTileProps> = ({ iconSrc, value, label }) => {
  return (
    <div
      style={{
        backgroundColor: '#FFFFFF',
        borderRadius: 8,
        width: 64,
        height: 72,
        padding: '6px 4px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexShrink: 0,
        boxShadow: '0 1px 2px rgba(0,0,0,0.04)'
      }}
    >
      <img src={iconSrc} alt={label} style={{ width: 16, height: 16 }} />
      <span
        style={{
          fontSize: 12,
          fontWeight: 700,
          color: '#000000',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          maxWidth: '100%'
        }}
      >
        {value}
      </span>
      <span
        style={{
          fontSize: 9,
          color: '#64748B',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          maxWidth: '100%'
        }}
      >
        {label}
      </span>
    </div>
  );
};
