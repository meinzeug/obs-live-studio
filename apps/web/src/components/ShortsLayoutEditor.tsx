import React, { useEffect, useRef, useState } from 'react';
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Eye,
  EyeOff,
  GripVertical,
  Image as ImageIcon,
  LayoutTemplate,
  MonitorPlay,
  Move,
  RotateCcw,
  Type,
  UserRound,
} from 'lucide-react';

export type ShortsPlatform = 'youtube' | 'tiktok';
export type ShortsMediaElement = {
  visible: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
  fit: 'contain' | 'cover';
  borderWidth: number;
};
export type ShortsTextElement = {
  visible: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
  fontFamily: 'dejavu-sans' | 'ibm-plex-sans' | 'ibm-plex-condensed' | 'liberation-sans' | 'nimbus-sans';
  fontSize: number;
  fontWeight: 'regular' | 'semibold' | 'bold';
  color: string;
  align: 'left' | 'center' | 'right';
  background: 'none' | 'glass' | 'solid';
  text?: string;
};
export type ShortsLayoutConfig = {
  version: 1;
  backgroundStyle: 'blur' | 'studio' | 'clean';
  accentColor: string;
  brandingOverlayVisible: boolean;
  elements: {
    sourceVideo: ShortsMediaElement;
    avatar: ShortsMediaElement;
    formatLabel: ShortsTextElement;
    title: ShortsTextElement;
    commentary: ShortsTextElement;
    source: ShortsTextElement;
  };
};

type ElementId = keyof ShortsLayoutConfig['elements'];
type DragState = {
  id: ElementId;
  mode: 'move' | 'resize';
  pointerId: number;
  clientX: number;
  clientY: number;
  element: ShortsMediaElement | ShortsTextElement;
};

const elementMeta: Array<{
  id: ElementId;
  label: string;
  hint: string;
  kind: 'media' | 'text';
  icon: React.ComponentType<{ size?: number }>;
}> = [
  { id: 'sourceVideo', label: 'YouTube-Video', hint: 'Originalausschnitt', kind: 'media', icon: MonitorPlay },
  { id: 'avatar', label: 'AVA', hint: 'Sprech- und Zuhörvideo', kind: 'media', icon: UserRound },
  { id: 'formatLabel', label: 'Formatzeile', hint: 'z. B. AVA ordnet ein', kind: 'text', icon: Type },
  { id: 'title', label: 'Videotitel', hint: 'Dynamischer Originaltitel', kind: 'text', icon: Type },
  { id: 'commentary', label: 'AVA-Einordnung', hint: 'KI-generierter Sprechertext', kind: 'text', icon: Type },
  { id: 'source', label: 'Quelle', hint: 'YouTube-Kanal', kind: 'text', icon: Type },
];

const colors = ['#ffffff', '#e2e8f0', '#94a3b8', '#22d3ee', '#25f4ee', '#fbbf24', '#fb7185', '#c084fc'];
const accentColors = ['#22d3ee', '#25f4ee', '#31c6b1', '#fb7185', '#fbbf24', '#8b5cf6'];
const fontOptions: Array<{ value: ShortsTextElement['fontFamily']; label: string }> = [
  { value: 'ibm-plex-sans', label: 'IBM Plex Sans · TV modern' },
  { value: 'ibm-plex-condensed', label: 'IBM Plex Sans Condensed · kompakt' },
  { value: 'dejavu-sans', label: 'DejaVu Sans · neutral' },
  { value: 'liberation-sans', label: 'Liberation Sans · klassisch' },
  { value: 'nimbus-sans', label: 'Nimbus Sans · editorial' },
];

function mediaElement(
  x: number,
  y: number,
  width: number,
  height: number,
  visible = true,
  borderWidth = 4,
): ShortsMediaElement {
  return { visible, x, y, width, height, fit: 'contain', borderWidth };
}

