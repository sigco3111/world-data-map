
import React, { useState, useEffect, useMemo, useRef } from 'react';
import * as d3 from 'd3';
import * as topojson from 'topojson-client';
import type { Feature, FeatureCollection } from 'geojson';
import { GoogleGenAI, Part, Tool, Type } from '@google/genai';

// Data source for country statistics
interface CountryStats {
  population: number;
  area: number;
  capital: string;
  gini?: number;
  region?: string;
  subregion?: string;
  currencies?: string;
  languages?: string;
}

// AI Summary State
interface AiSummaryState {
  loading: boolean;
  text: string;
  error: string | null;
  sources: Array<{ uri: string; title: string; }>;
}

// Chat Message State
interface ChatMessage {
    role: 'user' | 'model';
    parts: Part[];
}


const WORLD_ATLAS_URL = 'https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json';

interface WorldAtlasTopology {
  type: 'Topology';
  objects: {
    countries: {
      type: 'GeometryCollection';
      geometries: Array<{
        type: 'Polygon' | 'MultiPolygon';
        arcs: any[];
        id: string;
        properties: { name:string; };
      }>;
    };
  };
  arcs: any[];
}

type Metric = 'population' | 'area' | 'gini';
type ScaleType = 'linear' | 'log';

const metricTranslations: Record<Metric, string> = {
    population: '인구',
    area: '면적',
    gini: '지니계수'
};

// Helper to format AI-generated text with basic Markdown-like syntax
const formatAiText = (text: string): string => {
  if (!text) return '';
  return text
    .replace(/\*\*(.*?)\*\*/g, '<strong class="text-emerald-400">$1</strong>')
    .replace(/\n/g, '<br />');
};

const LoadingSpinner: React.FC<{ text: string }> = ({ text }) => (
  <div className="flex flex-col items-center justify-center space-y-4">
    <div className="animate-spin rounded-full h-16 w-16 border-t-4 border-b-4 border-emerald-500"></div>
    <p className="text-lg text-gray-300">{text}</p>
  </div>
);

const Tooltip: React.FC<{ content: string; x: number; y: number; }> = ({ content, x, y }) => (
  <div
    className="absolute bg-gray-900/90 text-white text-sm rounded-md px-3 py-2 pointer-events-none shadow-lg border border-gray-600 z-50"
    style={{ left: x, top: y, transform: 'translate(15px, -30px)' }}
    dangerouslySetInnerHTML={{ __html: content }}
  />
);

const InfoRow: React.FC<{ label: string; value: string | number | undefined | null }> = ({ label, value }) => {
    if (value == null || value === '') return null;
    return (
        <div className="flex justify-between">
          <span className="text-gray-400">{label}:</span>
          <span className="font-semibold text-gray-200 text-right">{typeof value === 'number' ? value.toLocaleString() : value}</span>
        </div>
    );
};

