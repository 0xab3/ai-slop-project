import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Landing from './Landing';
import Chat from './Chat';
import Manual from './Manual';
import Login from './Login';
import Register from './Register';
import Dashboard from './Dashboard';

const PrivateRoute = ({ children }) => {
  const username = localStorage.getItem('username');
  return username ? children : <Navigate to="/login" />;
};

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/dashboard" element={<PrivateRoute><Dashboard /></PrivateRoute>} />
        <Route path="/chat" element={<PrivateRoute><Chat /></PrivateRoute>} />
        <Route path="/manual" element={<Manual />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
);
