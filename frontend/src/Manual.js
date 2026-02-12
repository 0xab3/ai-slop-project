import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import './App.css';

const Manual = () => {
  const navigate = useNavigate();
  const [messages, setMessages] = useState([]);
  const [inputMessage, setInputMessage] = useState('');
  const [connectionStatus, setConnectionStatus] = useState('disconnected');
  const [localPeer, setLocalPeer] = useState(null);
  const [remotePeer, setRemotePeer] = useState(null);
  const [dataChannel, setDataChannel] = useState(null);
  const [mode, setMode] = useState(null);
  const [showOffer, setShowOffer] = useState(false);
  const [offerText, setOfferText] = useState('');
  const [showAnswer, setShowAnswer] = useState(false);
  const [answerText, setAnswerText] = useState('');
  const [localIceCandidates, setLocalIceCandidates] = useState([]);
  const [remoteIceCandidates, setRemoteIceCandidates] = useState('');
  const [iceFeedback, setIceFeedback] = useState({ message: '', type: '' });
  const [copyFeedback, setCopyFeedback] = useState('');
  const [activeTab, setActiveTab] = useState(null);
  const messagesEndRef = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const createPeerConnection = () => {
    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
      ]
    });

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        console.log('🧊 New ICE candidate:', event.candidate);
        setLocalIceCandidates(prev => [...prev, event.candidate]);
      } else {
        console.log('🏁 ICE gathering complete - no more candidates');
      }
    };

    pc.onicegatheringstatechange = () => {
      console.log('ICE gathering state:', pc.iceGatheringState);
    };

    pc.onconnectionstatechange = () => {
      console.log('Connection state:', pc.connectionState);
      setConnectionStatus(pc.connectionState);
    };

    pc.oniceconnectionstatechange = () => {
      console.log('ICE connection state:', pc.iceConnectionState);
    };

    pc.ondatachannel = (event) => {
      const channel = event.channel;
      setupDataChannel(channel);
      setDataChannel(channel);
    };

    return pc;
  };

  const setupDataChannel = (channel) => {
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

  const createOffer = async () => {
    const pc = createPeerConnection();
    setLocalPeer(pc);

    const channel = pc.createDataChannel('chat');
    setupDataChannel(channel);
    setDataChannel(channel);

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    
    await new Promise(resolve => {
      if (pc.iceGatheringState === 'complete') {
        resolve();
      } else {
        pc.onicegatheringstatechange = () => {
          if (pc.iceGatheringState === 'complete') {
            resolve();
          }
        };
      }
    });
    
    console.log('Created offer:', offer);
    return offer;
  };

  const createAnswer = async (offerData) => {
    const pc = createPeerConnection();
    setRemotePeer(pc);

    try {
      await pc.setRemoteDescription(offerData);
      console.log('Remote description set successfully');
      
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      console.log('Local description set successfully');
      
      await new Promise(resolve => {
        if (pc.iceGatheringState === 'complete') {
          resolve();
        } else {
          pc.onicegatheringstatechange = () => {
            if (pc.iceGatheringState === 'complete') {
              resolve();
            }
          };
        }
      });
      
      console.log('Created answer:', answer);
      return answer;
    } catch (error) {
      console.error('Error in createAnswer:', error);
      throw error;
    }
  };

  const handleOffer = async () => {
    const offer = await createOffer();
    const offerJson = JSON.stringify(offer, null, 2);
    setOfferText(offerJson);
    setShowOffer(true);
  };

  const handleAnswer = async () => {
    const offerTextInput = prompt('Paste the offer from your peer:');
    if (!offerTextInput) return;

    try {
      const offer = JSON.parse(offerTextInput);
      const answer = await createAnswer(offer);
      const answerJson = JSON.stringify(answer, null, 2);
      setAnswerText(answerJson);
      setShowAnswer(true);
    } catch (error) {
      console.error('Error in handleAnswer:', error);
      alert('Invalid offer format: ' + error.message);
    }
  };

  const handleCompleteOffer = async () => {
    const answerTextInput = prompt('Paste the answer from your peer:');
    if (!answerTextInput || !localPeer) return;

    try {
      const answer = JSON.parse(answerTextInput);
      await localPeer.setRemoteDescription(answer);
      console.log('Connection completed with remote description');
    } catch (error) {
      console.error('Error setting remote description:', error);
      alert('Invalid answer format: ' + error.message);
    }
  };

  const addRemoteIceCandidates = async () => {
    if (!remoteIceCandidates.trim()) {
      setIceFeedback({ message: 'Please paste ICE candidates first', type: 'error' });
      setTimeout(() => setIceFeedback({ message: '', type: '' }), 3000);
      return;
    }

    try {
      const candidates = JSON.parse(remoteIceCandidates);
      const targetPeer = mode === 'initiate' ? localPeer : remotePeer;
      
      if (targetPeer) {
        for (const candidate of candidates) {
          await targetPeer.addIceCandidate(candidate);
        }
        setRemoteIceCandidates('');
        setIceFeedback({ 
          message: `✅ Successfully added ${candidates.length} ICE candidate(s)!`, 
          type: 'success' 
        });
        setTimeout(() => setIceFeedback({ message: '', type: '' }), 4000);
      } else {
        setIceFeedback({ message: 'Please establish connection first', type: 'error' });
        setTimeout(() => setIceFeedback({ message: '', type: '' }), 3000);
      }
      
    } catch (error) {
      console.error('❌ Error adding ICE candidates:', error);
      setIceFeedback({ 
        message: '❌ Invalid ICE candidates format: ' + error.message, 
        type: 'error' 
      });
      setTimeout(() => setIceFeedback({ message: '', type: '' }), 5000);
    }
  };

  const copyToClipboard = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopyFeedback('✅ Copied!');
      setTimeout(() => setCopyFeedback(''), 2000);
    } catch (err) {
      console.error('Failed to copy text: ', err);
      setCopyFeedback('❌ Copy failed');
      setTimeout(() => setCopyFeedback(''), 2000);
    }
  };

  const sendMessage = () => {
    if (!inputMessage.trim() || !dataChannel || dataChannel.readyState !== 'open') {
      return;
    }

    const message = {
      text: inputMessage,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    dataChannel.send(JSON.stringify(message));
    setMessages(prev => [...prev, { ...message, remote: false }]);
    setInputMessage('');
  };

  if (!mode) {
    return (
      <div className="app">
        <div className="mode-selection">
          <header className="header">
            <h1>P2P Connect</h1>
            <button onClick={() => navigate('/')} className="btn btn-secondary">← Back</button>
          </header>
          
          <div className="mode-content">
            <h2>Choose Your Role</h2>
            <p>Manual copy/paste signaling mode</p>
            
            <div className="mode-buttons">
              <button 
                onClick={() => setMode('initiate')} 
                className="btn btn-primary mode-btn"
              >
                <span className="mode-icon">🚀</span>
                <span className="mode-text">Initiate Chat</span>
                <span className="mode-description">Create a new chat session</span>
              </button>
              
              <button 
                onClick={() => setMode('join')} 
                className="btn btn-secondary mode-btn"
              >
                <span className="mode-icon">🔗</span>
                <span className="mode-text">Join Chat</span>
                <span className="mode-description">Connect to existing chat</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <div className="container">
        <header className="header">
          <h1>P2P Connect</h1>
          <div className="header-right">
            <button onClick={() => navigate('/')} className="btn btn-secondary">← Leave</button>
            <div className="connection-status">
              <span className={`status-indicator ${connectionStatus}`}></span>
              <span>{connectionStatus}</span>
            </div>
          </div>
        </header>

        <div className="connection-controls">
          {mode === 'initiate' && (
            <div className="connection-buttons">
              <button onClick={handleOffer} className="btn btn-primary">
                Create Offer
              </button>
               <button onClick={handleCompleteOffer} className="btn btn-secondary" disabled={!localPeer}>
                 Accept Answer
               </button>
            </div>
          )}

          {mode === 'join' && (
            <div className="connection-buttons">
              <button onClick={handleAnswer} className="btn btn-primary">
                Accept Offer
              </button>
            </div>
          )}

          <div className="connection-buttons">
            <button 
              className={`btn ${activeTab === 'localIce' ? 'btn-secondary' : 'btn-primary'}`}
              onClick={() => setActiveTab(activeTab === 'localIce' ? null : 'localIce')}
            >
              📤 Your ICE {localIceCandidates.length > 0 && `(${localIceCandidates.length})`}
            </button>
            <button 
              className={`btn ${activeTab === 'remoteIce' ? 'btn-secondary' : 'btn-primary'}`}
              onClick={() => setActiveTab(activeTab === 'remoteIce' ? null : 'remoteIce')}
            >
              📥 Remote ICE
            </button>
          </div>
          
          {activeTab === 'localIce' && (
            <div className="tab-content">
              {localIceCandidates.length > 0 ? (
                <div className="ice-content side-by-side">
                  <div className="ice-text-container">
                    <pre className="ice-text">{JSON.stringify(localIceCandidates, null, 2)}</pre>
                  </div>
                  <div className="ice-button-side">
                    <button 
                      onClick={() => copyToClipboard(JSON.stringify(localIceCandidates, null, 2))}
                      className="btn btn-copy"
                    >
                      {copyFeedback ? copyFeedback : 'Copy'}
                    </button>
                  </div>
                </div>
              ) : (
                <p className="no-ice-message">No ICE candidates generated yet.</p>
              )}
            </div>
          )}
          
          {activeTab === 'remoteIce' && (
            <div className="tab-content">
              <div className="ice-input-content side-by-side">
                <div className="ice-textarea-container">
                  <textarea
                    value={remoteIceCandidates}
                    onChange={(e) => setRemoteIceCandidates(e.target.value)}
                    placeholder="Paste remote ICE candidates here..."
                    className="ice-input"
                    rows="4"
                  />
                </div>
                <div className="ice-button-side">
                  <button 
                    onClick={addRemoteIceCandidates}
                    className="btn btn-primary"
                  >
                    🧊 Add ICE
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {iceFeedback.message && (
          <div className="status-feedback">
            <p className={iceFeedback.type === 'success' ? 'success' : 'error'}>
              {iceFeedback.message}
            </p>
          </div>
        )}

        {showOffer && (
          <div className="modal-overlay">
            <div className="modal">
              <div className="modal-header">
                <h3>Offer to Share</h3>
                <button 
                  className="btn-close" 
                  onClick={() => setShowOffer(false)}
                >
                  ×
                </button>
              </div>
              <div className="modal-content">
                 <pre className="offer-text">{offerText}</pre>
                 <button 
                   onClick={() => copyToClipboard(offerText)}
                   className="btn btn-copy"
                 >
                   {copyFeedback ? copyFeedback : 'Copy to Clipboard'}
                 </button>
              </div>
            </div>
          </div>
        )}

        {showAnswer && (
          <div className="modal-overlay">
            <div className="modal">
              <div className="modal-header">
                <h3>Answer to Share</h3>
                <button 
                  className="btn-close" 
                  onClick={() => setShowAnswer(false)}
                >
                  ×
                </button>
              </div>
              <div className="modal-content">
                 <pre className="offer-text">{answerText}</pre>
                 <button 
                   onClick={() => copyToClipboard(answerText)}
                   className="btn btn-copy"
                 >
                   {copyFeedback ? copyFeedback : 'Copy to Clipboard'}
                 </button>
              </div>
            </div>
          </div>
        )}

        <div className="chat-container">
          <div className="messages">
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
    </div>
  );
};

export default Manual;
