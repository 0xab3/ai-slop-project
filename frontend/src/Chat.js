import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import io from 'socket.io-client';
import './App.css';

const SOCKET_URL = window.location.origin;

const Chat = () => {
  const navigate = useNavigate();
  
  const [toUser, setToUser] = useState(() => localStorage.getItem('callWith'));
  const [username] = useState(() => localStorage.getItem('username'));
  
  const roomId = username && toUser ? [username, toUser].sort().join('_') : '';
  
  const [messages, setMessages] = useState([]);
  const [inputMessage, setInputMessage] = useState('');
  const [connectionStatus, setConnectionStatus] = useState('disconnected');
  const [dataChannel, setDataChannel] = useState(null);
  const [socket, setSocket] = useState(null);
  const [peerId] = useState(() => Math.random().toString(36).substring(2, 10));
  const [peerConnection, setPeerConnection] = useState(null);
  const [roomReady, setRoomReady] = useState(false);
  const [waitingForPeer, setWaitingForPeer] = useState(false);
  
  const messagesEndRef = useRef(null);
  const dataChannelRef = useRef(null);

  if (!toUser) {
    return (
      <div className="app">
        <div className="container">
          <p>Loading...</p>
        </div>
      </div>
    );
  }

  useEffect(() => {
    if (!roomId || !username || !toUser) {
      if (username && !toUser) {
        navigate('/dashboard');
      }
      return;
    }

    // Connect to signaling server
    const newSocket = io(SOCKET_URL);
    setSocket(newSocket);

    const pc = createPeerConnection(newSocket);
    setPeerConnection(pc);

    // Join the room
    newSocket.emit('join-room', { roomId, peerId });

    return () => {
      newSocket.disconnect();
      pc.close();
    };
  }, [roomId, peerId, username, toUser, navigate]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const createPeerConnection = (socket) => {
    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
      ]
    });

    // Handle ICE candidates
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit('ice-candidate', {
          roomId,
          candidate: event.candidate,
          fromPeerId: peerId,
          toPeerId: 'all'
        });
      }
    };

    pc.onconnectionstatechange = () => {
      console.log('Connection state:', pc.connectionState);
      setConnectionStatus(pc.connectionState);
    };

    pc.oniceconnectionstatechange = () => {
      console.log('ICE connection state:', pc.iceConnectionState);
    };

    // Handle incoming data channel
    pc.ondatachannel = (event) => {
      const channel = event.channel;
      setupDataChannel(channel);
    };

    return pc;
  };

  const setupDataChannel = (channel) => {
    dataChannelRef.current = channel;
    setDataChannel(channel);

    channel.onopen = () => {
      console.log('🎉 Data channel opened!');
      setConnectionStatus('connected');
    };

    channel.onmessage = (event) => {
      const message = JSON.parse(event.data);
      setMessages(prev => [...prev, { ...message, remote: true }]);
    };

    channel.onclose = () => {
      console.log('Data channel closed');
      setConnectionStatus('disconnected');
    };
  };

  // Socket event handlers
  useEffect(() => {
    if (!socket || !peerConnection) return;

    socket.on('room-full', () => {
      alert('Room is full! Maximum 2 peers allowed.');
      navigate('/');
    });

    socket.on('room-ready', () => {
      console.log('Room ready - both peers connected');
      setRoomReady(true);
      setWaitingForPeer(false);
    });

    socket.on('peer-joined', async ({ peerId: otherPeerId }) => {
      console.log('Peer joined:', otherPeerId);
      setWaitingForPeer(false);
      
      // Create data channel
      const channel = peerConnection.createDataChannel('chat');
      setupDataChannel(channel);
      setDataChannel(channel);

      // Create offer
      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);

      socket.emit('offer', {
        roomId,
        offer,
        fromPeerId: peerId,
        toPeerId: otherPeerId
      });
    });

    socket.on('peers-list', async ({ peers }) => {
      if (peers.length > 0) {
        setWaitingForPeer(false);
        // Wait for offer from other peer
      } else {
        setWaitingForPeer(true);
      }
    });

    socket.on('offer', async ({ offer, fromPeerId }) => {
      console.log('Received offer from:', fromPeerId);
      
      await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
      
      const answer = await peerConnection.createAnswer();
      await peerConnection.setLocalDescription(answer);

      socket.emit('answer', {
        roomId,
        answer,
        fromPeerId: peerId,
        toPeerId: fromPeerId
      });
    });

    socket.on('answer', async ({ answer, fromPeerId }) => {
      console.log('Received answer from:', fromPeerId);
      await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
    });

    socket.on('ice-candidate', async ({ candidate, fromPeerId }) => {
      console.log('Received ICE candidate from:', fromPeerId);
      try {
        await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (err) {
        console.error('Error adding ICE candidate:', err);
      }
    });

    socket.on('peer-left', ({ peerId: leftPeerId }) => {
      console.log('Peer left:', leftPeerId);
      setConnectionStatus('disconnected');
      setRoomReady(false);
      setWaitingForPeer(true);
    });

    return () => {
      socket.off('room-full');
      socket.off('room-ready');
      socket.off('peer-joined');
      socket.off('peers-list');
      socket.off('offer');
      socket.off('answer');
      socket.off('ice-candidate');
      socket.off('peer-left');
    };
  }, [socket, peerConnection, roomId, peerId, toUser, navigate]);

  const sendMessage = () => {
    if (!inputMessage.trim() || !dataChannelRef.current || dataChannelRef.current.readyState !== 'open') {
      return;
    }

    const message = {
      text: inputMessage,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    dataChannelRef.current.send(JSON.stringify(message));
    setMessages(prev => [...prev, { ...message, remote: false }]);
    setInputMessage('');
  };

  return (
    <div className="app">
      <div className="container">
        <header className="header">
          <h1>P2P Connect</h1>
          <div className="header-right">
            <button onClick={() => {
              localStorage.removeItem('callWith');
              navigate('/dashboard');
            }} className="btn btn-secondary">← Leave</button>
            <div className="connection-status">
              <span className={`status-indicator ${connectionStatus}`}></span>
              <span>{connectionStatus}</span>
            </div>
          </div>
        </header>

        <div className="connection-controls">
          <div className="room-info">
            <span>Talking to </span>
            <code className="room-id" title="Chatting with">{toUser}</code>
          </div>
          
          {waitingForPeer && (
            <div className="waiting-message">
              ⏳ Waiting for peer to join...
            </div>
          )}
          
          {!waitingForPeer && connectionStatus === 'disconnected' && (
            <div className="connecting-message">
              🔄 Connecting...
            </div>
          )}
          
          {connectionStatus === 'connected' && (
            <div className="connected-message">
              ✅ P2P Connection established!
            </div>
          )}
        </div>

        <div className="chat-container">
          <div className="messages">
            {messages.length === 0 && (
              <div className="no-messages">
                {connectionStatus === 'connected' 
                  ? 'No messages yet. Start chatting!' 
                  : 'Waiting for connection...'}
              </div>
            )}
            {messages.map((message, index) => (
              <div
                key={index}
                className={`message ${message.remote ? 'remote' : 'local'}`}
              >
                <div className="message-content">{message.text}</div>
                <div className="message-time">{message.timestamp}</div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>

          <div className="input-container">
            <input
              type="text"
              value={inputMessage}
              onChange={(e) => setInputMessage(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && sendMessage()}
              placeholder={connectionStatus === 'connected' ? "Type a message..." : "Waiting for connection..."}
              className="message-input"
              disabled={connectionStatus !== 'connected'}
            />
            <button
              onClick={sendMessage}
              className="btn btn-send"
              disabled={connectionStatus !== 'connected' || !inputMessage.trim()}
            >
              Send
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Chat;