function textElement(
  x: number,
  y: number,
  width: number,
  height: number,
  fontSize: number,
  options: Partial<ShortsTextElement> = {},
): ShortsTextElement {
  return {
    visible: true,
    x,
    y,
    width,
    height,
    fontFamily: 'ibm-plex-sans',
    fontSize,
    fontWeight: 'bold',
    color: '#ffffff',
    align: 'left',
    background: 'none',
    ...options,
  };
}

export function defaultShortsLayout(platform: ShortsPlatform): ShortsLayoutConfig {
  if (platform === 'tiktok')
    return {
      version: 1,
      backgroundStyle: 'studio',
      accentColor: '#25f4ee',
      brandingOverlayVisible: false,
      elements: {
        sourceVideo: mediaElement(40, 190, 1000, 562),
        avatar: mediaElement(80, 1310, 920, 610, true, 0),
        formatLabel: textElement(70, 800, 940, 48, 31, { color: '#25f4ee', text: 'AVA ORDNET EIN' }),
        title: textElement(70, 855, 940, 176, 43, { background: 'glass' }),
        commentary: textElement(70, 1040, 940, 190, 30, { color: '#e2e8f0' }),
        source: textElement(70, 1245, 940, 44, 24, { color: '#94a3b8', fontWeight: 'semibold' }),
      },
    };
  return {
    version: 1,
    backgroundStyle: 'blur',
    accentColor: '#22d3ee',
    brandingOverlayVisible: true,
    elements: {
      sourceVideo: mediaElement(40, 270, 1000, 562),
      avatar: mediaElement(0, 1350, 900, 570, true, 0),
      formatLabel: textElement(72, 842, 936, 42, 28, {
        visible: false,
        color: '#22d3ee',
        text: 'AVA ORDNET EIN',
      }),
      title: textElement(72, 878, 936, 205, 42, { background: 'glass' }),
      commentary: textElement(72, 1110, 936, 220, 31, { color: '#e2e8f0' }),
      source: textElement(72, 1300, 936, 42, 24, {
        visible: false,
        color: '#94a3b8',
        fontWeight: 'semibold',
      }),
    },
  };
}

