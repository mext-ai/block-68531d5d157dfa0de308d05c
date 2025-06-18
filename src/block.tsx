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

const COLORS = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7', '#DDA0DD'];

const Block: React.FC<BlockProps> = ({ title = "Collaborative Whiteboard", description }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [selectedColor, setSelectedColor] = useState(COLORS[0]);
  const [peer, setPeer] = useState<Peer | null>(null);
  const [connections, setConnections] = useState<Map<string, any>>(new Map());
  const [users, setUsers] = useState<Map<string, User>>(new Map());
  const [connectionStatus, setConnectionStatus] = useState<'disconnected' | 'connecting' | 'connected'>('disconnected');
  const [roomId, setRoomId] = useState('');
  const [myUserId, setMyUserId] = useState('');
  const [userCursors, setUserCursors] = useState<Map<string, { x: number; y: number }>>(new Map());
  const [lastMousePos, setLastMousePos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  // Generate room ID based on current page
  useEffect(() => {
    const baseRoomId = window.location.href
      .replace(/[^a-zA-Z0-9]/g, '')
      .substring(0, 30);
    setRoomId(`wb-${baseRoomId}`);
  }, []);

  // Assign user a random color
  useEffect(() => {
    const randomColor = COLORS[Math.floor(Math.random() * COLORS.length)];
    setSelectedColor(randomColor);
  }, []);

  // Initialize PeerJS
  useEffect(() => {
    if (!roomId) return;

    setConnectionStatus('connecting');

    // Create a unique peer ID for this room
    const uniquePeerId = `${roomId}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    const newPeer = new Peer(uniquePeerId, {
      host: 'social.mext.app',
      port: 443,
      path: '/mext',
      key: 'mexty',
      secure: true,
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:global.stun.twilio.com:3478' }
        ]
      }
    });

    newPeer.on('open', (id) => {
      console.log('My peer ID is: ' + id);
      setMyUserId(id);
      setPeer(newPeer);
      setConnectionStatus('connected');
      
      // Add myself to users
      const myUser: User = {
        id,
        color: selectedColor
      };
      setUsers(prev => new Map(prev.set(id, myUser)));

      // Start room discovery
      startRoomDiscovery(newPeer, id);
    });

    newPeer.on('connection', (conn) => {
      console.log('Incoming connection from:', conn.peer);
      setupConnection(conn);
    });

    newPeer.on('error', (err) => {
      console.error('Peer error:', err);
      setConnectionStatus('connecting');
      
      // Retry connection after a delay
      setTimeout(() => {
        if (newPeer.destroyed) return;
        newPeer.reconnect();
      }, 2000);
    });

    newPeer.on('disconnected', () => {
      console.log('Peer disconnected');
      setConnectionStatus('connecting');
      newPeer.reconnect();
    });

    return () => {
      newPeer.destroy();
      setConnectionStatus('disconnected');
    };
  }, [roomId, selectedColor]);

  const startRoomDiscovery = (peerInstance: Peer, myId: string) => {
    // Use a simple discovery mechanism
    // In production, you'd want a proper signaling server
    const discoveryInterval = setInterval(() => {
      // Try to connect to potential peers in the same room
      const timestamp = Date.now();
      const timeWindow = 30000; // 30 seconds window
      
      // Generate potential peer IDs within a time window
      for (let i = 0; i < 10; i++) {
        const potentialTime = timestamp - (i * 3000); // Check every 3 seconds back
        const basePeerId = `${roomId}-${Math.floor(potentialTime / 10000) * 10000}`;
        
        // Try a few variations
        for (let j = 0; j < 3; j++) {
          const potentialPeerId = `${basePeerId}-${j}`;
          if (potentialPeerId !== myId && !connections.has(potentialPeerId)) {
            tryConnectToPeer(peerInstance, potentialPeerId);
          }
        }
      }
    }, 5000);

    // Clear interval after 2 minutes
    setTimeout(() => {
      clearInterval(discoveryInterval);
    }, 120000);

    return () => clearInterval(discoveryInterval);
  };

  const tryConnectToPeer = (peerInstance: Peer, peerId: string) => {
    try {
      console.log('Attempting to connect to:', peerId);
      const conn = peerInstance.connect(peerId, {
        reliable: true,
        metadata: { roomId, userId: myUserId }
      });

      if (conn) {
        conn.on('open', () => {
          console.log('Successfully connected to:', peerId);
          setupConnection(conn);
        });

        conn.on('error', (err) => {
          console.log('Failed to connect to:', peerId, err);
        });
      }
    } catch (err) {
      console.log('Connection attempt failed:', peerId, err);
    }
  };

  const setupConnection = (conn: any) => {
    conn.on('open', () => {
      console.log('Connection established with:', conn.peer);
      setConnections(prev => new Map(prev.set(conn.peer, conn)));
      
      // Send my user info
      conn.send({
        type: 'user-join',
        user: {
          id: myUserId,
          color: selectedColor
        }
      });

      // Request current canvas state
      conn.send({
        type: 'request-canvas-state'
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
      setUserCursors(prev => {
        const newCursors = new Map(prev);
        newCursors.delete(conn.peer);
        return newCursors;
      });
    });

    conn.on('error', (err: any) => {
      console.error('Connection error:', err);
    });
  };

  const handleIncomingData = (data: any, senderId: string) => {
    switch (data.type) {
      case 'drawing':
        drawOnCanvas(data.drawingData);
        break;
      case 'user-join':
        setUsers(prev => new Map(prev.set(senderId, data.user)));
        // Send back our user info
        const conn = connections.get(senderId);
        if (conn) {
          conn.send({
            type: 'user-join',
            user: {
              id: myUserId,
              color: selectedColor
            }
          });
        }
        break;
      case 'cursor':
        setUserCursors(prev => new Map(prev.set(senderId, { x: data.x, y: data.y })));
        break;
      case 'clear':
        clearCanvas();
        break;
      case 'request-canvas-state':
        // In a full implementation, you'd send the current canvas state
        // For now, we'll just acknowledge
        const requestConn = connections.get(senderId);
        if (requestConn) {
          requestConn.send({
            type: 'canvas-state',
            imageData: null // Would contain canvas data
          });
        }
        break;
    }
  };

  const broadcastData = (data: any) => {
    connections.forEach(conn => {
      if (conn.open) {
        try {
          conn.send(data);
        } catch (err) {
          console.error('Failed to send data to peer:', err);
        }
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
    setLastMousePos(coords);
    
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
    
    const drawData: DrawingData = {
      x: coords.x,
      y: coords.y,
      prevX: lastMousePos.x,
      prevY: lastMousePos.y,
      color: selectedColor,
      type: 'draw',
      userId: myUserId
    };

    drawOnCanvas(drawData);
    broadcastData({ type: 'drawing', drawingData: drawData });
    setLastMousePos(coords);
  };

  const stopDrawing = () => {
    setIsDrawing(false);
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const coords = getCanvasCoordinates(e);
    
    // Throttle cursor updates
    const now = Date.now();
    if (!handleMouseMove.lastUpdate || now - handleMouseMove.lastUpdate > 50) {
      broadcastData({ type: 'cursor', x: coords.x, y: coords.y });
      handleMouseMove.lastUpdate = now;
    }
    
    if (isDrawing) {
      draw(e);
    }
  };
  (handleMouseMove as any).lastUpdate = 0;

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

  const getStatusText = () => {
    switch (connectionStatus) {
      case 'connecting':
        return 'Connecting...';
      case 'connected':
        return `Connected (${users.size} user${users.size !== 1 ? 's' : ''})`;
      case 'disconnected':
        return 'Disconnected';
      default:
        return 'Unknown';
    }
  };

  const getStatusColor = () => {
    switch (connectionStatus) {
      case 'connecting':
        return '#ff9800';
      case 'connected':
        return '#4CAF50';
      case 'disconnected':
        return '#f44336';
      default:
        return '#666';
    }
  };

  // Send completion event on first interaction
  useEffect(() => {
    const handleFirstInteraction = () => {
      window.postMessage({ 
        type: 'BLOCK_COMPLETION', 
        blockId: 'collaborative-whiteboard', 
        completed: true 
      }, '*');
      window.parent.postMessage({ 
        type: 'BLOCK_COMPLETION', 
        blockId: 'collaborative-whiteboard', 
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
              backgroundColor: getStatusColor()
            }}></div>
            <span style={{ fontSize: '14px', color: '#666' }}>
              {getStatusText()}
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
        alignItems: 'center',
        flexWrap: 'wrap'
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
            cursor: isDrawing ? 'none' : 'crosshair',
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
                left: cursor.x - 8,
                top: cursor.y - 8,
                width: '16px',
                height: '16px',
                backgroundColor: user?.color || '#333',
                borderRadius: '50%',
                pointerEvents: 'none',
                zIndex: 10,
                border: '2px solid white',
                boxShadow: '0 2px 6px rgba(0,0,0,0.3)',
                transform: 'translate(-50%, -50%)'
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
          <div style={{ 
            marginTop: '10px',
            padding: '10px',
            backgroundColor: '#f8f9fa',
            borderRadius: '6px',
            border: '1px solid #e9ecef'
          }}>
            <strong>Active collaborators:</strong>
            <div style={{ 
              marginTop: '5px',
              display: 'flex',
              justifyContent: 'center',
              flexWrap: 'wrap',
              gap: '10px'
            }}>
              {Array.from(users.values()).map(user => (
                <span key={user.id} style={{ 
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '5px',
                  padding: '4px 8px',
                  backgroundColor: 'white',
                  borderRadius: '12px',
                  border: '1px solid #ddd'
                }}>
                  <span style={{ 
                    width: '12px', 
                    height: '12px', 
                    backgroundColor: user.color,
                    borderRadius: '50%',
                    display: 'inline-block'
                  }}></span>
                  {user.id === myUserId ? 'You' : `User ${user.id.substring(0, 6)}`}
                </span>
              ))}
            </div>
          </div>
        )}
        {connectionStatus === 'connected' && users.size === 1 && (
          <div style={{ 
            marginTop: '10px',
            padding: '8px',
            backgroundColor: '#fff3cd',
            borderRadius: '4px',
            color: '#856404'
          }}>
            💡 You're the only one here. Share this page with others to start collaborating!
          </div>
        )}
      </div>
    </div>
  );
};

export default Block;