import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import io from 'socket.io-client';
import './App.css';

const API_URL = window.location.origin;
const SOCKET_URL = window.location.origin;

const Dashboard = () => {
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [contacts, setContacts] = useState([]);
  const [newContact, setNewContact] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [socket, setSocket] = useState(null);
  const [incomingCall, setIncomingCall] = useState(null);
  const [callStatus, setCallStatus] = useState('');

  useEffect(() => {
    const storedUsername = localStorage.getItem('username');
    if (!storedUsername) {
      navigate('/login');
      return;
    }
    setUsername(storedUsername);
    fetchContacts(storedUsername);
  }, [navigate]);

  useEffect(() => {
    if (!username) return;

    const newSocket = io(SOCKET_URL);
    setSocket(newSocket);

    newSocket.emit('register-socket', { username });

    newSocket.on('call-request-received', ({ callId, from }) => {
      setIncomingCall({ callId, from });
    });

    newSocket.on('call-accepted', ({ peer, roomId }) => {
      setCallStatus('accepted');
      localStorage.setItem('callWith', peer);
      navigate('/chat');
    });

    newSocket.on('call-rejected', ({ from }) => {
      if (from === username) {
        setCallStatus('rejected');
        setTimeout(() => setCallStatus(''), 3000);
      }
    });

    return () => {
      newSocket.disconnect();
    };
  }, [username, navigate]);

  const fetchContacts = async (user) => {
    try {
      const res = await fetch(`${API_URL}/api/contacts/${user}`);
      const data = await res.json();
      setContacts(data.contacts || []);
    } catch (err) {
      setError('Failed to load contacts');
    } finally {
      setLoading(false);
    }
  };

  const handleAddContact = async (e) => {
    e.preventDefault();
    setError('');

    if (!newContact.trim()) return;
    if (newContact === username) {
      setError('Cannot add yourself as contact');
      return;
    }

    try {
      const res = await fetch(`${API_URL}/api/contacts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, contact: newContact.trim() })
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Failed to add contact');
      }

      setNewContact('');
      fetchContacts(username);
    } catch (err) {
      setError(err.message);
    }
  };

  const handleRemoveContact = async (contact) => {
    try {
      const res = await fetch(`${API_URL}/api/contacts`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, contact })
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to remove contact');
      }

      fetchContacts(username);
    } catch (err) {
      setError(err.message);
    }
  };

  const handleCall = (contact) => {
    if (!socket) return;
    setCallStatus('calling');
    localStorage.setItem('callWith', contact);
    socket.emit('call-request', { to: contact, from: username });
    setTimeout(() => {
      if (callStatus === 'calling') {
        setCallStatus('');
      }
    }, 10000);
  };

  const handleAcceptCall = () => {
    if (!socket || !incomingCall) return;
    socket.emit('call-accepted', { to: incomingCall.from, from: username });
    localStorage.setItem('callWith', incomingCall.from);
    setIncomingCall(null);
    navigate('/chat');
  };

  const handleDeclineCall = () => {
    if (!socket || !incomingCall) return;
    socket.emit('call-rejected', { to: incomingCall.from, from: username });
    setIncomingCall(null);
  };

  const handleLogout = () => {
    localStorage.removeItem('username');
    navigate('/login');
  };

  if (loading) {
    return (
      <div className="app">
        <div className="container">
          <p>Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <div className="container">
        <header className="header">
          <h1>Dashboard</h1>
          <div className="header-right">
            <span className="username-display">{username}</span>
            <button onClick={handleLogout} className="btn btn-secondary">Logout</button>
          </div>
        </header>

        {error && <div className="error-message">{error}</div>}

        {callStatus === 'calling' && (
          <div className="status-message">Calling...</div>
        )}

        {callStatus === 'rejected' && (
          <div className="status-message">Call was rejected</div>
        )}

        <div className="dashboard-content">
          <div className="add-contact-section">
            <h3>Add Contact</h3>
            <form onSubmit={handleAddContact} className="add-contact-form">
              <input
                type="text"
                value={newContact}
                onChange={(e) => setNewContact(e.target.value)}
                placeholder="Enter username to add"
                className="contact-input"
              />
              <button type="submit" className="btn btn-primary">Add</button>
            </form>
          </div>

          <div className="contacts-section">
            <h3>Contacts ({contacts.length})</h3>
            {contacts.length === 0 ? (
              <p className="no-contacts">No contacts yet. Add someone to start chatting!</p>
            ) : (
              <ul className="contact-list">
                {contacts.map(contact => (
                  <li key={contact} className="contact-item">
                    <span className="contact-name">{contact}</span>
                    <div className="contact-actions">
                      <button
                        onClick={() => handleCall(contact)}
                        className="btn btn-primary"
                      >
                        Chat
                      </button>
                      <button
                        onClick={() => handleRemoveContact(contact)}
                        className="btn btn-secondary"
                      >
                        Remove
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {incomingCall && (
          <div className="modal-overlay">
            <div className="modal">
              <div className="modal-header">
                <h3>Incoming Chat Request</h3>
              </div>
              <div className="modal-content">
                <p>{incomingCall.from} wants to chat with you</p>
                <div className="modal-actions">
                  <button onClick={handleAcceptCall} className="btn btn-primary">
                    Accept
                  </button>
                  <button onClick={handleDeclineCall} className="btn btn-secondary">
                    Decline
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Dashboard;
