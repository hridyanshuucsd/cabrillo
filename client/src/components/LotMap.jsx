import React from 'react';

// A simple drawn map of the fictional north lot. Layers are overlays on the same drawing.
const B = { fill: '#c5d0d8', rx: 7 };
const label = { fontSize: 11, fontWeight: 700, fill: '#2e3f4a' };
const filled = [0, 1, 3, 4, 9, 12, 13, 17, 20];

export default function LotMap({ layer }) {
  return (
    <div className="map">
      <svg viewBox="0 0 350 230" width="100%" height="100%" role="img" aria-label={`Map of the north lot showing ${layer}`}>
        <defs>
          <pattern id="hatch" width="12" height="12" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="12" height="12" fill="rgba(232,163,61,0.14)" /><rect width="6" height="12" fill="rgba(232,163,61,0.3)" />
          </pattern>
          <radialGradient id="hot"><stop offset="0" stopColor="rgba(200,50,40,0.55)" /><stop offset="1" stopColor="rgba(200,50,40,0)" /></radialGradient>
          <radialGradient id="warm"><stop offset="0" stopColor="rgba(232,163,61,0.55)" /><stop offset="1" stopColor="rgba(232,163,61,0)" /></radialGradient>
          <radialGradient id="loud"><stop offset="0" stopColor="rgba(122,79,214,0.5)" /><stop offset="1" stopColor="rgba(122,79,214,0)" /></radialGradient>
        </defs>
        <rect x="0" y="112" width="350" height="14" fill="#f7f9fa" />
        <rect x="160" y="0" width="14" height="230" fill="#f7f9fa" />
        <rect x="12" y="10" width="136" height="92" {...B} /><text x="20" y="27" style={label}>Library</text>
        <rect x="186" y="10" width="152" height="46" {...B} /><text x="194" y="27" style={label}>Lecture hall</text>
        <rect x="186" y="62" width="152" height="40" {...B} /><text x="194" y="79" style={label}>Student center</text>
        <rect x="12" y="136" width="100" height="84" {...B} /><text x="20" y="153" style={label}>Dining hall</text>
        {[[130, 140], [146, 158], [128, 178], [146, 196], [130, 214]].map(([x, y], i) => <circle key={i} cx={x} cy={y} r="7" fill="#7db59f" />)}
        <rect x="186" y="136" width="152" height="84" rx="10" fill="url(#hatch)" stroke="#b8741a" strokeWidth="2" strokeDasharray="6 4" />
        <text x="194" y="152" style={{ ...label, fill: '#6b3a05', fontWeight: 800 }}>North lot</text>

        {layer === 'traffic' && <g>
          <circle cx="167" cy="119" r="62" fill="url(#hot)" /><circle cx="75" cy="119" r="50" fill="url(#warm)" /><ellipse cx="262" cy="130" rx="60" ry="30" fill="url(#hot)" />
        </g>}
        {layer === 'shade' && <g>
          <rect x="116" y="130" width="60" height="100" rx="18" fill="rgba(11,122,110,0.34)" />
          <rect x="186" y="136" width="46" height="84" rx="8" fill="rgba(11,122,110,0.3)" />
        </g>}
        {layer === 'parking' && <g>
          {Array.from({ length: 24 }, (_, i) => (
            <rect key={i} x={196 + (i % 8) * 17.5} y={162 + Math.floor(i / 8) * 18} width="13" height="14" rx="2"
              fill={filled.includes(i) ? '#46525c' : '#ffffff'} stroke="#8a5a12" strokeWidth="1" />
          ))}
        </g>}
        {layer === 'noise' && <g>
          <circle cx="62" cy="178" r="80" fill="url(#loud)" /><ellipse cx="250" cy="225" rx="110" ry="30" fill="url(#loud)" />
        </g>}
      </svg>
    </div>
  );
}
