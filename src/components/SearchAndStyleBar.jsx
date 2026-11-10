import React, { useState, useRef, useEffect } from 'react';

// エディタ側と共通のカラーパレット
const COLORS = ['#1a1a1a','#e53e3e','#dd6b20','#d69e2e','#38a169','#3182ce','#805ad5','#d53f8c'];
const HIGHLIGHTS = ['transparent', '#fefcbf','#fed7d7','#c6f6d5','#bee3f8','#e9d8fd','#fbb6ce','#e2e8f0'];

export default function SearchAndStyleBar({ 
  searchQuery, 
  onSearchChange, 
  selectedNode, 
  onUpdateNodeStyle 
}) {
  const [showPalette, setShowPalette] = useState(false);
  const paletteRef = useRef(null);

  // パレットの外をクリックしたら閉じる処理
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (paletteRef.current && !paletteRef.current.contains(e.target)) {
        setShowPalette(false);
      }
    };
    if (showPalette) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showPalette]);

  // ON/OFFを切り替えるスタイル（太字など）
  const toggleStyle = (key) => {
    if (!selectedNode) return;
    const currentStyle = selectedNode.title_style || {};
    onUpdateNodeStyle(selectedNode.id, {
      ...currentStyle,
      [key]: !currentStyle[key]
    });
  };

  // 値を直接セットするスタイル（色など）
  const setStyleValue = (key, value) => {
    if (!selectedNode) return;
    const currentStyle = selectedNode.title_style || {};
    onUpdateNodeStyle(selectedNode.id, {
      ...currentStyle,
      [key]: value
    });
  };

  const currentStyle = selectedNode?.title_style || {};

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px', borderBottom: '1px solid var(--border)' }}>
      {/* 検索ボックス */}
      <div style={{ position: 'relative', flex: 1 }}>
        <span style={{ position: 'absolute', left: '8px', top: '50%', transform: 'translateY(-50%)', fontSize: '13px', color: 'var(--text-muted)' }}>🔍</span>
        <input 
          type="text" 
          placeholder="ノードを検索..." 
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          style={{ 
            width: '100%', padding: '6px 28px', fontSize: '13px', border: '1px solid var(--border)', 
            borderRadius: '6px', background: 'var(--surface)', color: 'var(--text)', outline: 'none', 
            boxSizing: 'border-box', transition: 'border-color 0.2s'
          }}
          onFocus={e => e.target.style.borderColor = 'var(--accent)'}
          onBlur={e => e.target.style.borderColor = 'var(--border)'}
        />
        {searchQuery && (
          <button 
            onClick={() => onSearchChange('')}
            style={{ position: 'absolute', right: '4px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '12px', padding: '4px' }}
          >✕</button>
        )}
      </div>
      
      {/* 装飾パレット */}
      <div style={{ position: 'relative' }} ref={paletteRef}>
        <button 
          onClick={() => setShowPalette(!showPalette)}
          disabled={!selectedNode}
          title={selectedNode ? "選択中のノードを装飾" : "ノードを選択してください"}
          style={{ 
            background: showPalette ? 'var(--accent)' : 'var(--surface)', 
            color: showPalette ? 'white' : 'var(--text)',
            border: '1px solid var(--border)', 
            borderRadius: '6px', 
            width: '32px', 
            height: '32px', 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'center', 
            cursor: selectedNode ? 'pointer' : 'not-allowed',
            opacity: selectedNode ? 1 : 0.5,
            transition: 'all 0.2s',
            fontSize: '15px',
            padding: 0
          }}
        >
          🎨
        </button>

        {showPalette && selectedNode && (
          <div style={{ 
            position: 'absolute', top: '100%', right: 0, marginTop: '8px', background: 'var(--bg)', 
            border: '1px solid var(--border)', borderRadius: '8px', padding: '12px', width: '200px', 
            boxShadow: '0 4px 24px rgba(0,0,0,0.15)', zIndex: 1000 
          }}>
            
            {/* テキストスタイル (太字, 斜体, 下線, 取消線) */}
            <div style={{ display: 'flex', gap: '4px', marginBottom: '12px', paddingBottom: '12px', borderBottom: '1px solid var(--border)' }}>
              <StyleBtn active={currentStyle.bold} onClick={() => toggleStyle('bold')} style={{fontWeight: 900}}>B</StyleBtn>
              <StyleBtn active={currentStyle.italic} onClick={() => toggleStyle('italic')} style={{fontStyle: 'italic', fontWeight: 700}}>I</StyleBtn>
              <StyleBtn active={currentStyle.underline} onClick={() => toggleStyle('underline')} style={{textDecoration: 'underline'}}>U</StyleBtn>
              <StyleBtn active={currentStyle.strike} onClick={() => toggleStyle('strike')} style={{textDecoration: 'line-through'}}>S</StyleBtn>
            </div>

            {/* 文字色 */}
            <div style={{ marginBottom: '12px' }}>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '6px', fontWeight: 600 }}>文字色</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                <ColorBtn 
                  color="var(--text)" 
                  active={!currentStyle.color} 
                  onClick={() => setStyleValue('color', null)} 
                  label="自" 
                />
                {COLORS.map(c => (
                  <ColorBtn key={c} color={c} active={currentStyle.color === c} onClick={() => setStyleValue('color', c)} />
                ))}
              </div>
            </div>

            {/* ハイライト */}
            <div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '6px', fontWeight: 600 }}>ハイライト</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                <ColorBtn 
                  color="transparent" 
                  active={!currentStyle.highlight} 
                  onClick={() => setStyleValue('highlight', null)} 
                  label="無" 
                />
                {HIGHLIGHTS.filter(c => c !== 'transparent').map(c => (
                  <ColorBtn key={c} color={c} active={currentStyle.highlight === c} onClick={() => setStyleValue('highlight', c)} />
                ))}
              </div>
            </div>

          </div>
        )}
      </div>
    </div>
  );
}

function StyleBtn({ active, onClick, children, style }) {
  return (
    <button 
      onClick={onClick}
      style={{ 
        flex: 1, height: '28px', background: active ? 'var(--accent)' : 'var(--surface)', color: active ? 'white' : 'var(--text)', 
        border: active ? 'none' : '1px solid var(--border)', borderRadius: '4px', cursor: 'pointer', fontSize: '13px', 
        display: 'flex', alignItems: 'center', justifyContent: 'center', ...style 
      }}
    >
      {children}
    </button>
  );
}

function ColorBtn({ color, active, onClick, label }) {
  return (
    <button 
      onClick={onClick}
      style={{ 
        width: '20px', height: '20px', background: color, border: color === 'transparent' ? '1px dashed var(--border)' : '1px solid rgba(0,0,0,0.1)',
        borderRadius: '3px', cursor: 'pointer', outline: active ? '2px solid var(--accent)' : 'none', outlineOffset: '1px',
        display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', fontWeight: 900, 
        color: color === 'var(--text)' || color === '#1a1a1a' ? 'var(--bg)' : 'var(--text-muted)'
      }}
    >
      {label}
    </button>
  );
}