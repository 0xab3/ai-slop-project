import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import io from 'socket.io-client';
import { initDB, saveMessage, getMessages } from './db';
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
  
  // Video state
  const [isVideoCall, setIsVideoCall] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [showVideoDropdown, setShowVideoDropdown] = useState(false);
  const [localStream, setLocalStream] = useState(null);
  const [remoteStream, setRemoteStream] = useState(null);
  
  // Video request state
  const [videoRequest, setVideoRequest] = useState(null);
  const [waitingForVideoAccept, setWaitingForVideoAccept] = useState(false);
  const [videoRejected, setVideoRejected] = useState(false);
  
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const videoTrackRef = useRef(null);
  const screenTrackRef = useRef(null);
  
  const messagesEndRef = useRef(null);
  const dataChannelRef = useRef(null);

  const [incomingFile, setIncomingFile] = useState(null);
  const [fileChunks, setFileChunks] = useState([]);
  const [receivedFileData, setReceivedFileData] = useState(null);

  // Set local video srcObject when stream changes
  useEffect(() => {
    if (localStream) {
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = localStream;
        localVideoRef.current.play().catch(e => console.log('Play error:', e));
      } else {
        const timer = setTimeout(() => {
          if (localVideoRef.current) {
            localVideoRef.current.srcObject = localStream;
            localVideoRef.current.play().catch(e => console.log('Play error:', e));
          }
        }, 100);
        return () => clearTimeout(timer);
      }
    }
  }, [localStream]);

  // Set remote video srcObject when stream changes
  useEffect(() => {
    console.log('remoteStream effect running, remoteStream:', remoteStream, 'videoRef:', !!remoteVideoRef.current);
    if (remoteStream) {
      if (remoteVideoRef.current) {
        console.log('Setting remote video srcObject...');
        remoteVideoRef.current.srcObject = remoteStream;
        remoteVideoRef.current.play().catch(e => console.log('Play error:', e));
        console.log('Remote video srcObject set!');
      } else {
        // Video element not ready yet, wait for next render
        console.log('Video ref not ready, waiting...');
        const timer = setTimeout(() => {
          if (remoteVideoRef.current) {
            remoteVideoRef.current.srcObject = remoteStream;
            remoteVideoRef.current.play().catch(e => console.log('Play error:', e));
            console.log('Remote video srcObject set after timeout!');
          }
        }, 100);
        return () => clearTimeout(timer);
      }
    }
  }, [remoteStream]);

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

    // Initialize IndexedDB and load messages
    initDB().then(() => {
      getMessages(username, toUser).then(loadedMessages => {
        const formattedMessages = loadedMessages.map(msg => ({
          text: msg.text,
          timestamp: new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          remote: msg.sender !== username
        }));
        setMessages(formattedMessages);
      }).catch(err => console.error('Error loading messages:', err));
    }).catch(err => console.error('Error initializing DB:', err));

    // Connect to signaling server
    const newSocket = io(SOCKET_URL);
    setSocket(newSocket);

    // Register socket with username for video requests
    newSocket.emit('register-socket', { username });

    const pc = createPeerConnection(newSocket);
    setPeerConnection(pc);

    console.log('[Chat] Joining room:', roomId, 'peerId:', peerId, 'username:', username);
    // Join the room
    newSocket.emit('join-room', { roomId, peerId, username });

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

    pc.onnegotiationneeded = async () => {
      console.log('Negotiation needed, creating offer...');
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        socket.emit('offer', { roomId, offer, fromPeerId: peerId, toPeerId: 'all' });
        console.log('Sent new offer');
      } catch (err) {
        console.error('Error creating offer:', err);
      }
    };

    pc.oniceconnectionstatechange = () => {
      console.log('ICE connection state:', pc.iceConnectionState);
    };

    // Handle incoming data channel
    pc.ondatachannel = (event) => {
      const channel = event.channel;
      setupDataChannel(channel);
    };

    // Handle incoming video tracks
    pc.ontrack = (event) => {
      console.log('Received remote track:', event.track.kind, 'stream:', event.streams[0]);
      console.log('Setting remoteStream...');
      setRemoteStream(event.streams[0]);
      console.log('remoteStream set to:', event.streams[0]);
    };

    return pc;
  };

  const setupDataChannel = (channel) => {
    dataChannelRef.current = channel;
    setDataChannel(channel);

    let fileMeta = null;
    let receivedSize = 0;
    const chunks = [];

    channel.onopen = () => {
      console.log('🎉 Data channel opened!');
      setConnectionStatus('connected');
    };

    channel.onmessage = (event) => {
      const data = event.data;

      if (typeof data === 'string') {
        const message = JSON.parse(data);
        
        if (message.type === 'file-start') {
          fileMeta = {
            fileName: message.fileName,
            fileSize: message.fileSize,
            mimeType: message.mimeType
          };
          receivedSize = 0;
          chunks.length = 0;
          console.log('Receiving file:', fileMeta.fileName, 'Size:', fileMeta.fileSize);
          return;
        }

        if (message.type === 'text') {
          setMessages(prev => [...prev, { ...message, remote: true }]);
          saveMessage({
            sender: toUser,
            receiver: username,
            text: message.text
          }).catch(err => console.error('Error saving received message:', err));
        }
      } else if (data instanceof ArrayBuffer || data instanceof Blob) {
        if (fileMeta && chunks) {
          chunks.push(data);
          receivedSize += data.byteLength || data.size;
          console.log('Received chunk:', receivedSize, '/', fileMeta.fileSize);

          if (chunks.length > 0 && receivedSize >= fileMeta.fileSize) {
            console.log('File received completely, saving...');
            try {
              const blob = new Blob(chunks, { type: fileMeta.mimeType });
              const fileInfo = { fileName: fileMeta.fileName, blob: blob };
              
              setMessages(prev => [...prev, { 
                text: `📎 Received file: ${fileMeta.fileName}`, 
                remote: true,
                isFile: true,
                fileInfo: fileInfo
              }]);
            } catch (err) {
              console.error('Error saving file:', err);
            }
            
            fileMeta = null;
            chunks.length = 0;
            receivedSize = 0;
          }
        }
      }
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
      // Reset video state
      stopVideoCall();
    });

    // Video request handlers
    socket.on('video-request-received', ({ from, type }) => {
      console.log('Video request received from:', from, 'type:', type);
      
      // Use setTimeout to ensure state updates properly
      setTimeout(() => {
        setVideoRequest({ from, type });
        console.log('videoRequest set via timeout');
      }, 100);
    });

    socket.on('video-accepted', async ({ from }) => {
      console.log('Video accepted by:', from);
      setWaitingForVideoAccept(false);
    });

    socket.on('video-rejected', ({ from }) => {
      console.log('Video rejected by:', from);
      setWaitingForVideoAccept(false);
      setVideoRejected(true);
      setTimeout(() => setVideoRejected(false), 3000);
    });

    socket.on('video-accepted', async ({ from }) => {
      console.log('Video accepted by:', from);
      setWaitingForVideoAccept(false);
    });

    socket.on('video-rejected', ({ from }) => {
      console.log('Video rejected by:', from);
      setWaitingForVideoAccept(false);
      stopVideoCall();
      setVideoRejected(true);
      setTimeout(() => setVideoRejected(false), 3000);
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
      socket.off('video-request-received');
      socket.off('video-accepted');
      socket.off('video-rejected');
    };
  }, [socket, peerConnection, roomId, peerId, toUser, navigate]);

  const sendMessage = () => {
    if (!inputMessage.trim() || !dataChannelRef.current || dataChannelRef.current.readyState !== 'open') {
      return;
    }

    const message = {
      type: 'text',
      text: inputMessage,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    dataChannelRef.current.send(JSON.stringify(message));
    setMessages(prev => [...prev, { ...message, remote: false }]);
    
    // Save to IndexedDB
    saveMessage({
      sender: username,
      receiver: toUser,
      text: inputMessage
    }).catch(err => console.error('Error saving message:', err));
    
    setInputMessage('');
  };

  const startVideoCall = async () => {
    console.log('Starting video call');
    setShowVideoDropdown(false);
    
    if (!socket || !peerConnection) {
      console.error('Socket or peerConnection not available');
      return;
    }
    
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      console.log('Got stream:', stream);
      setLocalStream(stream);
      
      // Add tracks to peer connection
      stream.getTracks().forEach(track => {
        peerConnection.addTrack(track, stream);
      });
      console.log('Added tracks to peer connection');
      
      setIsVideoCall(true);
      setIsScreenSharing(false);
       
      // Send video request
      socket.emit('video-request', { to: toUser, from: username, type: 'camera' });
    } catch (err) {
      console.error('Error starting video call:', err);
      alert('Could not access camera/microphone');
    }
  };

  const startScreenShare = async () => {
    console.log('Starting screen share');
    setShowVideoDropdown(false);
    
    if (!socket || !peerConnection) {
      console.error('Socket or peerConnection not available');
      return;
    }
    
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      console.log('Got stream:', stream);
      setLocalStream(stream);
      
      // Add tracks to peer connection
      stream.getTracks().forEach(track => {
        peerConnection.addTrack(track, stream);
      });
      console.log('Added tracks to peer connection');
      
      setIsVideoCall(true);
      setIsScreenSharing(true);
      
      // Send video request
      socket.emit('video-request', { to: toUser, from: username, type: 'screen' });
      setWaitingForVideoAccept(true);
    } catch (err) {
      console.error('Error starting screen share:', err);
    }
  };

  const stopVideoCall = () => {
    if (localStream) {
      localStream.getTracks().forEach(track => track.stop());
      setLocalStream(null);
    }

    if (screenTrackRef.current) {
      screenTrackRef.current = null;
    }

    if (peerConnection) {
      const senders = peerConnection.getSenders();
      senders.forEach(sender => {
        if (sender.track && (sender.track.kind === 'video' || sender.track.kind === 'audio')) {
          peerConnection.removeTrack(sender);
        }
      });
    }

    setRemoteStream(null);
    videoTrackRef.current = null;
    setIsVideoCall(false);
    setIsScreenSharing(false);
  };

  const acceptVideoRequest = async () => {
    if (!videoRequest) return;
    
    const { from, type } = videoRequest;
    console.log('Accepting video request from:', from, 'type:', type);
    
    // Tell the caller we accepted
    socket.emit('video-accepted', { to: from, from: username });
    console.log('Sent video-accepted to:', from);
    
    // Show the video window - remote peer's video will appear via ontrack
    setIsVideoCall(true);
    setIsScreenSharing(type === 'screen');
    
    setVideoRequest(null);
    console.log('Video window should be showing now, waiting for remote track...');
  };

  const declineVideoRequest = () => {
    if (!videoRequest) return;
    
    const { from } = videoRequest;
    
    socket.emit('video-rejected', { to: from, from: username });
    setVideoRequest(null);
  };

  const fileInputRef = useRef(null);

  const handleFileSelect = (event) => {
    const file = event.target.files[0];
    if (file) {
      console.log('File selected:', file);
      sendFile(file);
    }
    event.target.value = '';
  };

  const downloadReceivedFile = (fileInfo) => {
    if (!fileInfo || !fileInfo.blob) return;
    const url = URL.createObjectURL(fileInfo.blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileInfo.fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 100);
  };

  const sendFile = (file) => {
    if (!dataChannelRef.current || dataChannelRef.current.readyState !== 'open') {
      console.error('Data channel not open');
      return;
    }

    dataChannelRef.current.send(JSON.stringify({
      type: 'file-start',
      fileName: file.name,
      fileSize: file.size,
      mimeType: file.type
    }));

    const CHUNK_SIZE = 16 * 1024;
    let offset = 0;

    const sendChunk = () => {
      const chunk = file.slice(offset, offset + CHUNK_SIZE);
      const reader = new FileReader();
      
      reader.onload = (e) => {
        const arrayBuffer = e.target.result;
        dataChannelRef.current.send(arrayBuffer);
        
        offset += CHUNK_SIZE;
        if (offset < file.size) {
          setTimeout(sendChunk, 10);
        } else {
          console.log('File sent successfully');
        }
      };
      
      reader.readAsArrayBuffer(chunk);
    };

    sendChunk();

    setMessages(prev => [...prev, { 
      text: `📎 Sent file: ${file.name}`, 
      remote: false,
      isFile: true 
    }]);
  };

  const openFilePicker = () => {
    fileInputRef.current?.click();
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
              Waiting for peer to join...
            </div>
          )}
          
          {!waitingForPeer && connectionStatus === 'disconnected' && (
            <div className="connecting-message">
              Connecting...
            </div>
          )}
          
          {connectionStatus === 'connected' && (
            <div className="connected-message">
              P2P Connection established!
            </div>
          )}
        </div>

        {waitingForVideoAccept && (
          <div className="status-message">Waiting for peer to accept video...</div>
        )}

        {videoRejected && (
          <div className="status-message">Peer declined video request</div>
        )}

        {videoRequest && (
          <div className="modal-overlay">
            <div className="modal">
              <div className="modal-header">
                <h3>Video Request</h3>
              </div>
              <div className="modal-content">
                <p>{videoRequest.from} wants to {videoRequest.type === 'screen' ? 'share screen' : 'video chat'} with you</p>
                <div className="modal-actions">
                  <button onClick={acceptVideoRequest} className="btn btn-primary">Accept</button>
                  <button onClick={declineVideoRequest} className="btn btn-secondary">Decline</button>
                </div>
              </div>
            </div>
          </div>
        )}

        {isVideoCall || videoRequest ? (
          <div className="video-chat-layout">
            <div className="video-area">
              <div className="video-main">
                <video 
                  ref={remoteVideoRef}
                  srcObject={remoteStream}
                  autoPlay 
                  playsInline 
                  className="remote-video"
                  onClick={() => remoteVideoRef.current?.play()}
                />
                {!remoteStream && (
                  <div className="video-placeholder">
                    Waiting for peer video...
                  </div>
                )}
              </div>
              <div className="video-local">
                <video 
                  ref={localVideoRef}
                  srcObject={localStream}
                  autoPlay 
                  playsInline 
                  muted 
                  className="local-video"
                  onClick={() => {
                    setShowVideoDropdown(!showVideoDropdown);
                  }}
                />
                {isScreenSharing && <span className="screen-share-badge">Screen</span>}
                {showVideoDropdown && (
                  <div className="video-dropdown" style={{ position: 'absolute', bottom: '10px', left: '50%', transform: 'translateX(-50%)', minWidth: '150px' }}>
                    <button onClick={() => { startVideoCall(); setShowVideoDropdown(false); }} className="dropdown-item">
                      Camera
                    </button>
                    <button onClick={() => { startScreenShare(); setShowVideoDropdown(false); }} className="dropdown-item">
                      Screen Share
                    </button>
                  </div>
                )}
              </div>
              <button onClick={stopVideoCall} className="btn btn-secondary stop-video-btn">
                End Video
              </button>
            </div>
            <div className="chat-area">
              <div className="messages">
                {messages.length === 0 && (
                  <div className="no-messages">
                    No messages yet. Start chatting!
                  </div>
                )}
                {messages.map((message, index) => (
                  <div
                    key={index}
                    className={`message ${message.remote ? 'remote' : 'local'} ${message.isFile ? 'file-message' : ''}`}
                    onClick={() => message.fileInfo && downloadReceivedFile(message.fileInfo)}
                  >
                    <div className="message-content">{message.text}</div>
                    <div className="message-time">{message.timestamp}</div>
                  </div>
                ))}
                <div ref={messagesEndRef} />
              </div>

              <div className="input-container">
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileSelect}
                  style={{ display: 'none' }}
                />
                <button
                  onClick={openFilePicker}
                  className="btn btn-secondary"
                  disabled={connectionStatus !== 'connected'}
                  title="Send file"
                >
                  +
                </button>
                <input
                  type="text"
                  value={inputMessage}
                  onChange={(e) => setInputMessage(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && sendMessage()}
                  placeholder="Type a message..."
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
        ) : (
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
                  className={`message ${message.remote ? 'remote' : 'local'} ${message.isFile ? 'file-message' : ''}`}
                  onClick={() => message.fileInfo && downloadReceivedFile(message.fileInfo)}
                >
                  <div className="message-content">{message.text}</div>
                  <div className="message-time">{message.timestamp}</div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>

            <div className="input-container">
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileSelect}
                style={{ display: 'none' }}
              />
              <button
                onClick={openFilePicker}
                className="btn btn-secondary"
                disabled={connectionStatus !== 'connected'}
                title="Send file"
              >
                📎
              </button>
              <input
                type="text"
                value={inputMessage}
                onChange={(e) => setInputMessage(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && sendMessage()}
                placeholder={connectionStatus === 'connected' ? "Type a message..." : "Waiting for connection..."}
                className="message-input"
                disabled={connectionStatus !== 'connected'}
              />
              <div className="video-dropdown-container">
                <button
                  onClick={() => setShowVideoDropdown(!showVideoDropdown)}
                  className="btn btn-secondary"
                  disabled={connectionStatus !== 'connected'}
                >
                  Video
                </button>
                {showVideoDropdown && (
                  <div className="video-dropdown" style={{ minWidth: '150px' }}>
                    <button onClick={startVideoCall} className="dropdown-item">
                      Camera
                    </button>
                    <button onClick={startScreenShare} className="dropdown-item">
                      Screen Share
                    </button>
                  </div>
                )}
              </div>
              <button
                onClick={sendMessage}
                className="btn btn-send"
                disabled={connectionStatus !== 'connected' || !inputMessage.trim()}
              >
                Send
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Chat;
