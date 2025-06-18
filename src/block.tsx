import React, { useRef, useEffect, useState, useCallback } from 'react';
import Peer from 'peerjs';

interface BlockProps {
  title?: string;
  description?: string;
}

interface DrawingData {
  x: number;
  y: number;
  prevX: number;
  prevY: number;
  color: string;
  type: 'draw' | 'start';
  userId: string;
}

interface User {
  id: string;
  color: string;
  cursor?: { x: number; y: number };
}

const COLORS = ['#FF6B6B', '#4ECDC4', '#45B7D1'];

const Block: React.FC<BlockProps> = ({ title = "Collaborative Whiteboard", description }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [selectedColor, setSelectedColor] = useState(COLORS[0]);
  const [peer, setPeer] = useState<Peer | null>(null);
  const [connections, setConnections] = useState<Map<string, any>>(new Map());
  const [users, setUsers] = useState<Map<string, User>>(new Map());
  const [isConnected, setIsConnected] = useState(false);
  const [roomId, setRoomId] = useState('');
  const [myUserId, setMyUserId] = useState('');
  const [userCursors, setUserCursors] = useState<Map<string, { x: number; y: number }>>(new Map());

  // Generate room ID based on current page
  useEffect(() => {
    const baseRoomId = window.location.href.replace(/[^a-zA-Z0-9]/g, '').substring(0, 50);
    setRoomId(`whiteboard-${baseRoomId}`);
  }, []);

  // Initialize PeerJS
  useEffect(() => {
    if (!roomId) return;

    const newPeer = new Peer({
      host: 'social.mext.app',
      port: 443,
      path: '/mext',
      key: 'mexty',
      secure: true
    });

    newPeer.on('open', (id) => {
      console.log('My peer ID is: ' + id);
      setMyUserId(id);
      setPeer(newPeer);
      setIsConnected(true);
      
      // Add myself to users
      const myUser: User = {
        id,
        color: selectedColor
      };
      setUsers(prev => new Map(prev.set(id, myUser)));

      // Try to connect to existing peers in the room
      connectToRoom(newPeer, id);
    });

    newPeer.on('connection', (conn) => {
      setupConnection(conn);
    });

    newPeer.on('error', (err) => {
      console.error('Peer error:', err);
      setIsConnected(false);
    });

    return () => {
      newPeer.destroy();
    };
  }, [roomId]);

  const connectToRoom = (peerInstance: Peer, myId: string) => {
    // In a real implementation, you'd have a signaling server
    // For now, we'll use a simple approach where peers try to connect to known IDs
    // This is a simplified version - in production you'd want a proper room management system
    
    // Try to connect to other potential peers
    const potentialPeerIds = Array.from({ length: 5 }, (_, i) => `${roomId}-${i}`);
    
    potentialPeerIds.forEach(peerId => {
      if (peerId !== myId) {
        setTimeout(() => {
          try {
            const conn = peerInstance.connect(peerId);
            if (conn) {
              setupConnection(conn);
            }
          } catch (err) {
            // Peer doesn't exist, that's fine
          }
        }, Math.random() * 1000);
      }
    });
  };

  const setupConnection = (conn: any) => {
    conn.on('open', () => {
      console.log('Connected to peer:', conn.peer);
      setConnections(prev => new Map(prev.set(conn.peer, conn)));
      
      // Send my user info
      conn.send({
        type: 'user-info',
        user: {
          id: myUserId,
          color: selectedColor
        }
      });
    });

    conn.on('data', (data: any) => {
      handleIncomingData(data, conn.peer);
    });

    conn.on('close', () => {
      console.log('Connection closed:', conn.peer);
      setConnections(prev => {
        const newConnections = new Map(prev);
        newConnections.delete(conn.peer);
        return newConnections;
      });
      setUsers(prev => {
        const newUsers = new Map(prev);
        newUsers.delete(conn.peer);
        return newUsers;
      });
    });
  };

  const handleIncomingData = (data: any, senderId: string) => {
    switch (data.type) {
      case 'drawing':
        drawOnCanvas(data.drawingData);
        break;
      case 'user-info':
        setUsers(prev => new Map(prev.set(senderId, data.user)));
        break;
      case 'cursor':
        setUserCursors(prev => new Map(prev.set(senderId, { x: data.x, y: data.y })));
        break;
      case 'clear':
        clearCanvas();
        break;
    }
  };

  const broadcastData = (data: any) => {
    connections.forEach(conn => {
      if (conn.open) {
        conn.send(data);
      }
    });
  };

  const drawOnCanvas = (drawData: DrawingData) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.strokeStyle = drawData.color;
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (drawData.type === 'start') {
      ctx.beginPath();
      ctx.moveTo(drawData.x, drawData.y);
    } else {
      ctx.beginPath();
      ctx.moveTo(drawData.prevX, drawData.prevY);
      ctx.lineTo(drawData.x, drawData.y);
      ctx.stroke();
    }
  };

  const getCanvasCoordinates = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };

    const rect = canvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
    };
  };

  const startDrawing = (e: React.MouseEvent<HTMLCanvasElement>) => {
    setIsDrawing(true);
    const coords = getCanvasCoordinates(e);
    
    const drawData: DrawingData = {
      x: coords.x,
      y: coords.y,
      prevX: coords.x,
      prevY: coords.y,
      color: selectedColor,
      type: 'start',
      userId: myUserId
    };

    drawOnCanvas(drawData);
    broadcastData({ type: 'drawing', drawingData: drawData });
  };

  const draw = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;

    const coords = getCanvasCoordinates(e);
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const prevCoords = {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
    };

    const drawData: DrawingData = {
      x: coords.x,
      y: coords.y,
      prevX: prevCoords.x,
      prevY: prevCoords.y,
      color: selectedColor,
      type: 'draw',
      userId: myUserId
    };

    drawOnCanvas(drawData);
    broadcastData({ type: 'drawing', drawingData: drawData });
  };

  const stopDrawing = () => {
    setIsDrawing(false);
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const coords = getCanvasCoordinates(e);
    broadcastData({ type: 'cursor', x: coords.x, y: coords.y });
    
    if (isDrawing) {
      draw(e);
    }
  };

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
  };

  const handleClear = () => {
    clearCanvas();
    broadcastData({ type: 'clear' });
  };

  // Send completion event on first interaction
  useEffect(() => {
    const handleFirstInteraction = () => {
      window.postMessage({ 
        type: 'BLOCK_COMPLETION', 
        blockId: '68531d5d157dfa0de308d05c', 
        completed: true 
      }, '*');
      window.parent.postMessage({ 
        type: 'BLOCK_COMPLETION', 
        blockId: '68531d5d157dfa0de308d05c', 
        completed: true 
      }, '*');
    };

    const canvas = canvasRef.current;
    if (canvas) {
      canvas.addEventListener('mousedown', handleFirstInteraction, { once: true });
      return () => canvas.removeEventListener('mousedown', handleFirstInteraction);
    }
  }, []);

  return (
    <div style={{ 
      padding: '20px', 
      fontFamily: 'Arial, sans-serif',
      maxWidth: '800px',
      margin: '0 auto'
    }}>
      <div style={{ 
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: 'center',
        marginBottom: '20px'
      }}>
        <h2 style={{ margin: 0, color: '#333' }}>{title}</h2>
        <div style={{ 
          display: 'flex', 
          alignItems: 'center', 
          gap: '15px'
        }}>
          <div style={{ 
            display: 'flex', 
            alignItems: 'center', 
            gap: '5px'
          }}>
            <div style={{ 
              width: '10px', 
              height: '10px', 
              borderRadius: '50%', 
              backgroundColor: isConnected ? '#4CAF50' : '#f44336'
            }}></div>
            <span style={{ fontSize: '14px', color: '#666' }}>
              {isConnected ? `Connected (${users.size} users)` : 'Connecting...'}
            </span>
          </div>
          <button
            onClick={handleClear}
            style={{
              padding: '8px 16px',
              backgroundColor: '#f44336',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '14px'
            }}
          >
            Clear All
          </button>
        </div>
      </div>

      <div style={{ 
        display: 'flex', 
        gap: '10px', 
        marginBottom: '20px',
        alignItems: 'center'
      }}>
        <span style={{ fontSize: '16px', fontWeight: 'bold', color: '#333' }}>Colors:</span>
        {COLORS.map((color, index) => (
          <button
            key={index}
            onClick={() => setSelectedColor(color)}
            style={{
              width: '40px',
              height: '40px',
              backgroundColor: color,
              border: selectedColor === color ? '3px solid #333' : '2px solid #ddd',
              borderRadius: '50%',
              cursor: 'pointer',
              transition: 'all 0.2s ease'
            }}
            title={`Color ${index + 1}`}
          />
        ))}
        <div style={{ 
          marginLeft: '20px',
          padding: '8px 12px',
          backgroundColor: '#f5f5f5',
          borderRadius: '4px',
          fontSize: '14px',
          color: '#666'
        }}>
          Selected: <span style={{ 
            display: 'inline-block',
            width: '16px',
            height: '16px',
            backgroundColor: selectedColor,
            borderRadius: '50%',
            marginLeft: '5px',
            verticalAlign: 'middle'
          }}></span>
        </div>
      </div>

      <div style={{ position: 'relative', display: 'inline-block' }}>
        <canvas
          ref={canvasRef}
          width={750}
          height={500}
          onMouseDown={startDrawing}
          onMouseMove={handleMouseMove}
          onMouseUp={stopDrawing}
          onMouseLeave={stopDrawing}
          style={{
            border: '2px solid #ddd',
            borderRadius: '8px',
            cursor: 'crosshair',
            backgroundColor: 'white',
            boxShadow: '0 2px 10px rgba(0,0,0,0.1)'
          }}
        />
        
        {/* Render other users' cursors */}
        {Array.from(userCursors.entries()).map(([userId, cursor]) => {
          if (userId === myUserId) return null;
          const user = users.get(userId);
          return (
            <div
              key={userId}
              style={{
                position: 'absolute',
                left: cursor.x - 5,
                top: cursor.y - 5,
                width: '10px',
                height: '10px',
                backgroundColor: user?.color || '#333',
                borderRadius: '50%',
                pointerEvents: 'none',
                zIndex: 10,
                border: '2px solid white',
                boxShadow: '0 0 4px rgba(0,0,0,0.3)'
              }}
            />
          );
        })}
      </div>

      <div style={{ 
        marginTop: '15px', 
        fontSize: '14px', 
        color: '#666',
        textAlign: 'center'
      }}>
        <p>🎨 Draw with your mouse • Share this page with others to collaborate in real-time!</p>
        {users.size > 1 && (
          <div style={{ marginTop: '10px' }}>
            <strong>Active users:</strong> {Array.from(users.values()).map(user => (
              <span key={user.id} style={{ 
                marginLeft: '10px',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px'
              }}>
                <span style={{ 
                  width: '12px', 
                  height: '12px', 
                  backgroundColor: user.color,
                  borderRadius: '50%',
                  display: 'inline-block'
                }}></span>
                {user.id === myUserId ? 'You' : user.id.substring(0, 8)}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default Block;