const BarChart: React.FC<{ title: string; data: Array<{ label: string; value: number }>; format: (d: number) => string; }> = ({ title, data, format }) => {
  if (!data || data.length < 2) return null;

  const maxValue = Math.max(...data.map(d => d.value));
  if (maxValue === 0) return null;

  return (
    <div>
      <h4 className="text-md font-semibold text-gray-300 mb-3">{title}</h4>
      <div className="space-y-3">
        {data.map(({ label, value }) => (
          <div key={label} className="grid grid-cols-12 gap-2 items-center text-sm">
            <span className="col-span-3 truncate text-gray-400" title={label}>{label}</span>
            <div className="col-span-7">
                <div className="w-full bg-gray-700/50 rounded">
                    <div
                      className="bg-gradient-to-r from-teal-400 to-emerald-500 h-5 rounded transition-all duration-500 ease-out"
                      style={{ width: `${(value / maxValue) * 100}%` }}
                    />
                </div>
            </div>
            <span className="col-span-2 text-right text-gray-200 font-medium">{format(value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
};


const CountryInfoPanel: React.FC<{ 
    countries: Feature[]; 
    onClear: () => void; 
    onCompare: () => Promise<void>; 
    onFetchLatestInfo: () => Promise<void>;
    aiSummary: AiSummaryState; 
    countryStats: Record<string, CountryStats>; 
    isAiEnabled: boolean;
    chatMessages: ChatMessage[];
    onSendMessage: (message: string) => Promise<void>;
    isChatProcessing: boolean;
}> = ({ countries, onClear, onCompare, onFetchLatestInfo, aiSummary, countryStats, isAiEnabled, chatMessages, onSendMessage, isChatProcessing }) => {
  const count = countries.length;
  const country = count === 1 ? countries[0] : null;
  const countryName = country ? (country.properties as { name: string })?.name : null;
  const data = countryName ? countryStats[countryName] : null;
  const countryNames = countries.map(c => (c.properties as { name: string })?.name);
  const [chatInput, setChatInput] = useState('');
  const chatHistoryRef = useRef<HTMLDivElement>(null);


  useEffect(() => {
    if (chatHistoryRef.current) {
        chatHistoryRef.current.scrollTop = chatHistoryRef.current.scrollHeight;
    }
  }, [chatMessages]);

  const handleChatSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (chatInput.trim() && !isChatProcessing) {
        onSendMessage(chatInput.trim());
        setChatInput('');
    }
  };


  const headerText = count === 0 ? '국가 정보' : count === 1 ? countryName : '국가 비교 분석';
  
  const comparisonData = useMemo(() => {
    if (countries.length < 2) return null;

    const getStat = (country: Feature, metric: keyof CountryStats) => {
        const name = (country.properties as { name: string }).name;
        return countryStats[name]?.[metric];
    };

    const populationData = countries.map(c => ({
        label: (c.properties as { name: string }).name,
        value: getStat(c, 'population') as number || 0,
    })).filter(d => d.value > 0);

    const areaData = countries.map(c => ({
        label: (c.properties as { name: string }).name,
        value: getStat(c, 'area') as number || 0,
    })).filter(d => d.value > 0);

    const giniData = countries.map(c => ({
        label: (c.properties as { name: string }).name,
        value: getStat(c, 'gini') as number || 0,
    })).filter(d => d.value > 0);
    
    return { populationData, areaData, giniData };
  }, [countries, countryStats]);

  const renderContent = () => {
    if (count > 1) { // Multi-country comparison view
      return (
        <>
            <div>
                <p className="text-gray-400">선택된 국가 ({count}):</p>
                <p className="font-semibold text-lg text-emerald-300 mt-1">{countryNames.join(', ')}</p>
                <p className="text-xs text-gray-500 mt-2">최대 4개 국가까지 비교할 수 있습니다.</p>
            </div>
            
            {comparisonData && (
              <div className="mt-6 pt-5 border-t border-gray-700/60">
                <h3 className="text-lg font-bold text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 to-teal-500 mb-4">주요 지표 비교</h3>
                <div className="space-y-6">
                    <BarChart title="인구" data={comparisonData.populationData} format={(d) => d3.format(".3s")(d)} />
                    <BarChart title="면적 (km²)" data={comparisonData.areaData} format={(d) => d3.format(".3s")(d)} />
                    {comparisonData.giniData.length > 1 && (
                        <BarChart title="지니계수" data={comparisonData.giniData} format={(d) => d.toFixed(3)} />
                    )}
                </div>
              </div>
            )}

            <div className="mt-8">
              <button
                onClick={onCompare}
                disabled={aiSummary.loading || !isAiEnabled}
                className="w-full bg-emerald-500 hover:bg-emerald-600 text-white font-bold py-3 px-4 rounded-lg transition-colors disabled:bg-gray-500 disabled:cursor-not-allowed flex items-center justify-center text-base"
                title={!isAiEnabled ? 'AI 기능을 사용하려면 Gemini API 토글을 켜세요.' : 'AI로 국가 비교 분석'}
              >
                {aiSummary.loading ? (
                  <><svg className="animate-spin -ml-1 mr-3 h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg> 분석 중...</>
                ) : `AI로 비교 분석하기`}
              </button>
            </div>
            
            {isAiEnabled && (aiSummary.loading || aiSummary.text || aiSummary.error) && (
              <div className="mt-6 pt-5 border-t border-gray-700/60">
                <h3 className="text-lg font-bold text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 to-teal-500 mb-2">AI 분석 결과</h3>
                <div>
                  {aiSummary.loading && <p className="text-gray-400 animate-pulse">AI가 국가들을 비교 분석하고 있습니다...</p>}
                  {aiSummary.error && <p className="text-red-400 text-sm">{aiSummary.error}</p>}
                  {aiSummary.text && <div className="text-gray-300 text-base leading-relaxed" dangerouslySetInnerHTML={{ __html: formatAiText(aiSummary.text) }} />}
                </div>
              </div>
            )}
        </>
      );
    }
    
    if (country) { // Single country info view
        return (
            <>
                {data && (
                  <div className="space-y-3 text-lg">
                    <InfoRow label="수도" value={data.capital} />
                    <InfoRow label="인구" value={data.population} />
                    <InfoRow label="면적 (km²)" value={data.area} />
                    <InfoRow label="지니계수" value={data.gini} />
                    <div className="pt-3 mt-3 border-t border-gray-600/50">
                        <InfoRow label="지역" value={data.region} />
                        <InfoRow label="소속 지역" value={data.subregion} />
                        <InfoRow label="통화" value={data.currencies} />
                        <InfoRow label="언어" value={data.languages} />
                    </div>
                  </div>
                )}
                {!data && (
                    <p className="text-yellow-400 text-center">{countryName}에 대한 통계 데이터를 찾을 수 없습니다.</p>
                )}
                {isAiEnabled && (
                  <div className="mt-6 pt-5 border-t border-gray-700/60">
                    <h3 className="text-lg font-bold text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 to-teal-500 mb-3">AI 기반 분석</h3>
                    <button
                        onClick={onFetchLatestInfo}
                        disabled={aiSummary.loading || !isAiEnabled}
                        className="w-full bg-teal-500 hover:bg-teal-600 text-white font-bold py-3 px-4 rounded-lg transition-colors disabled:bg-gray-500 disabled:cursor-not-allowed flex items-center justify-center text-base mb-4"
                    >
                      {aiSummary.loading ? (
                          <><svg className="animate-spin -ml-1 mr-3 h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg> 검색 중...</>
                      ) : `최신 정보 보기`}
                    </button>
                    {(aiSummary.loading || aiSummary.text || aiSummary.error) && (
                      <div className="max-h-72 overflow-y-auto pr-2">
                        {aiSummary.loading && <p className="text-gray-400 animate-pulse text-center">최신 정보 검색 중...</p>}
                        {aiSummary.error && <p className="text-red-400 text-sm">{aiSummary.error}</p>}
                        {aiSummary.text && (
                          <div
                            className="text-gray-300 text-base leading-relaxed"
                            dangerouslySetInnerHTML={{ __html: formatAiText(aiSummary.text) }}
                          />
                        )}
                        {aiSummary.sources && aiSummary.sources.length > 0 && (
                          <div className="mt-4">
                            <h4 className="text-sm font-semibold text-gray-400 mb-2">출처</h4>
                            <ul className="space-y-1.5">
                              {aiSummary.sources.map((source, index) => (
                                <li key={index}>
                                  <a
                                    href={source.uri}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-emerald-400 text-sm hover:underline truncate block"
                                    title={source.title}
                                  >
                                  &#8226; {source.title || source.uri}
                                  </a>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
            </>
        );
    }
    
    // Default view: No country selected
    return <p className="text-gray-500 text-center">국가를 선택하여 데이터를 확인하거나, 아래 채팅으로 지도를 제어해보세요.</p>;
  };

  return (
    <div className="w-full lg:w-1/3 bg-gray-800 rounded-xl shadow-2xl shadow-emerald-500/10 border border-gray-700 p-6 flex flex-col max-h-[85vh] lg:max-h-full">
      <div className="flex-shrink-0">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-2xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 to-teal-500">
              {headerText || '국가 정보'}
            </h2>
            {count > 0 && (
              <button onClick={onClear} className="text-gray-400 hover:text-white transition-colors text-2xl font-bold">&times;</button>
            )}
          </div>
      </div>
      
      <div className="flex-grow overflow-y-auto pr-2 flex flex-col justify-center">
        {renderContent()}
      </div>
      
      {isAiEnabled && (
        <div className="flex-shrink-0 mt-6 pt-6 border-t border-gray-700/60">
          <h3 className="text-lg font-bold text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 to-teal-500 mb-3">지도 제어 채팅</h3>
          <div className="bg-gray-900/50 rounded-lg p-3 h-48 flex flex-col">
              <div ref={chatHistoryRef} className="flex-grow overflow-y-auto space-y-3 pr-2 text-sm">
                  {chatMessages.map((msg, index) => (
                      <div key={index} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                          <div className={`rounded-lg px-3 py-2 max-w-xs md:max-w-sm ${msg.role === 'user' ? 'bg-emerald-600 text-white' : 'bg-gray-700 text-gray-200'}`}>
                               {/* @ts-ignore */}
                              <div dangerouslySetInnerHTML={{ __html: formatAiText(msg.parts[0].text) }}></div>
                          </div>
                      </div>
                  ))}
                  {isChatProcessing && (
                      <div className="flex justify-start">
                          <div className="rounded-lg px-3 py-2 bg-gray-700 text-gray-200">
                              <div className="flex items-center space-x-2">
                                <div className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse [animation-delay:-0.3s]"></div>
                                <div className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse [animation-delay:-0.15s]"></div>
                                <div className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse"></div>
                              </div>
                          </div>
                      </div>
                  )}
              </div>
              <form onSubmit={handleChatSubmit} className="mt-3 flex items-center gap-2">
                  <input
                    type="text"
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    placeholder={isChatProcessing ? "응답을 기다리는 중..." : "예: 아프리카를 확대해줘"}
                    disabled={isChatProcessing}
                    className="flex-grow bg-gray-700 text-gray-200 rounded-lg py-2 px-3 focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-all text-sm"
                  />
                  <button type="submit" disabled={isChatProcessing || !chatInput.trim()} className="bg-emerald-500 text-white rounded-lg p-2 disabled:bg-gray-600 disabled:cursor-not-allowed hover:bg-emerald-600 transition-colors">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.428A1 1 0 0010 16.5V3a1 1 0 00-.106-.447z" /></svg>
                  </button>
              </form>
          </div>
        </div>
      )}
    </div>
  );
}

const Legend: React.FC<{ colorScale: any, metric: Metric | null }> = ({ colorScale, metric }) => {
    if (!colorScale || !metric) return null;

    const [min, max] = colorScale.domain();
    const interpolator = colorScale.interpolator ? colorScale.interpolator() : d3.interpolateViridis;

    return (
        <div className="absolute bottom-4 left-4 bg-gray-800/80 p-3 rounded-lg border border-gray-700 text-white text-sm">
            <p className="font-bold capitalize mb-2">{metricTranslations[metric]}</p>
            <div className="w-32 h-4 rounded" style={{ background: 'linear-gradient(to right, ' + d3.range(0, 1.01, 0.1).map(t => interpolator(t)).join(',') + ')' }}></div>
            <div className="flex justify-between mt-1 text-xs text-gray-400">
                <span>{d3.format(".2s")(min)}</span>
                <span>{d3.format(".2s")(max)}</span>
            </div>
        </div>
    );
};

const App: React.FC = () => {
  const [geographies, setGeographies] = useState<Feature[] | null>(null);
  const [countryStats, setCountryStats] = useState<Record<string, CountryStats>>({});
  const [loading, setLoading] = useState<boolean>(true);
  const [mapError, setMapError] = useState<string | null>(null);

  const [hoveredCountry, setHoveredCountry] = useState<string | null>(null);
  const [selectedCountries, setSelectedCountries] = useState<Feature[]>([]);
  const [activeMetric, setActiveMetric] = useState<Metric>('population');
  const [scaleType, setScaleType] = useState<ScaleType>('linear');
  const [tooltip, setTooltip] = useState({ visible: false, content: '', x: 0, y: 0 });
  const [aiSummary, setAiSummary] = useState<AiSummaryState>({ loading: false, text: '', error: null, sources: [] });
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [isAiEnabled, setIsAiEnabled] = useState<boolean>(false);
  const [isCompareMode, setIsCompareMode] = useState<boolean>(false);
  
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [isChatProcessing, setIsChatProcessing] = useState<boolean>(false);

  const [apiKey, setApiKey] = useState<string>('');
  const [activeApiKey, setActiveApiKey] = useState<string>('');
  const [apiKeyStatus, setApiKeyStatus] = useState<'ready' | 'missing'>('missing');

  const svgRef = useRef<SVGSVGElement>(null);
  const gRef = useRef<SVGGElement>(null);
  const zoomRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const aiRef = useRef<GoogleGenAI | null>(null);

  useEffect(() => {
    const key = localStorage.getItem('GEMINI_API_KEY') || process.env.API_KEY;
    if (key) {
        setApiKey(key);
        setActiveApiKey(key);
        setApiKeyStatus('ready');
    }
  }, []);
  
  const handleSaveApiKey = () => {
    const trimmedKey = apiKey.trim();
    if (trimmedKey) {
        localStorage.setItem('GEMINI_API_KEY', trimmedKey);
        setActiveApiKey(trimmedKey);
        setApiKeyStatus('ready');
        alert('API 키가 저장되었습니다.');
    } else {
        localStorage.removeItem('GEMINI_API_KEY');
        if (process.env.API_KEY) {
            setActiveApiKey(process.env.API_KEY);
            setApiKey(process.env.API_KEY);
            setApiKeyStatus('ready');
            alert('API 키가 환경 변수 값으로 초기화되었습니다.');
        } else {
            setActiveApiKey('');
            setApiKey('');
            setApiKeyStatus('missing');
            alert('API 키가 삭제되었습니다.');
        }
    }
  };
  
  /**
   * API 키를 삭제하는 함수
   * 로컬 스토리지에서 API 키를 제거하고 상태를 업데이트합니다.
   */
  const handleDeleteApiKey = () => {
    if (window.confirm('API 키를 삭제하시겠습니까?')) {
      localStorage.removeItem('GEMINI_API_KEY');
      if (process.env.API_KEY) {
        setActiveApiKey(process.env.API_KEY);
        setApiKey(process.env.API_KEY);
        setApiKeyStatus('ready');
        alert('API 키가 환경 변수 값으로 초기화되었습니다.');
      } else {
        setActiveApiKey('');
        setApiKey('');
        setApiKeyStatus('missing');
        alert('API 키가 삭제되었습니다.');
      }
    }
  };
  
  // Effect for fetching map topology
  useEffect(() => {
    const fetchAtlasData = async () => {
      try {
        setLoading(true);
        setMapError(null);
        
        const response = await fetch(WORLD_ATLAS_URL);
        if (!response.ok) throw new Error(`지도 데이터를 불러오는 데 실패했습니다: ${response.status}`);
        const worldAtlas = await response.json() as WorldAtlasTopology;
        if (worldAtlas?.objects?.countries) {
          const geoJson = topojson.feature(worldAtlas, worldAtlas.objects.countries) as unknown as FeatureCollection;
          setGeographies(geoJson.features);
        } else {
          throw new Error("잘못된 TopoJSON 형식입니다.");
        }
      } catch (e) {
        setMapError(e instanceof Error ? e.message : '알 수 없는 오류가 발생했습니다.');
      } finally {
        setLoading(false);
      }
    };
    fetchAtlasData();
  }, []);

  // Effect for fetching country statistics from local bundled data
  // (replaces deprecated restcountries.com v3.1 — now uses pre-bundled JSON in public/countries.json)
  useEffect(() => {
    const fetchCountryStats = async () => {
        if (!geographies || geographies.length === 0) return;
        try {
          setMapError(null);
          const response = await fetch(`${import.meta.env.BASE_URL}countries.json`);
          if (!response.ok) throw new Error(`번들된 국가 통계 파일을 가져오는 데 실패했습니다: ${response.statusText}`);
          const data: Array<{ name: string; capital: string; population?: number; area?: number; gini?: number; currencies?: string }> = await response.json();
          const statsMap: Record<string, CountryStats> = {};
          for (const country of data) {
            const stat: CountryStats = {
                population: country.population,
                area: country.area,
                capital: country.capital || 'N/A',
                gini: country.gini,
                currencies: country.currencies,
            };
            statsMap[country.name] = stat;
          }

          // Map countriesnow / world-atlas country names to bundled names
          // (preserves original restcountries name aliases)
          const aliasMap: Record<string, string> = {
              'United States of America': 'United States',
              'Dem. Rep. Congo': 'DR Congo',
              'S. Sudan': 'South Sudan',
              'Central African Rep.': 'Central African Republic',
              'Eq. Guinea': 'Equatorial Guinea',
              'Dominican Rep.': 'Dominican Republic',
              'W. Sahara': 'Western Sahara',
              'Bosnia and Herz.': 'Bosnia and Herzegovina',
              'Solomon Is.': 'Solomon Islands',
              'Russian Federation': 'Russia',
          };
          for (const [atlasName, bundledName] of Object.entries(aliasMap)) {
              if (statsMap[bundledName]) statsMap[atlasName] = statsMap[bundledName];
          }
          setCountryStats(statsMap);
        } catch (e) {
          console.error("Country stats error:", e);
          setMapError("국가 통계 데이터를 가져오는 데 실패했습니다.");
          setCountryStats({});
        }
    };
    fetchCountryStats();
  }, [geographies]);

  useEffect(() => {
    setIsTransitioning(true);
    const timer = setTimeout(() => setIsTransitioning(false), 750);
    return () => clearTimeout(timer);
  }, [activeMetric, scaleType]);
  
  useEffect(() => {
    if (isAiEnabled && activeApiKey) {
      try {
        aiRef.current = new GoogleGenAI({ apiKey: activeApiKey });
        setChatMessages([{ role: 'model', parts: [{ text: '안녕하세요! 무엇을 도와드릴까요? 지도를 제어하거나 국가에 대한 질문을 할 수 있습니다.' }] }]);
      } catch (e) {
        console.error("Failed to initialize Gemini AI:", e);
        setChatMessages(prev => [...prev, { role: 'model', parts: [{ text: 'Gemini AI 초기화에 실패했습니다. API 키를 확인해주세요.' }] }]);
        setIsAiEnabled(false);
      }
    } else {
      aiRef.current = null;
      if (!isAiEnabled) {
          // Keep compare mode state, but clear AI-related states
          setAiSummary({ loading: false, text: '', error: null, sources: [] });
      }
      setChatMessages([]);
    }
  }, [isAiEnabled, activeApiKey]);

  useEffect(() => {
    if(selectedCountries.length > 0) handleClearSelections();
  }, [isCompareMode]);

  useEffect(() => {
    if (selectedCountries.length > 1) {
      setAiSummary({ loading: false, text: '', error: null, sources: [] });
    }
  }, [selectedCountries]);

  const handleFetchLatestInfo = async () => {
    if (!aiRef.current || selectedCountries.length !== 1) return;
    const countryName = (selectedCountries[0].properties as { name: string })?.name;
    if (!countryName) return;
    setAiSummary({ loading: true, text: '', error: null, sources: [] });
    try {
      const response = await aiRef.current.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: `${countryName}의 최신 주요 뉴스나 흥미로운 사건에 대해 한국어로 간략히 요약해 주세요.`,
        config: { tools: [{ googleSearch: {} }] },
      });
      const groundingMetadata = response.candidates?.[0]?.groundingMetadata;
      const sources = groundingMetadata?.groundingChunks?.map((chunk: any) => chunk.web).filter((web: any) => web?.uri) || [];
      setAiSummary({ loading: false, text: response.text, error: null, sources });
    } catch (e) {
      console.error("AI summary generation error:", e);
      setAiSummary({ loading: false, text: '', error: 'AI 요약 생성에 실패했습니다.', sources: [] });
    }
  };

  const pathGenerator = useMemo(() => {
    const projection = d3.geoEqualEarth().scale(180).translate([480, 250]);
    return d3.geoPath().projection(projection);
  }, []);

  const colorScale = useMemo(() => {
    if (!activeMetric || Object.keys(countryStats).length === 0) return null;
    const metricValues = Object.values(countryStats).map(d => d[activeMetric]).filter(v => v != null && v > 0) as number[];
    if (metricValues.length === 0) return null;
    const domain = d3.extent(metricValues) as [number, number];
    const interpolator = activeMetric === 'gini' ? d3.interpolateViridis : d3.interpolatePlasma;
    if (scaleType === 'log') {
        const logDomain: [number, number] = [domain[0] > 0 ? domain[0] : 1, domain[1]];
        const normalizer = d3.scaleLog().domain(logDomain).range([0, 1]).clamp(true);
        const scale = (d: number) => interpolator(normalizer(d));
        scale.domain = () => logDomain;
        scale.interpolator = () => interpolator;
        return scale;
    }
    return d3.scaleSequential(interpolator).domain(domain);
  }, [activeMetric, scaleType, countryStats]);

  useEffect(() => {
    if (loading || !svgRef.current || !gRef.current) return;
    const svg = d3.select(svgRef.current);
    const g = d3.select(gRef.current);
    const zoom = d3.zoom<SVGSVGElement, unknown>().scaleExtent([1, 12]).on('zoom', (event) => {
      g.attr('transform', event.transform.toString());
    });
    zoomRef.current = zoom;
    svg.call(zoom);
    return () => { svg.on('.zoom', null); };
  }, [loading]);
  
  const handleCountryClick = (feature: Feature) => {
    const countryName = (feature.properties as { name: string }).name;
    setAiSummary({ loading: false, text: '', error: null, sources: [] }); // Clear previous summary
    if (!isCompareMode) {
      setSelectedCountries(prev => prev.length === 1 && (prev[0].properties as any).name === countryName ? [] : [feature]);
      return;
    }
    setSelectedCountries(prev => {
      const isSelected = prev.some(c => (c.properties as any).name === countryName);
      if (isSelected) return prev.filter(c => (c.properties as any).name !== countryName);
      if (prev.length < 4) return [...prev, feature];
      return prev;
    });
  };

  const handleClearSelections = () => {
      setSelectedCountries([]);
      setAiSummary({ loading: false, text: '', error: null, sources: [] });
  };

  const handleResetZoom = () => {
    if (!svgRef.current || !zoomRef.current) return;
    d3.select(svgRef.current).transition().duration(750).call(zoomRef.current.transform, d3.zoomIdentity);
  };
  
  const handleCompareCountries = async () => {
    if (selectedCountries.length < 2 || !isAiEnabled || !aiRef.current) return;
    const countryNames = selectedCountries.map(c => (c.properties as { name: string }).name);
    const prompt = `${countryNames.join('과 ')}의 경제, 문화, 지리적 특징을 비교하고 대조하여 흥미로운 사실들을 한국어로 요약해 주세요.`;
    setAiSummary({ loading: true, text: '', error: null, sources: [] });
    try {
        const response = await aiRef.current.models.generateContent({ model: 'gemini-2.5-flash', contents: prompt });
        setAiSummary({ loading: false, text: response.text, error: null, sources: [] });
    } catch (e) {
        console.error("AI comparison error:", e);
        setAiSummary({ loading: false, text: '', error: 'AI 비교 분석에 실패했습니다.', sources: [] });
    }
  };
  
  const handleHighlightCountries = (countriesToHighlight: string[]) => {
    if (!geographies) return '지리 데이터가 로드되지 않았습니다.';
    const foundFeatures = geographies.filter(f => countriesToHighlight.includes((f.properties as { name: string }).name));
    setSelectedCountries(foundFeatures);
    return `완료: ${countriesToHighlight.join(', ')} 국가를 강조 표시했습니다.`;
  };

  const handleZoomToArea = (areaName: string) => {
    if (!geographies || !svgRef.current || !gRef.current || !zoomRef.current) return '지도가 준비되지 않았습니다.';
    
    const isContinent = Object.values(countryStats).some(s => s.region?.toLowerCase() === areaName.toLowerCase());
    
    const featuresToZoom = geographies.filter(f => {
      const name = (f.properties as { name: string }).name;
      const stats = countryStats[name];
      if (isContinent) return stats?.region?.toLowerCase() === areaName.toLowerCase();
      return name.toLowerCase() === areaName.toLowerCase();
    });

    if (featuresToZoom.length === 0) return `'${areaName}'을(를) 찾을 수 없습니다.`;

    const bounds = pathGenerator.bounds({ type: 'FeatureCollection', features: featuresToZoom });
    const dx = bounds[1][0] - bounds[0][0];
    const dy = bounds[1][1] - bounds[0][1];
    const x = (bounds[0][0] + bounds[1][0]) / 2;
    const y = (bounds[0][1] + bounds[1][1]) / 2;
    const svgWidth = svgRef.current.clientWidth;
    const svgHeight = svgRef.current.clientHeight;

    const scale = Math.max(1, Math.min(8, 0.9 / Math.max(dx / svgWidth, dy / svgHeight)));
    const translate = [svgWidth / 2 - scale * x, svgHeight / 2 - scale * y];
    
    const transform = d3.zoomIdentity.translate(translate[0], translate[1]).scale(scale);
    
    d3.select(svgRef.current).transition().duration(1000).call(zoomRef.current.transform, transform);
    
    return `완료: ${areaName}(으)로 확대합니다.`;
  };

  const handleClearActions = () => {
    handleClearSelections();
    handleResetZoom();
    return '완료: 강조 표시를 지우고 지도를 초기화했습니다.';
  };

  const handleChangeMetric = (metric: string) => {
    if (Object.keys(metricTranslations).includes(metric)) {
      setActiveMetric(metric as Metric);
      return `완료: 지표를 '${metricTranslations[metric as Metric]}'(으)로 변경했습니다.`;
    }
    return `오류: '${metric}'은(는) 유효한 지표가 아닙니다. 'population', 'area', 'gini' 중에서 선택하세요.`;
  };

  const handleSendMessage = async (message: string) => {
    if (!aiRef.current) return;
    setIsChatProcessing(true);
    const userMessage: ChatMessage = { role: 'user', parts: [{ text: message }] };
    setChatMessages(prev => [...prev, userMessage]);

    const tools: Tool[] = [
      { functionDeclarations: [
        { name: 'highlightCountries', description: '지도에서 특정 국가 목록을 강조 표시합니다. "브라질과 아르헨티나를 보여줘"와 같은 사용자 쿼리를 기반으로 특정 국가를 표시하는 데 사용합니다.', parameters: { type: Type.OBJECT, properties: { countries: { type: Type.ARRAY, description: '강조할 국가 이름 배열입니다.', items: { type: Type.STRING } } }, required: ['countries'] } },
        { name: 'zoomToArea', description: '지도에서 대륙이나 국가와 같은 특정 지역으로 확대합니다.', parameters: { type: Type.OBJECT, properties: { areaName: { type: Type.STRING, description: '확대할 대륙(예: "Africa") 또는 국가(예: "Brazil")의 이름입니다.' } }, required: ['areaName'] } },
        { name: 'clearActions', description: '모든 국가 선택/강조 표시를 지우고 지도 확대를 기본 보기로 재설정합니다.', parameters: { type: Type.OBJECT, properties: {} } },
        { name: 'changeMetric', description: '지도 색상 스케일의 데이터 시각화 메트릭을 변경합니다.', parameters: { type: Type.OBJECT, properties: { metric: { type: Type.STRING, description: '표시할 메트릭입니다. "population", "area", "gini" 중 하나여야 합니다.' } }, required: ['metric'] } }
      ]}
    ];

    const modelInstruction = `당신은 세계 지도 도우미입니다. 사용자의 요청을 분석하고 제공된 도구를 사용하여 지도를 제어하세요. 국가를 강조 표시하거나, 지역으로 확대하거나, 데이터 메트릭을 변경할 수 있습니다. 사용자가 데이터에 대해 질문하면(예: "가장 인구가 많은 5개국은 어디인가요?") 먼저 데이터를 분석하여 답을 찾은 다음 해당 도구(예: highlightCountries)를 사용하여 지도에 표시하세요. 사용자가 일반적인 질문을 하면 유용한 답변을 제공하세요. 모든 답변은 한국어로 하세요.`;
    
    try {
        const response = await aiRef.current.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: [...chatMessages, userMessage].map(m => ({ role: m.role, parts: m.parts })),
            config: {
              systemInstruction: modelInstruction,
              tools: tools
            }
        });
        
        const call = response.candidates?.[0]?.content?.parts[0]?.functionCall;
        
        let modelResponseText = response.text;

        if (call) {
            let resultText = '';
            if (call.name === 'highlightCountries') resultText = handleHighlightCountries(call.args.countries as string[]);
            else if (call.name === 'zoomToArea') resultText = handleZoomToArea(call.args.areaName as string);
            else if (call.name === 'clearActions') resultText = handleClearActions();
            else if (call.name === 'changeMetric') resultText = handleChangeMetric(call.args.metric as string);
            
            if (resultText) {
               modelResponseText = modelResponseText ? `${modelResponseText}\n\n**작업:** ${resultText}` : `**작업:** ${resultText}`;
            }
        }

        if (modelResponseText) {
          setChatMessages(prev => [...prev, { role: 'model', parts: [{ text: modelResponseText }] }]);
        }

    } catch (e) {
        console.error("Chat error:", e);
        setChatMessages(prev => [...prev, { role: 'model', parts: [{ text: '죄송합니다. 요청을 처리하는 중에 오류가 발생했습니다.' }] }]);
    } finally {
        setIsChatProcessing(false);
    }
  };

  const getFillColor = (feature: Feature) => {
    const countryName = (feature.properties as { name: string })?.name;
    const isSelected = selectedCountries.some(c => (c.properties as {name: string}).name === countryName);
    if (isSelected) return '#10b981';
    if (countryName === hoveredCountry) return '#2dd4bf'; 
    if (colorScale && activeMetric) {
        const data = countryStats[countryName];
        if (data && data[activeMetric] != null && data[activeMetric] > 0) return colorScale(data[activeMetric]);
    }
    return '#4b5563';
  };

  return (
    <main className="bg-gray-900 min-h-screen w-full flex flex-col items-center justify-center p-4 sm:p-6 lg:p-8 font-sans text-white">
      {tooltip.visible && <Tooltip content={tooltip.content} x={tooltip.x} y={tooltip.y} />}
      <div className="w-full max-w-7xl text-center mb-6">
        <h1 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold mb-2 text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 to-teal-500">
          세계 데이터 지도
        </h1>
        <p className="text-gray-400 text-sm sm:text-base">
          세계 데이터를 시각화하세요. 확대/축소, 이동이 가능하며, 국가를 클릭해 상세 정보를 볼 수 있습니다.
        </p>
        <div className="mt-6 flex flex-col justify-center items-center gap-4">
            <div className="flex flex-wrap justify-center items-center gap-3 sm:gap-6">
                <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-gray-400">지표:</span>
                    <div className="flex items-center gap-1 bg-gray-700 p-1 rounded-full">
                        {(Object.keys(metricTranslations) as Metric[]).map(metric => (
                            <button key={metric} onClick={() => setActiveMetric(metric)} className={`px-4 py-1.5 text-sm font-semibold rounded-full transition-all duration-200 ${activeMetric === metric ? 'bg-emerald-500 text-white shadow-md' : 'bg-transparent text-gray-300 hover:bg-gray-600'}`}>
                                {metricTranslations[metric]}
                            </button>
                        ))}
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-gray-400">스케일:</span>
                    <div className="flex items-center gap-1 bg-gray-700 p-1 rounded-full">
                        <button onClick={() => setScaleType('linear')} className={`px-4 py-1.5 text-sm font-semibold rounded-full transition-all duration-200 ${scaleType === 'linear' ? 'bg-emerald-500 text-white shadow-md' : 'bg-transparent text-gray-300 hover:bg-gray-600'}`}>선형</button>
                        <button onClick={() => setScaleType('log')} className={`px-4 py-1.5 text-sm font-semibold rounded-full transition-all duration-200 ${scaleType === 'log' ? 'bg-emerald-500 text-white shadow-md' : 'bg-transparent text-gray-300 hover:bg-gray-600'}`}>로그</button>
                    </div>
                </div>
                <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-gray-400">Gemini API:</span>
                        <button
                            onClick={() => setIsAiEnabled(!isAiEnabled)}
                            role="switch"
                            aria-checked={isAiEnabled}
                            disabled={apiKeyStatus === 'missing'}
                            title={apiKeyStatus === 'missing' ? '먼저 Gemini API 키를 저장하세요.' : 'Gemini AI 기능 활성화'}
                            className={`${isAiEnabled ? 'bg-emerald-500' : 'bg-gray-600'} relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 focus:ring-offset-gray-900 disabled:opacity-50 disabled:cursor-not-allowed`}
                        >
                            <span aria-hidden="true" className={`${isAiEnabled ? 'translate-x-5' : 'translate-x-0'} pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out`} />
                        </button>
                    </div>
                    <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-gray-400">국가 비교:</span>
                        <button
                            onClick={() => setIsCompareMode(!isCompareMode)}
                            role="switch"
                            aria-checked={isCompareMode}
                            title="국가 비교 모드 전환"
                            className={`${isCompareMode ? 'bg-emerald-500' : 'bg-gray-600'} relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 focus:ring-offset-gray-900`}
                        >
                            <span aria-hidden="true" className={`${isCompareMode ? 'translate-x-5' : 'translate-x-0'} pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out`} />
                        </button>
                    </div>
                </div>
            </div>
            <div className="flex items-center gap-2 bg-gray-700/80 p-1.5 rounded-full border border-gray-600">
                <span className="pl-3 pr-1 text-sm font-semibold text-gray-300">API Key</span>
                <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${apiKeyStatus === 'ready' ? 'bg-green-400' : 'bg-yellow-400 animate-pulse'}`} title={apiKeyStatus === 'ready' ? 'API 키가 활성화되었습니다.' : 'API 키를 입력해주세요.'}></div>
                <input 
                    type="password"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder="여기에 API 키를 붙여넣으세요"
                    className="bg-gray-800 text-gray-200 rounded-md py-1.5 px-3 text-sm w-48 sm:w-60 focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-all"
                />
                <button onClick={handleSaveApiKey} className="px-4 py-1.5 text-sm font-semibold rounded-full bg-emerald-500 text-white hover:bg-emerald-600 transition-colors shadow-md">
                    저장
                </button>
                {apiKeyStatus === 'ready' && (
                    <button onClick={handleDeleteApiKey} className="px-4 py-1.5 text-sm font-semibold rounded-full bg-red-500 text-white hover:bg-red-600 transition-colors shadow-md">
                        삭제
                    </button>
                )}
            </div>
        </div>
      </div>

      <div className="w-full max-w-7xl flex flex-col lg:flex-row gap-6">
        <div className="relative w-full lg:w-2/3 bg-gray-800 rounded-xl shadow-2xl shadow-emerald-500/10 overflow-hidden border border-gray-700 aspect-[960/500] cursor-move">
            {loading && <div className="w-full h-full flex items-center justify-center"><LoadingSpinner text="지도 로딩 중..." /></div>}
            {mapError && !loading && <div className="w-full h-full flex items-center justify-center text-red-400 p-4 text-center"><p><strong>오류:</strong> {mapError}</p></div>}
            {!loading && !mapError && geographies && (
              <>
                <svg ref={svgRef} width="100%" height="100%" viewBox="0 0 960 500">
                  <g ref={gRef}>
                      <path d={pathGenerator({ type: 'Sphere' }) || ''} className="fill-gray-900" />
                      {geographies.map((feature, i) => {
                        const countryName = (feature.properties as { name: string })?.name;
                        return (
                          <path
                            key={`path-${countryName}-${i}`}
                            d={pathGenerator(feature) || ''}
                            className="stroke-gray-900 stroke-[0.5]"
                            onMouseEnter={(event: React.MouseEvent<SVGPathElement>) => {
                              if (!countryName) return;
                              setHoveredCountry(countryName);
                              const data = countryStats[countryName];
                              const value = data ? data[activeMetric] : null;
                              setTooltip({
                                visible: true,
                                content: `<strong>${countryName}</strong><br/>${metricTranslations[activeMetric]}: ${value != null ? value.toLocaleString() : 'N/A'}`,
                                x: event.clientX,
                                y: event.clientY,
                              });
                            }}
                            onMouseMove={(event: React.MouseEvent<SVGPathElement>) => setTooltip(prev => ({ ...prev, x: event.clientX, y: event.clientY }))}
                            onMouseLeave={() => { setHoveredCountry(null); setTooltip(prev => ({...prev, visible: false})); }}
                            onClick={() => handleCountryClick(feature)}
                            style={{
                              cursor: 'pointer',
                              fill: getFillColor(feature),
                              transition: `fill ${isTransitioning ? '0.75s' : '0.2s'} ease-in-out`,
                            }}
                          />
                        )
                      })}
                  </g>
                </svg>
                <Legend colorScale={colorScale} metric={activeMetric} />
                <button onClick={handleResetZoom} className="absolute top-4 right-4 bg-gray-800/80 p-2 rounded-full border border-gray-700 text-white hover:bg-gray-700 transition-colors focus:outline-none focus:ring-2 focus:ring-emerald-500" aria-label="보기 초기화">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path d="M10.707 2.293a1 1 0 00-1.414 0l-7 7a1 1 0 001.414 1.414L4 10.414V17a1 1 0 001 1h2a1 1 0 001-1v-2a1 1 0 011-1h2a1 1 0 011 1v2a1 1 0 001 1h2a1 1 0 001-1v-6.586l.293.293a1 1 0 001.414-1.414l-7-7z" /></svg>
                </button>
              </>
            )}
        </div>
        <CountryInfoPanel 
            countries={selectedCountries} 
            onClear={handleClearSelections} 
            onCompare={handleCompareCountries} 
            onFetchLatestInfo={handleFetchLatestInfo}
            aiSummary={aiSummary} 
            countryStats={countryStats} 
            isAiEnabled={isAiEnabled}
            chatMessages={chatMessages}
            onSendMessage={handleSendMessage}
            isChatProcessing={isChatProcessing}
        />
      </div>
    </main>
  );
};

export default App;
