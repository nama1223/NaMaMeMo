import { useState, useEffect } from 'react';
// =====================================================================
// ▼ 実際の環境（GitHub等）で使用する際は、以下の2行を有効にしてください ▼
// （このチャット画面(Canvas)上でのエラーを防ぐためだけの一時的なダミーです）
// =====================================================================
 import { supabase } from '../supabaseClient';
 import RichEditor from './RichEditor';


export default function PublicViewer({ rootId }) {
  const [nodes, setNodes] = useState([]);
  const [activeNode, setActiveNode] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [fileViewer, setFileViewer] = useState(null); // ★ 添付ファイル閲覧用

  // ── レスポンシブ＆メニュー開閉状態 ──
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);
  const [isTreeOpen, setIsTreeOpen] = useState(window.innerWidth > 768);

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

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#f7f7f8' }}>
        <div style={{ fontSize: 16, color: '#888' }}>⏳ 読み込み中...</div>
      </div>
    );
  }
  
  if (error) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#f7f7f8', padding: 20 }}>
        <div style={{ fontSize: 15, color: '#dc2626', fontWeight: 'bold', textAlign: 'center', lineHeight: 1.6 }}>
          ⚠️ エラーが発生しました<br/>
          <span style={{ fontSize: 13, color: '#666', fontWeight: 'normal' }}>{error}</span>
        </div>
      </div>
    );
  }

  const renderTree = (parentId) => {
    const children = nodes.filter(n => n.parent_id === parentId).sort((a, b) => a.position - b.position);
    if (children.length === 0) return null;
    
    return (
      <div style={{ marginLeft: 16, borderLeft: '1px solid #e5e5e7', paddingLeft: 8, marginTop: 4 }}>
        {children.map(node => (
          <div key={node.id}>
            <div 
              style={{ 
                padding: '8px 10px', 
                cursor: 'pointer', 
                background: activeNode?.id === node.id ? '#e2e8f0' : 'transparent',
                color: activeNode?.id === node.id ? '#1a1a1a' : '#4a4a4a',
                borderRadius: 6,
                marginBottom: 2,
                fontSize: 14,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis'
              }}
              onClick={() => handleNodeSelect(node)}
            >
              📄 {node.title || '無題のメモ'}
            </div>
            {renderTree(node.id)}
          </div>
        ))}
      </div>
    );
  };

  const rootNode = nodes.find(n => n.id === rootId);

  const sidebarStyle = isMobile ? {
    position: 'fixed',
    top: 0, left: 0, bottom: 0,
    width: 280, maxWidth: '85vw',
    background: '#f1f1f3',
    zIndex: 50,
    transform: isTreeOpen ? 'translateX(0)' : 'translateX(-100%)',
    transition: 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
    boxShadow: isTreeOpen ? '4px 0 24px rgba(0,0,0,0.15)' : 'none',
    borderRight: '1px solid #e5e5e7',
    overflowY: 'auto',
    padding: 20
  } : {
    display: isTreeOpen ? 'block' : 'none',
    width: 260,
    height: '100vh',
    background: '#f1f1f3',
    borderRight: '1px solid #e5e5e7',
    overflowY: 'auto',
    padding: 16,
    flexShrink: 0
  };

  return (
    <div style={{ display: 'flex', height: '100vh', width: '100vw', background: '#f7f7f8', fontFamily: 'sans-serif', overflow: 'hidden',
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
                padding: '10px 12px', 
                cursor: 'pointer', 
                background: activeNode?.id === rootNode.id ? '#e2e8f0' : 'white',
                border: '1px solid #e5e5e7',
                color: '#1a1a1a',
                borderRadius: 8,
                fontWeight: 'bold',
                marginBottom: 4,
                fontSize: 15,
                boxShadow: activeNode?.id === rootNode.id ? 'none' : '0 1px 2px rgba(0,0,0,0.05)'
              }}
              onClick={() => handleNodeSelect(rootNode)}
            >
              🌐 {rootNode.title || '無題のメモ'}
            </div>
            {renderTree(rootNode.id)}
          </div>
        )}
      </div>

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