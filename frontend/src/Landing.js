import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import './App.css';

const Landing = () => {
  const navigate = useNavigate();
  const [joinRoomId, setJoinRoomId] = useState('');

  const generateRoomId = () => {
    return Math.random().toString(36).substring(2, 10);
  };

  const handleCreateRoom = () => {
    const roomId = generateRoomId();
    navigate(`/chat/${roomId}`);
  };

  const handleJoinRoom = (e) => {
    e.preventDefault();
    if (joinRoomId.trim()) {
      navigate(`/chat/${joinRoomId.trim()}`);
    }
  };

  return (
    <div className="app">
      <div className="mode-selection">
        <header className="header">
          <h1>P2P Connect</h1>
        </header>
        
        <div className="mode-content">
          <h2>Choose Your Role</h2>
          <p>Start a new chat or join an existing one</p>
          
          <div className="mode-buttons">
            <button 
              onClick={handleCreateRoom}
              className="btn btn-primary mode-btn"
            >
              <span className="mode-icon">🚀</span>
              <span className="mode-text">Create Room</span>
              <span className="mode-description">Start a new chat session</span>
            </button>
            
            <form onSubmit={handleJoinRoom} className="join-form">
              <input
                type="text"
                value={joinRoomId}
                onChange={(e) => setJoinRoomId(e.target.value)}
                placeholder="Enter room ID..."
                className="room-input"
              />
              <button 
                type="submit"
                className="btn btn-secondary mode-btn"
                disabled={!joinRoomId.trim()}
              >
                <span className="mode-icon">🔗</span>
                <span className="mode-text">Join Room</span>
                <span className="mode-description">Connect to existing chat</span>
              </button>
            </form>
            
            <button 
              onClick={() => navigate('/manual')}
              className="btn btn-secondary mode-btn"
            >
              <span className="mode-icon">📋</span>
              <span className="mode-text">Manual Mode</span>
              <span className="mode-description">Copy/paste signaling</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Landing;
