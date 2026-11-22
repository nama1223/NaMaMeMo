import { useState, useEffect } from 'react';
// =====================================================================
// ▼ 実際の環境（GitHub等）で使用する際は、以下の2行を有効にしてください ▼
// （このチャット画面(Canvas)上でのエラーを防ぐためだけの一時的なダミーです）
// =====================================================================
 import { supabase } from '../supabaseClient';
 import RichEditor from './RichEditor';
 import CommentSection from './CommentSection';


export default function PublicViewer({ rootId }) {
  const [nodes, setNodes] = useState([]);
  const [activeNode, setActiveNode] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [fileViewer, setFileViewer] = useState(null); // ★ 添付ファイル閲覧用
  const [commentInfo, setCommentInfo] = useState(null); // コメント設定 { mode, admin_name }（オフや取得失敗なら欄ごと出さない）

  // ── レスポンシブ＆メニュー開閉状態 ──
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);
  const [isTreeOpen, setIsTreeOpen] = useState(window.innerWidth > 768);

  // ── ツリーの開閉状態（nullは未初期化。初期はルートだけ開き、以後は端末に保存） ──
  const [expandedIds, setExpandedIds] = useState(null);
  // ── サイドバーの幅（端末に保存） ──
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = parseInt(localStorage.getItem('namamemo-public-sidebar-width') || '', 10);
    return Number.isFinite(saved) ? Math.min(520, Math.max(180, saved)) : 260;
  });

  useEffect(() => {
    const handleResize = () => {
      const mobile = window.innerWidth <= 768;
      setIsMobile(mobile);
      if (!mobile) setIsTreeOpen(true);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    const fetchPublicTree = async () => {
      setLoading(true);
      setError(null);
      
      try {
        const { data, error: rpcError } = await supabase.rpc('get_public_tree', { p_root_id: rootId });
        
        if (rpcError) {
          setError(`データベースエラー: ${rpcError.message}`);
        } else if (!data || data.length === 0) {
          setError(`このページは存在しないか、公開が停止されています。（対象ID: ${rootId}）`);
        } else {
          setNodes(data);
          let initialExpanded = null;
          try {
            const saved = JSON.parse(localStorage.getItem(`namamemo-public-tree-open:${rootId}`) || 'null');
            if (Array.isArray(saved)) initialExpanded = saved.filter(id => data.some(n => n.id === id));
          } catch (e) { /* 保存データが読めなくても続行する */ }
          // 初期状態はフルオープン（子を持つノードを全部開く）。開閉できる事に気づかず
          // 中身をスルーされるのを防ぐため。旧仕様（ルートだけ開く）の保存データは
          // 保存キーを変えたので引き継がず、新しい初期状態が全員に一度は効く
          const allParents = data.filter(n => data.some(c => c.parent_id === n.id)).map(n => n.id);
          setExpandedIds(new Set(initialExpanded !== null ? initialExpanded : allParents));
          const root = data.find(n => n.id === rootId);
          setActiveNode(root || data[0]);
        }
      } catch (err) {
        setError(`通信エラーが発生しました: ${err.message}`);
      } finally {
        setLoading(false);
      }
    };
    
    if (rootId) fetchPublicTree();
  }, [rootId]);

  // コメント設定の取得（オフ＝機能の存在自体を見せない）
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase.rpc('get_public_comment_info', { p_root_id: rootId });
      if (cancelled) return;
      if (error || !data || data.mode === 'off') setCommentInfo(null);
      else setCommentInfo(data);
    })();
    return () => { cancelled = true; };
  }, [rootId]);

  // ★ 添付ファイルを開くためのイベントリスナー（音声リスナーはRichEditor側に統合しました）
  useEffect(() => {
    // テキストファイルなどを開く処理
    const handleFileOpen = (e) => setFileViewer(e.detail);
    document.addEventListener('file-attachment-open', handleFileOpen);
    
    return () => {
      document.removeEventListener('file-attachment-open', handleFileOpen);
    };
  }, []);

  const handleNodeSelect = (node) => {
    setActiveNode(node);
    if (isMobile) setIsTreeOpen(false);
  };

  const toggleExpand = (id) => {
    setExpandedIds(prev => {
      const next = new Set(prev || []);
      if (next.has(id)) next.delete(id); else next.add(id);
      try { localStorage.setItem(`namamemo-public-tree-open:${rootId}`, JSON.stringify([...next])); } catch (e) { /* 保存できなくても続行する */ }
      return next;
    });
  };

  const handleResizeStart = (e) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = sidebarWidth;
    const onMove = (ev) => {
      setSidebarWidth(Math.min(520, Math.max(180, startW + (ev.clientX - startX))));
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      setSidebarWidth(w => {
        try { localStorage.setItem('namamemo-public-sidebar-width', String(w)); } catch (err) { /* 保存できなくても続行する */ }
        return w;
      });
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  if (loading) {
    return (
      <div style={{ position: 'fixed', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f7f7f8' }}>
        <div style={{ fontSize: 16, color: '#888' }}>⏳ 読み込み中...</div>
      </div>
    );
  }
  
  if (error) {
    return (
      <div style={{ position: 'fixed', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f7f7f8', padding: 20 }}>
        <div style={{ fontSize: 15, color: '#dc2626', fontWeight: 'bold', textAlign: 'center', lineHeight: 1.6 }}>
          ⚠️ エラーが発生しました<br/>
          <span style={{ fontSize: 13, color: '#666', fontWeight: 'normal' }}>{error}</span>
        </div>
      </div>
    );
  }

  const renderTree = (parentId) => {
    if (!expandedIds || !expandedIds.has(parentId)) return null;
    const children = nodes.filter(n => n.parent_id === parentId).sort((a, b) => a.position - b.position);
    if (children.length === 0) return null;

    return (
      <div style={{ marginLeft: 8, borderLeft: '1px solid #e5e5e7', paddingLeft: 6, marginTop: 2 }}>
        {children.map(node => {
          const hasKids = nodes.some(n => n.parent_id === node.id);
          const isOpen = expandedIds.has(node.id);
          return (
            <div key={node.id}>
              <div style={{
                display: 'flex', alignItems: 'flex-start', gap: 2,
                background: activeNode?.id === node.id ? '#e2e8f0' : 'transparent',
                borderRadius: 6, marginBottom: 2
              }}>
                {hasKids ? (
                  <button
                    onClick={(e) => { e.stopPropagation(); toggleExpand(node.id); }}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', width: 38, marginLeft: -22, paddingRight: 4, textAlign: 'right', fontSize: 13, fontWeight: 'bold', color: isOpen ? '#5b6af0' : '#a8a8ae', flexShrink: 0, lineHeight: 1.4 }}
                    title={isOpen ? 'たたむ' : 'ひらく'}
                  >{isOpen ? '▾' : '▸'}</button>
                ) : (
                  <span style={{ width: 16, flexShrink: 0 }} />
                )}
                <div
                  style={{
                    padding: '5px 6px 5px 0',
                    cursor: 'pointer',
                    color: activeNode?.id === node.id ? '#1a1a1a' : '#4a4a4a',
                    fontSize: 14,
                    lineHeight: 1.35,
                    whiteSpace: 'normal',
                    wordBreak: 'break-word',
                    flex: 1, minWidth: 0
                  }}
                  onClick={() => handleNodeSelect(node)}
                  title={node.title || '無題のメモ'}
                >
                  {node.title || '無題のメモ'}
                </div>
              </div>
              {renderTree(node.id)}
            </div>
          );
        })}
      </div>
    );
  };

  const rootNode = nodes.find(n => n.id === rootId);

  // 幅ドラッグの目印（中央に小さな ◀▶ のツマミを表示）
  const gripPillStyle = {
    position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
    background: '#ffffff', border: '1px solid #d9d9de', borderRadius: 6,
    padding: '5px 2px', fontSize: 8, lineHeight: 1.15, color: '#9a9aa0',
    textAlign: 'center', boxShadow: '0 1px 3px rgba(0,0,0,0.14)', pointerEvents: 'none'
  };

  const sidebarStyle = isMobile ? {
    position: 'fixed',
    top: 0, left: 0, bottom: 0,
    width: sidebarWidth, maxWidth: '88vw',
    background: '#f1f1f3',
    zIndex: 50,
    transform: isTreeOpen ? 'translateX(0)' : 'translateX(-100%)',
    transition: 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
    boxShadow: isTreeOpen ? '4px 0 24px rgba(0,0,0,0.15)' : 'none',
    borderRight: '1px solid #e5e5e7',
    overflowY: 'auto',
    overflowX: 'auto',
    padding: 14
  } : {
    display: isTreeOpen ? 'block' : 'none',
    position: 'relative',
    width: sidebarWidth,
    height: '100%',
    background: '#f1f1f3',
    borderRight: '1px solid #e5e5e7',
    overflowY: 'auto',
    overflowX: 'auto',
    padding: 12,
    flexShrink: 0
  };

  return (
    <div style={{ position: 'fixed', inset: 0, display: 'flex', background: '#f7f7f8', fontFamily: 'sans-serif', overflow: 'hidden',
      // CSS変数をここで定義（RichEditorのスタイルが参照する）
      '--bg': '#ffffff', '--surface': '#f7f7f8', '--border': '#e5e5e7',
      '--text': '#1a1a1a', '--text-muted': '#8e8e93',
      '--accent': '#5b6af0', '--accent-bg': '#eff1fe',
    }}>
      
      {isMobile && (
        <div 
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
            zIndex: 40, opacity: isTreeOpen ? 1 : 0, pointerEvents: isTreeOpen ? 'auto' : 'none',
            transition: 'opacity 0.3s ease'
          }}
          onClick={() => setIsTreeOpen(false)}
        />
      )}

      {/* ── 左サイドバー（公開ツリー） ── */}
      <div style={sidebarStyle}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <h3 style={{ margin: 0, fontSize: 12, color: '#888', textTransform: 'uppercase', letterSpacing: 1 }}>公開されたメモ</h3>
          {isMobile && (
            <button 
              onClick={() => setIsTreeOpen(false)}
              style={{ background: 'none', border: 'none', fontSize: 20, color: '#888', cursor: 'pointer', padding: '0 4px' }}
            >
              ✕
            </button>
          )}
        </div>

        {rootNode && (
          <div>
            <div
              style={{
                display: 'flex', alignItems: 'flex-start', gap: 2,
                padding: '8px 8px 8px 4px',
                background: activeNode?.id === rootNode.id ? '#e2e8f0' : 'white',
                border: '1px solid #e5e5e7',
                borderRadius: 8,
                marginBottom: 4,
                boxShadow: activeNode?.id === rootNode.id ? 'none' : '0 1px 2px rgba(0,0,0,0.05)'
              }}
            >
              {nodes.some(n => n.parent_id === rootNode.id) ? (
                <button
                  onClick={(e) => { e.stopPropagation(); toggleExpand(rootNode.id); }}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', width: 36, marginLeft: -16, paddingRight: 4, textAlign: 'right', fontSize: 13, fontWeight: 'bold', color: expandedIds?.has(rootNode.id) ? '#5b6af0' : '#a8a8ae', flexShrink: 0, lineHeight: 1.4 }}
                  title={expandedIds?.has(rootNode.id) ? 'たたむ' : 'ひらく'}
                >{expandedIds?.has(rootNode.id) ? '▾' : '▸'}</button>
              ) : (
                <span style={{ width: 20, flexShrink: 0 }} />
              )}
              <div
                style={{ cursor: 'pointer', color: '#1a1a1a', fontWeight: 'bold', fontSize: 15, lineHeight: 1.35, whiteSpace: 'normal', wordBreak: 'break-word', flex: 1, minWidth: 0 }}
                onClick={() => handleNodeSelect(rootNode)}
                title={rootNode.title || '無題のメモ'}
              >
                🌐 {rootNode.title || '無題のメモ'}
              </div>
            </div>
            {renderTree(rootNode.id)}
          </div>
        )}
      </div>

      {/* ── サイドバーの幅リサイズ（右端をドラッグ） ── */}
      {!isMobile && isTreeOpen && (
        <div
          onPointerDown={handleResizeStart}
          style={{ width: 12, marginLeft: -6, flexShrink: 0, cursor: 'col-resize', touchAction: 'none', zIndex: 20, position: 'relative' }}
          title="ドラッグでメニューの幅を変更"
        >
          <div style={gripPillStyle}>
            <div>◀</div>
            <div>▶</div>
          </div>
        </div>
      )}
      {isMobile && isTreeOpen && (
        <div
          onPointerDown={handleResizeStart}
          style={{ position: 'fixed', top: 0, bottom: 0, left: Math.min(sidebarWidth, window.innerWidth * 0.88) - 7, width: 14, cursor: 'col-resize', touchAction: 'none', zIndex: 60 }}
        >
          <div style={gripPillStyle}>
            <div>◀</div>
            <div>▶</div>
          </div>
        </div>
      )}

      {/* ── メインエディタエリア (読み取り専用) ── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: 'white', minWidth: 0 }}>
        {/* ヘッダーエリア */}
        <div style={{ 
          padding: isMobile ? '12px 16px' : '20px 32px 16px', 
          borderBottom: '1px solid #e5e5e7', 
          background: 'white', 
          zIndex: 10,
          display: 'flex',
          alignItems: 'center',
          gap: 12
        }}>
          <button
            onClick={() => setIsTreeOpen(!isTreeOpen)}
            style={{
              background: '#f1f1f3', border: '1px solid #e5e5e7', borderRadius: 8,
              width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', flexShrink: 0, color: '#4a4a4a', transition: 'background 0.2s'
            }}
            title="メニューを開閉"
          >
            <span style={{ fontSize: 16 }}>{isTreeOpen && !isMobile ? '◀' : '☰'}</span>
          </button>
          
          <h1 style={{ margin: 0, fontSize: isMobile ? 20 : 26, color: '#1a1a1a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {activeNode?.title || '無題のメモ'}
          </h1>
        </div>

        {/* コンテンツエリア */}
        <div style={{ flex: 1, overflowY: 'auto', position: 'relative' }}>
          {activeNode ? (
            <RichEditor 
              node={activeNode} 
              onUpdateContent={() => {}} 
              toolbarCollapsed={true} 
              settings={{ defaultFontSize: 15, lineHeight: 1.6, enabledToolbarItems: [] }} 
              readOnly={true} 
            />
          ) : null}
          {commentInfo && activeNode ? (
            <CommentSection
              key={activeNode.id}
              rootId={rootId}
              nodeId={activeNode.id}
              mode={commentInfo.mode}
              adminName={commentInfo.admin_name}
            />
          ) : null}
        </div>
      </div>

      {/* ── 添付テキストファイルのビューアー ── */}
      {fileViewer && (
        <div style={styles.fileViewerOverlay} onClick={() => setFileViewer(null)}>
          <div style={styles.fileViewer} onClick={e=>e.stopPropagation()}>
            <div style={styles.fileViewerHeader}>
              <span style={styles.fileViewerTitle}>📄 {fileViewer.filename}</span>
              <button style={styles.fileViewerClose} onClick={() => setFileViewer(null)}>✕</button>
            </div>
            <pre style={styles.fileViewerContent}>{fileViewer.content}</pre>
          </div>
        </div>
      )}
    </div>
  );
}

const styles = {
  fileViewerOverlay: { position:'fixed', inset:0, background:'rgba(0,0,0,0.6)', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center' },
  fileViewer: { background:'#fff', borderRadius:12, width:'80vw', maxWidth:640, maxHeight:'80vh', display:'flex', flexDirection:'column', boxShadow:'0 16px 48px rgba(0,0,0,0.3)', overflow:'hidden' },
  fileViewerHeader: { display:'flex', alignItems:'center', justifyContent:'space-between', padding:'12px 16px', borderBottom:'1px solid #eee', flexShrink:0 },
  fileViewerTitle: { fontSize:14, fontWeight:600, color:'#111', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' },
  fileViewerClose: { background:'none', border:'none', fontSize:15, cursor:'pointer', color:'#888', width:28, height:28, borderRadius:4, flexShrink:0 },
  fileViewerContent: { flex:1, overflowY:'auto', padding:'16px', margin:0, fontSize:12, lineHeight:1.6, fontFamily:'ui-monospace,SFMono-Regular,monospace', color:'#111', whiteSpace:'pre-wrap', wordBreak:'break-all', background:'#f9f9f9' },
};