function presetLayout(platform: ShortsPlatform, preset: 'editorial' | 'video' | 'split') {
  const layout = defaultShortsLayout(platform);
  if (preset === 'editorial') return layout;
  if (preset === 'video') {
    layout.elements.sourceVideo = mediaElement(28, 100, 1024, 760);
    layout.elements.formatLabel = textElement(48, 900, 610, 50, 30, {
      color: layout.accentColor,
      text: 'AVA ORDNET EIN',
    });
    layout.elements.title = textElement(48, 958, 610, 205, 42, { background: 'glass' });
    layout.elements.commentary = textElement(48, 1180, 600, 340, 29, { color: '#e2e8f0' });
    layout.elements.source = textElement(48, 1532, 600, 48, 23, {
      color: '#94a3b8',
      fontWeight: 'semibold',
    });
    layout.elements.avatar = mediaElement(530, 1260, 550, 660, true, 0);
    return layout;
  }
  layout.elements.sourceVideo = mediaElement(30, 150, 1020, 574);
  layout.elements.formatLabel = textElement(50, 770, 980, 52, 31, {
    color: layout.accentColor,
    text: 'AVA ORDNET EIN',
  });
  layout.elements.title = textElement(50, 830, 980, 174, 42, { background: 'glass' });
  layout.elements.commentary = textElement(50, 1020, 590, 300, 30, { color: '#e2e8f0' });
  layout.elements.source = textElement(50, 1335, 590, 46, 23, {
    color: '#94a3b8',
    fontWeight: 'semibold',
  });
  layout.elements.avatar = mediaElement(520, 1035, 560, 885, true, 0);
  return layout;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

function snap(value: number) {
  return Math.round(value / 5) * 5;
}

function fontPreview(family: ShortsTextElement['fontFamily']) {
  if (family === 'ibm-plex-condensed') return '"Arial Narrow", "IBM Plex Sans Condensed", sans-serif';
  if (family === 'nimbus-sans') return '"Helvetica Neue", Arial, sans-serif';
  if (family === 'dejavu-sans') return '"DejaVu Sans", sans-serif';
  if (family === 'liberation-sans') return '"Liberation Sans", Arial, sans-serif';
  return '"IBM Plex Sans", Inter, sans-serif';
}

function sampleText(id: ElementId, element: ShortsMediaElement | ShortsTextElement) {
  if (id === 'formatLabel') return 'text' in element ? element.text || 'AVA ORDNET EIN' : 'AVA ORDNET EIN';
  if (id === 'title') return 'Warum diese Debatte gerade so viele Menschen bewegt';
  if (id === 'commentary')
    return 'AVA prüft die zentrale Aussage, ergänzt Kontext und zeigt, welche Frage offenbleibt.';
  if (id === 'source') return 'Quelle: Beispielkanal @ YouTube';
  return '';
}

export function ShortsLayoutEditor({
  platform,
  value,
  onChange,
  brandingOverlayUrl,
  disabled = false,
}: {
  platform: ShortsPlatform;
  value: ShortsLayoutConfig;
  onChange: (value: ShortsLayoutConfig) => void;
  brandingOverlayUrl?: string;
  disabled?: boolean;
}) {
  const [selected, setSelected] = useState<ElementId>('sourceVideo');
  const canvasRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    const move = (event: PointerEvent) => {
      const drag = dragRef.current;
      const canvas = canvasRef.current;
      if (!drag || !canvas || event.pointerId !== drag.pointerId) return;
      const bounds = canvas.getBoundingClientRect();
      const factor = 1080 / Math.max(1, bounds.width);
      const dx = (event.clientX - drag.clientX) * factor;
      const dy = (event.clientY - drag.clientY) * factor;
      const original = drag.element;
      let next = { ...original };
      if (drag.mode === 'move') {
        next.x = snap(clamp(original.x + dx, 0, 1080 - original.width));
        next.y = snap(clamp(original.y + dy, 0, 1920 - original.height));
      } else {
        const minimumWidth = drag.id === 'avatar' || drag.id === 'sourceVideo' ? 140 : 180;
        const minimumHeight = drag.id === 'avatar' || drag.id === 'sourceVideo' ? 100 : 36;
        next.width = snap(clamp(original.width + dx, minimumWidth, 1080 - original.x));
        next.height = snap(clamp(original.height + dy, minimumHeight, 1920 - original.y));
      }
      onChangeRef.current({
        ...value,
        elements: { ...value.elements, [drag.id]: next },
      });
    };
    const stop = (event: PointerEvent) => {
      if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
    };
  }, [value]);

  const selectedMeta = elementMeta.find((entry) => entry.id === selected)!;
  const selectedElement = value.elements[selected];
  const updateElement = (patch: Partial<ShortsMediaElement & ShortsTextElement>) =>
    onChange({ ...value, elements: { ...value.elements, [selected]: { ...selectedElement, ...patch } } });
  const startPointer = (event: React.PointerEvent, id: ElementId, mode: DragState['mode']) => {
    if (disabled) return;
    event.preventDefault();
    event.stopPropagation();
    setSelected(id);
    dragRef.current = {
      id,
      mode,
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      element: { ...value.elements[id] },
    };
  };

  return (
    <section className="shorts-layout-editor-section">
      <div className="shorts-layout-editor-heading">
        <div>
          <p className="eyebrow">Visueller 9:16-Designer</p>
          <h4>
            <LayoutTemplate size={18} /> Short-Layout bearbeiten
          </h4>
          <p>Element auswählen, direkt verschieben und am rechten unteren Griff skalieren.</p>
        </div>
        <div className="shorts-layout-presets" aria-label="Layoutvorlagen">
          <button type="button" onClick={() => onChange(presetLayout(platform, 'editorial'))} disabled={disabled}>
            Redaktion
          </button>
          <button type="button" onClick={() => onChange(presetLayout(platform, 'video'))} disabled={disabled}>
            Video groß
          </button>
          <button type="button" onClick={() => onChange(presetLayout(platform, 'split'))} disabled={disabled}>
            Split Story
          </button>
        </div>
      </div>

      <div className="shorts-layout-editor-workspace">
        <div className="shorts-layout-preview-column">
          <div
            ref={canvasRef}
            className={`shorts-layout-canvas background-${value.backgroundStyle}`}
            aria-label={`${platform === 'youtube' ? 'YouTube' : 'TikTok'} Short Vorschau`}
          >
            <div className="shorts-layout-safe-area" />
            {elementMeta.map((meta) => {
              const element = value.elements[meta.id];
              if (!element.visible && selected !== meta.id) return null;
              const style: React.CSSProperties = {
                left: `${(element.x / 1080) * 100}%`,
                top: `${(element.y / 1920) * 100}%`,
                width: `${(element.width / 1080) * 100}%`,
                height: `${(element.height / 1920) * 100}%`,
                opacity: element.visible ? 1 : 0.28,
                borderColor:
                  meta.kind === 'media' && 'borderWidth' in element && element.borderWidth > 0
                    ? value.accentColor
                    : undefined,
                borderWidth:
                  meta.kind === 'media' && 'borderWidth' in element ? `${Math.max(0, element.borderWidth / 3)}px` : 0,
              };
              if (meta.kind === 'text' && 'fontSize' in element) {
                Object.assign(style, {
                  color: element.color,
                  fontFamily: fontPreview(element.fontFamily),
                  fontSize: `${element.fontSize / 10.8}cqw`,
                  fontWeight: element.fontWeight === 'regular' ? 400 : element.fontWeight === 'semibold' ? 650 : 800,
                  textAlign: element.align,
                  background:
                    element.background === 'solid'
                      ? 'rgba(5,11,20,.95)'
                      : element.background === 'glass'
                        ? 'rgba(6,16,29,.78)'
                        : 'transparent',
                  borderLeft: element.background === 'none' ? undefined : `3px solid ${value.accentColor}`,
                });
              }
              return (
                <div
                  key={meta.id}
                  className={`shorts-layout-element kind-${meta.kind} ${selected === meta.id ? 'selected' : ''} ${!element.visible ? 'hidden-preview' : ''}`}
                  style={style}
                  onPointerDown={(event) => startPointer(event, meta.id, 'move')}
                  onClick={() => setSelected(meta.id)}
                  role="button"
                  tabIndex={0}
                  aria-label={`${meta.label} verschieben`}
                >
                  {meta.id === 'sourceVideo' && (
                    <div className="shorts-layout-video-placeholder">
                      <MonitorPlay />
                      <span>YOUTUBE VIDEO</span>
                    </div>
                  )}
                  {meta.id === 'avatar' && (
                    <div className="shorts-layout-avatar-placeholder">
                      <video
                        src="/api/overlay/ai-presenters/moderator/idle"
                        muted
                        loop
                        autoPlay
                        playsInline
                        aria-label="AVA Vorschau"
                      />
                      <span>AVA</span>
                    </div>
                  )}
                  {meta.kind === 'text' && 'fontSize' in element && (
                    <span className="shorts-layout-sample-text">{sampleText(meta.id, element)}</span>
                  )}
                  {selected === meta.id && !disabled && (
                    <button
                      type="button"
                      className="shorts-layout-resize-handle"
                      aria-label={`${meta.label} skalieren`}
                      onPointerDown={(event) => startPointer(event, meta.id, 'resize')}
                    />
                  )}
                </div>
              );
            })}
            {platform === 'youtube' && value.brandingOverlayVisible && brandingOverlayUrl && (
              <img className="shorts-layout-branding-preview" src={brandingOverlayUrl} alt="PNG-Branding" />
            )}
          </div>
          <div className="shorts-layout-preview-note">
            <Move size={14} /> 1080 × 1920 · Sicherheitslinien werden nicht mitgerendert
          </div>
        </div>

        <div className="shorts-layout-inspector">
          <div className="shorts-layout-layer-list">
            <div className="shorts-layout-inspector-title">
              <GripVertical size={16} /> Ebenen
            </div>
            {elementMeta.map((meta) => {
              const Icon = meta.icon;
              const element = value.elements[meta.id];
              return (
                <div className={`shorts-layout-layer ${selected === meta.id ? 'selected' : ''}`} key={meta.id}>
                  <button type="button" onClick={() => setSelected(meta.id)}>
                    <Icon size={15} />
                    <span>
                      <strong>{meta.label}</strong>
                      <small>{meta.hint}</small>
                    </span>
                  </button>
                  <button
                    type="button"
                    className="shorts-layout-visibility"
                    aria-label={`${meta.label} ${element.visible ? 'ausblenden' : 'einblenden'}`}
                    onClick={() =>
                      onChange({
                        ...value,
                        elements: { ...value.elements, [meta.id]: { ...element, visible: !element.visible } },
                      })
                    }
                    disabled={disabled}
                  >
                    {element.visible ? <Eye size={15} /> : <EyeOff size={15} />}
                  </button>
                </div>
              );
            })}
          </div>

          <div className="shorts-layout-properties">
            <div className="shorts-layout-inspector-title">
              {selectedMeta.kind === 'media' ? <ImageIcon size={16} /> : <Type size={16} />}
              {selectedMeta.label}
              <span>
                {selectedElement.x} / {selectedElement.y} · {selectedElement.width} × {selectedElement.height}
              </span>
            </div>

            {selectedMeta.kind === 'media' && 'fit' in selectedElement ? (
              <div className="shorts-layout-choice-grid two">
                <label>
                  <span>Bildanpassung</span>
                  <select
                    value={selectedElement.fit}
                    onChange={(event) => updateElement({ fit: event.target.value as ShortsMediaElement['fit'] })}
                    disabled={disabled}
                  >
                    <option value="contain">Ganz zeigen</option>
                    <option value="cover">Fläche füllen</option>
                  </select>
                </label>
                <label>
                  <span>Rahmen</span>
                  <select
                    value={selectedElement.borderWidth}
                    onChange={(event) => updateElement({ borderWidth: Number(event.target.value) })}
                    disabled={disabled}
                  >
                    <option value="0">Kein Rahmen</option>
                    <option value="2">Fein</option>
                    <option value="4">Standard</option>
                    <option value="8">Kräftig</option>
                    <option value="12">Statement</option>
                  </select>
                </label>
              </div>
            ) : null}

            {selectedMeta.kind === 'text' && 'fontSize' in selectedElement ? (
              <>
                {selected === 'formatLabel' && (
                  <label className="shorts-layout-field">
                    <span>Fester Text</span>
                    <input
                      value={selectedElement.text || ''}
                      maxLength={80}
                      onChange={(event) => updateElement({ text: event.target.value })}
                      disabled={disabled}
                    />
                  </label>
                )}
                <div className="shorts-layout-choice-grid two">
                  <label>
                    <span>Schriftart</span>
                    <select
                      value={selectedElement.fontFamily}
                      onChange={(event) =>
                        updateElement({ fontFamily: event.target.value as ShortsTextElement['fontFamily'] })
                      }
                      disabled={disabled}
                    >
                      {fontOptions.map((font) => (
                        <option value={font.value} key={font.value}>
                          {font.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>Schriftgröße</span>
                    <select
                      value={selectedElement.fontSize}
                      onChange={(event) => updateElement({ fontSize: Number(event.target.value) })}
                      disabled={disabled}
                    >
                      {[18, 20, 24, 28, 30, 32, 36, 42, 48, 56, 64, 72, 84, 96, 112].map((size) => (
                        <option value={size} key={size}>
                          {size} px
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>Stärke</span>
                    <select
                      value={selectedElement.fontWeight}
                      onChange={(event) =>
                        updateElement({ fontWeight: event.target.value as ShortsTextElement['fontWeight'] })
                      }
                      disabled={disabled}
                    >
                      <option value="regular">Normal</option>
                      <option value="semibold">Halbfett</option>
                      <option value="bold">Fett</option>
                    </select>
                  </label>
                  <label>
                    <span>Textfläche</span>
                    <select
                      value={selectedElement.background}
                      onChange={(event) =>
                        updateElement({ background: event.target.value as ShortsTextElement['background'] })
                      }
                      disabled={disabled}
                    >
                      <option value="none">Transparent</option>
                      <option value="glass">Studio-Glas</option>
                      <option value="solid">Deckend dunkel</option>
                    </select>
                  </label>
                </div>
                <div className="shorts-layout-property-group">
                  <span>Ausrichtung</span>
                  <div className="shorts-layout-segmented">
                    {[
                      ['left', AlignLeft, 'Links'],
                      ['center', AlignCenter, 'Mittig'],
                      ['right', AlignRight, 'Rechts'],
                    ].map(([alignment, Icon, label]) => (
                      <button
                        type="button"
                        key={String(alignment)}
                        className={selectedElement.align === alignment ? 'selected' : ''}
                        onClick={() => updateElement({ align: alignment as ShortsTextElement['align'] })}
                        disabled={disabled}
                      >
                        <Icon size={15} /> {String(label)}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="shorts-layout-property-group">
                  <span>Textfarbe</span>
                  <div className="shorts-layout-color-list">
                    {colors.map((color) => (
                      <button
                        type="button"
                        key={color}
                        style={{ background: color }}
                        className={selectedElement.color === color ? 'selected' : ''}
                        onClick={() => updateElement({ color })}
                        disabled={disabled}
                        aria-label={`Textfarbe ${color}`}
                      />
                    ))}
                  </div>
                </div>
              </>
            ) : null}

            <div className="shorts-layout-position-actions">
              <button type="button" onClick={() => updateElement({ x: 0 })} disabled={disabled}>
                Links
              </button>
              <button
                type="button"
                onClick={() => updateElement({ x: Math.round((1080 - selectedElement.width) / 2) })}
                disabled={disabled}
              >
                Zentrieren
              </button>
              <button
                type="button"
                onClick={() => updateElement({ x: 1080 - selectedElement.width })}
                disabled={disabled}
              >
                Rechts
              </button>
              <button
                type="button"
                onClick={() =>
                  onChange({
                    ...value,
                    elements: {
                      ...value.elements,
                      [selected]: { ...defaultShortsLayout(platform).elements[selected] },
                    },
                  })
                }
                disabled={disabled}
              >
                <RotateCcw size={14} /> Ebene zurücksetzen
              </button>
            </div>
          </div>

          <div className="shorts-layout-global">
            <div className="shorts-layout-inspector-title">
              <LayoutTemplate size={16} /> Gesamtstil
            </div>
            <div className="shorts-layout-choice-grid two">
              <label>
                <span>Hintergrund</span>
                <select
                  value={value.backgroundStyle}
                  onChange={(event) =>
                    onChange({ ...value, backgroundStyle: event.target.value as ShortsLayoutConfig['backgroundStyle'] })
                  }
                  disabled={disabled}
                >
                  <option value="blur">Video Blur</option>
                  <option value="studio">Studio Dark</option>
                  <option value="clean">Clean Kontrast</option>
                </select>
              </label>
              {platform === 'youtube' && (
                <label>
                  <span>PNG-Branding</span>
                  <select
                    value={value.brandingOverlayVisible ? 'visible' : 'hidden'}
                    onChange={(event) =>
                      onChange({ ...value, brandingOverlayVisible: event.target.value === 'visible' })
                    }
                    disabled={disabled}
                  >
                    <option value="visible">Einblenden</option>
                    <option value="hidden">Ausblenden</option>
                  </select>
                </label>
              )}
            </div>
            <div className="shorts-layout-property-group">
              <span>Akzentfarbe</span>
              <div className="shorts-layout-color-list">
                {accentColors.map((color) => (
                  <button
                    type="button"
                    key={color}
                    style={{ background: color }}
                    className={value.accentColor === color ? 'selected' : ''}
                    onClick={() => onChange({ ...value, accentColor: color })}
                    disabled={disabled}
                    aria-label={`Akzentfarbe ${color}`}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
